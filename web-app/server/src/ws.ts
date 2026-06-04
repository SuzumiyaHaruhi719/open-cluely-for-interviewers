import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { WS_PATH } from '@open-cluely/contract';
import type {
  FollowUpOutput,
  GenerationTrigger,
  RankedQuestion,
  ServerMessage,
  TokenUsage
} from '@open-cluely/contract';
import { createHeadlessSession } from '@open-cluely/copilot-core';
import { config } from './config';
import { createAsrRelay, type AsrRelay, type VolcCredentials } from './asr-relay';
import { getRetriever } from './question-bank';
import { toRankedQuestions } from './ranked';
import { createAutoTrigger, type AutoTrigger } from './auto-trigger';
import { createSpeakerRoleMap, type SpeakerRoleMap } from './speaker-roles';
import { stampRole, isCandidateFinal } from './ws-speaker';

// Top-K real interview questions threaded into Block D as OPTIONAL grounding.
const BANK_GROUNDING_TOP_K = 6;

/**
 * Resolve the dir Customize-mode pipelines live in — the SAME dir the pipelines
 * route writes to (`${DATA_DIR}/pipelines`). Passing it to the headless session
 * lets `getActivePipeline` load a saved custom pipeline by `activePipelineId`.
 * Resolved lazily (per connection) so a test can set DATA_DIR first.
 */
function pipelinesDir(): string {
  const base = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
  return path.join(base, 'pipelines');
}

/**
 * Retrieve high-frequency interview questions semantically similar to the
 * candidate's answer. NEVER throws and NEVER blocks analysis — any failure
 * (no key, embed error, missing vectors) resolves to []. The retriever itself
 * already swallows errors; the try/catch is belt-and-suspenders for the lazy
 * singleton construction.
 */
async function retrieveBankGrounding(candidateAnswer: string): Promise<string[]> {
  try {
    const retriever = getRetriever();
    const hits = await retriever.retrieve({ queryText: candidateAnswer, topK: BANK_GROUNDING_TOP_K });
    return hits.map((h) => h.question).filter((q): q is string => typeof q === 'string' && q.length > 0);
  } catch {
    return [];
  }
}

// --- Incoming message validation (mirrors ClientMessage) -------------------

const audioSourceSchema = z.enum(['mic', 'display']);

const sessionConfigSchema = z
  .object({
    mode: z.enum(['fast', 'expert', 'expert2', 'customize']).optional(),
    resumeText: z.string().optional(),
    jobDescription: z.string().optional(),
    outputLanguage: z.enum(['', 'zh', 'en']).optional(),
    activePipelineId: z.string().nullable().optional(),
    // Opt-in: when true, a FINAL interviewee ('display') transcript auto-runs
    // analyze. Default off so live audio only streams transcripts (no surprise
    // model spend). The interviewer can still press Analyze manually.
    autoAnalyzeDisplay: z.boolean().optional(),
    // Realtime ASR provider + (for 'volc') Doubao/Volcengine credentials. These
    // are stored on the relay and used for the NEXT `audio-control start`. The
    // creds are application secrets for the user's own Volc account; the server
    // uses them to open the Volc WebSocket and NEVER logs them.
    asrProvider: z.enum(['paraformer', 'volc', 'funasr']).optional(),
    volcAppId: z.string().optional(),
    volcAccessToken: z.string().optional(),
    volcResourceId: z.string().optional(),
    volcModel: z.string().optional(),
    // CAM++ diarizer sidecar URL (offline). The text engine is asrProvider;
    // `diarize` adds local CAM++ speaker labelling on top of it.
    funasrUrl: z.string().optional(),
    diarize: z.boolean().optional()
  })
  .passthrough();

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), config: sessionConfigSchema }),
  z.object({
    type: z.literal('analyze'),
    requestId: z.string(),
    candidateAnswer: z.string(),
    questionHistory: z.array(z.string()).optional()
  }),
  z.object({ type: z.literal('audio'), seq: z.number(), source: audioSourceSchema, pcm: z.string() }),
  z.object({ type: z.literal('audio-control'), action: z.enum(['start', 'stop']), source: audioSourceSchema }),
  z.object({
    type: z.literal('set-speaker-role'),
    speakerId: z.number(),
    role: z.enum(['interviewer', 'candidate', 'unknown'])
  }),
  z.object({ type: z.literal('context-note'), note: z.string().min(1) })
]);

type ClientMessageParsed = z.infer<typeof clientMessageSchema>;

// --- emit() -> ServerMessage translation -----------------------------------

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0, total: 0 };

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

interface ProgressPayload {
  requestId: string;
  phase: string;
  index: number;
  total: number;
  status: 'start' | 'done';
  model?: string;
  tokens?: { input: number; output: number } | null;
}

/** Map a copilot-core emit(channel,payload) onto the wire protocol. */
function makeEmit(ws: WebSocket) {
  return (channel: string, payload: unknown): void => {
    if (channel === 'interviewer-progress') {
      const p = (payload ?? {}) as Partial<ProgressPayload>;
      send(ws, {
        type: 'progress',
        requestId: String(p.requestId ?? ''),
        phase: String(p.phase ?? ''),
        index: Number(p.index ?? 0),
        total: Number(p.total ?? 0),
        status: p.status === 'done' ? 'done' : 'start',
        model: p.model,
        tokens: p.tokens ?? null
      });
    } else if (channel === 'session-context-updated') {
      send(ws, { type: 'session-context', state: payload });
    }
  };
}

// --- analyze result -> FollowUpOutput --------------------------------------

interface FastQuestion {
  question?: string;
  rationale?: string;
}

interface AnalyzeResult {
  mode?: string;
  output?: FollowUpOutput;
  stage2?: { parsed?: { questions?: FastQuestion[] } } | null;
  // Expert/Customize modes carry the per-block results; Fast mode omits them.
  // `toRankedQuestions` reads D (candidate pool) + E (rubric scores) from here.
  blocks?: {
    D?: { candidates?: Array<{ id?: string; question?: string }> } | null;
    E?: { ranked?: Array<{ id?: string; total?: number; reasoning?: string }> } | null;
  } | null;
  shouldShowFollowUps?: boolean;
  tokensUsed?: TokenUsage;
  elapsedMs?: number;
  iterationVersion?: string;
  skipped?: boolean;
  reason?: string;
}

/** Build a FollowUpOutput defensively: prefer result.output, else synthesize from fast-mode stage2. */
function toFollowUpOutput(result: AnalyzeResult): FollowUpOutput {
  if (result.output) return result.output;
  const questions = result.stage2?.parsed?.questions ?? [];
  return {
    primary_question: questions[0]?.question ?? '',
    alternative_question: questions[1]?.question ?? '',
    rationale_for_interviewer: questions[0]?.rationale ?? '',
    anchor_quotes: [],
    expected_evidence_yield: '',
    iteration_version: result.iterationVersion ?? ''
  };
}

// --- per-connection wiring --------------------------------------------------

type HeadlessSession = ReturnType<typeof createHeadlessSession>;

interface RunAnalysisArgs {
  candidateAnswer: string;
  questionHistory?: string[];
  requestId: string;
  /** Distinguishes the autonomous monitor ('auto') from manual Generate Q ('manual'). */
  trigger: GenerationTrigger;
}

/**
 * The SINGLE analyze-and-emit path shared by manual Generate Q and the autonomous
 * trigger monitor. Both emit identical `progress` (via the session's emit) and a
 * `result` carrying `output` + the scored `ranked` pool — the ONLY difference is
 * the `trigger` flag. Returns nothing; a `skipped` result emits an `error` instead.
 */
async function runAnalysis(ws: WebSocket, session: HeadlessSession, args: RunAnalysisArgs): Promise<void> {
  // Question-bank grounding — retrieved BEFORE analysis, passed to every mode:
  // Expert 1.0/2.0/Customize ground Block D; Fast grounds its Stage-2 prompt.
  // Retrieval never throws/blocks (returns [] on any failure).
  const bankQuestions = await retrieveBankGrounding(args.candidateAnswer);

  const result = (await session.analyze({
    candidateAnswer: args.candidateAnswer,
    questionHistory: args.questionHistory ?? [],
    requestId: args.requestId,
    bankQuestions
  })) as AnalyzeResult;

  if (result.skipped) {
    send(ws, { type: 'error', requestId: args.requestId, message: `skipped: ${result.reason ?? 'unknown'}` });
    return;
  }

  const ranked: RankedQuestion[] = toRankedQuestions(result);

  send(ws, {
    type: 'result',
    requestId: args.requestId,
    mode: result.mode ?? 'fast',
    output: toFollowUpOutput(result),
    shouldShowFollowUps: !!result.shouldShowFollowUps,
    tokensUsed: result.tokensUsed ?? ZERO_TOKENS,
    elapsedMs: result.elapsedMs ?? 0,
    iterationVersion: result.iterationVersion ?? '',
    ranked,
    trigger: args.trigger
  });
}

/**
 * Manual Generate Q. Shares the auto-trigger's in-flight/cooldown bookkeeping so
 * a manual run and the monitor never overlap: markManualRun() claims the slot +
 * resets the cooldown up front; markRunDone() releases it on settle.
 */
async function handleAnalyze(
  ws: WebSocket,
  session: HeadlessSession,
  trigger: AutoTrigger,
  msg: Extract<ClientMessageParsed, { type: 'analyze' }>
): Promise<void> {
  trigger.markManualRun(msg.candidateAnswer);
  try {
    await runAnalysis(ws, session, {
      candidateAnswer: msg.candidateAnswer,
      questionHistory: msg.questionHistory,
      requestId: msg.requestId,
      trigger: 'manual'
    });
  } finally {
    trigger.markRunDone(msg.candidateAnswer);
  }
}

type ConfigurePayload = Extract<ClientMessageParsed, { type: 'configure' }>['config'];

/**
 * Resolve per-session Volc creds, falling back to VOLC_* env defaults for any
 * field the configure message omits. configure values ALWAYS win. SECURITY: the
 * returned object is handed to the relay (which opens the Volc socket) and is
 * NEVER logged here or by the relay.
 */
function resolveVolcCreds(cfg: ConfigurePayload): VolcCredentials {
  return {
    // `||` (not `??`) so a BLANK field from the browser ('' — not undefined) still
    // falls back to the server's VOLC_* env creds (.env). With `??`, an empty
    // string would win over the env default and break the fallback.
    appId: String(cfg.volcAppId || config.volcAppId).trim(),
    accessToken: String(cfg.volcAccessToken || config.volcAccessToken).trim(),
    resourceId: String(cfg.volcResourceId || config.volcResourceId).trim() || undefined,
    model: String(cfg.volcModel || config.volcModel).trim() || undefined
  };
}

/**
 * Push ASR provider + Volc creds from a configure message onto the relay. Called
 * only when at least one ASR field is present so an unrelated configure (e.g. a
 * mode change) does not reset the provider. The provider defaults to the env
 * default ('volc' only if VOLC creds exist, else 'paraformer') when the message
 * supplies creds but no explicit provider.
 */
function applyAsrConfig(relay: AsrRelay, cfg: ConfigurePayload): void {
  const hasAsrField =
    cfg.asrProvider !== undefined ||
    cfg.volcAppId !== undefined ||
    cfg.volcAccessToken !== undefined ||
    cfg.volcResourceId !== undefined ||
    cfg.volcModel !== undefined ||
    cfg.funasrUrl !== undefined;
  if (!hasAsrField) return;
  const creds = resolveVolcCreds(cfg);
  // asrProvider is the TEXT engine (paraformer | volc); `diarize` adds local CAM++
  // speaker labelling on top (offline single-mic). Back-compat: older clients sent
  // asrProvider:'funasr' to mean "paraformer text + diarize".
  const legacyFunasr = cfg.asrProvider === 'funasr';
  const textProvider: 'paraformer' | 'volc' = legacyFunasr
    ? 'paraformer'
    : cfg.asrProvider === 'volc' || (cfg.asrProvider === undefined && creds.appId && creds.accessToken)
      ? 'volc'
      : 'paraformer';
  // Only change diarize when it's EXPLICITLY in this message (or legacy funasr).
  // A PARTIAL configure (e.g. a provider/settings change) omits diarize and must
  // NOT clobber the offline diarization flag set by the full session config.
  if (cfg.diarize !== undefined || legacyFunasr) {
    relay.setDiarize(cfg.diarize === true || legacyFunasr);
  }
  relay.setAsrProvider(textProvider, creds, { url: cfg.funasrUrl ?? '' });
}

export async function dispatch(
  ws: WebSocket,
  session: HeadlessSession,
  relay: AsrRelay,
  trigger: AutoTrigger,
  roles: SpeakerRoleMap,
  injectNote: (note: string) => void,
  msg: ClientMessageParsed
): Promise<void> {
  switch (msg.type) {
    case 'configure':
      session.configure(msg.config);
      // The opt-in auto-analyze flag is relay state, not session state.
      if (typeof msg.config.autoAnalyzeDisplay === 'boolean') {
        relay.setAutoAnalyzeDisplay(msg.config.autoAnalyzeDisplay);
      }
      // Autonomous generation toggle: monitor state, default ON. A configure that
      // omits the field leaves the current setting untouched (so an unrelated
      // mode change doesn't silently flip autonomy).
      if (typeof msg.config.autoGenerate === 'boolean') {
        trigger.setAutoGenerate(msg.config.autoGenerate);
      }
      // ASR provider + Volc creds are relay state too. Apply when present so the
      // NEXT audio-control start uses the chosen provider/creds. Volc creds carry
      // forward across configures (a later configure that only flips the provider
      // keeps earlier-entered creds).
      applyAsrConfig(relay, msg.config);
      return;
    case 'analyze':
      await handleAnalyze(ws, session, trigger, msg);
      return;
    case 'audio':
      relay.handleAudio({ source: msg.source, pcmBase64: msg.pcm });
      return;
    case 'audio-control':
      relay.handleAudioControl({ action: msg.action, source: msg.source });
      return;
    case 'set-speaker-role':
      roles.setRole(msg.speakerId, msg.role);
      return;
    case 'context-note':
      // "Add a note to the context": fold the interviewer's manual note into the
      // SAME accumulated candidate answer the autonomous trigger watches, so AUTO
      // generation sees it too (manual Generate Q also carries it via candidateAnswer).
      injectNote(msg.note);
      return;
  }
}

function onMessage(
  ws: WebSocket,
  session: HeadlessSession,
  relay: AsrRelay,
  trigger: AutoTrigger,
  roles: SpeakerRoleMap,
  injectNote: (note: string) => void,
  raw: unknown
): void {
  let requestId: string | undefined;
  void (async () => {
    try {
      const text = typeof raw === 'string' ? raw : String(raw);
      const json: unknown = JSON.parse(text);
      const parsed = clientMessageSchema.safeParse(json);
      if (!parsed.success) {
        send(ws, { type: 'error', message: parsed.error.issues[0]?.message ?? 'invalid message' });
        return;
      }
      if (parsed.data.type === 'analyze') requestId = parsed.data.requestId;
      await dispatch(ws, session, relay, trigger, roles, injectNote, parsed.data);
    } catch (err) {
      // A handler error must never close the socket.
      const message = err instanceof Error ? err.message : 'handler error';
      send(ws, { type: 'error', requestId, message });
    }
  })();
}

/**
 * Run an analysis turn for an interviewee FINAL transcript (the opt-in
 * autoAnalyzeDisplay path — fires Expert on EVERY display final, ungated). This
 * is SEPARATE from the autonomous trigger monitor (which gates + debounces +
 * asks Flash). Failures are swallowed (best-effort) — they must not break the
 * relay. Bookkeeping is shared with the monitor via markManualRun/markRunDone so
 * the two transcript-driven paths never overlap.
 */
function autoAnalyzeFromTranscript(
  ws: WebSocket,
  session: HeadlessSession,
  trigger: AutoTrigger,
  text: string
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  void handleAnalyze(ws, session, trigger, {
    type: 'analyze',
    requestId: randomUUID(),
    candidateAnswer: trimmed,
    questionHistory: []
  }).catch((err) => {
    const message = err instanceof Error ? err.message : 'auto-analyze error';
    send(ws, { type: 'error', message });
  });
}

/** Attach the WebSocket server (path = WS_PATH) to an existing http.Server. */
export function attachWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on('connection', (ws: WebSocket) => {
    const session = createHeadlessSession({
      apiKey: config.dashscopeApiKey,
      emit: makeEmit(ws),
      // Customize mode RUNS a saved custom pipeline: the brain's
      // getActivePipeline reads activePipelineId (set via configure) and loads
      // the pipeline JSON from this dir — the same one the pipelines route saves to.
      pipelinesDir: pipelinesDir()
    });

    // Per-connection speaker-role map. FunASR segments carry a speakerId that
    // resolves to a role here; online providers carry no id (resolve(null) =
    // 'unknown') so the role gating below is inert for them.
    const roles = createSpeakerRoleMap();

    // Accumulated interviewee FINAL transcript — the candidate's answer so far.
    // The trigger monitor gates on its LENGTH (new chars since the last fire) and
    // generates from its content. Partial transcripts are not accumulated here.
    let accumulatedDisplayFinal = '';

    // The SINGLE finalized-interviewee-answer seam: accumulate the new segment and
    // feed the running answer to the autonomous trigger monitor. ONLINE mode hits
    // this via display finals; OFFLINE funasr hits the SAME function for candidate
    // finals. Factored out so both paths share identical accumulation + trigger.
    function feedCandidateAnswer(rawSegment: string): void {
      const segment = rawSegment.trim();
      if (segment) {
        accumulatedDisplayFinal = accumulatedDisplayFinal
          ? `${accumulatedDisplayFinal} ${segment}`
          : segment;
      }
      trigger.onCandidateFinal(accumulatedDisplayFinal);
    }

    // The autonomous trigger monitor (per connection). `runAnalyze` reuses the
    // SAME analyze-and-emit path manual Generate Q uses; only the `trigger` flag
    // differs ('auto'). The monitor owns its own isGenerating slot for auto fires
    // (set inside its evaluate()), so this runAnalyze just emits — it must NOT
    // touch markManualRun/markRunDone or it would double-claim the slot.
    const trigger: AutoTrigger = createAutoTrigger({
      runAnalyze: ({ candidateAnswer }) =>
        runAnalysis(ws, session, {
          candidateAnswer,
          questionHistory: [],
          requestId: randomUUID(),
          trigger: 'auto'
        })
    });

    // One ASR relay per connection. Transcripts stream straight back as
    // `transcript` messages. TWO transcript-driven generation paths hang off the
    // interviewee ('display') lane: (1) the autonomous trigger monitor, fed the
    // accumulated final text on EVERY display final (it gates/debounces/asks
    // Flash internally); (2) the legacy opt-in autoAnalyzeDisplay, which fires
    // Expert ungated on each display final (via onDisplayFinal). They share the
    // trigger's in-flight bookkeeping so they never overlap.
    const relay = createAsrRelay({
      emit: (t) => {
        // Stamp the resolved speaker role + carry speakerId so the browser can
        // label lanes and offer a per-speaker role override.
        const stamped = stampRole(roles, t);
        // Only attach the speaker fields when the provider actually diarized (a
        // numeric speakerId). Online (paraformer/volc) carries none, so the wire
        // shape stays byte-identical to before and the browser builds no segment.
        send(
          ws,
          stamped.speakerId == null
            ? {
                type: 'transcript',
                source: stamped.source,
                text: stamped.text,
                isFinal: stamped.isFinal
              }
            : {
                type: 'transcript',
                source: stamped.source,
                text: stamped.text,
                isFinal: stamped.isFinal,
                speakerId: stamped.speakerId,
                speaker: stamped.speaker
              }
        );
        // ONLINE seam (paraformer/volc): interviewee answers arrive on the
        // 'display' lane with no speakerId — unchanged byte-for-byte.
        if (t.source === 'display' && t.isFinal) {
          feedCandidateAnswer(t.text);
        }
        // OFFLINE seam (funasr): a finalized CANDIDATE segment (by speaker role,
        // not source) feeds the SAME trigger path. Inert online: resolve(null) =
        // 'unknown' so isCandidateFinal is always false there.
        else if (isCandidateFinal(roles, t)) {
          feedCandidateAnswer(t.text);
        }
      },
      onDisplayFinal: (text) => autoAnalyzeFromTranscript(ws, session, trigger, text)
    });

    // Seed the relay from VOLC_* env defaults (if any) so a deployment can ship
    // default Doubao creds without the browser sending them. A per-session
    // configure still overrides this. Paraformer stays the default provider.
    if (config.volcAppId && config.volcAccessToken) {
      relay.setAsrProvider('paraformer', {
        appId: config.volcAppId,
        accessToken: config.volcAccessToken,
        resourceId: config.volcResourceId || undefined,
        model: config.volcModel || undefined
      });
    }

    send(ws, { type: 'ready', sessionId: randomUUID() });

    ws.on('message', (data) =>
      onMessage(ws, session, relay, trigger, roles, feedCandidateAnswer, data.toString())
    );
    ws.on('error', () => {
      /* swallow socket errors — connection cleanup happens on 'close' */
    });
    ws.on('close', () => {
      relay.dispose();
    });
  });

  return wss;
}

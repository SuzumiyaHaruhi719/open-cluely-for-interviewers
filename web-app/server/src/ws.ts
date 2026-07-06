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
  SessionContextState,
  SummaryDebugEvent,
  TokenUsage
} from '@open-cluely/contract';
import { createHeadlessSession } from '@open-cluely/copilot-core';
import { config } from './config';
import { createAsrRelay, type AsrRelay, type VolcCredentials } from './asr-relay';
import { getRetriever } from './question-bank';
import { toRankedQuestions } from './ranked';
import { createAutoTrigger, type AutoTrigger } from './auto-trigger';
import { createSessionContextAnalyzer } from './session-context-analyzer';
import {
  analyzeSessionContext,
  analyzeSummary,
  analyzeSummaryStream,
  buildAnalysisInput,
  buildSummaryInput,
  resolveSummarySystemPrompt,
  type SummaryResult,
  type StreamCallbacks
} from './interview-analysis';
import { createSummaryTelemetry, type SummaryTelemetry, type SummaryTelemetryEvent } from './summary-telemetry';
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
    asrProvider: z.enum(['paraformer', 'volc', 'funasr', 'xfyun', 'sim']).optional(),
    volcAppId: z.string().optional(),
    volcAccessToken: z.string().optional(),
    volcResourceId: z.string().optional(),
    volcModel: z.string().optional(),
    // Simulation script for asrProvider 'sim' (mic-less test harness): the relay
    // stores the latest one and replays it on the NEXT audio-control start.
    simScript: z.array(z.object({ speakerId: z.number(), text: z.string() })).optional(),
    // CAM++ diarizer sidecar URL (offline). The text engine is asrProvider;
    // `diarize` adds local CAM++ speaker labelling on top of it.
    funasrUrl: z.string().optional(),
    diarize: z.boolean().optional(),
    // How autonomous generation fires while autoGenerate is on: 'agent' (the Flash
    // monitor decides; default) or 'interval' (fixed ~30s wall-clock cadence, no gate).
    autoMode: z.enum(['agent', 'interval']).optional(),
    // Interviewer-adjustable cadence (ms) for 'interval' mode. Clamped server-side
    // to a 5s floor; absent leaves the current cadence (default 30000) untouched.
    autoIntervalMs: z.number().optional(),
    // One-shot signal from a new/switched chat: abandon the previous chat's
    // accumulated transcript AND in-flight generation (see SessionConfig docs).
    resetGeneration: z.boolean().optional(),
    // Per-session summary model override (Feature 2). When set, overrides the
    // server's INTERVIEWER_SUMMARY_MODEL / getSummaryModel() default for this
    // connection's next summarize call.
    summaryModel: z.string().optional(),
    // Per-session custom summary prompt (Feature 3).
    // 'default' keeps the built-in SUMMARY_SYSTEM; 'custom' uses summaryPromptText
    // when non-empty, else falls back to the built-in default.
    summaryPromptMode: z.enum(['default', 'custom']).optional(),
    summaryPromptText: z.string().optional()
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
  z.object({ type: z.literal('context-note'), note: z.string().min(1) }),
  z.object({ type: z.literal('summarize'), requestId: z.string(), transcript: z.string().optional() })
]);

type ClientMessageParsed = z.infer<typeof clientMessageSchema>;

// --- emit() -> ServerMessage translation -----------------------------------

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0, total: 0 };

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function telemetryToDebugEvent(
  type: SummaryTelemetryEvent['type'],
  detail: Partial<SummaryTelemetryEvent>,
  at: number
): SummaryDebugEvent {
  const stage = typeof detail.stage === 'string' && detail.stage.length > 0 ? detail.stage : type;
  return {
    at,
    source: detail.source ?? 'server',
    stage,
    ...(detail.model ? { model: detail.model } : {}),
    ...(typeof detail.status === 'number' ? { status: detail.status } : {}),
    ...(detail.eventType ? { eventType: detail.eventType } : {}),
    ...(typeof detail.inputChars === 'number' ? { inputChars: detail.inputChars } : {}),
    ...(typeof detail.chunkChars === 'number' ? { chunkChars: detail.chunkChars } : {}),
    ...(typeof detail.accumulatedChars === 'number' ? { accumulatedChars: detail.accumulatedChars } : {}),
    ...(typeof detail.inputTokens === 'number' ? { inputTokens: detail.inputTokens } : {}),
    ...(typeof detail.outputTokens === 'number' ? { outputTokens: detail.outputTokens } : {}),
    ...(typeof detail.elapsedMs === 'number' ? { elapsedMs: detail.elapsedMs } : {}),
    ...(detail.reason ? { reason: detail.reason } : {}),
    ...(detail.error ? { error: detail.error } : {})
  };
}

function sendSummaryDebug(ws: WebSocket, requestId: string, event: SummaryDebugEvent): void {
  send(ws, { type: 'summary-debug', requestId, event });
}

function withSummaryDebugFrames(
  telemetry: SummaryTelemetry | undefined,
  ws: WebSocket,
  requestId: string
): SummaryTelemetry {
  return {
    record(type, detail = {}): void {
      const fullDetail = { ...detail, requestId };
      telemetry?.record(type, fullDetail);
      sendSummaryDebug(ws, requestId, telemetryToDebugEvent(type, fullDetail, Date.now()));
    },
    snapshot(): SummaryTelemetryEvent[] {
      return telemetry?.snapshot() ?? [];
    },
    clear(): void {
      telemetry?.clear();
    }
  };
}

// A process-wide summary telemetry log so the (30–60s, otherwise opaque) summary
// lifecycle is observable across connections. Bounded ring buffer — see
// `summary-telemetry.ts`. Exposed for an ops/health surface to snapshot.
const summaryTelemetry = createSummaryTelemetry({ onEvent: logSummaryTelemetryEvent });

/** The process-wide summary telemetry recorder (lifecycle event log). */
export function getSummaryTelemetry(): SummaryTelemetry {
  return summaryTelemetry;
}

function logSummaryTelemetryEvent(event: SummaryTelemetryEvent): void {
  const debug = telemetryToDebugEvent(event.type, event, event.at);
  const parts = [
    '[summary-debug]',
    `requestId=${event.requestId ?? '-'}`,
    `source=${debug.source}`,
    `stage=${debug.stage}`
  ];
  if (debug.model) parts.push(`model=${debug.model}`);
  if (typeof debug.status === 'number') parts.push(`status=${debug.status}`);
  if (debug.eventType) parts.push(`event=${debug.eventType}`);
  if (typeof debug.inputChars === 'number') parts.push(`inputChars=${debug.inputChars}`);
  if (typeof debug.chunkChars === 'number') parts.push(`chunkChars=${debug.chunkChars}`);
  if (typeof debug.accumulatedChars === 'number') parts.push(`accumulatedChars=${debug.accumulatedChars}`);
  if (typeof debug.inputTokens === 'number') parts.push(`inputTokens=${debug.inputTokens}`);
  if (typeof debug.outputTokens === 'number') parts.push(`outputTokens=${debug.outputTokens}`);
  if (typeof debug.elapsedMs === 'number') parts.push(`elapsedMs=${debug.elapsedMs}`);
  if (debug.reason) parts.push(`reason=${JSON.stringify(debug.reason)}`);
  if (debug.error) parts.push(`error=${JSON.stringify(debug.error)}`);
  console.info(parts.join(' '));
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

/**
 * Map a copilot-core emit(channel,payload) onto the wire protocol. `isStale`
 * lets a NEW/switched chat suppress the leftover `progress` of an abandoned
 * in-flight auto generation: when it returns true for the event's requestId the
 * progress is dropped (so a stale progress bar never appears in the new chat).
 */
function makeEmit(ws: WebSocket, isStale: (requestId: string) => boolean) {
  return (channel: string, payload: unknown): void => {
    if (channel === 'interviewer-progress') {
      const p = (payload ?? {}) as Partial<ProgressPayload>;
      if (isStale(String(p.requestId ?? ''))) return;
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
      // Legacy forward: copilot-core may emit its own session-context payload. The
      // wire `state` is typed as SessionContextState; this payload is untyped from
      // core, so cast through unknown. The client parses/renders it defensively.
      send(ws, { type: 'session-context', state: payload as SessionContextState });
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
  /**
   * Optional staleness probe for the AUTO path. When it returns true at settle
   * time, a reset() (new/switched chat) happened mid-flight, so this generation
   * belongs to the abandoned chat: its `result` is NOT emitted (and the matching
   * progress was already suppressed by makeEmit). Absent for manual runs.
   */
  isStale?: () => boolean;
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

  // A reset() (new/switched chat) landed while this auto generation was running:
  // the result belongs to the abandoned chat. Drop it silently so the new chat
  // shows nothing leftover (a 'skipped' error is likewise dropped, not surfaced).
  if (args.isStale?.()) return;

  if (result.skipped) {
    send(ws, { type: 'error', requestId: args.requestId, message: `skipped: ${result.reason ?? 'unknown'}` });
    return;
  }

  const ranked: RankedQuestion[] = toRankedQuestions(result);

  // The runtime echoes the PIPELINE label, not the user-selected mode: Expert 2.0
  // (expert2) internally runs the merged-DE chain tagged mode:'expert', so
  // result.mode would mislabel an expert2 result as 'expert'. session.getMode()
  // returns the TRUE selected mode ('fast'|'expert'|'expert2'|'customize'); prefer
  // it, falling back to the result's label then 'fast'.
  const trueMode = session.getMode() || result.mode || 'fast';

  send(ws, {
    type: 'result',
    requestId: args.requestId,
    mode: trueMode,
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

/** Injectable deps for handleSummarize (defaults wire production analyzeSummaryStream). */
export interface SummarizeDeps {
  /**
   * The one-shot summary runner; injected in tests that don't need streaming.
   * When this is set, streaming is skipped (no summary-chunk events) — the whole
   * report arrives as a single summary-done (legacy test path).
   */
  readonly analyze?: (input: string, deps?: { telemetry?: SummaryTelemetry; requestId?: string }) => Promise<SummaryResult>;
  /**
   * The streaming summary runner; defaults to the real `analyzeSummaryStream`.
   * Emits `summary-chunk` events as text accumulates, then a final `summary-done`.
   * Tests that inject `analyze` bypass this entirely.
   */
  readonly analyzeStream?: (
    input: string,
    callbacks: StreamCallbacks,
    deps: { telemetry?: SummaryTelemetry; requestId?: string; model?: string }
  ) => Promise<SummaryResult>;
  /** Optional lifecycle recorder so the (slow, opaque) summary flow is observable. */
  readonly telemetry?: SummaryTelemetry;
  /** Per-session summary model override (set via SessionConfig.summaryModel). */
  readonly summaryModel?: string;
  /**
   * Per-session custom system prompt for the evaluation report (Feature 3).
   * When non-empty, replaces the default SUMMARY_SYSTEM prompt for this call.
   * An empty string (or undefined) falls back to the default.
   */
  readonly summarySystemPrompt?: string;
}

/**
 * Handle a `summarize` request: build the summary input from the per-connection
 * accumulated transcript (both lanes) + captured JD/résumé, stream the report
 * via `summary-chunk` events as it generates, and reply with a final `summary-done`.
 *
 * Streaming path (production):
 *   Each SSE text delta → `summary-chunk {requestId, text}` (client accumulates).
 *   Final `summary-done {requestId, model}` (no `text` — client already has it).
 *
 * Legacy one-shot path (tests that inject `analyze`):
 *   No `summary-chunk` events — whole report arrives on `summary-done {text}`.
 *
 * An EMPTY transcript replies with a friendly `summary-done` flagged `empty:true`.
 * Any model failure → `summary-error`.
 */
export async function handleSummarize(
  ws: WebSocket,
  buildSummary: () => string,
  requestId: string,
  deps: SummarizeDeps = {}
): Promise<void> {
  const tel = withSummaryDebugFrames(deps.telemetry, ws, requestId);
  tel?.record('requested', { requestId });

  const input = buildSummary();
  if (!input) {
    // Friendly empty-state — surfaced as a non-error reply flagged `empty:true` so
    // the modal renders a NOTICE, not a fake evaluation report.
    send(ws, {
      type: 'summary-done',
      requestId,
      empty: true,
      text: '还没有可总结的面试内容。\n\nThere is no interview content to summarize yet — start the conversation first.'
    });
    tel?.record('stream-event', { requestId, source: 'server', stage: 'summary-done-sent', reason: 'empty' });
    tel?.record('done', { requestId, reason: 'empty' });
    return;
  }
  tel?.record('input-built', { requestId, inputChars: input.length });

  // Legacy one-shot path: tests inject `analyze` to avoid streaming complexity.
  if (deps.analyze) {
    try {
      const result = await deps.analyze(input, { telemetry: tel, requestId });
      const text = result.fellBack
        ? `> 注意：所选总结模型不可用，已回退到 ${result.model}。\n\n${result.text}`
        : result.text;
      tel?.record('stream-event', {
        requestId,
        source: 'server',
        stage: 'summary-done-sent',
        model: result.model,
        accumulatedChars: text.length
      });
      send(ws, { type: 'summary-done', requestId, text, model: result.model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'summary failed';
      tel?.record('error', { requestId, error: message });
      tel?.record('stream-event', { requestId, source: 'server', stage: 'summary-error-sent', error: message });
      send(ws, { type: 'summary-error', requestId, message });
    }
    return;
  }

  // Streaming path (production): emit summary-chunk per delta.
  const streamFn = deps.analyzeStream ?? analyzeSummaryStream;
  const callbacks: StreamCallbacks = {
    onDelta: (text) => {
      tel?.record('stream-event', {
        requestId,
        source: 'server',
        stage: 'summary-chunk-sent',
        chunkChars: text.length
      });
      send(ws, { type: 'summary-chunk', requestId, text });
    },
    onUsage: (usage) => {
      tel?.record('stream-event', {
        requestId,
        source: 'server',
        stage: 'usage',
        inputTokens: usage.input,
        outputTokens: usage.output
      });
    }
  };

  try {
    const result = await streamFn(input, callbacks, {
      telemetry: tel,
      requestId,
      model: deps.summaryModel,
      summarySystemPrompt: deps.summarySystemPrompt
    });
    // For the fellBack case, prepend the notice to the accumulated text and
    // send it as a final chunk so the client sees it.
    if (result.fellBack) {
      const notice = `> 注意：所选总结模型不可用，已回退到 ${result.model}。\n\n`;
      tel?.record('stream-event', {
        requestId,
        source: 'server',
        stage: 'summary-chunk-sent',
        model: result.model,
        chunkChars: notice.length,
        reason: 'fallback-notice'
      });
      send(ws, { type: 'summary-chunk', requestId, text: notice });
    }
    // summary-done carries no `text` in streaming mode — the client has already
    // accumulated the full report via summary-chunk events.
    tel?.record('stream-event', { requestId, source: 'server', stage: 'summary-done-sent', model: result.model });
    send(ws, { type: 'summary-done', requestId, model: result.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'summary failed';
    tel?.record('error', { requestId, error: message });
    tel?.record('stream-event', { requestId, source: 'server', stage: 'summary-error-sent', error: message });
    send(ws, { type: 'summary-error', requestId, message });
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
function applyAsrConfig(relay: AsrRelay, roles: SpeakerRoleMap, cfg: ConfigurePayload): void {
  // Back-compat: older clients sent asrProvider:'funasr' to mean "paraformer text
  // + diarize". The diarize flag is separate now, so funasr still implies it.
  const legacyFunasr = cfg.asrProvider === 'funasr';
  // Apply diarize INDEPENDENTLY of the ASR fields below: a configure carrying ONLY
  // `diarize` (no provider/creds/sim) must still reach setDiarize, so this runs
  // BEFORE the hasAsrField early-return. Only change it when EXPLICITLY present (or
  // legacy funasr) — a partial configure that omits it must NOT clobber the flag.
  if (cfg.diarize !== undefined || legacyFunasr) {
    relay.setDiarize(cfg.diarize === true || legacyFunasr);
  }
  const hasAsrField =
    cfg.asrProvider !== undefined ||
    cfg.volcAppId !== undefined ||
    cfg.volcAccessToken !== undefined ||
    cfg.volcResourceId !== undefined ||
    cfg.volcModel !== undefined ||
    cfg.funasrUrl !== undefined ||
    cfg.simScript !== undefined;
  if (!hasAsrField) return;
  const creds = resolveVolcCreds(cfg);
  // Stash the simulation script (mic-less harness) so the relay replays it on the
  // NEXT audio-control start. Stored regardless of provider so the script can be
  // configured before the provider flips to 'sim'.
  if (Array.isArray(cfg.simScript)) {
    relay.setSimScript(cfg.simScript);
  }
  // asrProvider is the TEXT engine (paraformer | volc | xfyun); `diarize` (applied
  // above, independently of these ASR fields) adds local CAM++ speaker labelling on
  // top (offline single-mic) — EXCEPT xfyun, which carries its own speaker (角色分离
  // role_type=2) and needs no per-session creds (the server reads XFYUN_* from .env).
  const textProvider: 'paraformer' | 'volc' | 'xfyun' | 'sim' = legacyFunasr
    ? 'paraformer'
    : cfg.asrProvider === 'sim'
      ? 'sim'
      : cfg.asrProvider === 'xfyun'
        ? 'xfyun'
        : cfg.asrProvider === 'volc' || (cfg.asrProvider === undefined && creds.appId && creds.accessToken)
          ? 'volc'
          : 'paraformer';
  relay.setAsrProvider(textProvider, creds, { url: cfg.funasrUrl ?? '' });
  // iFlytek carries its OWN speaker cluster ids (role_type=2) the interviewer
  // labels manually → never guess for it (unassigned ids resolve to 'unknown',
  // shown as "说话人 N"). CAM++/others keep the first-seen guess.
  roles.setGuess(textProvider !== 'xfyun');
}

export async function dispatch(
  ws: WebSocket,
  session: HeadlessSession,
  relay: AsrRelay,
  trigger: AutoTrigger,
  roles: SpeakerRoleMap,
  injectNote: (note: string) => void,
  resetAccumulated: () => void,
  setContextGrounding: (jd: string | undefined, resume: string | undefined) => void,
  buildSummary: (clientTranscript?: string) => string,
  msg: ClientMessageParsed,
  /** Setter for the per-session summary model (Feature 2). */
  setSummaryModel?: (model: string | undefined) => void,
  /** Getter for the per-session summary model (Feature 2). */
  getSummaryModelOverride?: () => string | undefined,
  /** Setter for the per-session custom system prompt (Feature 3). */
  setSummaryPrompt?: (prompt: string | undefined) => void,
  /** Getter for the per-session custom system prompt (Feature 3). */
  getSummaryPromptOverride?: () => string | undefined,
  summarizeDeps: SummarizeDeps = {}
): Promise<void> {
  switch (msg.type) {
    case 'configure':
      // New/switched chat: abandon the old chat's accumulation + in-flight auto
      // generation BEFORE applying the rest of the config. trigger.reset() bumps
      // the epoch (suppressing any stale in-flight result/progress), clears the
      // interval-mode transcript + cooldown; resetAccumulated() drops the
      // per-connection candidate-answer buffer the trigger is fed from AND the
      // full-transcript buffer + pending analysis the context analyzer reads.
      if (msg.config.resetGeneration === true) {
        trigger.reset();
        roles.reset();
        resetAccumulated();
      }
      session.configure(msg.config);
      // Capture JD/résumé so the session-context analyzer can ground on them. Only
      // overwrite a field the configure actually carries (a partial configure — e.g.
      // a mode change — must NOT wipe earlier-entered JD/résumé).
      setContextGrounding(msg.config.jobDescription, msg.config.resumeText);
      // The opt-in auto-analyze flag is relay state, not session state.
      if (typeof msg.config.autoAnalyzeDisplay === 'boolean') {
        relay.setAutoAnalyzeDisplay(msg.config.autoAnalyzeDisplay);
      }
      // Autonomous generation toggle + firing mode: monitor state, default ON /
      // 'agent'. A configure that omits a field leaves that setting untouched (so an
      // unrelated change doesn't silently flip autonomy or mode). Apply setMode
      // BEFORE setAutoGenerate so that, when both are present, enabling in 'interval'
      // mode starts the cadence timer.
      // Apply the cadence BEFORE setMode so that, if this same message also
      // switches into 'interval', the freshly started timer uses the new period.
      if (typeof msg.config.autoIntervalMs === 'number') {
        trigger.setIntervalMs(msg.config.autoIntervalMs);
      }
      if (msg.config.autoMode !== undefined) {
        trigger.setMode(msg.config.autoMode);
      }
      if (typeof msg.config.autoGenerate === 'boolean') {
        trigger.setAutoGenerate(msg.config.autoGenerate);
      }
      // ASR provider + Volc creds are relay state too. Apply when present so the
      // NEXT audio-control start uses the chosen provider/creds. Volc creds carry
      // forward across configures (a later configure that only flips the provider
      // keeps earlier-entered creds).
      applyAsrConfig(relay, roles, msg.config);
      // Per-session summary model override (Feature 2). Only overwrite when the
      // configure explicitly carries the field (partial configures must not clear it).
      if (typeof msg.config.summaryModel === 'string') {
        setSummaryModel?.(msg.config.summaryModel || undefined);
      }
      // Per-session custom system prompt (Feature 3). When mode is 'custom' and
      // summaryPromptText is non-empty, store it; 'default' or blank clears it.
      if (msg.config.summaryPromptMode !== undefined || msg.config.summaryPromptText !== undefined) {
        const mode = msg.config.summaryPromptMode;
        const text = typeof msg.config.summaryPromptText === 'string'
          ? msg.config.summaryPromptText.trim()
          : undefined;
        if (mode === 'custom' && text) {
          setSummaryPrompt?.(text);
        } else if (mode === 'default' || mode === 'custom') {
          // 'default' always clears; 'custom' + empty text also falls back to default.
          setSummaryPrompt?.(undefined);
        } else if (mode === undefined && text !== undefined) {
          // No mode change but text updated: only keep if already in custom mode
          // (non-undefined prompt means custom was previously set).
          const current = getSummaryPromptOverride?.();
          if (current !== undefined) {
            setSummaryPrompt?.(text || undefined);
          }
        }
      }
      return;
    case 'analyze':
      await handleAnalyze(ws, session, trigger, msg);
      return;
    case 'audio':
      relay.handleAudio({ source: msg.source, pcmBase64: msg.pcm });
      return;
    case 'audio-control':
      relay.handleAudioControl({ action: msg.action, source: msg.source });
      // Gate autonomous follow-ups on capture state: auto (agent AND interval)
      // only fires while at least one audio source is live (the mic is On).
      trigger.setCapturing(relay.isCapturing());
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
    case 'summarize':
      // Interview summary: stream the report via summary-chunk events. Uses the
      // per-session summaryModel override (Feature 2) and prompt override (Feature 3)
      // when set; else falls back to server defaults.
      summaryTelemetry.record('stream-event', {
        requestId: msg.requestId,
        source: 'server',
        stage: 'server:received'
      });
      sendSummaryDebug(
        ws,
        msg.requestId,
        telemetryToDebugEvent(
          'stream-event',
          { requestId: msg.requestId, source: 'server', stage: 'server:received' },
          Date.now()
        )
      );
      await handleSummarize(ws, () => buildSummary(msg.transcript), msg.requestId, {
        ...summarizeDeps,
        telemetry: summarizeDeps.telemetry ?? summaryTelemetry,
        summaryModel: summarizeDeps.summaryModel ?? getSummaryModelOverride?.(),
        summarySystemPrompt: summarizeDeps.summarySystemPrompt ?? getSummaryPromptOverride?.()
      });
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
  resetAccumulated: () => void,
  setContextGrounding: (jd: string | undefined, resume: string | undefined) => void,
  buildSummary: (clientTranscript?: string) => string,
  setSummaryModel: (model: string | undefined) => void,
  getSummaryModelOverride: () => string | undefined,
  setSummaryPrompt: (prompt: string | undefined) => void,
  getSummaryPromptOverride: () => string | undefined,
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
      // Correlate errors with the request: analyze + summarize both carry a
      // requestId, so a thrown handler error can be reported against it.
      if (parsed.data.type === 'analyze' || parsed.data.type === 'summarize') {
        requestId = parsed.data.requestId;
      }
      await dispatch(
        ws,
        session,
        relay,
        trigger,
        roles,
        injectNote,
        resetAccumulated,
        setContextGrounding,
        buildSummary,
        parsed.data,
        setSummaryModel,
        getSummaryModelOverride,
        setSummaryPrompt,
        getSummaryPromptOverride
      );
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
    // Tracks the in-flight AUTO generation(s) so a mid-flight reset() (new/switched
    // chat) can suppress their leftover progress. We map each auto requestId → the
    // trigger epoch captured at the START of that run; `autoIsStale` looks the id up
    // and compares the trigger's CURRENT epoch (bumped by reset) against it. A Map
    // (not a single slot) so that if reset() frees the monitor's gate mid-flight and
    // a NEW auto run starts before the abandoned one settles, the abandoned run's id
    // is still tracked and its stale progress is still suppressed (the single-slot
    // version would have been overwritten, leaking the old run's progress). Manual
    // runs never register here, so they are never suppressed. Each run deletes its
    // own id on settle. The trigger is defined below — `autoIsStale` only reads it
    // when invoked (during/after analysis).
    const autoInflight = new Map<string, number>();
    const autoIsStale = (requestId: string): boolean => {
      const startEpoch = autoInflight.get(requestId);
      return startEpoch !== undefined && trigger.getEpoch() !== startEpoch;
    };

    const session = createHeadlessSession({
      apiKey: config.dashscopeApiKey,
      // Suppress stale auto progress (a reset abandoned the in-flight chat).
      emit: makeEmit(ws, autoIsStale),
      // Customize mode RUNS a saved custom pipeline: the brain's
      // getActivePipeline reads activePipelineId (set via configure) and loads
      // the pipeline JSON from this dir — the same one the pipelines route saves to.
      pipelinesDir: pipelinesDir()
    });

    // Per-connection speaker-role map. FunASR segments carry a speakerId that
    // resolves to a role here; online providers carry no id (resolve(null) =
    // 'unknown') so the role gating below is inert for them.
    const roles = createSpeakerRoleMap();

    // Per-connection summary model override (Feature 2). Set by configure when the
    // client sends `summaryModel`; undefined means use the server default.
    let perSessionSummaryModel: string | undefined;
    const setSummaryModel = (model: string | undefined): void => { perSessionSummaryModel = model; };
    const getSummaryModelOverride = (): string | undefined => perSessionSummaryModel;

    // Per-connection custom system prompt override (Feature 3). Set by configure
    // when the client sends summaryPromptMode='custom' + a non-empty summaryPromptText.
    // undefined (or empty) means use the server's built-in SUMMARY_SYSTEM default.
    // resolveSummarySystemPrompt() is the authoritative fallback — never pass empty.
    let perSessionSummaryPrompt: string | undefined;
    const setSummaryPrompt = (prompt: string | undefined): void => { perSessionSummaryPrompt = prompt; };
    const getSummaryPromptOverride = (): string | undefined => perSessionSummaryPrompt;

    // Accumulated interviewee FINAL transcript — the candidate's answer so far.
    // The trigger monitor gates on its LENGTH (new chars since the last fire) and
    // generates from its content. Partial transcripts are not accumulated here.
    let accumulatedDisplayFinal = '';

    // FULL accumulated transcript (BOTH lanes — candidate + interviewer finals),
    // oldest first, capped, that feeds the live session-context analyzer. Distinct
    // from accumulatedDisplayFinal (candidate-only, drives follow-up generation):
    // the context panel summarizes the whole conversation, both sides. Cleared by
    // a new/switched chat (resetAccumulated).
    let accumulatedTranscript = '';
    const TRANSCRIPT_CAP = 16000;
    // Latest JD/résumé from configure — grounding for the context analyzer. Updated
    // on every configure that carries them (the session itself also stores them,
    // but ws.ts needs them to BUILD the context input).
    let contextJobDescription = '';
    let contextResumeText = '';

    // The live session-context analyzer (per connection). Debounced + in-flight-
    // gated; fed at the SAME finalized-transcript seam the trigger is fed. On a
    // successful (non-null) analysis it emits a `session-context` message. It NEVER
    // fires while not capturing, and SKIPS while the heavier follow-up/auto pipeline
    // is generating so the cheap light call never competes with the expensive one.
    const contextAnalyzer = createSessionContextAnalyzer({
      analyze: () =>
        analyzeSessionContext(
          buildAnalysisInput({
            transcript: accumulatedTranscript,
            jobDescription: contextJobDescription,
            resumeText: contextResumeText
          })
        ),
      onState: (state) => send(ws, { type: 'session-context', state }),
      // Only while the mic is on (mirrors the auto-trigger's capture gate).
      isCapturing: () => relay.isCapturing(),
      // Don't piggyback on the expensive Expert/auto pipeline.
      isPipelineBusy: () => trigger.getIsGenerating()
    });

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
      runAnalyze: async ({ candidateAnswer }) => {
        // Capture the epoch at the START so a reset() during this generation marks
        // it stale (suppressing its progress + result). Record the in-flight auto
        // requestId so makeEmit/runAnalysis can match it; clear it on settle.
        const requestId = randomUUID();
        const startEpoch = trigger.getEpoch();
        autoInflight.set(requestId, startEpoch);
        try {
          await runAnalysis(ws, session, {
            candidateAnswer,
            questionHistory: [],
            requestId,
            trigger: 'auto',
            isStale: () => trigger.getEpoch() !== startEpoch
          });
        } finally {
          // Drop our own entry on settle (the Map only holds genuinely in-flight ids).
          autoInflight.delete(requestId);
        }
      }
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
        // Record EVERY finalized segment for trigger bookkeeping. Generation
        // content stays candidate-only: feedCandidateAnswer() below is the only
        // path that grows the auto trigger's since-last-fire question window.
        if (t.isFinal) {
          trigger.noteFinal(t.text);
          // Accumulate the FULL conversation (both lanes) and (re)arm the debounced
          // session-context analyzer on EVERY final — candidate AND interviewer —
          // so the live panel reflects the whole interview, not just answers.
          const seg = t.text.trim();
          if (seg) {
            accumulatedTranscript = accumulatedTranscript
              ? `${accumulatedTranscript} ${seg}`
              : seg;
            if (accumulatedTranscript.length > TRANSCRIPT_CAP) {
              accumulatedTranscript = accumulatedTranscript.slice(-TRANSCRIPT_CAP);
            }
            contextAnalyzer.schedule();
          }
        }
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
      onMessage(
        ws,
        session,
        relay,
        trigger,
        roles,
        feedCandidateAnswer,
        // resetGeneration → drop the per-connection accumulated candidate answer so
        // the new chat's trigger starts from a blank transcript, AND drop the full
        // transcript + cancel any pending context analysis so "New interview" starts
        // the live panel blank too.
        () => {
          accumulatedDisplayFinal = '';
          accumulatedTranscript = '';
          contextAnalyzer.cancel();
        },
        // configure → capture JD/résumé for the context analyzer's grounding. Only
        // overwrite a field the configure carries (a partial configure keeps prior).
        (jd, resume) => {
          if (typeof jd === 'string') contextJobDescription = jd;
          if (typeof resume === 'string') contextResumeText = resume;
        },
        // summarize → build the summary input from the SAME per-connection
        // accumulated transcript (both lanes) + captured JD/résumé the live panel
        // reads. Returns '' when there is nothing to summarize (handleSummarize
        // then replies with the friendly empty-state message).
        (clientTranscript?: string) => {
          const client = String(clientTranscript ?? '').trim();
          const accumulated = accumulatedTranscript.trim();
          const transcript = [client, accumulated].filter(Boolean).join('\n\n');
          return buildSummaryInput({
            transcript,
            jobDescription: contextJobDescription,
            resumeText: contextResumeText
          });
        },
        setSummaryModel,
        getSummaryModelOverride,
        setSummaryPrompt,
        getSummaryPromptOverride,
        data.toString()
      )
    );
    ws.on('error', () => {
      /* swallow socket errors — connection cleanup happens on 'close' */
    });
    ws.on('close', () => {
      relay.dispose();
      // Stop the autonomous trigger too: setAutoGenerate(false) cancels any armed
      // debounce AND clears the interval-mode cadence timer (leak guard — a live
      // setInterval would otherwise keep the closure + connection alive).
      trigger.setAutoGenerate(false);
      // Cancel any armed session-context debounce so its timer can't outlive the
      // connection (same leak guard as the trigger above).
      contextAnalyzer.cancel();
    });
  });

  return wss;
}

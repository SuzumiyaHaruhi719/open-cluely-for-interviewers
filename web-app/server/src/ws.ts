import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { WS_PATH } from '@open-cluely/contract';
import type { FollowUpOutput, ServerMessage, TokenUsage } from '@open-cluely/contract';
import { createHeadlessSession } from '@open-cluely/copilot-core';
import { config } from './config';
import { createAsrRelay, type AsrRelay } from './asr-relay';
import { getRetriever } from './question-bank';

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
    autoAnalyzeDisplay: z.boolean().optional()
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
  z.object({ type: z.literal('audio-control'), action: z.enum(['start', 'stop']), source: audioSourceSchema })
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

async function handleAnalyze(
  ws: WebSocket,
  session: HeadlessSession,
  msg: Extract<ClientMessageParsed, { type: 'analyze' }>
): Promise<void> {
  // Grounding for Block D — retrieved BEFORE analysis. Fast mode ignores it;
  // passing it unconditionally keeps the call site simple and never blocks.
  const bankQuestions = await retrieveBankGrounding(msg.candidateAnswer);

  const result = (await session.analyze({
    candidateAnswer: msg.candidateAnswer,
    questionHistory: msg.questionHistory ?? [],
    requestId: msg.requestId,
    bankQuestions
  })) as AnalyzeResult;

  if (result.skipped) {
    send(ws, { type: 'error', requestId: msg.requestId, message: `skipped: ${result.reason ?? 'unknown'}` });
    return;
  }

  send(ws, {
    type: 'result',
    requestId: msg.requestId,
    mode: result.mode ?? 'fast',
    output: toFollowUpOutput(result),
    shouldShowFollowUps: !!result.shouldShowFollowUps,
    tokensUsed: result.tokensUsed ?? ZERO_TOKENS,
    elapsedMs: result.elapsedMs ?? 0,
    iterationVersion: result.iterationVersion ?? ''
  });
}

async function dispatch(
  ws: WebSocket,
  session: HeadlessSession,
  relay: AsrRelay,
  msg: ClientMessageParsed
): Promise<void> {
  switch (msg.type) {
    case 'configure':
      session.configure(msg.config);
      // The opt-in auto-analyze flag is relay state, not session state.
      if (typeof msg.config.autoAnalyzeDisplay === 'boolean') {
        relay.setAutoAnalyzeDisplay(msg.config.autoAnalyzeDisplay);
      }
      return;
    case 'analyze':
      await handleAnalyze(ws, session, msg);
      return;
    case 'audio':
      relay.handleAudio({ source: msg.source, pcmBase64: msg.pcm });
      return;
    case 'audio-control':
      relay.handleAudioControl({ action: msg.action, source: msg.source });
      return;
  }
}

function onMessage(ws: WebSocket, session: HeadlessSession, relay: AsrRelay, raw: unknown): void {
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
      await dispatch(ws, session, relay, parsed.data);
    } catch (err) {
      // A handler error must never close the socket.
      const message = err instanceof Error ? err.message : 'handler error';
      send(ws, { type: 'error', requestId, message });
    }
  })();
}

/**
 * Run an analysis turn for an interviewee FINAL transcript (auto-analyze path).
 * Generates its own requestId and streams progress/result like a manual analyze
 * would. Failures are swallowed (best-effort) — they must not break the relay.
 */
function autoAnalyzeFromTranscript(ws: WebSocket, session: HeadlessSession, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  void handleAnalyze(ws, session, {
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

    // One ASR relay per connection. Transcripts stream straight back as
    // `transcript` messages; a FINAL interviewee transcript optionally auto-runs
    // analyze (opt-in via configure({ autoAnalyzeDisplay: true })).
    const relay = createAsrRelay({
      emit: (t) => send(ws, { type: 'transcript', source: t.source, text: t.text, isFinal: t.isFinal }),
      onDisplayFinal: (text) => autoAnalyzeFromTranscript(ws, session, text)
    });

    send(ws, { type: 'ready', sessionId: randomUUID() });

    ws.on('message', (data) => onMessage(ws, session, relay, data.toString()));
    ws.on('error', () => {
      /* swallow socket errors — connection cleanup happens on 'close' */
    });
    ws.on('close', () => {
      relay.dispose();
    });
  });

  return wss;
}

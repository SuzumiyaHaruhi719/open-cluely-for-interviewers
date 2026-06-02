import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { WS_PATH } from '@open-cluely/contract';
import type { FollowUpOutput, ServerMessage, TokenUsage } from '@open-cluely/contract';
import { createHeadlessSession } from '@open-cluely/copilot-core';
import { config } from './config';
import { handleAudio, handleAudioControl } from './asr-relay';

// --- Incoming message validation (mirrors ClientMessage) -------------------

const audioSourceSchema = z.enum(['mic', 'display']);

const sessionConfigSchema = z
  .object({
    mode: z.enum(['fast', 'expert', 'expert2', 'customize']).optional(),
    resumeText: z.string().optional(),
    jobDescription: z.string().optional(),
    outputLanguage: z.enum(['', 'zh', 'en']).optional(),
    activePipelineId: z.string().nullable().optional()
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
  const result = (await session.analyze({
    candidateAnswer: msg.candidateAnswer,
    questionHistory: msg.questionHistory ?? [],
    requestId: msg.requestId
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

async function dispatch(ws: WebSocket, session: HeadlessSession, msg: ClientMessageParsed): Promise<void> {
  switch (msg.type) {
    case 'configure':
      session.configure(msg.config);
      return;
    case 'analyze':
      await handleAnalyze(ws, session, msg);
      return;
    case 'audio':
      // TODO(wave2): ASR relay
      handleAudio({ seq: msg.seq, source: msg.source, pcm: msg.pcm });
      return;
    case 'audio-control':
      // TODO(wave2): ASR relay
      handleAudioControl({ action: msg.action, source: msg.source });
      return;
  }
}

function onMessage(ws: WebSocket, session: HeadlessSession, raw: unknown): void {
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
      await dispatch(ws, session, parsed.data);
    } catch (err) {
      // A handler error must never close the socket.
      const message = err instanceof Error ? err.message : 'handler error';
      send(ws, { type: 'error', requestId, message });
    }
  })();
}

/** Attach the WebSocket server (path = WS_PATH) to an existing http.Server. */
export function attachWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on('connection', (ws: WebSocket) => {
    const session = createHeadlessSession({
      apiKey: config.dashscopeApiKey,
      emit: makeEmit(ws)
    });

    send(ws, { type: 'ready', sessionId: randomUUID() });

    ws.on('message', (data) => onMessage(ws, session, data.toString()));
    ws.on('error', () => {
      /* swallow socket errors — connection cleanup happens on 'close' */
    });
    ws.on('close', () => {
      // No durable per-connection resources today. Wave 2 will close the ASR
      // session here.
    });
  });

  return wss;
}

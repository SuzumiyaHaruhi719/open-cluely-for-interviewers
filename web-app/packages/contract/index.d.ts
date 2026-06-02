export const WS_PATH: string;
export const AUDIO_SOURCES: readonly ['mic', 'display'];
export const INTERVIEWER_MODES: readonly ['fast', 'expert', 'expert2', 'customize'];
export const PCM: { sampleRate: number; channels: number; format: string };
export const S2C: {
  READY: 'ready';
  PROGRESS: 'progress';
  RESULT: 'result';
  TRANSCRIPT: 'transcript';
  SESSION_CONTEXT: 'session-context';
  ERROR: 'error';
};
export const C2S: {
  CONFIGURE: 'configure';
  ANALYZE: 'analyze';
  AUDIO: 'audio';
  AUDIO_CONTROL: 'audio-control';
};

/** Live-ASR providers the server can stream through. Default: 'paraformer'. */
export const ASR_PROVIDERS: readonly ['paraformer', 'volc'];

export type InterviewerMode = 'fast' | 'expert' | 'expert2' | 'customize';
export type OutputLanguage = '' | 'zh' | 'en';
export type AudioSource = 'mic' | 'display';

/**
 * Realtime ASR provider:
 *   'paraformer' — DashScope Paraformer (server uses its env DASHSCOPE key).
 *   'volc'       — Doubao / Volcengine streaming ASR (豆包). Needs the Volc
 *                  credentials below, which are SEPARATE from the DashScope key.
 */
export type AsrProvider = 'paraformer' | 'volc';

/** Block G final output — the follow-up shown to the interviewer. */
export interface FollowUpOutput {
  primary_question: string;
  alternative_question: string;
  rationale_for_interviewer: string;
  anchor_quotes: string[];
  expected_evidence_yield: string;
  iteration_version: string;
}

export interface SessionConfig {
  mode: InterviewerMode;
  resumeText: string;
  jobDescription: string;
  outputLanguage: OutputLanguage;
  /**
   * Customize mode only: the saved pipeline the headless session should run.
   * `null` clears it (falls back to the Expert preset). Ignored by other modes.
   */
  activePipelineId?: string | null;
  /**
   * Realtime ASR provider for subsequent `audio-control start` controls.
   * Omitted/'paraformer' keeps the default DashScope Paraformer relay.
   */
  asrProvider?: AsrProvider;
  /**
   * Doubao / Volcengine credentials (only used when `asrProvider === 'volc'`).
   * SECURITY: these are sent to the SERVER, which opens the Volc WebSocket on the
   * browser's behalf — the browser never connects to Volc directly. The server
   * NEVER logs these values. They are application credentials for the user's own
   * Volc account (distinct from the DashScope key).
   */
  volcAppId?: string;
  volcAccessToken?: string;
  /** Volc resource id, e.g. `volc.bigasr.sauc.duration`. Optional; server defaults. */
  volcResourceId?: string;
  /** Optional Volc model name override (config-frame `model_name`). */
  volcModel?: string;
}

/** A question-bank search hit. difficulty: 0=unspecified,1=easy,2=medium,3=hard. */
export interface QuestionBankHit {
  question: string;
  companies: string[];
  subcategories: string[];
  difficulty: number;
  vote: number;
  url: string;
  score: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total?: number;
}

export type ClientMessage =
  | { type: 'configure'; config: Partial<SessionConfig> }
  | { type: 'analyze'; requestId: string; candidateAnswer: string; questionHistory?: string[] }
  | { type: 'audio'; seq: number; source: AudioSource; pcm: string }
  | { type: 'audio-control'; action: 'start' | 'stop'; source: AudioSource };

export type ServerMessage =
  | { type: 'ready'; sessionId: string }
  | {
      type: 'progress';
      requestId: string;
      phase: string;
      index: number;
      total: number;
      status: 'start' | 'done';
      model?: string;
      tokens?: { input: number; output: number } | null;
    }
  | {
      type: 'result';
      requestId: string;
      mode: string;
      output: FollowUpOutput;
      shouldShowFollowUps: boolean;
      tokensUsed: TokenUsage;
      elapsedMs: number;
      iterationVersion: string;
    }
  | { type: 'transcript'; source: AudioSource; text: string; isFinal: boolean }
  | { type: 'session-context'; state: unknown }
  | { type: 'error'; requestId?: string; message: string };

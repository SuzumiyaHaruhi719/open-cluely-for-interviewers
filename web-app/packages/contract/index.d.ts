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
  SET_SPEAKER_ROLE: 'set-speaker-role';
};

/** Live-ASR providers the server can stream through. Default: 'paraformer'. */
export const ASR_PROVIDERS: readonly ['paraformer', 'volc', 'funasr'];

/** How a `result` was produced: autonomous monitor vs. manual Generate Q. */
export const GENERATION_TRIGGERS: readonly ['auto', 'manual'];

export type InterviewerMode = 'fast' | 'expert' | 'expert2' | 'customize';
export type OutputLanguage = '' | 'zh' | 'en';
export type AudioSource = 'mic' | 'display';

/**
 * Realtime ASR provider:
 *   'paraformer' — DashScope Paraformer (server uses its env DASHSCOPE key).
 *   'volc'       — Doubao / Volcengine streaming ASR (豆包). Needs the Volc
 *                  credentials below, which are SEPARATE from the DashScope key.
 *   'funasr'     — FunASR streaming-SPK WebSocket provider with per-segment
 *                  speaker labels. Requires `funasrUrl` in `SessionConfig`.
 */
export type AsrProvider = 'paraformer' | 'volc' | 'funasr';

/** Per-segment speaker role resolved from a cluster ID. */
export type SpeakerRole = 'interviewer' | 'candidate' | 'unknown';

/** Block G final output — the follow-up shown to the interviewer. */
export interface FollowUpOutput {
  primary_question: string;
  alternative_question: string;
  rationale_for_interviewer: string;
  anchor_quotes: string[];
  expected_evidence_yield: string;
  iteration_version: string;
}

/**
 * One scored/ranked follow-up candidate, surfaced from the Expert pipeline's
 * Block D (the candidate pool) joined with Block E (the rubric scores). Lets the
 * client render an expandable ranked list under the prominent pick.
 *   - `score`    — Block E composite total (sum of the 6 rubric dims).
 *   - `maxScore` — the rubric ceiling (6 dims × 5 = 30).
 *   - `rubricReason` — Block E's one-line reasoning for this candidate.
 *   - `rank`     — 1-based position after sorting by score descending.
 */
export interface RankedQuestion {
  question: string;
  score: number;
  maxScore: number;
  rubricReason: string;
  rank: number;
}

/** Whether a `result` was produced by the autonomous monitor or a manual Generate Q. */
export type GenerationTrigger = 'auto' | 'manual';

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
  /**
   * CAM++ diarizer sidecar URL (offline single-mic). Falls back to the server's
   * CAMPP_URL env var when omitted.
   */
  funasrUrl?: string;
  /**
   * Offline speaker diarization: when true, the server runs LOCAL CAM++ speaker
   * labelling on top of `asrProvider`'s text and stamps `speakerId` on finals.
   * The text engine still follows `asrProvider` (Paraformer or Doubao).
   */
  diarize?: boolean;
  /**
   * Autonomous question generation: when true (the default), the server's
   * per-session trigger monitor may decide on its own to run the Expert pipeline
   * from the live interviewee transcript. Toggling false stops ALL monitor
   * activity (a cheap local check runs before any LLM call). Manual Generate Q
   * always works regardless.
   */
  autoGenerate?: boolean;
  /**
   * How autonomous generation fires while autoGenerate is on:
   *   'agent'    — the AI monitor decides when to fire (gated/debounced; default).
   *   'interval' — fire on a fixed ~30s wall-clock cadence (no monitor gate),
   *                independent of how long each generation takes.
   */
  autoMode?: 'agent' | 'interval';
  /**
   * Interval-mode cadence in milliseconds (default 30000 = 30s). Interviewer-
   * adjustable; only used when autoMode === 'interval'. Server clamps to a sane min.
   */
  autoIntervalMs?: number;
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
  | { type: 'audio-control'; action: 'start' | 'stop'; source: AudioSource }
  | { type: 'set-speaker-role'; speakerId: number; role: SpeakerRole }
  | { type: 'context-note'; note: string };

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
      /**
       * The full scored candidate pool (Block D ⨝ Block E), sorted by score
       * descending. Empty for Fast mode / fallbacks that produce no blocks, in
       * which case the client falls back to the single `output` question.
       */
      ranked?: RankedQuestion[];
      /** How this result was produced: the autonomous monitor ('auto') or a manual Generate Q ('manual'). */
      trigger?: GenerationTrigger;
    }
  | { type: 'transcript'; source: AudioSource; text: string; isFinal: boolean; speakerId?: number | null; speaker?: SpeakerRole }
  | { type: 'session-context'; state: unknown }
  | { type: 'error'; requestId?: string; message: string };

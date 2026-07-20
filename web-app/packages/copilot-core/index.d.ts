import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';

export interface HeadlessSessionConfig {
  mode?: InterviewerMode;
  interviewerModel?: string;
  resumeText?: string;
  jobDescription?: string;
  interviewGuide?: string[];
  outputLanguage?: OutputLanguage;
  activePipelineId?: string | null;
}

export interface AnalyzeArgs {
  candidateAnswer: string;
  questionHistory?: string[];
  emotion?: unknown;
  requestId?: string | null;
  /**
   * OPTIONAL grounding for Block D: real high-frequency interview questions
   * similar to the candidate's answer. Empty/absent = unchanged behavior;
   * the Fast path ignores it.
   */
  bankQuestions?: string[];
}

export interface HeadlessSession {
  configure(partial: HeadlessSessionConfig): void;
  setApiKey(key: string): void;
  analyze(args: AnalyzeArgs): Promise<any>;
  isConfigured(): boolean;
  getMode(): string;
  getState(): Record<string, unknown>;
}

export function createHeadlessSession(opts?: {
  apiKey?: string;
  config?: HeadlessSessionConfig;
  emit?: (channel: string, payload: unknown) => void;
  pipelinesDir?: string | null;
}): HeadlessSession;

export const config: any;
export const presetLibrary: any;
export const EXPERT_PRESET: any;
export const EXPERT_FAST_PRESET: any;
export const REPO_SRC: string;

/** A typed input port on a block type. */
export interface BlockInputPort {
  name: string;
  type: string;
  optional: boolean;
}

/** Serializable per-type metadata for the editor palette + config panel. */
export interface BlockTypeMeta {
  id: string;
  label: string;
  schemaId: string | null;
  inputs: BlockInputPort[];
  outputType: string;
  defaultBody: string;
  defaults: {
    model: string;
    thinking: { type: string; budget_tokens?: number };
    temperature: number;
    maxTokens: number;
  };
}

/** Live block-type registry (entries hold runtime hooks; cannot cross the wire). */
export const BLOCK_TYPES: Record<string, unknown>;

/** Serializable catalog of block types for the editor (palette + config). */
export function blockTypeMeta(): BlockTypeMeta[];

/** Pure validator result. */
export interface ValidatePipelineResult {
  ok: boolean;
  errors: string[];
  terminalId?: string | null;
}

/** Validate a pipeline against a block-type registry. Pure, no I/O. */
export function validatePipeline(
  pipeline: unknown,
  registry: Record<string, unknown>
): ValidatePipelineResult;
export function createInterviewerRuntime(opts: any): any;
export function runPipelineChain(args: any): Promise<any>;
export function runExpertChain(args: any): Promise<any>;

/**
 * Canonical desktop DashScope Paraformer realtime ASR factory. Re-exported for
 * parity; the web relay reuses its WS protocol via a focused client rather than
 * this Electron-shaped factory (see server/src/paraformer-client.ts).
 */
export function createParaformerService(deps: {
  WebSocket: unknown;
  desktopCapturer?: unknown;
  getDashscopeApiKey: () => string;
  getGeminiService?: () => unknown;
  sendToRenderer: (channel: string, payload: unknown) => void;
}): {
  startAssemblyAiStream: (source: string) => unknown;
  handleAudioChunk: (payload: { source: string; data: unknown }) => void;
  stopVoiceRecognition: (payload?: { source?: string }) => unknown;
  dispose: () => void;
  [key: string]: unknown;
};

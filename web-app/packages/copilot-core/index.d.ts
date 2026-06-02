import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';

export interface HeadlessSessionConfig {
  mode?: InterviewerMode;
  resumeText?: string;
  jobDescription?: string;
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
export function createInterviewerRuntime(opts: any): any;
export function runPipelineChain(args: any): Promise<any>;
export function runExpertChain(args: any): Promise<any>;

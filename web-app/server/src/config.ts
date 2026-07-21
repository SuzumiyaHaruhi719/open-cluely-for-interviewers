import path from 'node:path';
import { loadServerEnvironment } from './environment';

// One root .env is the canonical portable deployment file. Existing
// web-app/.env installations remain a fallback without overriding OS/root.
const ENV_PATH = path.resolve(__dirname, '..', '..', '..', '.env');
const LEGACY_ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
loadServerEnvironment({ rootPath: ENV_PATH, legacyPath: LEGACY_ENV_PATH });

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface ServerConfig {
  readonly port: number;
  readonly dashscopeApiKey: string;
  readonly dashscopeBaseUrl: string;
  readonly interviewerModel: string;
  readonly speakerPartitionModel: string;
  readonly expertQuestionModel: string;
  readonly interviewerContextModel: string;
  readonly interviewerSummaryModel: string;
  /** DashScope Paraformer realtime model for live ASR. */
  readonly paraformerModel: string;
  /** PCM sample rate the ASR model expects (the relay downsamples 16k->this). */
  readonly paraformerSampleRate: number;
  /**
   * Doubao Seed-ASR 2.0 / Volcengine environment configuration. The renderer
   * never receives or overrides these values.
   */
  readonly volcAppId: string;
  readonly volcAccessToken: string;
  readonly volcResourceId: string;
  readonly volcModel: string;
  /** PCM sample rate forwarded to Volc (Doubao expects 16 kHz mono s16le). */
  readonly volcSampleRate: number;
  /**
   * Autonomous question-generation trigger tuning (server-side monitor).
   * `autoCooldownMs`    — min gap between auto fires (anti-spam).
   * `autoMinNewChars`   — min NEW interviewee transcript chars since the last
   *                       generation before the monitor may even consider firing.
   * `autoDebounceMs`    — semantic-final coalescing window before evaluating;
   *                       raw PCM activity does not reset it.
   * `autoMonitorModel`  — the thinking-off Flash model the trigger gate calls.
   */
  readonly autoCooldownMs: number;
  readonly autoMinNewChars: number;
  readonly autoDebounceMs: number;
  readonly autoMonitorModel: string;
  readonly envPath: string;
  readonly legacyEnvPath: string;
}

// The bundled DashScope key is licensed for paraformer-realtime-8k-v2 (8 kHz),
// not the multilingual -v2 (16 kHz) — verified live. Default to the 8k model so
// live ASR works out of the box; override via env if your key differs.
const DEFAULT_PARAFORMER_MODEL = 'paraformer-realtime-8k-v2';
const DEFAULT_PARAFORMER_SAMPLE_RATE = 8000;
const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/apps/anthropic';
const DEFAULT_FLASH_MODEL = 'deepseek-v4-flash';
const DEFAULT_SUMMARY_MODEL = 'deepseek-v4-pro';
const DEFAULT_VOLC_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const DEFAULT_VOLC_MODEL = 'bigmodel';
// Doubao streams the browser's native 16 kHz mono PCM directly (no downsample).
const DEFAULT_VOLC_SAMPLE_RATE = 16000;
// The product exposes one Auto behavior: Balanced. Keep admission, cadence, and
// liveness in one named preset so a UI/settings refactor cannot silently combine
// unrelated heuristics. Environment overrides remain deployment-only controls.
export const BALANCED_AUTO_GATE = Object.freeze({
  profile: 'balanced' as const,
  cooldownMs: 20_000,
  minNewChars: 120,
  debounceMs: 3_000,
  livenessWaits: 3,
  livenessChars: 280
});
const DEFAULT_AUTO_MONITOR_MODEL = 'deepseek-v4-flash';

export function resolveServerConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>
): ServerConfig {
  return {
    port: toInt(source.PORT, 8787),
    dashscopeApiKey: String(source.DASHSCOPE_API_KEY ?? '').trim(),
    dashscopeBaseUrl:
      String(source.DASHSCOPE_BASE_URL ?? '').trim() || DEFAULT_DASHSCOPE_BASE_URL,
    interviewerModel: String(source.INTERVIEWER_MODEL ?? '').trim() || DEFAULT_FLASH_MODEL,
    speakerPartitionModel:
      String(source.SPEAKER_PARTITION_MODEL ?? '').trim() || DEFAULT_FLASH_MODEL,
    expertQuestionModel:
      String(source.EXPERT_QUESTION_MODEL ?? '').trim() || DEFAULT_FLASH_MODEL,
    interviewerContextModel:
      String(source.INTERVIEWER_CONTEXT_MODEL ?? '').trim() || DEFAULT_FLASH_MODEL,
    interviewerSummaryModel:
      String(source.INTERVIEWER_SUMMARY_MODEL ?? '').trim() || DEFAULT_SUMMARY_MODEL,
    paraformerModel:
      String(source.PARAFORMER_MODEL ?? '').trim() || DEFAULT_PARAFORMER_MODEL,
    paraformerSampleRate: toInt(
      source.PARAFORMER_SAMPLE_RATE,
      DEFAULT_PARAFORMER_SAMPLE_RATE
    ),
    // Volc/Doubao Seed-ASR 2.0 configuration — environment is the sole owner.
    volcAppId: String(source.VOLC_APP_ID ?? '').trim(),
    volcAccessToken: String(source.VOLC_ACCESS_TOKEN ?? '').trim(),
    volcResourceId:
      String(source.VOLC_RESOURCE_ID ?? '').trim() || DEFAULT_VOLC_RESOURCE_ID,
    volcModel: String(source.VOLC_MODEL ?? '').trim() || DEFAULT_VOLC_MODEL,
    volcSampleRate: toInt(source.VOLC_SAMPLE_RATE, DEFAULT_VOLC_SAMPLE_RATE),
    // Auto-trigger tuning — all env-overridable.
    autoCooldownMs: toInt(source.AUTO_COOLDOWN_MS, BALANCED_AUTO_GATE.cooldownMs),
    autoMinNewChars: toInt(source.AUTO_MIN_NEW_CHARS, BALANCED_AUTO_GATE.minNewChars),
    autoDebounceMs: toInt(source.AUTO_DEBOUNCE_MS, BALANCED_AUTO_GATE.debounceMs),
    autoMonitorModel:
      String(source.AUTO_MONITOR_MODEL ?? '').trim() || DEFAULT_AUTO_MONITOR_MODEL,
    envPath: ENV_PATH,
    legacyEnvPath: LEGACY_ENV_PATH
  };
}

export const config: ServerConfig = Object.freeze(resolveServerConfig(process.env));

export function hasKey(): boolean {
  return config.dashscopeApiKey.length > 0;
}

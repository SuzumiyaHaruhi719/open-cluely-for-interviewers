import path from 'node:path';
import dotenv from 'dotenv';

// Load web-app/.env (the parent of server/). dotenv never overrides vars that
// are already present in process.env, so an externally-provided env still wins.
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
dotenv.config({ path: ENV_PATH });

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface ServerConfig {
  readonly port: number;
  readonly dashscopeApiKey: string;
  readonly interviewerModel: string;
  /** DashScope Paraformer realtime model for live ASR. */
  readonly paraformerModel: string;
  /** PCM sample rate the ASR model expects (the relay downsamples 16k->this). */
  readonly paraformerSampleRate: number;
  /**
   * Optional Doubao / Volcengine (豆包) defaults. Per-session `configure` values
   * ALWAYS win over these — they only let a deployment ship default creds.
   * Empty unless VOLC_* env vars are set.
   */
  readonly volcAppId: string;
  readonly volcAccessToken: string;
  readonly volcResourceId: string;
  readonly volcModel: string;
  /** PCM sample rate forwarded to Volc (Doubao expects 16 kHz mono s16le). */
  readonly volcSampleRate: number;
  /** FunASR streaming-SPK WebSocket URL. Used when asrProvider === 'funasr'. */
  readonly funasrWsUrl: string;
  /**
   * Autonomous question-generation trigger tuning (server-side monitor).
   * `autoCooldownMs`    — min gap between auto fires (anti-spam).
   * `autoMinNewChars`   — min NEW interviewee transcript chars since the last
   *                       generation before the monitor may even consider firing.
   * `autoDebounceMs`    — quiet period after a final segment before evaluating,
   *                       so rapid finals coalesce into one decision (act on a pause).
   * `autoMonitorModel`  — the thinking-off Flash model the trigger gate calls.
   */
  readonly autoCooldownMs: number;
  readonly autoMinNewChars: number;
  readonly autoDebounceMs: number;
  readonly autoMonitorModel: string;
  readonly envPath: string;
}

// The bundled DashScope key is licensed for paraformer-realtime-8k-v2 (8 kHz),
// not the multilingual -v2 (16 kHz) — verified live. Default to the 8k model so
// live ASR works out of the box; override via env if your key differs.
const DEFAULT_PARAFORMER_MODEL = 'paraformer-realtime-8k-v2';
const DEFAULT_PARAFORMER_SAMPLE_RATE = 8000;
// Doubao streams the browser's native 16 kHz mono PCM directly (no downsample).
const DEFAULT_VOLC_SAMPLE_RATE = 16000;

// Auto-trigger defaults (see ServerConfig + auto-trigger.ts). Tuned for a live
// interview cadence: ~20s between auto fires, ~120 new chars (a sentence or two)
// of fresh candidate speech, and a ~1.2s pause before deciding.
const DEFAULT_AUTO_COOLDOWN_MS = 20000;
const DEFAULT_AUTO_MIN_NEW_CHARS = 120;
const DEFAULT_AUTO_DEBOUNCE_MS = 1200;
const DEFAULT_AUTO_MONITOR_MODEL = 'deepseek-v4-flash';

export const config: ServerConfig = Object.freeze({
  port: toInt(process.env.PORT, 8787),
  dashscopeApiKey: String(process.env.DASHSCOPE_API_KEY ?? '').trim(),
  interviewerModel: String(process.env.INTERVIEWER_MODEL ?? '').trim(),
  paraformerModel: String(process.env.PARAFORMER_MODEL ?? '').trim() || DEFAULT_PARAFORMER_MODEL,
  paraformerSampleRate: toInt(process.env.PARAFORMER_SAMPLE_RATE, DEFAULT_PARAFORMER_SAMPLE_RATE),
  // Optional Volc/Doubao env fallbacks — per-session configure values win.
  volcAppId: String(process.env.VOLC_APP_ID ?? '').trim(),
  volcAccessToken: String(process.env.VOLC_ACCESS_TOKEN ?? '').trim(),
  volcResourceId: String(process.env.VOLC_RESOURCE_ID ?? '').trim(),
  volcModel: String(process.env.VOLC_MODEL ?? '').trim(),
  volcSampleRate: toInt(process.env.VOLC_SAMPLE_RATE, DEFAULT_VOLC_SAMPLE_RATE),
  // Optional FunASR env fallback — per-session configure funasrUrl wins.
  funasrWsUrl: String(process.env.FUNASR_WS_URL ?? '').trim(),
  // Auto-trigger tuning — all env-overridable.
  autoCooldownMs: toInt(process.env.AUTO_COOLDOWN_MS, DEFAULT_AUTO_COOLDOWN_MS),
  autoMinNewChars: toInt(process.env.AUTO_MIN_NEW_CHARS, DEFAULT_AUTO_MIN_NEW_CHARS),
  autoDebounceMs: toInt(process.env.AUTO_DEBOUNCE_MS, DEFAULT_AUTO_DEBOUNCE_MS),
  autoMonitorModel: String(process.env.AUTO_MONITOR_MODEL ?? '').trim() || DEFAULT_AUTO_MONITOR_MODEL,
  envPath: ENV_PATH
});

export function hasKey(): boolean {
  return config.dashscopeApiKey.length > 0;
}

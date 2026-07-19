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
   * iFlytek (讯飞) 实时语音转写大模型 credentials, read from XFYUN_* env. Used when
   * asrProvider === 'xfyun' — the cloud call returns BOTH text AND speaker id
   * (角色分离 role_type=2) for the offline single-mic scenario. No per-session
   * creds: the server reads these from .env. Empty unless XFYUN_* are set.
   */
  readonly xfyunAppId: string;
  readonly xfyunApiKey: string;
  readonly xfyunApiSecret: string;
  /** iFlytek realtime ASR WebSocket base URL. */
  readonly xfyunWsUrl: string;
  /** Qwen Audio 3.0 TTS settings; all remain server-only. */
  readonly ttsWsUrl: string;
  readonly ttsDefaultModel: QwenTtsModel;
  readonly ttsVoice: string;
  readonly ttsTimeoutMs: number;
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
// iFlytek 实时语音转写大模型 default endpoint (verified live by the probe).
const DEFAULT_XFYUN_WS_URL = 'wss://office-api-ast-dx.iflyaisol.com/';
export const QWEN_TTS_MODELS = [
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-tts-flash'
] as const;
export type QwenTtsModel = (typeof QWEN_TTS_MODELS)[number];
export const DEFAULT_QWEN_TTS_MODEL: QwenTtsModel = 'qwen-audio-3.0-tts-plus';
export const DEFAULT_QWEN_TTS_VOICE = 'longanlingxi';
export const DEFAULT_TTS_WS_URL =
  'wss://llm-opv63ugogbbsgk6i.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference';
const DEFAULT_TTS_TIMEOUT_MS = 10_000;
// Auto-trigger defaults (see ServerConfig + auto-trigger.ts). Tuned for a live
// interview cadence: ~20s between auto fires, ~120 new chars (a sentence or two)
// of fresh candidate speech, and a ~1.2s pause before deciding.
const DEFAULT_AUTO_COOLDOWN_MS = 20000;
const DEFAULT_AUTO_MIN_NEW_CHARS = 120;
const DEFAULT_AUTO_DEBOUNCE_MS = 1200;
const DEFAULT_AUTO_MONITOR_MODEL = 'deepseek-v4-flash';

export function isQwenTtsModel(value: string): value is QwenTtsModel {
  return (QWEN_TTS_MODELS as readonly string[]).includes(value);
}

export function validateTtsConfig(input: {
  apiKey: string;
  voice: string;
}): { available: true } | { available: false; reason: string } {
  if (!input.apiKey.trim()) return { available: false, reason: 'DASHSCOPE_API_KEY 未配置' };
  if (!input.voice.trim()) return { available: false, reason: 'QWEN_TTS_VOICE 未配置' };
  return { available: true };
}

export const config: ServerConfig = Object.freeze({
  port: toInt(process.env.PORT, 8787),
  dashscopeApiKey: String(process.env.DASHSCOPE_API_KEY ?? '').trim(),
  interviewerModel: String(process.env.INTERVIEWER_MODEL ?? '').trim(),
  paraformerModel: String(process.env.PARAFORMER_MODEL ?? '').trim() || DEFAULT_PARAFORMER_MODEL,
  paraformerSampleRate: toInt(process.env.PARAFORMER_SAMPLE_RATE, DEFAULT_PARAFORMER_SAMPLE_RATE),
  // Volc/Doubao Seed-ASR 2.0 configuration — environment is the sole owner.
  volcAppId: String(process.env.VOLC_APP_ID ?? '').trim(),
  volcAccessToken: String(process.env.VOLC_ACCESS_TOKEN ?? '').trim(),
  volcResourceId: String(process.env.VOLC_RESOURCE_ID ?? '').trim(),
  volcModel: String(process.env.VOLC_MODEL ?? '').trim(),
  volcSampleRate: toInt(process.env.VOLC_SAMPLE_RATE, DEFAULT_VOLC_SAMPLE_RATE),
  // iFlytek (讯飞) 实时语音转写大模型 creds — server-side only, read from .env.
  xfyunAppId: String(process.env.XFYUN_APP_ID ?? '').trim(),
  xfyunApiKey: String(process.env.XFYUN_API_KEY ?? '').trim(),
  xfyunApiSecret: String(process.env.XFYUN_API_SECRET ?? '').trim(),
  xfyunWsUrl: String(process.env.XFYUN_WS_URL ?? '').trim() || DEFAULT_XFYUN_WS_URL,
  ttsWsUrl: String(process.env.DASHSCOPE_TTS_WS_URL ?? '').trim() || DEFAULT_TTS_WS_URL,
  ttsDefaultModel: isQwenTtsModel(String(process.env.QWEN_TTS_MODEL ?? '').trim())
    ? (String(process.env.QWEN_TTS_MODEL).trim() as QwenTtsModel)
    : DEFAULT_QWEN_TTS_MODEL,
  ttsVoice: String(process.env.QWEN_TTS_VOICE ?? '').trim() || DEFAULT_QWEN_TTS_VOICE,
  ttsTimeoutMs: toInt(process.env.QWEN_TTS_TIMEOUT_MS, DEFAULT_TTS_TIMEOUT_MS),
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

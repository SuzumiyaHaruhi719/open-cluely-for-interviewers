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
  readonly envPath: string;
}

export const config: ServerConfig = Object.freeze({
  port: toInt(process.env.PORT, 8787),
  dashscopeApiKey: String(process.env.DASHSCOPE_API_KEY ?? '').trim(),
  interviewerModel: String(process.env.INTERVIEWER_MODEL ?? '').trim(),
  envPath: ENV_PATH
});

export function hasKey(): boolean {
  return config.dashscopeApiKey.length > 0;
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

export const PORTABLE_ENV_KEYS = Object.freeze([
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_BASE_URL',
  'INTERVIEWER_MODEL',
  'AUTO_MONITOR_MODEL',
  'SPEAKER_PARTITION_MODEL',
  'EXPERT_QUESTION_MODEL',
  'INTERVIEWER_CONTEXT_MODEL',
  'INTERVIEWER_SUMMARY_MODEL',
  'VOLC_APP_ID',
  'VOLC_ACCESS_TOKEN',
  'VOLC_RESOURCE_ID',
  'VOLC_MODEL',
  'VOLC_SAMPLE_RATE',
  'AUTO_COOLDOWN_MS',
  'AUTO_MIN_NEW_CHARS',
  'AUTO_DEBOUNCE_MS',
  'PORT',
  'HIDE_FROM_SCREEN_CAPTURE',
  'START_HIDDEN',
  'MAX_SCREENSHOTS',
  'SCREENSHOT_DELAY',
  'NODE_ENV',
  'NODE_OPTIONS'
]);

const REQUIRED_KEYS = Object.freeze([
  'DASHSCOPE_API_KEY',
  'VOLC_APP_ID',
  'VOLC_ACCESS_TOKEN'
]);

const DEFAULTS = Object.freeze({
  DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  INTERVIEWER_MODEL: 'deepseek-v4-flash',
  AUTO_MONITOR_MODEL: 'deepseek-v4-flash',
  SPEAKER_PARTITION_MODEL: 'deepseek-v4-flash',
  EXPERT_QUESTION_MODEL: 'deepseek-v4-flash',
  INTERVIEWER_CONTEXT_MODEL: 'deepseek-v4-flash',
  INTERVIEWER_SUMMARY_MODEL: 'deepseek-v4-pro',
  VOLC_RESOURCE_ID: 'volc.seedasr.sauc.duration',
  VOLC_MODEL: 'bigmodel',
  VOLC_SAMPLE_RATE: '16000',
  AUTO_COOLDOWN_MS: '20000',
  AUTO_MIN_NEW_CHARS: '120',
  AUTO_DEBOUNCE_MS: '3000',
  PORT: '8787',
  HIDE_FROM_SCREEN_CAPTURE: 'true',
  START_HIDDEN: 'false',
  MAX_SCREENSHOTS: '50',
  SCREENSHOT_DELAY: '300',
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=4096'
});

function readEnvironment(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

function serializeValue(value) {
  const normalized = String(value ?? '');
  return /^[A-Za-z0-9_./:@+\-]+$/.test(normalized)
    ? normalized
    : JSON.stringify(normalized);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

export function exportPortableEnvironment(options = {}) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(moduleDirectory, '..');
  const rootEnvPath = options.rootEnvPath ?? path.join(repositoryRoot, '.env');
  const legacyEnvPath = options.legacyEnvPath ?? path.join(repositoryRoot, 'web-app', '.env');
  const outputPath = options.outputPath ?? path.join(repositoryRoot, '.env.portable');
  const processEnv = options.processEnv ?? process.env;
  const logger = options.logger ?? console.log;
  const root = readEnvironment(rootEnvPath);
  const legacy = readEnvironment(legacyEnvPath);
  const resolved = {};

  for (const key of PORTABLE_ENV_KEYS) {
    const value = firstDefined(processEnv[key], root[key], legacy[key], DEFAULTS[key]);
    resolved[key] = value === undefined ? '' : String(value);
  }

  const missing = REQUIRED_KEYS.filter((key) => !resolved[key].trim());
  if (missing.length > 0) {
    throw new Error(`Missing required keys: ${missing.join(', ')}`);
  }

  const content = `${PORTABLE_ENV_KEYS
    .map((key) => `${key}=${serializeValue(resolved[key])}`)
    .join('\n')}\n`;
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, outputPath);
  fs.chmodSync(outputPath, 0o600);

  logger(`Portable environment written with ${PORTABLE_ENV_KEYS.length} allowlisted keys.`);
  return {
    outputPath,
    keys: [...PORTABLE_ENV_KEYS],
    missing
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    exportPortableEnvironment();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

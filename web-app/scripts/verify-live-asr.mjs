#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { parseLiveAsrOptions, parsePcm16Wav, summarizeAsrRun } from './live-asr-lib.mjs';

const argv = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);

if (has('--help')) {
  console.log(`Usage: node scripts/verify-live-asr.mjs --provider xfyun --audio source-16k.wav [options]

Options:
  --url ws://127.0.0.1:8788/ws  Copilot WebSocket endpoint
  --source mic|display            Audio lane (default: mic)
  --frame-ms 40                   PCM frame duration
  --speed 1                       Playback speed; 1 is realtime
  --limit-seconds N               Replay only the first N seconds
  --out report.json               Save the JSON evidence report
  --auto-generate                 Enable continuous Flash delegation + Expert question generation
  --no-diarize                    Disable final DeepSeek role partition
`);
  process.exit(0);
}

const provider = valueOf('--provider');
const audioPath = path.resolve(valueOf('--audio'));
const url = valueOf('--url', 'ws://127.0.0.1:8788/ws');
const source = valueOf('--source', 'mic');
const frameMs = Number(valueOf('--frame-ms', '40'));
const speed = Number(valueOf('--speed', '1'));
const limitSeconds = Number(valueOf('--limit-seconds', '0'));
const outPath = valueOf('--out');
const { autoGenerate, diarize } = parseLiveAsrOptions(argv);

if (!['xfyun', 'volc', 'paraformer'].includes(provider)) {
  throw new Error('--provider must be xfyun, volc, or paraformer');
}
if (!['mic', 'display'].includes(source)) throw new Error('--source must be mic or display');
if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);
if (!Number.isFinite(frameMs) || frameMs < 20 || frameMs > 200) {
  throw new Error('--frame-ms must be between 20 and 200');
}
if (!Number.isFinite(speed) || speed <= 0 || speed > 8) throw new Error('--speed must be in (0, 8]');

const parsed = parsePcm16Wav(fs.readFileSync(audioPath));
const bytesPerFrame = Math.round((parsed.sampleRate * parsed.channels * (parsed.bitsPerSample / 8) * frameMs) / 1000);
const requestedBytes = limitSeconds > 0
  ? Math.min(parsed.pcm.length, Math.floor(limitSeconds * parsed.sampleRate * 2))
  : parsed.pcm.length;
const pcm = parsed.pcm.subarray(0, requestedBytes - (requestedBytes % 2));
const audioDurationMs = Math.round((pcm.length / (parsed.sampleRate * 2)) * 1000);
const events = [];
const waiters = new Set();
const socket = new WebSocket(url);

function record(message) {
  const event = { at: Date.now(), message };
  events.push(event);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(message)) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
}

function waitFor(predicate, timeoutMs, label) {
  const existing = events.find((event) => predicate(event.message));
  if (existing) return Promise.resolve(existing.message);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    waiters.add(waiter);
  });
}

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error('Copilot socket is not open');
  socket.send(JSON.stringify(message));
}

socket.on('message', (raw) => {
  try {
    record(JSON.parse(String(raw)));
  } catch {
    /* Ignore non-JSON evidence frames. */
  }
});
socket.on('error', (error) => record({ type: 'error', message: error.message }));
socket.on('close', () => {
  for (const waiter of [...waiters]) {
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.reject(new Error('Copilot socket closed before the run completed'));
  }
});

await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
await waitFor((message) => message.type === 'ready', 5_000, 'ready');

send({
  type: 'configure',
  config: {
    mode: 'expert',
    interviewerModel: 'deepseek-v4-flash',
    outputLanguage: 'zh',
    asrProvider: provider,
    autoGenerate,
    diarize,
    resetGeneration: true,
    jobDescription: '物业经理：负责园区现场运营、安全消防、人员管理、设备维护与租户服务。'
  }
});
send({ type: 'audio-control', action: 'start', source });

let startState;
try {
  startState = await waitFor(
    (message) =>
      message.type === 'asr-status' &&
      message.source === source &&
      (message.state === 'live' || message.state === 'failed'),
    20_000,
    `${provider} live/failed`
  );
} catch (error) {
  record({ type: 'error', message: error.message });
}

const playbackStartedAt = Date.now();
if (startState?.state === 'live') {
  let seq = 0;
  let nextAt = performance.now();
  let nextProgressAt = 30_000;
  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame) {
    const frame = pcm.subarray(offset, Math.min(pcm.length, offset + bytesPerFrame));
    send({ type: 'audio', seq, source, pcm: frame.toString('base64') });
    seq += 1;
    const playedMs = (offset + frame.length) / (parsed.sampleRate * 2) * 1000;
    if (playedMs >= nextProgressAt) {
      console.error(`[live-asr] ${provider} ${Math.round(playedMs / 1000)}s / ${Math.round(audioDurationMs / 1000)}s`);
      nextProgressAt += 30_000;
    }
    nextAt += frameMs / speed;
    const delay = nextAt - performance.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

send({ type: 'audio-control', action: 'stop', source });
try {
  await waitFor(
    (message) =>
      message.type === 'asr-status' &&
      message.source === source &&
      (message.state === 'stopped' || message.state === 'partial'),
    30_000,
    'provider finalization and final role partition'
  );
} catch (error) {
  record({ type: 'error', message: error.message });
}

await new Promise((resolve) => setTimeout(resolve, 100));
socket.close();
const report = {
  provider,
  source,
  url,
  audioPath,
  audioDurationMs,
  wallPlaybackMs: Date.now() - playbackStartedAt,
  frameMs,
  speed,
  autoGenerate,
  ...summarizeAsrRun(events),
  transcripts: events
    .filter((event) => event.message.type === 'transcript')
    .map((event) => ({
      atMs: event.at - events[0].at,
      text: event.message.text,
      isFinal: event.message.isFinal,
      ...(Number.isInteger(event.message.speakerId) ? { speakerId: event.message.speakerId } : {})
    })),
  partitions: events
    .filter((event) => event.message.type === 'speaker-partition')
    .map((event) => ({ atMs: event.at - events[0].at, ...event.message }))
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) fs.writeFileSync(path.resolve(outPath), json, 'utf8');
process.stdout.write(json);

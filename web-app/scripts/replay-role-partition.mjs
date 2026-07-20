#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const reportPath = path.resolve(valueOf('--report'));
const url = valueOf('--url', 'ws://127.0.0.1:8788/ws');
const outPath = valueOf('--out');
if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);

const sourceReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const simScript = (Array.isArray(sourceReport.transcripts) ? sourceReport.transcripts : [])
  .filter((turn) => turn?.isFinal === true && Number.isInteger(turn.speakerId))
  .map((turn) => ({ speakerId: turn.speakerId, text: String(turn.text ?? '').trim() }))
  .filter((turn) => turn.text.length > 0);
if (simScript.length < 2) throw new Error('Report has fewer than two native-speaker final turns');

const socket = new WebSocket(url);
const events = [];
const waiters = new Set();
function record(message) {
  events.push({ at: Date.now(), message });
  for (const waiter of [...waiters]) {
    if (!waiter.predicate(message)) continue;
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
}
function waitFor(predicate, timeoutMs, label) {
  const existing = events.find((event) => predicate(event.message));
  if (existing) return Promise.resolve(existing.message);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    waiters.add(waiter);
  });
}
function send(message) {
  socket.send(JSON.stringify(message));
}

socket.on('message', (raw) => {
  try {
    record(JSON.parse(String(raw)));
  } catch {
    /* ignore malformed evidence */
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
    asrProvider: 'sim',
    simScript,
    diarize: true,
    autoGenerate: false,
    resetGeneration: true
  }
});
send({ type: 'audio-control', action: 'start', source: 'mic' });

await waitFor(
  () => events.filter((event) => event.message.type === 'transcript' && event.message.isFinal).length >= simScript.length,
  Math.max(15_000, simScript.length * 4_000),
  `${simScript.length} replayed finals`
);
send({ type: 'audio-control', action: 'stop', source: 'mic' });
await waitFor(
  (message) => message.type === 'speaker-partition' && message.status === 'final',
  30_000,
  'final speaker partition'
);
await waitFor(
  (message) => message.type === 'asr-status' && (message.state === 'stopped' || message.state === 'partial'),
  5_000,
  'stopped status'
);

const finalEventIndex = events.findIndex(
  (event) => event.message.type === 'speaker-partition' && event.message.status === 'final'
);
const stoppedEventIndex = events.findIndex(
  (event) => event.message.type === 'asr-status' && event.message.state === 'stopped'
);
const finalPartition = events[finalEventIndex].message;
const roles = finalPartition.segments.reduce(
  (totals, segment) => {
    const role = segment.role === 'interviewer' || segment.role === 'candidate' ? segment.role : 'unknown';
    totals[role] += 1;
    return totals;
  },
  { interviewer: 0, candidate: 0, unknown: 0 }
);
const speakerRoles = Array.from(
  new Map(finalPartition.segments.map((segment) => [segment.speakerId, segment.role])).entries(),
  ([speakerId, role]) => ({ speakerId, role })
).sort((a, b) => a.speakerId - b.speakerId);

socket.close();
const report = {
  sourceReport: reportPath,
  replayedFinals: simScript.length,
  model: finalPartition.model,
  segmentCount: finalPartition.segments.length,
  roles,
  speakerRoles,
  finalPartitionBeforeStopped: finalEventIndex >= 0 && stoppedEventIndex > finalEventIndex,
  passed: roles.interviewer > 0 && roles.candidate > 0 && roles.unknown === 0 && stoppedEventIndex > finalEventIndex
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) fs.writeFileSync(path.resolve(outPath), json, 'utf8');
process.stdout.write(json);
if (!report.passed) process.exitCode = 1;

'use strict';

// Runtime protocol constants shared by the server (Node) and the web client
// (browser). TypeScript types live in index.d.ts. Keep this file dependency-free
// and isomorphic (no Node-only or browser-only APIs).

const WS_PATH = '/ws';

// Audio capture target:
//   'display' = the interviewee, captured from a shared tab/window/system audio
//               via getDisplayMedia (the desktop app used per-process loopback;
//               the browser cannot, so the user shares audio instead).
//   'mic'     = the interviewer, captured via getUserMedia.
const AUDIO_SOURCES = Object.freeze(['mic', 'display']);

const INTERVIEWER_MODES = Object.freeze(['fast', 'expert', 'expert2', 'customize']);

// Realtime ASR providers the server can stream through. 'volc' is the fixed
// product provider (Doubao Seed ASR 2.0), with credentials supplied by the
// server environment. 'paraformer' is an internal compatibility path and 'sim'
// is the mic-less transcript-replay test harness; neither is user-selectable.
const ASR_PROVIDERS = Object.freeze(['volc', 'paraformer', 'sim']);

// How a `result` was produced: 'auto' = the server's autonomous trigger monitor
// fired the Expert pipeline from the live transcript; 'manual' = the interviewer
// pressed Generate Q. Carried on the `result` message's `trigger` field.
const GENERATION_TRIGGERS = Object.freeze(['auto', 'manual']);

// PCM format the browser AudioWorklet must emit for the ASR relay.
const PCM = Object.freeze({ sampleRate: 16000, channels: 1, format: 's16le' });

// Server -> client message type tags. The summary-* tags carry the interview
// evaluation report (DeepSeek v4 pro): summary-chunk streams slices in order,
// summary-done finalizes (carrying the whole text for the one-shot path),
// summary-error reports a failure (no key / model error / empty transcript),
// summary-debug carries sanitized event-level diagnostics for stuck runs.
const S2C = Object.freeze({
  READY: 'ready',
  PROGRESS: 'progress',
  AUTO_MONITOR: 'auto-monitor',
  RESULT: 'result',
  TRANSCRIPT: 'transcript',
  ASR_STATUS: 'asr-status',
  SPEAKER_PARTITION: 'speaker-partition',
  SESSION_CONTEXT: 'session-context',
  SUMMARY_CHUNK: 'summary-chunk',
  SUMMARY_DONE: 'summary-done',
  SUMMARY_DEBUG: 'summary-debug',
  SUMMARY_ERROR: 'summary-error',
  ERROR: 'error'
});

// Client -> server message type tags. 'summarize' requests the interview summary;
// it may carry an optional client-side seeded transcript for template interviews.
const C2S = Object.freeze({
  CONFIGURE: 'configure',
  ANALYZE: 'analyze',
  AUDIO: 'audio',
  AUDIO_CONTROL: 'audio-control',
  SET_SPEAKER_ROLE: 'set-speaker-role',
  SUMMARIZE: 'summarize'
});

module.exports = {
  WS_PATH,
  AUDIO_SOURCES,
  INTERVIEWER_MODES,
  ASR_PROVIDERS,
  GENERATION_TRIGGERS,
  PCM,
  S2C,
  C2S
};

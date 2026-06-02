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

// PCM format the browser AudioWorklet must emit for the ASR relay.
const PCM = Object.freeze({ sampleRate: 16000, channels: 1, format: 's16le' });

// Server -> client message type tags.
const S2C = Object.freeze({
  READY: 'ready',
  PROGRESS: 'progress',
  RESULT: 'result',
  TRANSCRIPT: 'transcript',
  SESSION_CONTEXT: 'session-context',
  ERROR: 'error'
});

// Client -> server message type tags.
const C2S = Object.freeze({
  CONFIGURE: 'configure',
  ANALYZE: 'analyze',
  AUDIO: 'audio',
  AUDIO_CONTROL: 'audio-control'
});

module.exports = { WS_PATH, AUDIO_SOURCES, INTERVIEWER_MODES, PCM, S2C, C2S };

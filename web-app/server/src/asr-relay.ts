// TODO(wave2): ASR relay.
//
// This is the seam for the wave-2 audio/ASR work. The WebSocket handler routes
// every `audio` (PCM frame) and `audio-control` (start/stop) client message here.
// Today both are no-ops; wave 2 will stand up a per-connection ASR session
// (decode base64 s16le PCM per @open-cluely/contract PCM = 16kHz/mono/s16le),
// stream it to the recognizer, and emit `transcript` server messages back.

import type { AudioSource } from '@open-cluely/contract';

export interface AudioFrame {
  seq: number;
  source: AudioSource;
  pcm: string; // base64-encoded s16le PCM
}

export interface AudioControl {
  action: 'start' | 'stop';
  source: AudioSource;
}

/** No-op PCM frame handler. Wave 2 will feed frames into an ASR session. */
export function handleAudio(_frame: AudioFrame): void {
  // intentionally empty — ASR relay lands in wave 2
}

/** No-op audio start/stop handler. Wave 2 will open/close the ASR session. */
export function handleAudioControl(_control: AudioControl): void {
  // intentionally empty — ASR relay lands in wave 2
}

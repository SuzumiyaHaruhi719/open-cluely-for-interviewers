// ============================================================================
// Browser audio capture for the live copilot.
// ----------------------------------------------------------------------------
//   'display' = interviewee. getDisplayMedia({ video:true, audio:true }); we use
//               the AUDIO track and stop the video track immediately. The user
//               must tick "share tab audio" — Chrome/Edge only.
//   'mic'     = interviewer. getUserMedia({ audio:true }).
// Each stream is piped through an AudioContext + the pcm-capture-processor
// AudioWorklet (public/pcm-worklet.js). Worklet chunks are downsampled to 16 kHz
// mono, converted to int16, re-framed, and base64-encoded via the shared pure
// helpers in ./pcm, then handed to onFrame for the WebSocket layer to send.
// ============================================================================

import type { AudioSource } from '@open-cluely/contract';
import {
  TARGET_SAMPLE_RATE,
  convertToPCM16,
  downsampleFloat32Buffer,
  computeRms,
  bytesToBase64,
  createFrameAccumulator
} from './pcm';

const WORKLET_MODULE_URL = '/pcm-worklet.js';
const WORKLET_PROCESSOR = 'pcm-capture-processor';
const LEVEL_EMIT_INTERVAL_MS = 100;

/** A user-facing capture error with a stable `kind` for friendly messaging. */
export class AudioCaptureError extends Error {
  readonly kind: 'denied' | 'cancelled' | 'no-audio-track' | 'unsupported' | 'unknown';
  constructor(kind: AudioCaptureError['kind'], message: string) {
    super(message);
    this.name = 'AudioCaptureError';
    this.kind = kind;
  }
}

export interface CaptureCallbacks {
  /** A finished 16 kHz mono s16le frame, base64-encoded, ready for the wire. */
  onFrame: (pcmBase64: string) => void;
  /** Throttled 0..1 RMS level for a VU meter. */
  onLevel?: (level: number) => void;
}

export interface CaptureHandle {
  stop: () => void;
}

/** True if this browser can capture tab/system audio via getDisplayMedia. */
export function supportsDisplayAudio(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

/** True if this browser can capture the microphone. */
export function supportsMic(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function classifyGetMediaError(err: unknown): AudioCaptureError {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    // getDisplayMedia throws NotAllowedError both for an OS/permission denial
    // AND when the user clicks Cancel on the picker — treat as a soft cancel.
    return new AudioCaptureError('cancelled', 'Capture was cancelled or permission was denied.');
  }
  if (name === 'NotFoundError' || name === 'NotReadableError') {
    return new AudioCaptureError('denied', 'No usable audio device was found.');
  }
  return new AudioCaptureError('unknown', message || 'Failed to start audio capture.');
}

async function acquireStream(source: AudioSource): Promise<MediaStream> {
  if (source === 'display') {
    if (!supportsDisplayAudio()) {
      throw new AudioCaptureError(
        'unsupported',
        'Tab audio sharing is only supported in Chrome and Edge.'
      );
    }
    let raw: MediaStream;
    try {
      raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
      throw classifyGetMediaError(err);
    }
    const audioTracks = raw.getAudioTracks();
    if (audioTracks.length === 0) {
      // User shared a screen/tab but didn't tick "share audio".
      raw.getTracks().forEach((t) => t.stop());
      throw new AudioCaptureError(
        'no-audio-track',
        'No audio was shared. Re-share and tick "Share tab audio".'
      );
    }
    // We only want the audio. Drop the video track immediately.
    raw.getVideoTracks().forEach((t) => t.stop());
    return new MediaStream(audioTracks);
  }

  if (!supportsMic()) {
    throw new AudioCaptureError('unsupported', 'Microphone capture is not supported here.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw classifyGetMediaError(err);
  }
}

/**
 * Start capturing `source`. Resolves to a handle once the audio graph is live;
 * rejects with an AudioCaptureError if the user cancels/denies or the browser
 * can't capture. Always cleans up partial resources on failure.
 */
export async function startCapture(
  source: AudioSource,
  callbacks: CaptureCallbacks
): Promise<CaptureHandle> {
  const stream = await acquireStream(source);

  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();

  // Teardown collects everything so a failure mid-setup leaks nothing.
  let stopped = false;
  let workletNode: AudioWorkletNode | null = null;
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  let silentGain: GainNode | null = null;

  const teardown = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      if (workletNode) workletNode.port.onmessage = null;
    } catch {
      /* ignore */
    }
    for (const node of [mediaSource, workletNode, silentGain]) {
      try {
        node?.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      void context.close();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  try {
    await context.audioWorklet.addModule(WORKLET_MODULE_URL);

    mediaSource = context.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(context, WORKLET_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    // A zero-gain sink keeps the graph pulling without echoing audio to output.
    silentGain = context.createGain();
    silentGain.gain.value = 0;

    const accumulator = createFrameAccumulator();
    let lastLevelAt = 0;

    workletNode.port.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      const chunk =
        event.data instanceof Float32Array ? event.data : new Float32Array(event.data ?? []);

      // RMS on the raw chunk (pre-downsample), throttled — like the desktop app.
      if (callbacks.onLevel) {
        const now = Date.now();
        if (now - lastLevelAt >= LEVEL_EMIT_INTERVAL_MS) {
          lastLevelAt = now;
          callbacks.onLevel(computeRms(chunk));
        }
      }

      const downsampled = downsampleFloat32Buffer(chunk, context.sampleRate, TARGET_SAMPLE_RATE);
      for (const frame of accumulator.push(downsampled)) {
        const pcm16 = convertToPCM16(frame);
        callbacks.onFrame(bytesToBase64(new Uint8Array(pcm16.buffer)));
      }
    };

    mediaSource.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(context.destination);

    // If the user stops sharing via the browser's native "Stop sharing" UI, the
    // track ends — tear down so we don't keep a dead graph alive.
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', teardown);
    });

    return { stop: teardown };
  } catch (err) {
    teardown();
    if (err instanceof AudioCaptureError) throw err;
    throw new AudioCaptureError(
      'unknown',
      err instanceof Error ? err.message : 'Failed to initialize the audio graph.'
    );
  }
}

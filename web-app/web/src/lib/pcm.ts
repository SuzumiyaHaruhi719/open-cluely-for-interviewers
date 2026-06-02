// ============================================================================
// Pure PCM DSP helpers — ported VERBATIM from the desktop audio pipeline
// (src/windows/assistant/renderer/features/assembly-ai/audio-pipeline.js) so the
// browser produces byte-identical 16 kHz mono s16le frames. Kept pure and
// dependency-free so the math is unit-testable without an AudioContext.
// ============================================================================

export const TARGET_SAMPLE_RATE = 16000;
const TARGET_FRAME_MS = 100;
const MIN_FRAME_MS = 50;

/** Samples per full frame at the target rate (100 ms => 1600 samples). */
export const TARGET_FRAME_SAMPLES = Math.round((TARGET_SAMPLE_RATE * TARGET_FRAME_MS) / 1000);
/** Minimum frame we bother to emit (50 ms => 800 samples). */
export const MIN_FRAME_SAMPLES = Math.round((TARGET_SAMPLE_RATE * MIN_FRAME_MS) / 1000);

/**
 * Clamp float32 [-1, 1] samples and scale to int16. Negative samples scale by
 * 0x8000 (32768) and positives by 0x7fff (32767) — the asymmetric scaling the
 * desktop app uses so -1.0 maps to exactly -32768.
 */
export function convertToPCM16(float32Data: Float32Array): Int16Array {
  const int16Data = new Int16Array(float32Data.length);
  for (let index = 0; index < float32Data.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Data[index]));
    int16Data[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16Data;
}

/**
 * Average-downsample a float32 buffer from inputSampleRate to outputSampleRate.
 * Returns the input untouched when rates match or the buffer is empty. Identical
 * to the desktop downsampleFloat32Buffer (block-average resampler).
 */
export function downsampleFloat32Buffer(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number = TARGET_SAMPLE_RATE
): Float32Array {
  if (inputSampleRate <= 0 || outputSampleRate <= 0 || input.length === 0) {
    return input;
  }
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / sampleRateRatio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.min(input.length, Math.round((offsetResult + 1) * sampleRateRatio));
    let accum = 0;
    let count = 0;
    for (let index = offsetInput; index < nextOffsetInput; index += 1) {
      accum += input[index];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetInput = nextOffsetInput;
  }

  return result;
}

/** RMS magnitude (0..1) of a float32 chunk, for a live level meter. */
export function computeRms(float32Data: Float32Array): number {
  if (!float32Data || float32Data.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let index = 0; index < float32Data.length; index += 1) {
    const sample = float32Data[index];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / float32Data.length);
  return rms > 1 ? 1 : rms;
}

/**
 * Base64-encode raw bytes. Works in the browser (btoa) and is the wire format
 * for the `audio` message's `pcm` field. Chunked to avoid blowing the argument
 * limit of String.fromCharCode on large buffers.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * A re-framing accumulator: push arbitrary-length 16 kHz float chunks, pull out
 * fixed TARGET_FRAME_SAMPLES frames. Mirrors the desktop sample queue so frames
 * sent over the wire are a consistent size. Returns completed frames as a list.
 */
export function createFrameAccumulator() {
  let queue: Float32Array[] = [];
  let length = 0;

  function pull(count: number): Float32Array {
    const output = new Float32Array(count);
    let written = 0;
    while (written < count && queue.length > 0) {
      const first = queue[0];
      const take = Math.min(first.length, count - written);
      output.set(first.subarray(0, take), written);
      written += take;
      if (take === first.length) {
        queue.shift();
      } else {
        queue[0] = first.subarray(take);
      }
      length -= take;
    }
    return written === count ? output : output.subarray(0, written);
  }

  return {
    /** Append samples; returns any full frames now available. */
    push(samples: Float32Array): Float32Array[] {
      if (samples && samples.length > 0) {
        queue.push(samples);
        length += samples.length;
      }
      const frames: Float32Array[] = [];
      while (length >= TARGET_FRAME_SAMPLES) {
        frames.push(pull(TARGET_FRAME_SAMPLES));
      }
      return frames;
    },
    /** Flush a trailing partial frame (>= MIN_FRAME_SAMPLES), else null. */
    flush(): Float32Array | null {
      if (length >= MIN_FRAME_SAMPLES) {
        return pull(length);
      }
      return null;
    },
    reset(): void {
      queue = [];
      length = 0;
    }
  };
}

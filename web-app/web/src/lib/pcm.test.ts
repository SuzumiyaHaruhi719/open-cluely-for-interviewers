import { describe, expect, test } from 'vitest';
import {
  convertToPCM16,
  downsampleFloat32Buffer,
  computeRms,
  createFrameAccumulator,
  TARGET_FRAME_SAMPLES,
  TARGET_SAMPLE_RATE
} from './pcm';

describe('convertToPCM16', () => {
  test('scales the full-scale endpoints asymmetrically (-1 => -32768, +1 => 32767)', () => {
    const out = convertToPCM16(new Float32Array([-1, 1, 0]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(0);
  });

  test('clamps out-of-range samples before scaling', () => {
    const out = convertToPCM16(new Float32Array([-2, 2]));
    expect(out[0]).toBe(-32768); // clamped to -1 then *0x8000
    expect(out[1]).toBe(32767); // clamped to +1 then *0x7fff
  });

  test('scales mid-range values toward int16 (0.5 => ~16383)', () => {
    const out = convertToPCM16(new Float32Array([0.5, -0.5]));
    expect(out[0]).toBe(Math.trunc(0.5 * 0x7fff)); // 16383
    expect(out[1]).toBe(Math.trunc(-0.5 * 0x8000)); // -16384
  });

  test('output length matches input length', () => {
    expect(convertToPCM16(new Float32Array(1600)).length).toBe(1600);
  });
});

describe('downsampleFloat32Buffer', () => {
  test('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleFloat32Buffer(input, 16000, 16000)).toBe(input);
  });

  test('48k -> 16k yields one third the samples (ratio math)', () => {
    // 48000/16000 = 3, so 9 input samples => 3 output samples.
    const input = new Float32Array(9).map((_, i) => i);
    const out = downsampleFloat32Buffer(input, 48000, 16000);
    expect(out.length).toBe(3);
  });

  test('block-averages adjacent samples when halving the rate', () => {
    // 32000/16000 = 2 => average each pair: [0,1,2,3] -> [0.5, 2.5]
    const out = downsampleFloat32Buffer(new Float32Array([0, 1, 2, 3]), 32000, 16000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(2.5, 6);
  });

  test('empty input is returned as-is', () => {
    const input = new Float32Array(0);
    expect(downsampleFloat32Buffer(input, 44100, 16000)).toBe(input);
  });
});

describe('computeRms', () => {
  test('is 0 for silence and the magnitude for a DC signal', () => {
    expect(computeRms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 6);
  });

  test('is clamped to 1 for overdriven input', () => {
    expect(computeRms(new Float32Array([5, -5]))).toBe(1);
  });

  test('empty input is 0', () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });
});

describe('createFrameAccumulator', () => {
  test('emits no frame until a full TARGET_FRAME_SAMPLES is buffered', () => {
    const acc = createFrameAccumulator();
    expect(acc.push(new Float32Array(TARGET_FRAME_SAMPLES - 1))).toEqual([]);
    const frames = acc.push(new Float32Array(1));
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(TARGET_FRAME_SAMPLES);
  });

  test('splits a large push into multiple exact-size frames with a remainder', () => {
    const acc = createFrameAccumulator();
    const frames = acc.push(new Float32Array(TARGET_FRAME_SAMPLES * 2 + 10));
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.length).toBe(TARGET_FRAME_SAMPLES);
    // The 10-sample remainder is below MIN_FRAME_SAMPLES, so flush() is null.
    expect(acc.flush()).toBeNull();
  });

  test('TARGET_FRAME_SAMPLES is 1600 (100 ms at 16 kHz)', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
    expect(TARGET_FRAME_SAMPLES).toBe(1600);
  });
});

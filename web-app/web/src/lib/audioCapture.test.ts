import { describe, expect, it, vi } from 'vitest';
import {
  buildMicAudioConstraints,
  isVirtualLoopbackLabel,
  suppressLocalAudioPlayback
} from './audioCapture';

describe('suppressLocalAudioPlayback', () => {
  it('asks a captured tab-audio track to stay silent locally without stopping capture', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const track = {
      applyConstraints,
      getSettings: () => ({ suppressLocalAudioPlayback: true }),
      readyState: 'live'
    } as unknown as MediaStreamTrack;

    await expect(suppressLocalAudioPlayback(track)).resolves.toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({ suppressLocalAudioPlayback: true });
    expect(track.readyState).toBe('live');
  });

  it('keeps capture usable when the browser does not implement the constraint', async () => {
    const track = {
      applyConstraints: vi.fn().mockRejectedValue(new DOMException('unsupported', 'OverconstrainedError')),
      getSettings: () => ({}),
      readyState: 'live'
    } as unknown as MediaStreamTrack;

    await expect(suppressLocalAudioPlayback(track)).resolves.toBe(false);
    expect(track.readyState).toBe('live');
  });
});

describe('virtual loopback capture', () => {
  it('recognizes loopback devices without treating physical microphones as virtual', () => {
    expect(isVirtualLoopbackLabel('BlackHole 2ch (Virtual)')).toBe(true);
    expect(isVirtualLoopbackLabel('Blackhole Audio Input (Aggregate)')).toBe(true);
    expect(isVirtualLoopbackLabel('OrayVirtualAudioDevice')).toBe(true);
    expect(isVirtualLoopbackLabel('Screen Record with Audio')).toBe(true);
    expect(isVirtualLoopbackLabel('MacBook Pro Microphone (Built-in)')).toBe(false);
    expect(isVirtualLoopbackLabel('Huawei Mate 60 Pro+ Microphone')).toBe(false);
  });

  it('disables speech enhancement only for a selected virtual loopback', () => {
    expect(buildMicAudioConstraints('blackhole-id', 'BlackHole 2ch (Virtual)')).toEqual({
      deviceId: { exact: 'blackhole-id' },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    });
    expect(buildMicAudioConstraints('builtin-id', 'MacBook Pro Microphone (Built-in)')).toEqual({
      deviceId: { exact: 'builtin-id' }
    });
    expect(buildMicAudioConstraints('', '')).toBe(true);
  });
});

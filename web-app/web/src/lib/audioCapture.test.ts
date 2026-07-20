import { describe, expect, it, vi } from 'vitest';
import { suppressLocalAudioPlayback } from './audioCapture';

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

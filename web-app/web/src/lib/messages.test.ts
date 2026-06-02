import { describe, it, expect } from 'vitest';
import { parseServerMessage } from './messages';

describe('transcript speaker fields', () => {
  it('carries speaker + speakerId through', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate' })
    );
    expect(out).toMatchObject({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate' });
  });

  it('parses transcripts with no speaker (online)', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'transcript', source: 'display', text: 'hi', isFinal: false })
    );
    expect(out).toMatchObject({ type: 'transcript', source: 'display', text: 'hi', isFinal: false });
  });

  it('omits speakerId when not a number', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'transcript', source: 'mic', text: 'hello', isFinal: true, speakerId: null })
    ) as Record<string, unknown> | null;
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty('speakerId');
  });

  it('omits speaker when not a valid SpeakerRole', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'transcript', source: 'mic', text: 'hello', isFinal: true, speaker: 'robot' })
    ) as Record<string, unknown> | null;
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty('speaker');
  });

  it('carries all three valid speaker roles', () => {
    for (const role of ['interviewer', 'candidate', 'unknown'] as const) {
      const out = parseServerMessage(
        JSON.stringify({ type: 'transcript', source: 'display', text: 'x', isFinal: true, speaker: role })
      );
      expect(out).toMatchObject({ speaker: role });
    }
  });
});

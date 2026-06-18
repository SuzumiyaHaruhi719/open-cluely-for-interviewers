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

describe('result trigger fields', () => {
  const baseResult = {
    type: 'result',
    requestId: 'req-1',
    mode: 'expert',
    output: {
      primary_question: 'How did you debug the queue?',
      alternative_question: '',
      rationale_for_interviewer: '',
      anchor_quotes: [],
      expected_evidence_yield: '',
      iteration_version: '3'
    },
    shouldShowFollowUps: true,
    tokensUsed: { input: 10, output: 5, total: 15 },
    elapsedMs: 1200,
    iterationVersion: '3'
  };

  it('preserves manual and auto result triggers', () => {
    for (const trigger of ['manual', 'auto'] as const) {
      const out = parseServerMessage(JSON.stringify({ ...baseResult, trigger }));
      expect(out).toMatchObject({ type: 'result', trigger });
    }
  });

  it('omits malformed result triggers without dropping the result', () => {
    const out = parseServerMessage(JSON.stringify({ ...baseResult, trigger: 'timer' })) as Record<string, unknown>;
    expect(out).toMatchObject({ type: 'result', requestId: 'req-1' });
    expect(out).not.toHaveProperty('trigger');
  });
});

import { describe, it, expect } from 'vitest';
import { parseServerMessage } from './messages';

describe('transcript speaker fields', () => {
  it('carries speaker + speakerId through', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate', startTimeMs: 1_240 })
    );
    expect(out).toMatchObject({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate', startTimeMs: 1_240 });
  });

  it('omits malformed provider-relative transcript timestamps', () => {
    for (const startTimeMs of [-1, Number.NaN, 'soon']) {
      const out = parseServerMessage(
        JSON.stringify({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, startTimeMs })
      ) as Record<string, unknown> | null;
      expect(out).not.toBeNull();
      expect(out).not.toHaveProperty('startTimeMs');
    }
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

describe('ASR runtime status messages', () => {
  it('parses a provider failure with a concise public reason', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'failed',
        message: '鉴权失败'
      })
    );

    expect(out).toEqual({
      type: 'asr-status',
      source: 'mic',
      provider: 'volc',
      state: 'failed',
      message: '鉴权失败'
    });
  });

  it('rejects unknown ASR states and providers', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'asr-status', source: 'mic', provider: 'cam++', state: 'live' })
      )
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'asr-status', source: 'mic', provider: 'volc', state: 'healthy-ish' })
      )
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'asr-status', source: 'mic', provider: 'xfyun', state: 'live' })
      )
    ).toBeNull();
  });
});

describe('auto monitor state messages', () => {
  it('parses the credential-free Flash sentinel lifecycle', () => {
    for (const status of ['idle', 'evaluating', 'waiting', 'delegating'] as const) {
      expect(
        parseServerMessage(
          JSON.stringify({
            type: 'auto-monitor',
            status,
            model: 'deepseek-v4-flash',
            elapsedMs: 321
          })
        )
      ).toEqual({ type: 'auto-monitor', status, model: 'deepseek-v4-flash', elapsedMs: 321 });
    }
  });

  it('rejects unknown monitor states', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'auto-monitor', status: 'thinking-hard', model: 'deepseek-v4-flash' })
      )
    ).toBeNull();
  });
});

describe('speaker partition messages', () => {
  it('parses a complete Flash role partition', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        segments: [
          { seq: 0, speakerId: 9, role: 'interviewer', text: '请坐' },
          { seq: 1, speakerId: 7, role: 'candidate', text: '谢谢' }
        ]
      })
    );
    expect(out).toMatchObject({
      type: 'speaker-partition',
      status: 'live',
      model: 'deepseek-v4-flash',
      speakerAssignments: [],
      segments: [
        { seq: 0, speakerId: 9, role: 'interviewer', text: '请坐' },
        { seq: 1, speakerId: 7, role: 'candidate', text: '谢谢' }
      ]
    });
  });

  it('parses authoritative whole-voiceprint assignments', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 7,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.93,
            evidenceVersion: 11,
            updatedAtMs: 4200,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          {
            seq: 11,
            speakerId: 7,
            role: 'candidate',
            roleSource: 'cohort',
            text: '我负责了这个项目。'
          }
        ]
      })
    );

    expect(out?.type === 'speaker-partition' ? out.speakerAssignments : null).toEqual([
      {
        speakerId: 7,
        role: 'candidate',
        state: 'delegated',
        roleSource: 'cohort',
        confidence: 0.93,
        evidenceVersion: 11,
        updatedAtMs: 4200,
        reasonCodes: ['two_pass_consensus']
      }
    ]);
  });

  it('rejects duplicate or role-conflicting whole-voiceprint assignments', () => {
    const baseAssignment = {
      speakerId: 7,
      role: 'candidate',
      state: 'delegated',
      roleSource: 'cohort',
      confidence: 0.93,
      evidenceVersion: 11,
      updatedAtMs: 4200,
      reasonCodes: ['two_pass_consensus']
    };
    const duplicate = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          baseAssignment,
          { ...baseAssignment, role: 'interviewer' }
        ],
        segments: []
      })
    );
    const conflict = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [baseAssignment],
        segments: [
          {
            seq: 11,
            speakerId: 7,
            role: 'interviewer',
            roleSource: 'cohort',
            text: '冲突角色。'
          }
        ]
      })
    );

    expect(duplicate).toBeNull();
    expect(conflict).toBeNull();
  });

  it('rejects malformed assignment state and numeric evidence fields', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 7,
            role: 'candidate',
            state: 'guessing',
            roleSource: 'cohort',
            confidence: 1.2,
            evidenceVersion: -1,
            updatedAtMs: -20,
            reasonCodes: ['bad']
          }
        ],
        segments: []
      })
    );

    expect(out).toBeNull();
  });

  it('rejects a partially malformed partition instead of silently dropping turns', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'final',
        model: 'deepseek-v4-flash',
        segments: [{ seq: 0, speakerId: 9, role: 'robot', text: 'bad' }]
      })
    );
    expect(out).toBeNull();
  });

  it('preserves a valid speaker role decision source', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        segments: [
          {
            seq: 4,
            speakerId: 30,
            role: 'candidate',
            roleSource: 'cohort',
            text: '我会持续复验整改结果。'
          }
        ]
      })
    );

    expect(out?.type === 'speaker-partition' ? out.segments[0].roleSource : null).toBe('cohort');
  });

  it('rejects an unknown speaker role decision source', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        segments: [
          {
            seq: 4,
            speakerId: 30,
            role: 'candidate',
            roleSource: 'voice-guess',
            text: '不可信来源。'
          }
        ]
      })
    );

    expect(out).toBeNull();
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

  it('preserves a non-negative transcript anchor sequence', () => {
    const out = parseServerMessage(JSON.stringify({ ...baseResult, trigger: 'auto', anchorSeq: 12 }));
    expect(out).toMatchObject({ type: 'result', requestId: 'req-1', anchorSeq: 12 });

    const malformed = parseServerMessage(
      JSON.stringify({ ...baseResult, trigger: 'auto', anchorSeq: -1 })
    ) as Record<string, unknown>;
    expect(malformed).not.toHaveProperty('anchorSeq');
  });
});

describe('session-context messages', () => {
  it('normalizes malformed state to empty arrays', () => {
    const out = parseServerMessage(
      JSON.stringify({ type: 'session-context', state: { competencies: undefined } })
    );

    expect(out).toMatchObject({
      type: 'session-context',
      state: { competencies: [], topics: [], gaps: [] }
    });
  });

  it('maps legacy desktop Block-H session state into web session context', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'session-context',
        state: {
          drilled_topics: ['payment migration'],
          competencies_covered: ['technical-depth'],
          open_gaps: ['missing QPS number']
        }
      })
    );

    expect(out).toMatchObject({
      type: 'session-context',
      state: {
        topics: ['payment migration'],
        gaps: ['missing QPS number'],
        competencies: [{ name: 'technical-depth', status: 'covered' }]
      }
    });
  });
});

describe('summary debug messages', () => {
  it('parses event-level summary debug frames without leaking free-form text fields', () => {
    const out = parseServerMessage(
      JSON.stringify({
        type: 'summary-debug',
        requestId: 'sum-1',
        event: {
          at: 1234,
          source: 'dashscope',
          stage: 'sse-event',
          model: 'deepseek-v4-pro',
          eventType: 'message_stop',
          inputTokens: 10,
          outputTokens: 20,
          text: 'do not leak transcript text'
        }
      })
    ) as Record<string, unknown> | null;

    expect(out).toMatchObject({
      type: 'summary-debug',
      requestId: 'sum-1',
      event: {
        at: 1234,
        source: 'dashscope',
        stage: 'sse-event',
        model: 'deepseek-v4-pro',
        eventType: 'message_stop',
        inputTokens: 10,
        outputTokens: 20
      }
    });
    expect(out?.event).not.toHaveProperty('text');
  });
});

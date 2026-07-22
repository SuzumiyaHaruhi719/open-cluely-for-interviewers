import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCopilotSocket } from './useCopilotSocket';
import { installMockWebSocket, MockWebSocket } from '../test/mockWebSocket';

const { startCaptureMock } = vi.hoisted(() => ({ startCaptureMock: vi.fn() }));
vi.mock('./audioCapture', async () => {
  const actual = await vi.importActual<typeof import('./audioCapture')>('./audioCapture');
  return { ...actual, startCapture: startCaptureMock };
});

describe('useCopilotSocket', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installMockWebSocket();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    startCaptureMock.mockResolvedValue({ stop: vi.fn() });
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  function seedCandidateTranscript(text = '候选人回答'): void {
    act(() => {
      MockWebSocket.last().emit({ type: 'transcript', source: 'display', text, isFinal: true });
    });
  }

  test('surfaces sessionId from a ready message', async () => {
    const { result } = renderHook(() => useCopilotSocket());

    expect(result.current.status).toBe('connecting');

    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      MockWebSocket.last().emit({ type: 'ready', sessionId: 'sess-42' });
    });

    await waitFor(() => expect(result.current.sessionId).toBe('sess-42'));
  });

  test('surfaces the current continuous Flash monitor lifecycle', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      MockWebSocket.last().emit({
        type: 'auto-monitor',
        status: 'delegating',
        model: 'deepseek-v4-flash',
        elapsedMs: 712
      });
    });

    await waitFor(() => expect(result.current.autoMonitor?.status).toBe('delegating'));
    expect(result.current.autoMonitor).toMatchObject({
      model: 'deepseek-v4-flash',
      elapsedMs: 712
    });
  });

  test('analyze sends a message and a result surfaces as lastResult', async () => {
    const { result } = renderHook(() => useCopilotSocket());

    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.analyze('We used consistent hashing.', ['Prior Q']);
    });

    expect(requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.isAnalyzing).toBe(true);

    // The client serialized exactly one analyze frame with our requestId + history.
    const socket = MockWebSocket.last();
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]);
    expect(frame).toMatchObject({
      type: 'analyze',
      requestId: '11111111-1111-4111-8111-111111111111',
      candidateAnswer: 'We used consistent hashing.',
      questionHistory: ['Prior Q']
    });

    // Server answers with a progress event, then the result.
    act(() => {
      socket.emit({
        type: 'progress',
        requestId,
        phase: 'drafting',
        index: 0,
        total: 2,
        status: 'start'
      });
    });
    await waitFor(() => expect(result.current.progress?.phase).toBe('drafting'));

    act(() => {
      socket.emit({
        type: 'result',
        requestId,
        mode: 'expert',
        output: {
          primary_question: 'Why consistent hashing over range sharding?',
          alternative_question: '',
          rationale_for_interviewer: 'Tests reasoning.',
          anchor_quotes: ['consistent hashing'],
          expected_evidence_yield: 'Depth.',
          iteration_version: '3'
        },
        shouldShowFollowUps: true,
        tokensUsed: { input: 10, output: 5, total: 15 },
        elapsedMs: 1234,
        iterationVersion: '3'
      });
    });

    await waitFor(() => {
      expect(result.current.lastResult?.output.primary_question).toBe(
        'Why consistent hashing over range sharding?'
      );
    });
    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('accumulates anchored question events instead of overwriting prior follow-ups', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    const resultFrame = (requestId: string, question: string, anchorSeq: number) => ({
      type: 'result',
      requestId,
      mode: 'expert',
      output: {
        primary_question: question,
        alternative_question: '',
        rationale_for_interviewer: '验证证据。',
        anchor_quotes: [],
        expected_evidence_yield: '获得具体证据。',
        iteration_version: '3'
      },
      shouldShowFollowUps: true,
      tokensUsed: { input: 10, output: 5, total: 15 },
      elapsedMs: 900,
      iterationVersion: '3',
      trigger: 'auto',
      anchorSeq
    });

    act(() => {
      socket.emit(resultFrame('auto-1', '第一次追问？', 4));
      socket.emit(resultFrame('auto-2', '第二次追问？', 9));
    });

    await waitFor(() => expect(result.current.questionEvents).toHaveLength(2));
    expect(result.current.questionEvents.map((event) => [event.result.requestId, event.anchorSeq])).toEqual([
      ['auto-1', 4],
      ['auto-2', 9]
    ]);
    expect(result.current.lastResult?.requestId).toBe('auto-2');
  });

  test('a terminal progress frame clears an adopted Auto attempt when no question is emitted', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'progress',
        requestId: 'auto-no-question',
        phase: 'expert-question',
        index: 1,
        total: 1,
        status: 'start'
      });
    });
    await waitFor(() => expect(result.current.isAnalyzing).toBe(true));

    act(() => {
      socket.emit({
        type: 'progress',
        requestId: 'auto-no-question',
        phase: 'expert-question',
        index: 1,
        total: 1,
        status: 'done'
      });
    });

    await waitFor(() => expect(result.current.isAnalyzing).toBe(false));
    expect(result.current.progress).toBeNull();
    expect(result.current.lastResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('progressTokens accumulates per-phase token payloads and resets on a new analyze', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.analyze('We sharded by user id.');
    });
    expect(result.current.progressTokens).toBe(0);

    // First phase reports tokens → accumulate (12 + 8).
    act(() => {
      socket.emit({
        type: 'progress',
        requestId,
        phase: 'answer',
        index: 0,
        total: 2,
        status: 'done',
        tokens: { input: 12, output: 8 }
      });
    });
    await waitFor(() => expect(result.current.progressTokens).toBe(20));

    // A token-less phase leaves the running total unchanged.
    act(() => {
      socket.emit({ type: 'progress', requestId, phase: 'rank', index: 1, total: 2, status: 'start' });
    });
    expect(result.current.progressTokens).toBe(20);

    // A second token-bearing phase adds on top (20 + 30).
    act(() => {
      socket.emit({
        type: 'progress',
        requestId,
        phase: 'rank',
        index: 1,
        total: 2,
        status: 'done',
        tokens: { input: 20, output: 10 }
      });
    });
    await waitFor(() => expect(result.current.progressTokens).toBe(50));

    // A fresh analyze resets the counter back to 0.
    act(() => {
      result.current.analyze('Another answer.');
    });
    expect(result.current.progressTokens).toBe(0);
  });

  test('configure is a no-op until the socket is open', () => {
    const { result } = renderHook(() => useCopilotSocket());

    // Not open yet — send should be swallowed without throwing.
    act(() => {
      result.current.sendConfigure({ mode: 'fast' });
    });
    expect(MockWebSocket.last().sent).toHaveLength(0);

    act(() => {
      MockWebSocket.last().open();
    });
    act(() => {
      result.current.sendConfigure({ mode: 'fast' });
    });

    const frame = JSON.parse(MockWebSocket.last().sent[0]);
    expect(frame).toEqual({ type: 'configure', config: { mode: 'fast' } });
  });

  test('transcript messages accumulate finals and track the live partial per source', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    // A partial on the interviewee (display) lane updates `partial` only.
    act(() => {
      socket.emit({ type: 'transcript', source: 'display', text: 'I built a', isFinal: false });
    });
    await waitFor(() => expect(result.current.transcripts.display.partial).toBe('I built a'));
    expect(result.current.transcripts.display.finalText).toBe('');

    // A final commits to `finalText` and clears the partial.
    act(() => {
      socket.emit({ type: 'transcript', source: 'display', text: 'I built a cache.', isFinal: true });
    });
    await waitFor(() => expect(result.current.transcripts.display.finalText).toBe('I built a cache.'));
    expect(result.current.transcripts.display.partial).toBe('');

    // A second final appends (space-joined).
    act(() => {
      socket.emit({ type: 'transcript', source: 'display', text: 'It cut p99.', isFinal: true });
    });
    await waitFor(() =>
      expect(result.current.transcripts.display.finalText).toBe('I built a cache. It cut p99.')
    );

    // The mic lane is independent of the display lane.
    expect(result.current.transcripts.mic.finalText).toBe('');
  });

  test('stopAudio sends an audio-control stop frame', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      result.current.stopAudio('mic');
    });
    const frame = JSON.parse(MockWebSocket.last().sent.at(-1) as string);
    expect(frame).toEqual({ type: 'audio-control', action: 'stop', source: 'mic' });
    expect(result.current.audio.mic.capturing).toBe(false);
    expect(result.current.audio.mic.runtimeState).toBe('finalizing');
  });

  test('ASR runtime status overrides optimistic local capture health without dropping late finals', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'failed',
        message: '豆包鉴权失败'
      });
    });
    await waitFor(() => expect(result.current.audio.mic.runtimeState).toBe('failed'));
    expect(result.current.audio.mic.provider).toBe('volc');
    expect(result.current.audio.mic.error).toBe('豆包鉴权失败');

    act(() => {
      result.current.stopAudio('mic');
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '停止后到达的最后一句',
        isFinal: true,
        speakerId: 2,
        speaker: 'candidate'
      });
      socket.emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'stopped'
      });
    });

    await waitFor(() =>
      expect(result.current.transcripts.mic.finalText).toContain('停止后到达的最后一句')
    );
    expect(result.current.audio.mic.runtimeState).toBe('stopped');
    expect(result.current.speakerSegments.at(-1)?.role).toBe('candidate');
  });

  test('partial ASR finalization is a non-fatal Chinese notice, not a capture error', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      MockWebSocket.last().emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'partial',
        message: 'Doubao finalization timeout'
      });
    });

    await waitFor(() => expect(result.current.audio.mic.runtimeState).toBe('partial'));
    expect(result.current.audio.mic.error).toBeNull();
    expect(result.current.audio.mic.notice).toBe('转写已保存；最后一小段可能未确认。');
  });

  test('terminal ASR status clears an unconfirmed live partial after capture closes', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      MockWebSocket.last().emit({
        type: 'transcript',
        source: 'mic',
        text: '停止时未成为最终句的尾音',
        isFinal: false
      });
    });
    expect(result.current.transcripts.mic.partial).toBe('停止时未成为最终句的尾音');

    act(() => {
      MockWebSocket.last().emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'stopped'
      });
    });

    expect(result.current.transcripts.mic.partial).toBe('');
  });

  test('a new audio session drops stale provider state and ignores late events until the fresh ASR connects', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    await act(async () => {
      await result.current.startAudio('mic', { skipLocalCapture: true });
    });
    act(() => {
      socket.emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'failed',
        message: '豆包 ASR 2.0 权限不足'
      });
    });
    expect(result.current.audio.mic.runtimeState).toBe('failed');

    act(() => result.current.resetAudioSession());
    expect(result.current.audio.mic).toMatchObject({
      capturing: false,
      runtimeState: 'stopped',
      error: null,
      notice: null
    });
    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({
      type: 'audio-control',
      action: 'stop',
      source: 'display'
    });

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '旧面试停止后迟到的最后一句',
        isFinal: true
      });
      socket.emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'partial'
      });
      socket.emit({
        type: 'speaker-partition',
        segments: [
          { seq: 99, speakerId: 1, role: 'candidate', text: '旧面试角色结果' }
        ]
      });
    });
    expect(result.current.transcripts.mic.finalText).toBe('');
    expect(result.current.speakerSegments).toEqual([]);
    expect(result.current.audio.mic.runtimeState).toBe('stopped');

    await act(async () => {
      await result.current.startAudio('mic', { skipLocalCapture: true });
    });
    act(() => {
      socket.emit({ type: 'asr-status', source: 'mic', provider: 'paraformer', state: 'partial' });
    });
    expect(result.current.audio.mic.runtimeState).toBe('connecting');

    act(() => {
      socket.emit({ type: 'asr-status', source: 'mic', provider: 'paraformer', state: 'connecting' });
      socket.emit({
        type: 'speaker-partition',
        status: 'final',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 1,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.95,
            evidenceVersion: 99,
            updatedAtMs: 99_000,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          { seq: 99, speakerId: 1, role: 'candidate', roleSource: 'cohort', text: '上一场完整面试' }
        ]
      });
    });
    expect(result.current.speakerSegments).toEqual([]);

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '新面试第一句',
        isFinal: true
      });
    });
    expect(result.current.transcripts.mic.finalText).toBe('新面试第一句');
  });

  test('startAudio with skipLocalCapture opens the server ASR session without browser media capture', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    await act(async () => {
      await result.current.startAudio('mic', { skipLocalCapture: true });
    });

    const frame = JSON.parse(MockWebSocket.last().sent.at(-1) as string);
    expect(frame).toEqual({ type: 'audio-control', action: 'start', source: 'mic' });
    expect(result.current.audio.mic).toMatchObject({ capturing: true, error: null });
  });

  test('normal microphone capture waits for its first PCM frame before opening the upstream ASR session', async () => {
    let resolveCapture!: (handle: { stop: () => void }) => void;
    let emitFrame!: (pcm: string) => void;
    startCaptureMock.mockImplementation((_source, callbacks) => {
      emitFrame = callbacks.onFrame;
      return new Promise((resolve) => {
        resolveCapture = resolve;
      });
    });
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    let starting!: Promise<void>;
    act(() => {
      starting = result.current.startAudio('mic');
    });
    expect(socket.sent).toHaveLength(0);

    resolveCapture({ stop: vi.fn() });
    await act(async () => {
      await starting;
    });

    expect(socket.sent).toHaveLength(0);
    expect(result.current.audio.mic).toMatchObject({ capturing: true, error: null });

    act(() => emitFrame('AA=='));

    expect(socket.sent.map((frame) => JSON.parse(frame as string))).toEqual([{
      type: 'audio-control',
      action: 'start',
      source: 'mic'
    }, {
      type: 'audio',
      seq: 0,
      source: 'mic',
      pcm: 'AA=='
    }]);
  });

  test('rebases provider-relative transcript time onto every local capture cycle', async () => {
    let emitFrame!: (pcm: string) => void;
    startCaptureMock.mockImplementation((_source, callbacks) => {
      emitFrame = callbacks.onFrame;
      return Promise.resolve({ stop: vi.fn() });
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));

    await act(async () => {
      await result.current.startAudio('mic');
    });
    act(() => emitFrame('AA=='));

    now.mockReturnValue(200_000);
    act(() => {
      MockWebSocket.last().emit({
        type: 'transcript',
        source: 'mic',
        text: '重连后返回的句子',
        isFinal: true,
        speakerId: 4,
        speaker: 'unknown',
        startTimeMs: 12_340
      });
    });

    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    expect(result.current.speakerSegments[0]).toMatchObject({
      createdAtMs: 112_340,
      audioStartMs: 12_340
    });
  });

  test('speakerSegments: online finals (no speakerId) add nothing; offline finals (numeric speakerId) append one labelled segment', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    // ONLINE provider: a final transcript with NO speakerId must NOT create a
    // segment — the guard `typeof message.speakerId === 'number'` holds.
    act(() => {
      socket.emit({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true });
    });
    await waitFor(() => expect(result.current.transcripts.mic.finalText).toBe('hi'));
    expect(result.current.speakerSegments).toEqual([]);

    // Native-cluster ASR: a final carrying a numeric speakerId appends exactly one
    // labelled segment using the server-provided speaker role.
    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '你好',
        isFinal: true,
        speakerId: 0,
        speaker: 'interviewer'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    expect(result.current.speakerSegments[0]).toMatchObject({
      speakerId: 0,
      role: 'interviewer',
      text: '你好'
    });
  });

  test('Doubao raw speaker ids remain independently labelable', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    // A native ASR may over-segment fast hand-offs into extra raw ids. The client
    // keeps those ids distinct so the interviewer can label each "说话人 N"
    // instead of receiving locally merged speakers.
    act(() => {
      socket.emit({ type: 'transcript', source: 'mic', text: '问题一', isFinal: true, speakerId: 1, speaker: 'unknown' });
      socket.emit({ type: 'transcript', source: 'mic', text: '回答一', isFinal: true, speakerId: 2, speaker: 'unknown' });
      socket.emit({ type: 'transcript', source: 'mic', text: '插话', isFinal: true, speakerId: 3, speaker: 'unknown' });
    });
    await waitFor(() => expect(result.current.speakerSegments.length).toBe(3));
    const distinct = new Set(result.current.speakerSegments.map((s) => s.speakerId));
    expect([...distinct].sort()).toEqual([1, 2, 3]);

    // Manual relabel of one raw speaker id only re-labels that id and tells the
    // server which raw id was assigned.
    act(() => {
      result.current.setSpeakerRole(2, 'candidate');
    });
    const speaker2Segs = result.current.speakerSegments.filter((s) => s.speakerId === 2);
    expect(speaker2Segs.length).toBeGreaterThan(0);
    expect(speaker2Segs.every((s) => s.role === 'candidate')).toBe(true);
    expect(result.current.speakerSegments.filter((s) => s.speakerId !== 2).every((s) => s.role === 'unknown')).toBe(true);
    const roleFrame = JSON.parse(socket.sent.at(-1) as string);
    expect(roleFrame).toEqual({ type: 'set-speaker-role', speakerId: 2, role: 'candidate' });
  });

  test('automatic speaker partition relabels past native segments after live/end inference', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({ type: 'transcript', source: 'mic', text: '请坐', isFinal: true, speakerId: 9, speaker: 'unknown' });
      socket.emit({ type: 'transcript', source: 'mic', text: '谢谢', isFinal: true, speakerId: 7, speaker: 'unknown' });
    });
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(2));

    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 9,
            role: 'interviewer',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.96,
            evidenceVersion: 3,
            updatedAtMs: 2000,
            reasonCodes: ['two_pass_consensus']
          },
          {
            speakerId: 7,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.95,
            evidenceVersion: 3,
            updatedAtMs: 2000,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          { seq: 0, speakerId: 9, role: 'interviewer', roleSource: 'cohort', text: '请坐' },
          { seq: 1, speakerId: 7, role: 'candidate', roleSource: 'cohort', text: '谢谢' }
        ]
      });
    });

    await waitFor(() =>
      expect(result.current.speakerSegments.map((s) => [s.speakerId, s.role])).toEqual([
        [9, 'interviewer'],
        [7, 'candidate']
      ])
    );
    expect(result.current.speakerSegments.map((s) => s.roleSource)).toEqual([
      'cohort',
      'cohort'
    ]);
  });

  test('whole-voiceprint assignment snapshots govern past and future raw finals atomically', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '我负责用户增长项目。',
        isFinal: true,
        speakerId: 7,
        speaker: 'unknown'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.role).toBe('unknown'));

    const delegated = {
      speakerId: 7,
      role: 'candidate' as const,
      state: 'delegated' as const,
      roleSource: 'cohort' as const,
      confidence: 0.95,
      evidenceVersion: 2,
      updatedAtMs: 1500,
      reasonCodes: ['two_pass_consensus']
    };
    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [delegated],
        segments: [
          {
            seq: 0,
            speakerId: 7,
            role: 'candidate',
            roleSource: 'cohort',
            text: '我负责用户增长项目。'
          }
        ]
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.role).toBe('candidate'));

    // A stale/raw role stamp cannot split the already delegated native id.
    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '我还负责跨部门复盘。',
        isFinal: true,
        speakerId: 7,
        speaker: 'interviewer'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.text).toContain('跨部门复盘'));
    expect(result.current.speakerSegments.every((segment) => segment.role === 'candidate')).toBe(true);
    expect(result.current.speakerSegments.every((segment) => segment.roleSource === 'cohort')).toBe(true);

    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            ...delegated,
            role: 'unknown',
            state: 'contested',
            roleSource: 'unknown',
            confidence: 0,
            evidenceVersion: 4,
            updatedAtMs: 5000,
            reasonCodes: ['opposite_role_contradictions']
          }
        ],
        segments: [
          {
            seq: 0,
            speakerId: 7,
            role: 'unknown',
            roleSource: 'unknown',
            text: '我负责用户增长项目。 我还负责跨部门复盘。'
          }
        ]
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.role).toBe('unknown'));

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '新的待确认样本。',
        isFinal: true,
        speakerId: 7,
        speaker: 'candidate'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.text).toContain('新的待确认样本'));
    expect(result.current.speakerSegments.every((segment) => segment.role === 'unknown')).toBe(true);
  });

  test('manual whole-voiceprint correction outranks later automatic snapshots', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '人工确认的候选人回答。',
        isFinal: true,
        speakerId: 5,
        speaker: 'unknown'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    act(() => result.current.setSpeakerRole(5, 'candidate'));

    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 5,
            role: 'interviewer',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.94,
            evidenceVersion: 3,
            updatedAtMs: 3000,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          {
            seq: 0,
            speakerId: 5,
            role: 'interviewer',
            roleSource: 'cohort',
            text: '人工确认的候选人回答。'
          }
        ]
      });
    });
    await waitFor(() => expect(result.current.speakerSegments[0]?.role).toBe('candidate'));
    expect(result.current.speakerSegments[0]?.roleSource).toBe('manual');
  });

  test('new interview reset clears the automatic voiceprint assignment map', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 3,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.96,
            evidenceVersion: 2,
            updatedAtMs: 1000,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: []
      });
      result.current.resetSpeakerSegments();
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '新面试尚未分类。',
        isFinal: true,
        speakerId: 3,
        speaker: 'unknown'
      });
    });
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    expect(result.current.speakerSegments[0]?.role).toBe('unknown');
  });

  test('semantic repartition restores every raw final timestamp after a provisional bubble splits', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '准备好了吗？',
        isFinal: true,
        speakerId: 0,
        speaker: 'unknown'
      });
    });
    now.mockReturnValue(2_000);
    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '嗯，准备好了。',
        isFinal: true,
        speakerId: 0,
        speaker: 'unknown'
      });
    });

    // The provisional acoustic view coalesces consecutive finals with one raw
    // speaker id, but the semantic pass may later split them into distinct roles.
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    now.mockReturnValue(10_000);
    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        segments: [
          {
            seq: 0,
            speakerId: 0,
            role: 'interviewer',
            roleSource: 'semantic-turn',
            text: '准备好了吗？'
          },
          {
            seq: 1,
            speakerId: 0,
            role: 'candidate',
            roleSource: 'semantic-turn',
            text: '嗯，准备好了。'
          }
        ]
      });
    });

    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(2));
    expect(result.current.speakerSegments.map((segment) => segment.createdAtMs)).toEqual([
      1_000,
      2_000
    ]);
  });

  test('preserves provider-relative start times across a later speaker partition', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => MockWebSocket.last().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'transcript',
        source: 'mic',
        text: '候选人回答。',
        isFinal: true,
        speakerId: 4,
        speaker: 'unknown',
        startTimeMs: 12_340
      });
    });
    await waitFor(() => expect(result.current.speakerSegments).toHaveLength(1));
    expect(result.current.speakerSegments[0]?.audioStartMs).toBe(12_340);

    act(() => {
      socket.emit({
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          {
            speakerId: 4,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.95,
            evidenceVersion: 2,
            updatedAtMs: 12_500,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          {
            seq: 0,
            speakerId: 4,
            role: 'candidate',
            roleSource: 'cohort',
            text: '候选人回答。'
          }
        ]
      });
    });

    await waitFor(() => expect(result.current.speakerSegments[0]?.role).toBe('candidate'));
    expect(result.current.speakerSegments[0]?.audioStartMs).toBe(12_340);
  });

  test('surfaces server error messages', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    act(() => {
      MockWebSocket.last().emit({ type: 'error', message: 'model unavailable' });
    });
    await waitFor(() => expect(result.current.error).toBe('model unavailable'));
  });

  test('resetTranscripts abandons a pending manual result so it cannot reappear after clear/new interview', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.analyze('I owned the queue migration.');
    });
    expect(result.current.isAnalyzing).toBe(true);

    act(() => {
      result.current.resetTranscripts();
    });
    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.lastResult).toBeNull();

    act(() => {
      socket.emit({
        type: 'result',
        requestId,
        mode: 'expert',
        trigger: 'manual',
        output: {
          primary_question: 'Stale manual question?',
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
      });
    });

    expect(result.current.lastResult).toBeNull();
  });

  test('resetTranscripts abandons an adopted auto request so late progress/result stay hidden', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    act(() => {
      socket.emit({
        type: 'progress',
        requestId: 'auto-1',
        phase: 'rank',
        index: 0,
        total: 2,
        status: 'start'
      });
    });
    await waitFor(() => expect(result.current.isAnalyzing).toBe(true));

    act(() => {
      result.current.resetTranscripts();
    });
    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.progress).toBeNull();

    act(() => {
      socket.emit({
        type: 'progress',
        requestId: 'auto-1',
        phase: 'rank',
        index: 1,
        total: 2,
        status: 'done'
      });
      socket.emit({
        type: 'result',
        requestId: 'auto-1',
        mode: 'expert',
        trigger: 'auto',
        output: {
          primary_question: 'Stale auto question?',
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
      });
    });

    expect(result.current.progress).toBeNull();
    expect(result.current.lastResult).toBeNull();
  });

  // ── Interview summary state machine ───────────────────────────────────────

  test('startSummary on a locally empty interview returns an empty notice without sending summarize', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });
    expect(requestId).toBeNull();
    expect(result.current.summary.status).toBe('done');
    expect(result.current.summary.empty).toBe(true);
    expect(result.current.summary.text).toMatch(/还没有可总结的面试内容|There is no interview content/i);
    expect(MockWebSocket.last().sent).toHaveLength(0);
    expect(result.current.summary.debugEvents.map((e) => e.stage)).toEqual([
      'client:start',
      'client:empty-local'
    ]);
  });

  test('startSummary sends a summarize frame and flips status to loading when transcript exists', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    act(() => {
      MockWebSocket.last().emit({ type: 'transcript', source: 'display', text: '候选人回答', isFinal: true });
    });

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });
    expect(requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.summary.status).toBe('loading');
    expect(result.current.summary.empty).toBe(false);

    const frame = JSON.parse(MockWebSocket.last().sent.at(-1) as string);
    expect(frame).toEqual({ type: 'summarize', requestId });
    expect(result.current.summary.debugEvents.map((e) => e.stage)).toEqual([
      'client:start',
      'client:sent',
      'client:timeout-armed'
    ]);
  });

  test('startSummary accepts a client transcript for seeded template interviews', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary(
        'Interviewer: Tell me about a distributed-systems project.\n\nCandidate: I led a Raft scheduler migration.'
      );
    });

    expect(requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.summary.status).toBe('loading');
    expect(result.current.summary.empty).toBe(false);

    const frame = JSON.parse(MockWebSocket.last().sent.at(-1) as string);
    expect(frame).toEqual({
      type: 'summarize',
      requestId,
      transcript: 'Interviewer: Tell me about a distributed-systems project.\n\nCandidate: I led a Raft scheduler migration.'
    });
  });

  test('summary-debug frames are appended to the active request timeline and stale ones are ignored', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });

    act(() => {
      socket.emit({
        type: 'summary-debug',
        requestId,
        event: {
          at: 111,
          source: 'server',
          stage: 'input-built',
          inputChars: 2048
        }
      });
      socket.emit({
        type: 'summary-debug',
        requestId: 'old-request',
        event: {
          at: 112,
          source: 'server',
          stage: 'should-ignore'
        }
      });
    });

    expect(result.current.summary.debugEvents.map((e) => e.stage)).toContain('input-built');
    expect(result.current.summary.debugEvents.map((e) => e.stage)).not.toContain('should-ignore');
    const inputBuilt = result.current.summary.debugEvents.find((e) => e.stage === 'input-built');
    expect(inputBuilt).toMatchObject({ source: 'server', inputChars: 2048 });
  });

  test('startSummary registers the active request before sending so immediate server debug is kept', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    const originalSend = socket.send.bind(socket);
    socket.send = (data: string): void => {
      originalSend(data);
      const frame = JSON.parse(data) as { requestId?: string };
      socket.emit({
        type: 'summary-debug',
        requestId: frame.requestId,
        event: {
          at: 123,
          source: 'server',
          stage: 'server:received'
        }
      });
    };

    act(() => {
      result.current.startSummary();
    });

    expect(result.current.summary.debugEvents.map((e) => e.stage)).toContain('server:received');
  });

  // #5 — the server is ONE-SHOT: the whole report rides on summary-done.text.
  test('#5 a one-shot summary-done with the full report transitions loading → done', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });
    expect(result.current.summary.status).toBe('loading');

    act(() => {
      socket.emit({ type: 'summary-done', requestId, text: '## 报告\n内容', model: 'deepseek-v4-pro' });
    });
    await waitFor(() => expect(result.current.summary.status).toBe('done'));
    expect(result.current.summary.text).toBe('## 报告\n内容');
    expect(result.current.summary.empty).toBe(false);
  });

  // #8 — an empty-transcript reply must be a distinct NOTICE, not a fake report.
  test('#8 summary-done with empty:true yields an empty notice state, not a report', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });

    act(() => {
      socket.emit({
        type: 'summary-done',
        requestId,
        text: '还没有可总结的面试内容。',
        empty: true
      });
    });
    await waitFor(() => expect(result.current.summary.status).toBe('done'));
    // The notice flag is set so the modal can render it distinctly.
    expect(result.current.summary.empty).toBe(true);
  });

  test('summary-error transitions loading → error with the message', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => {
      requestId = result.current.startSummary();
    });
    act(() => {
      socket.emit({ type: 'summary-error', requestId, message: 'no key' });
    });
    await waitFor(() => expect(result.current.summary.status).toBe('error'));
    expect(result.current.summary.error).toBe('no key');
  });

  test('a stale summary-done (superseded requestId) is ignored', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    act(() => {
      result.current.startSummary();
    });
    // A reply for a DIFFERENT (old) request must not move the state.
    act(() => {
      socket.emit({ type: 'summary-done', requestId: 'some-old-id', text: 'stale' });
    });
    expect(result.current.summary.status).toBe('loading');
    expect(result.current.summary.text).toBe('');
  });

  // #6 — a disconnect mid-summary must NOT leave the spinner stuck forever.
  test('#6 socket close while a summary is in flight transitions it to error (no infinite spinner)', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    act(() => {
      result.current.startSummary();
    });
    expect(result.current.summary.status).toBe('loading');

    // The socket drops before any summary-* reply arrives.
    act(() => {
      socket.close();
    });

    await waitFor(() => expect(result.current.summary.status).toBe('error'));
    expect(result.current.summary.status).not.toBe('loading');
    expect(result.current.summary.error).toBeTruthy();
  });

  test('#6 socket close when NO summary is in flight leaves summary idle', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

    expect(result.current.summary.status).toBe('idle');
    act(() => {
      socket.close();
    });
    // No spurious error when there was nothing in flight.
    expect(result.current.summary.status).toBe('idle');
  });

  test('summary request times out client-side instead of spinning forever', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    seedCandidateTranscript();

    vi.useFakeTimers();
    try {
      let requestId: string | null = null;
      act(() => {
        requestId = result.current.startSummary();
      });
      expect(requestId).toBeTruthy();
      expect(result.current.summary.status).toBe('loading');

      act(() => {
        vi.advanceTimersByTime(150000);
      });

      expect(result.current.summary.status).toBe('error');
      expect(result.current.summary.error).toMatch(/timed out|超时/i);
      expect(result.current.summary.debugEvents.at(-1)).toMatchObject({
        source: 'client',
        stage: 'client:timeout-fired'
      });

      act(() => {
        MockWebSocket.last().emit({
          type: 'summary-done',
          requestId,
          text: 'late report',
          model: 'deepseek-v4-pro'
        });
      });
      expect(result.current.summary.status).toBe('error');
      expect(result.current.summary.text).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  test('summary chunks clear the client timeout so long streams do not fail mid-report', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    vi.useFakeTimers();
    try {
      let requestId: string | null = null;
      act(() => {
        requestId = result.current.startSummary();
      });
      expect(result.current.summary.status).toBe('loading');

      act(() => {
        socket.emit({ type: 'summary-chunk', requestId, text: 'partial report' });
      });
      expect(result.current.summary.status).toBe('streaming');
      expect(result.current.summary.text).toBe('partial report');

      act(() => {
        vi.advanceTimersByTime(150000);
      });
      expect(result.current.summary.status).toBe('streaming');
      expect(result.current.summary.error).toBeNull();

      act(() => {
        socket.emit({ type: 'summary-done', requestId, model: 'deepseek-v4-pro' });
      });
      expect(result.current.summary.status).toBe('done');
      expect(result.current.summary.text).toBe('partial report');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Streaming (Feature 1) ────────────────────────────────────────────────

  test('summary-chunk transitions status to streaming and accumulates text', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => { MockWebSocket.last().open(); });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => { requestId = result.current.startSummary(); });
    expect(result.current.summary.status).toBe('loading');

    act(() => {
      socket.emit({ type: 'summary-chunk', requestId, text: '## 候选人' });
    });
    await waitFor(() => expect(result.current.summary.status).toBe('streaming'));
    expect(result.current.summary.text).toBe('## 候选人');

    act(() => {
      socket.emit({ type: 'summary-chunk', requestId, text: '概况\n不错。' });
    });
    await waitFor(() => expect(result.current.summary.text).toBe('## 候选人概况\n不错。'));
  });

  test('summary-chunk then summary-done (no text): uses accumulated text, status done', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => { MockWebSocket.last().open(); });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => { requestId = result.current.startSummary(); });

    act(() => {
      socket.emit({ type: 'summary-chunk', requestId, text: 'chunk1' });
      socket.emit({ type: 'summary-chunk', requestId, text: 'chunk2' });
    });
    await waitFor(() => expect(result.current.summary.text).toBe('chunk1chunk2'));

    act(() => {
      // summary-done without text (streaming path): client already has accumulated text
      socket.emit({ type: 'summary-done', requestId, model: 'deepseek-v4-pro' });
    });
    await waitFor(() => expect(result.current.summary.status).toBe('done'));
    // Accumulated text from chunks is preserved
    expect(result.current.summary.text).toBe('chunk1chunk2');
    expect(result.current.summary.empty).toBe(false);
  });

  test('summary websocket frames delivered as Blob are parsed instead of silently dropped', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => { MockWebSocket.last().open(); });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    let requestId: string | null = null;
    act(() => { requestId = result.current.startSummary(); });

    act(() => {
      socket.onmessage?.call(
        socket as unknown as WebSocket,
        new MessageEvent('message', {
          data: new Blob([
            JSON.stringify({ type: 'summary-chunk', requestId, text: '## 报告' })
          ])
        })
      );
    });

    await waitFor(() => expect(result.current.summary.status).toBe('streaming'));
    expect(result.current.summary.text).toBe('## 报告');
  });

  test('stale summary-chunk (old requestId) is ignored', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => { MockWebSocket.last().open(); });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();
    seedCandidateTranscript();

    act(() => { result.current.startSummary(); });

    // Emit a chunk for a different request id
    act(() => {
      socket.emit({ type: 'summary-chunk', requestId: 'stale-id', text: 'stale text' });
    });
    // Status must remain 'loading', not transition to 'streaming' with stale text
    expect(result.current.summary.status).toBe('loading');
    expect(result.current.summary.text).toBe('');
  });

  test('startSummary records startedAt and resets tokens to 0', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => { MockWebSocket.last().open(); });
    await waitFor(() => expect(result.current.status).toBe('open'));
    seedCandidateTranscript();

    const before = Date.now();
    act(() => { result.current.startSummary(); });
    const after = Date.now();

    expect(result.current.summary.startedAt).toBeGreaterThanOrEqual(before);
    expect(result.current.summary.startedAt).toBeLessThanOrEqual(after);
    expect(result.current.summary.tokens).toBe(0);
  });
});

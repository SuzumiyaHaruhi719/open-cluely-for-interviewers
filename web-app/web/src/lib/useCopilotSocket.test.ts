import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCopilotSocket } from './useCopilotSocket';
import { installMockWebSocket, MockWebSocket } from '../test/mockWebSocket';

describe('useCopilotSocket', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installMockWebSocket();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

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

  test('progressTokens accumulates per-phase token payloads and resets on a new analyze', async () => {
    const { result } = renderHook(() => useCopilotSocket());
    act(() => {
      MockWebSocket.last().open();
    });
    await waitFor(() => expect(result.current.status).toBe('open'));
    const socket = MockWebSocket.last();

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

    // OFFLINE FunASR: a final carrying a numeric speakerId appends exactly one
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
});

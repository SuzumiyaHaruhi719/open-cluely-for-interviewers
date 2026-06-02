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
});

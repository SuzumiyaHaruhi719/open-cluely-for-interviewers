import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessions } from './useSessions';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FetchCall[];
let sessionList: Array<{ id: string; title: string; updatedAt: number; createdAt: number; messageCount: number }>;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  calls = [];
  sessionList = [
    { id: 's1', title: 'First', updatedAt: 2, createdAt: 1, messageCount: 4 },
    { id: 's2', title: 'Second', updatedAt: 4, createdAt: 3, messageCount: 0 }
  ];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.endsWith('/api/sessions') && method === 'POST') {
      return Promise.resolve(jsonResponse({ session: { id: 'new', title: body?.title ?? '' } }));
    }
    if (url.endsWith('/api/sessions')) {
      return Promise.resolve(jsonResponse({ sessions: sessionList }));
    }
    if (url.includes('/api/sessions/') && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          session: {
            id: 's1',
            title: 'First',
            jobDescription: 'JD',
            resumeText: 'R',
            messages: [{ role: 'candidate', text: 'answer', ts: 1 }],
            createdAt: 1,
            updatedAt: 2
          }
        })
      );
    }
    if (url.includes('/api/sessions/') && method === 'DELETE') {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (url.includes('/api/sessions/') && method === 'PATCH') {
      return Promise.resolve(jsonResponse({ session: { id: 's1' } }));
    }
    if (url.includes('/messages')) {
      return Promise.resolve(jsonResponse({ ok: true, messageCount: 5 }));
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useSessions', () => {
  test('loads the session list on mount', async () => {
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.sessions[0].title).toBe('First');
  });

  test('create posts the body, refreshes, and selects the new id (persisted)', async () => {
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.create({ title: 'Backend', interviewType: 'offline' });
    });

    expect(newId).toBe('new');
    const post = calls.find((c) => c.url.endsWith('/api/sessions') && c.method === 'POST');
    expect(post?.body).toMatchObject({ title: 'Backend', interviewType: 'offline' });
    expect(result.current.activeId).toBe('new');
    expect(localStorage.getItem('open-cluely.activeSessionId')).toBe('new');
  });

  test('load returns the full session detail', async () => {
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detail: Awaited<ReturnType<typeof result.current.load>> = null;
    await act(async () => {
      detail = await result.current.load('s1');
    });

    expect(detail).not.toBeNull();
    expect(detail!.jobDescription).toBe('JD');
    expect(detail!.messages).toHaveLength(1);
  });

  test('remove clears the active id when it was the deleted one', async () => {
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.select('s1'));
    expect(result.current.activeId).toBe('s1');

    await act(async () => {
      await result.current.remove('s1');
    });

    expect(calls.some((c) => c.url.endsWith('/api/sessions/s1') && c.method === 'DELETE')).toBe(true);
    expect(result.current.activeId).toBeNull();
  });

  test('appendMessage posts to the session messages endpoint', async () => {
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.appendMessage('s1', 'candidate', 'hello');
    });

    const post = calls.find((c) => c.url.includes('/messages'));
    expect(post).toMatchObject({ method: 'POST', body: { role: 'candidate', text: 'hello' } });
  });
});

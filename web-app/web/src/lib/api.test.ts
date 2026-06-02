import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ApiError,
  appendSessionMessage,
  assistantAsk,
  assistantInsights,
  assistantNotes,
  createSession,
  deleteSession,
  extractResume,
  fetchSession,
  fetchSessions,
  resumeChat,
  updateSession
} from './api';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FetchCall[];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubFetch(impl: (call: FetchCall) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const call: FetchCall = {
        url: typeof input === 'string' ? input : input.toString(),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      };
      calls.push(call);
      return Promise.resolve(impl(call));
    })
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session api wrappers', () => {
  test('fetchSessions GETs /api/sessions and returns the list', async () => {
    stubFetch(() => jsonResponse({ sessions: [{ id: 'a', title: 'A' }] }));

    const res = await fetchSessions();

    expect(calls[0]).toMatchObject({ url: '/api/sessions', method: 'GET' });
    expect(res.sessions).toHaveLength(1);
  });

  test('createSession POSTs the title + interviewType body', async () => {
    stubFetch((call) => jsonResponse({ session: { id: 'x', title: call.body && (call.body as { title: string }).title } }));

    const res = await createSession({ title: 'Backend', interviewType: 'online' });

    expect(calls[0]).toMatchObject({
      url: '/api/sessions',
      method: 'POST',
      body: { title: 'Backend', interviewType: 'online' }
    });
    expect(res.session.id).toBe('x');
  });

  test('fetchSession encodes the id in the path', async () => {
    stubFetch(() => jsonResponse({ session: { id: 'a b', messages: [] } }));

    await fetchSession('a b');

    expect(calls[0].url).toBe('/api/sessions/a%20b');
  });

  test('updateSession PATCHes a JD/résumé patch', async () => {
    stubFetch(() => jsonResponse({ session: { id: 'a' } }));

    await updateSession('a', { jobDescription: 'JD', resumeText: 'R' });

    expect(calls[0]).toMatchObject({
      url: '/api/sessions/a',
      method: 'PATCH',
      body: { jobDescription: 'JD', resumeText: 'R' }
    });
  });

  test('deleteSession DELETEs and appendSessionMessage POSTs to /messages', async () => {
    stubFetch((call) =>
      call.method === 'DELETE'
        ? jsonResponse({ ok: true })
        : jsonResponse({ ok: true, messageCount: 3 })
    );

    await deleteSession('a');
    const appended = await appendSessionMessage('a', { role: 'candidate', text: 'hi' });

    expect(calls[0]).toMatchObject({ url: '/api/sessions/a', method: 'DELETE' });
    expect(calls[1]).toMatchObject({
      url: '/api/sessions/a/messages',
      method: 'POST',
      body: { role: 'candidate', text: 'hi' }
    });
    expect(appended.messageCount).toBe(3);
  });

  test('throws ApiError on a non-2xx response', async () => {
    stubFetch(() => jsonResponse({}, false, 500));

    await expect(fetchSessions()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('resume + assistant api wrappers', () => {
  test('extractResume POSTs filename + base64 and returns text', async () => {
    stubFetch(() => jsonResponse({ text: 'Resume text' }));

    const res = await extractResume({ filename: 'cv.pdf', contentBase64: 'QUJD' });

    expect(calls[0]).toMatchObject({
      url: '/api/resume/extract',
      method: 'POST',
      body: { filename: 'cv.pdf', contentBase64: 'QUJD' }
    });
    expect(res.text).toBe('Resume text');
  });

  test('resumeChat POSTs résumé + messages and returns the reply', async () => {
    stubFetch(() => jsonResponse({ reply: 'Strong on distributed systems.' }));

    const res = await resumeChat({
      resumeText: 'R',
      messages: [{ role: 'user', content: 'Summarise' }]
    });

    expect(calls[0]).toMatchObject({
      url: '/api/resume/chat',
      method: 'POST',
      body: { resumeText: 'R', messages: [{ role: 'user', content: 'Summarise' }] }
    });
    expect(res.reply).toContain('distributed');
  });

  test('assistant endpoints map to the right URLs', async () => {
    stubFetch(() => jsonResponse({ reply: 'ok' }));

    await assistantAsk({ prompt: 'p', context: 'c' });
    await assistantNotes({ transcript: 't' });
    await assistantInsights({ transcript: 't' });

    expect(calls[0]).toMatchObject({ url: '/api/assistant/ask', body: { prompt: 'p', context: 'c' } });
    expect(calls[1]).toMatchObject({ url: '/api/assistant/notes', body: { transcript: 't' } });
    expect(calls[2]).toMatchObject({ url: '/api/assistant/insights', body: { transcript: 't' } });
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { extractResume, resumeChat } from './api';

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

describe('resume api wrappers', () => {
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

});

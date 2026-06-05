import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  assistantAsk,
  assistantInsights,
  assistantNotes,
  extractResume,
  generatePipeline,
  getPipeline,
  listPipelines,
  resumeChat,
  savePipeline,
  type Pipeline
} from './api';

const FAKE_PIPELINE: Pipeline = {
  id: 'gen-1',
  name: 'Senior Backend',
  builtin: false,
  nodes: [],
  edges: []
};

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

describe('pipeline api wrappers', () => {
  test('listPipelines GETs /api/pipelines and returns the summaries', async () => {
    stubFetch(() =>
      jsonResponse({ pipelines: [{ id: 'builtin-role-be', name: 'Backend', builtin: true }] })
    );

    const res = await listPipelines();

    expect(calls[0]).toMatchObject({ url: '/api/pipelines', method: 'GET' });
    expect(res.pipelines[0]).toMatchObject({ id: 'builtin-role-be', builtin: true });
  });

  test('getPipeline encodes the id in the path', async () => {
    stubFetch(() => jsonResponse({ pipeline: FAKE_PIPELINE }));

    await getPipeline('builtin role be');

    expect(calls[0]).toMatchObject({ url: '/api/pipelines/builtin%20role%20be', method: 'GET' });
  });

  test('generatePipeline POSTs the prompt and returns the authored pipeline', async () => {
    stubFetch(() => jsonResponse({ pipeline: FAKE_PIPELINE }));

    const res = await generatePipeline('a senior backend who can run incidents');

    expect(calls[0]).toMatchObject({
      url: '/api/pipelines/generate',
      method: 'POST',
      body: { prompt: 'a senior backend who can run incidents' }
    });
    expect(res.pipeline.name).toBe('Senior Backend');
  });

  test('savePipeline POSTs the pipeline wrapped in { pipeline } and returns its id', async () => {
    stubFetch(() => jsonResponse({ id: 'saved-1' }));

    const res = await savePipeline(FAKE_PIPELINE);

    expect(calls[0]).toMatchObject({
      url: '/api/pipelines',
      method: 'POST',
      body: { pipeline: FAKE_PIPELINE }
    });
    expect(res.id).toBe('saved-1');
  });
});

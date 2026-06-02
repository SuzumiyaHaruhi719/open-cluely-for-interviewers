import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

// config.ts reads DASHSCOPE_API_KEY once at module load and freezes it, so the
// key must be present BEFORE the app (and its transitive config import) loads.
// Node's test runner isolates each test file in its own process, so this only
// affects this file. `require` (not `import`) runs after the assignment above.
process.env.DASHSCOPE_API_KEY = 'test-key-generate';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/app') as typeof import('../src/app');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EXPERT_PRESET, validatePipeline, BLOCK_TYPES } =
  require('@open-cluely/copilot-core') as typeof import('@open-cluely/copilot-core');

const DASHSCOPE_MARKER = 'apps/anthropic';

interface CapturedCall {
  url: string;
  body: { system?: string; messages: { role: string; content: string }[] };
}

const realFetch = globalThis.fetch;
let captured: CapturedCall[] = [];

/**
 * Intercept DashScope calls and return a canned Anthropic-shape reply. The reply
 * text is whatever the current test queued. The test's own fetch to the local
 * Express server passes through to real fetch.
 */
function installFetchStub(replyText: string): void {
  captured = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(DASHSCOPE_MARKER)) {
      captured.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: replyText }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

interface GeneratedPipeline {
  id: string;
  name: string;
  version: string;
  nodes: Array<{ id: string; type: string; promptBody?: string }>;
  edges: unknown[];
  builtin?: boolean;
  focus?: string;
  description?: string;
}

test('POST /api/pipelines/generate tunes the Expert preset from valid hints', async () => {
  const reply = JSON.stringify({
    name: '资深后端面试',
    focus: '系统设计权衡与线上事故的个人担当',
    blockPromptHints: {
      D: 'Aim every question at backend system-design tradeoffs the candidate personally owned.'
    }
  });
  installFetchStub(reply);
  try {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/pipelines/generate`,
        post({ prompt: '招一个能扛事的资深后端工程师' })
      );
      assert.equal(res.status, 200);
      const { pipeline } = (await res.json()) as { pipeline: GeneratedPipeline };

      // Exactly one DashScope tuning call was made, Anthropic-shape with a system prompt.
      assert.equal(captured.length, 1);
      assert.ok(captured[0].url.endsWith('/v1/messages'), `unexpected url ${captured[0].url}`);
      assert.ok((captured[0].body.system ?? '').length > 0, 'system prompt attached');
      assert.equal(captured[0].body.messages.at(-1)?.content, '招一个能扛事的资深后端工程师');

      // The returned pipeline is VALID against the same registry the engine uses.
      const v = validatePipeline(pipeline, BLOCK_TYPES);
      assert.ok(v.ok, `expected a valid pipeline; got errors ${JSON.stringify(v.errors)}`);

      // It carries the model's name and a fresh, non-builtin id distinct from the preset.
      assert.equal(pipeline.name, '资深后端面试');
      assert.equal(pipeline.builtin, false);
      assert.notEqual(pipeline.id, EXPERT_PRESET.id);
      assert.ok(pipeline.id.length > 0);
      assert.equal(typeof pipeline.version, 'string');

      // The structure is unchanged (same node ids as the Expert preset).
      const expertIds = (EXPERT_PRESET.nodes as Array<{ id: string }>).map((n) => n.id).sort();
      const gotIds = pipeline.nodes.map((n) => n.id).sort();
      assert.deepEqual(gotIds, expertIds, 'node set preserved');

      // The hinted block (D) had the hint APPENDED to its promptBody.
      const blockD = pipeline.nodes.find((n) => n.id === 'D');
      assert.ok(blockD, 'block D present');
      assert.ok(
        (blockD?.promptBody ?? '').includes(
          'Aim every question at backend system-design tradeoffs the candidate personally owned.'
        ),
        'hint appended to D.promptBody'
      );
      // Appended, not replaced: the default body is long; the hint is additive.
      assert.ok((blockD?.promptBody ?? '').length > 100, 'base body preserved under the hint');

      // A non-hinted block keeps no per-node promptBody override.
      const blockA = pipeline.nodes.find((n) => n.id === 'A');
      assert.equal(blockA?.promptBody, undefined, 'unhinted block left as-is');
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/pipelines/generate falls back to a valid Expert clone on garbage output', async () => {
  installFetchStub('I am not JSON at all — just chatty prose. 🙃');
  try {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/pipelines/generate`,
        post({ prompt: 'Hire a pragmatic data scientist who can own experiments' })
      );
      assert.equal(res.status, 200);
      const { pipeline } = (await res.json()) as { pipeline: GeneratedPipeline };

      // Still a VALID pipeline — the pristine Expert fallback.
      const v = validatePipeline(pipeline, BLOCK_TYPES);
      assert.ok(v.ok, `expected a valid fallback pipeline; got ${JSON.stringify(v.errors)}`);

      // Name derived from the prompt, prompt stored as focus/description.
      assert.ok(pipeline.name.length > 0, 'derived name present');
      assert.ok(
        pipeline.name.startsWith('Hire a pragmatic data scientist'),
        `name derived from prompt; got ${JSON.stringify(pipeline.name)}`
      );
      assert.equal(pipeline.focus, 'Hire a pragmatic data scientist who can own experiments');
      assert.equal(
        pipeline.description,
        'Hire a pragmatic data scientist who can own experiments'
      );

      // No block carries an appended hint (garbage produced no usable hints).
      const expertIds = (EXPERT_PRESET.nodes as Array<{ id: string }>).map((n) => n.id).sort();
      const gotIds = pipeline.nodes.map((n) => n.id).sort();
      assert.deepEqual(gotIds, expertIds, 'node set preserved');
      assert.equal(
        pipeline.nodes.every((n) => n.promptBody === undefined),
        true,
        'no per-node prompt overrides in the fallback'
      );
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/pipelines/generate ignores unknown/partial hints but stays valid', async () => {
  // Unknown block id + a non-string hint + a real hint on B — only B is applied.
  const reply = JSON.stringify({
    blockPromptHints: {
      ZZZ: 'this block does not exist',
      D: { not: 'a string' },
      B: 'Weight gaps toward incident ownership.'
    }
  });
  installFetchStub(reply);
  try {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/pipelines/generate`,
        post({ prompt: 'Senior SRE who has carried real on-call' })
      );
      assert.equal(res.status, 200);
      const { pipeline } = (await res.json()) as { pipeline: GeneratedPipeline };

      const v = validatePipeline(pipeline, BLOCK_TYPES);
      assert.ok(v.ok, `expected a valid pipeline; got ${JSON.stringify(v.errors)}`);

      // No "ZZZ" node was introduced.
      assert.equal(pipeline.nodes.find((n) => n.id === 'ZZZ'), undefined, 'no phantom node');

      // B got its string hint; D's non-string hint was dropped (no override).
      const blockB = pipeline.nodes.find((n) => n.id === 'B');
      assert.ok(
        (blockB?.promptBody ?? '').includes('Weight gaps toward incident ownership.'),
        'string hint applied to B'
      );
      const blockD = pipeline.nodes.find((n) => n.id === 'D');
      assert.equal(blockD?.promptBody, undefined, 'non-string hint ignored for D');

      // Name falls back to one derived from the prompt (model gave none).
      assert.ok(pipeline.name.startsWith('Senior SRE'), `derived name; got ${pipeline.name}`);
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/pipelines/generate rejects an empty prompt with 400', async () => {
  installFetchStub('{}');
  try {
    await withServer(async (base) => {
      const empty = await fetch(`${base}/api/pipelines/generate`, post({ prompt: '   ' }));
      assert.equal(empty.status, 400);
      const missing = await fetch(`${base}/api/pipelines/generate`, post({}));
      assert.equal(missing.status, 400);
      // No DashScope call is made on a rejected body.
      assert.equal(captured.length, 0);
    });
  } finally {
    restoreFetch();
  }
});

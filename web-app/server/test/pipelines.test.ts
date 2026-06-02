import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { EXPERT_PRESET } from '@open-cluely/copilot-core';
import { createApp } from '../src/app';

// Pipelines persist under ${DATA_DIR}/pipelines; the route resolves DATA_DIR
// lazily, so a temp dir set before the first request isolates this test.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-pipelines-'));
process.env.DATA_DIR = TMP_DATA_DIR;

interface PipelineSummary {
  id: string;
  name: string;
  builtin: boolean;
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

test('pipelines: lists built-ins, saves + reads + deletes a custom, guards built-ins', async () => {
  await withServer(async (base) => {
    // --- list includes the two expert built-ins -------------------------
    const listRes = await fetch(`${base}/api/pipelines`);
    assert.equal(listRes.status, 200);
    const { pipelines } = (await listRes.json()) as { pipelines: PipelineSummary[] };
    const byId = new Map(pipelines.map((p) => [p.id, p]));
    assert.ok(byId.get('builtin-expert')?.builtin === true, 'expert preset present + builtin');
    assert.ok(byId.get('builtin-expert-fast')?.builtin === true, 'expert-fast preset present + builtin');
    for (const p of pipelines) {
      assert.equal(typeof p.id, 'string');
      assert.equal(typeof p.name, 'string');
      assert.equal(typeof p.builtin, 'boolean');
    }

    // --- get a built-in by id -------------------------------------------
    const getBuiltin = await fetch(`${base}/api/pipelines/builtin-expert`);
    assert.equal(getBuiltin.status, 200);
    const { pipeline } = (await getBuiltin.json()) as { pipeline: { id: string } };
    assert.equal(pipeline.id, 'builtin-expert');

    // --- get a missing pipeline -> 404 ----------------------------------
    const missing = await fetch(`${base}/api/pipelines/does-not-exist`);
    assert.equal(missing.status, 404);

    // --- save a valid custom (clone of the expert preset w/ a new id) ----
    const custom = { ...EXPERT_PRESET, id: 'custom-test-1', name: 'Custom Test 1', builtin: false };
    const create = await fetch(`${base}/api/pipelines`, post({ pipeline: custom }));
    assert.equal(create.status, 200);
    const createBody = (await create.json()) as { id: string };
    assert.equal(createBody.id, 'custom-test-1');

    // custom now appears in the list as non-builtin
    const list2 = await fetch(`${base}/api/pipelines`);
    const { pipelines: pipelines2 } = (await list2.json()) as { pipelines: PipelineSummary[] };
    const saved = pipelines2.find((p) => p.id === 'custom-test-1');
    assert.ok(saved, 'custom pipeline listed');
    assert.equal(saved?.builtin, false);

    // --- saving over a built-in id -> 400 --------------------------------
    const overwrite = await fetch(
      `${base}/api/pipelines`,
      post({ pipeline: { ...EXPERT_PRESET, id: 'builtin-expert' } })
    );
    assert.equal(overwrite.status, 400);

    // --- deleting a built-in -> 400 --------------------------------------
    const delBuiltin = await fetch(`${base}/api/pipelines/builtin-expert`, { method: 'DELETE' });
    assert.equal(delBuiltin.status, 400);

    // --- deleting the custom -> ok ---------------------------------------
    const delCustom = await fetch(`${base}/api/pipelines/custom-test-1`, { method: 'DELETE' });
    assert.equal(delCustom.status, 200);
    assert.deepEqual(await delCustom.json(), { ok: true });

    const list3 = await fetch(`${base}/api/pipelines`);
    const { pipelines: pipelines3 } = (await list3.json()) as { pipelines: PipelineSummary[] };
    assert.equal(pipelines3.find((p) => p.id === 'custom-test-1'), undefined, 'custom removed');
  });
});

interface BlockTypeMeta {
  id: string;
  label: string;
  schemaId: string | null;
  inputs: { name: string; type: string; optional: boolean }[];
  outputType: string;
  defaultBody: string;
  defaults: { model: string; temperature: number; maxTokens: number };
}

test('pipelines: GET /block-types returns the editor catalog (not shadowed by :id)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pipelines/block-types`);
    assert.equal(res.status, 200);
    const { blockTypes } = (await res.json()) as { blockTypes: BlockTypeMeta[] };
    assert.ok(Array.isArray(blockTypes), 'blockTypes is an array');
    assert.ok(blockTypes.length >= 7, 'expected the 7 Expert blocks + generic llm');

    const byId = new Map(blockTypes.map((b) => [b.id, b]));
    // The terminal "final-render" block produces the `final` output the validator
    // requires exactly one of.
    const finalRender = byId.get('final-render');
    assert.ok(finalRender, 'final-render block present');
    assert.equal(finalRender?.outputType, 'final');

    // anatomy is a source (no inputs) and carries serializable defaults + body.
    const anatomy = byId.get('anatomy');
    assert.ok(anatomy, 'anatomy block present');
    assert.equal(anatomy?.inputs.length, 0);
    assert.equal(typeof anatomy?.defaults.model, 'string');
    assert.equal(typeof anatomy?.defaultBody, 'string');

    // A block with a typed input port (question-pool consumes claims/gaps/state).
    const pool = byId.get('question-pool');
    assert.ok(pool, 'question-pool present');
    assert.ok(
      pool?.inputs.some((p) => p.type === 'claims'),
      'question-pool declares a claims input'
    );
  });
});

test('pipelines: POST /validate accepts the Expert preset and rejects a broken graph', async () => {
  await withServer(async (base) => {
    // The Expert preset is a valid DAG with exactly one final producer.
    const okRes = await fetch(`${base}/api/pipelines/validate`, post({ pipeline: EXPERT_PRESET }));
    assert.equal(okRes.status, 200);
    const okBody = (await okRes.json()) as { ok: boolean; errors: string[] };
    assert.equal(okBody.ok, true);
    assert.deepEqual(okBody.errors, []);

    // A single anatomy node has no `final` producer + an unknown-type check path.
    const broken = {
      id: 'broken-1',
      name: 'Broken',
      version: 'custom_v1',
      nodes: [{ id: 'n1', type: 'anatomy' }],
      edges: []
    };
    const badRes = await fetch(`${base}/api/pipelines/validate`, post({ pipeline: broken }));
    assert.equal(badRes.status, 200, 'validate always 200; ok flag carries the verdict');
    const badBody = (await badRes.json()) as { ok: boolean; errors: string[] };
    assert.equal(badBody.ok, false);
    assert.ok(badBody.errors.length >= 1, 'reports at least one error');
    assert.ok(
      badBody.errors.some((e) => e.includes('final')),
      `expected a missing-final error; got ${JSON.stringify(badBody.errors)}`
    );

    // A malformed body (no pipeline) is a 400.
    const malformed = await fetch(`${base}/api/pipelines/validate`, post({}));
    assert.equal(malformed.status, 400);
  });
});

test.after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { validatePipeline } = require('../src/services/ai/pipeline/pipeline-schema');
const { BLOCK_TYPES } = require('../src/services/ai/pipeline/block-types');
const { EXPERT_PRESET } = require('../src/services/ai/pipeline/presets');
const lib = require('../src/services/ai/pipeline/preset-library');

const hasErr = (errs, sub) => errs.some((e) => e.includes(sub));

test('EXPERT_PRESET is valid', () => {
  const v = validatePipeline(EXPERT_PRESET, BLOCK_TYPES);
  assert.ok(v.ok, `expected valid, got: ${v.errors.join('; ')}`);
  assert.strictEqual(v.terminalId, 'G');
});

test('rejects unknown node type', () => {
  const v = validatePipeline({ nodes: [{ id: 'x', type: 'bogus' }], edges: [] }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'unknown type'));
});

test('rejects duplicate node id', () => {
  const v = validatePipeline({ nodes: [{ id: 'A', type: 'anatomy' }, { id: 'A', type: 'state-update' }], edges: [] }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'duplicate node id'));
});

test('rejects type-mismatched edge (claims → candidates port)', () => {
  const v = validatePipeline({
    nodes: [{ id: 'A', type: 'anatomy' }, { id: 'E', type: 'rank-score' }],
    edges: [{ fromNode: 'A', fromPort: 'out', toNode: 'E', toPort: 'candidates' }]
  }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'cannot connect'), v.errors.join('; '));
});

test('rejects missing required input', () => {
  const v = validatePipeline({ nodes: [{ id: 'G', type: 'final-render' }], edges: [] }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'required input "ranking"'), v.errors.join('; '));
});

test('rejects no final producer', () => {
  const v = validatePipeline({ nodes: [{ id: 'A', type: 'anatomy' }], edges: [] }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'no node producing a "final"'));
});

test('detects a cycle', () => {
  const v = validatePipeline({
    nodes: [{ id: 'L1', type: 'llm' }, { id: 'L2', type: 'llm' }],
    edges: [{ fromNode: 'L1', fromPort: 'out', toNode: 'L2', toPort: 'in' }, { fromNode: 'L2', fromPort: 'out', toNode: 'L1', toPort: 'in' }]
  }, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, 'cycle'));
});

test('rejects >1 final producer', () => {
  const p = JSON.parse(JSON.stringify(EXPERT_PRESET));
  p.nodes.push({ id: 'G2', type: 'final-render' });
  const v = validatePipeline(p, BLOCK_TYPES);
  assert.ok(hasErr(v.errors, '"final" producers'), v.errors.join('; '));
});

// ── preset-library (filesystem) ─────────────────────────────────────────────
test('preset-library: builtins protected; user CRUD roundtrips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plib-'));
  // built-in is listed + gettable, but cannot be overwritten or deleted.
  assert.ok(lib.listPipelines(dir).some((p) => p.id === EXPERT_PRESET.id && p.builtin));
  assert.ok(lib.getPipeline('expert', dir));
  assert.throws(() => lib.savePipeline({ ...EXPERT_PRESET }, dir), /built-in/);
  assert.throws(() => lib.deletePipeline(EXPERT_PRESET.id, dir), /built-in/);

  // save a valid user pipeline (Expert clone), get it back, then delete.
  const user = { ...JSON.parse(JSON.stringify(EXPERT_PRESET)), id: 'u1', name: 'U1', builtin: false };
  assert.strictEqual(lib.savePipeline(user, dir), 'u1');
  assert.ok(lib.getPipeline('u1', dir));
  assert.ok(lib.listPipelines(dir).some((p) => p.id === 'u1' && !p.builtin));
  assert.strictEqual(lib.deletePipeline('u1', dir), true);
  assert.strictEqual(lib.getPipeline('u1', dir), null);

  // invalid pipeline is rejected on save.
  assert.throws(() => lib.savePipeline({ id: 'bad', name: 'bad', nodes: [{ id: 'x', type: 'bogus' }], edges: [] }, dir), /invalid pipeline/);

  fs.rmSync(dir, { recursive: true, force: true });
});

import { describe, expect, test } from 'vitest';
import type { BlockTypeMeta, Pipeline } from '../../lib/api';
import {
  addNode,
  buildForSave,
  cloneAsNew,
  connect,
  indexTypes,
  moveNode,
  nextNodeId,
  removeEdge,
  removeNode,
  slug,
  updateNode
} from './studioState';

// Minimal block-type catalog: a `claims` source, a consumer with a typed input,
// and a terminal `final` producer — enough to exercise type-checked connects.
const TYPES: BlockTypeMeta[] = [
  {
    id: 'anatomy',
    label: '拆解回答',
    schemaId: 'A',
    inputs: [],
    outputType: 'claims',
    defaultBody: 'A body',
    defaults: { model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0.1, maxTokens: 1200 }
  },
  {
    id: 'evidence-gap',
    label: '查找证据缺口',
    schemaId: 'B',
    inputs: [{ name: 'claims', type: 'claims', optional: false }],
    outputType: 'gaps',
    defaultBody: 'B body',
    defaults: { model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0.2, maxTokens: 1200 }
  },
  {
    id: 'final-render',
    label: '整理成稿',
    schemaId: 'G',
    inputs: [{ name: 'gaps', type: 'gaps', optional: false }],
    outputType: 'final',
    defaultBody: 'G body',
    defaults: { model: 'deepseek-v4-pro', thinking: { type: 'enabled', budget_tokens: 512 }, temperature: 0.3, maxTokens: 1600 }
  }
];

const types = indexTypes(TYPES);

function emptyPipeline(): Pipeline {
  return { id: '', name: 'My pipeline', nodes: [], edges: [] };
}

describe('studioState — pure graph ops', () => {
  test('indexTypes keys by id', () => {
    expect(Object.keys(types).sort()).toEqual(['anatomy', 'evidence-gap', 'final-render']);
  });

  test('slug normalises a name and falls back when empty', () => {
    expect(slug('My Backend Pipeline!')).toBe('my-backend-pipeline');
    expect(slug('  ')).toMatch(/^pipeline-/);
  });

  test('nextNodeId avoids collisions with existing ids', () => {
    const p: Pipeline = { ...emptyPipeline(), nodes: [{ id: 'anatomy-1', type: 'anatomy' }] };
    const first = nextNodeId(p, 'anatomy', 1);
    expect(first.id).toBe('anatomy-2');
    expect(first.seq).toBe(2);
  });

  test('addNode appends an immutable copy; unknown type is a no-op', () => {
    const p0 = emptyPipeline();
    const p1 = addNode(p0, types, 'anatomy', 'anatomy-1', { x: 10, y: 20 });
    expect(p1).not.toBe(p0);
    expect(p0.nodes).toHaveLength(0); // original untouched
    expect(p1.nodes).toEqual([{ id: 'anatomy-1', type: 'anatomy', pos: { x: 10, y: 20 } }]);

    const p2 = addNode(p1, types, 'nope', 'nope-1', { x: 0, y: 0 });
    expect(p2).toBe(p1); // same reference — rejected
  });

  test('connect joins matching types and enforces a single inbound edge', () => {
    let p = emptyPipeline();
    p = addNode(p, types, 'anatomy', 'A', { x: 0, y: 0 });
    p = addNode(p, types, 'evidence-gap', 'B', { x: 200, y: 0 });

    const r1 = connect(p, types, 'A', 'B', 'claims');
    expect(r1.error).toBeNull();
    expect(r1.pipeline.edges).toEqual([
      { fromNode: 'A', fromPort: 'out', toNode: 'B', toPort: 'claims' }
    ]);

    // A second producer into the same (B,claims) port REPLACES the first.
    let p2 = r1.pipeline;
    p2 = addNode(p2, types, 'anatomy', 'A2', { x: 0, y: 120 });
    const r2 = connect(p2, types, 'A2', 'B', 'claims');
    expect(r2.error).toBeNull();
    expect(r2.pipeline.edges).toHaveLength(1);
    expect(r2.pipeline.edges[0].fromNode).toBe('A2');
  });

  test('connect rejects type mismatch, self-loops, and unknown ports', () => {
    let p = emptyPipeline();
    p = addNode(p, types, 'anatomy', 'A', { x: 0, y: 0 });
    p = addNode(p, types, 'final-render', 'G', { x: 200, y: 0 });

    // anatomy outputs `claims`; G's only input is `gaps` → mismatch.
    const mismatch = connect(p, types, 'A', 'G', 'gaps');
    expect(mismatch.error).toMatch(/类型不匹配/);
    expect(mismatch.pipeline).toBe(p);

    const selfLoop = connect(p, types, 'A', 'A', 'claims');
    expect(selfLoop.error).toMatch(/自身/);

    const badPort = connect(p, types, 'A', 'G', 'does-not-exist');
    expect(badPort.error).toMatch(/没有输入端口/);
  });

  test('removeNode cascades its edges; removeEdge removes only the target', () => {
    let p = emptyPipeline();
    p = addNode(p, types, 'anatomy', 'A', { x: 0, y: 0 });
    p = addNode(p, types, 'evidence-gap', 'B', { x: 0, y: 0 });
    p = addNode(p, types, 'final-render', 'G', { x: 0, y: 0 });
    p = connect(p, types, 'A', 'B', 'claims').pipeline;
    p = connect(p, types, 'B', 'G', 'gaps').pipeline;
    expect(p.edges).toHaveLength(2);

    const afterDeleteB = removeNode(p, 'B');
    expect(afterDeleteB.nodes.map((n) => n.id)).toEqual(['A', 'G']);
    expect(afterDeleteB.edges).toHaveLength(0); // both edges touched B

    const afterDeleteEdge = removeEdge(p, {
      fromNode: 'A',
      fromPort: 'out',
      toNode: 'B',
      toPort: 'claims'
    });
    expect(afterDeleteEdge.edges).toEqual([
      { fromNode: 'B', fromPort: 'out', toNode: 'G', toPort: 'gaps' }
    ]);
  });

  test('moveNode + updateNode return new pipelines without mutating the input', () => {
    let p = emptyPipeline();
    p = addNode(p, types, 'anatomy', 'A', { x: 0, y: 0 });

    const moved = moveNode(p, 'A', { x: 99, y: 88 });
    expect(moved.nodes[0].pos).toEqual({ x: 99, y: 88 });
    expect(p.nodes[0].pos).toEqual({ x: 0, y: 0 }); // original untouched

    const patched = updateNode(p, 'A', { model: 'deepseek-v4-pro', promptBody: 'custom' });
    expect(patched.nodes[0].model).toBe('deepseek-v4-pro');
    expect(patched.nodes[0].promptBody).toBe('custom');
    expect(p.nodes[0].model).toBeUndefined();
  });

  test('cloneAsNew strips id/builtin and deep-copies', () => {
    const base: Pipeline = {
      id: 'builtin-expert',
      name: 'Expert 1.0',
      builtin: true,
      version: 'expert_v1',
      nodes: [{ id: 'A', type: 'anatomy', pos: { x: 1, y: 2 } }],
      edges: []
    };
    const clone = cloneAsNew(base);
    expect(clone.id).toBe('');
    expect(clone.builtin).toBe(false);
    expect(clone.name).toBe('我的流程');
    // Deep copy: mutating the clone's node doesn't touch the base.
    clone.nodes[0].pos = { x: 9, y: 9 };
    expect(base.nodes[0].pos).toEqual({ x: 1, y: 2 });
  });

  test('buildForSave slugs a builtin into a new id but preserves a custom id', () => {
    const builtin: Pipeline = {
      id: 'builtin-expert',
      name: 'Expert 1.0',
      builtin: true,
      nodes: [],
      edges: []
    };
    const saved = buildForSave(builtin, 'Senior Backend');
    expect(saved.id).toBe('senior-backend');
    expect(saved.builtin).toBe(false);

    const custom: Pipeline = { id: 'my-custom', name: 'x', builtin: false, nodes: [], edges: [] };
    const resaved = buildForSave(custom, 'Renamed');
    expect(resaved.id).toBe('my-custom'); // keeps its id (overwrite in place)
    expect(resaved.name).toBe('Renamed');
  });
});

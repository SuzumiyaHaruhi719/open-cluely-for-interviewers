// Pure node/edge graph operations for the Pipeline Studio. Framework-free and
// immutable: every function returns a NEW pipeline (never mutates its input), so
// the hook can use them with React state and the logic is unit-testable on its
// own. Mirrors the desktop pipeline-studio.js behavior (addNode placement,
// type-checked single-inbound connect, delete cascades edges, dirty tracking).

import type {
  BlockTypeMeta,
  Pipeline,
  PipelineEdge,
  PipelineNode
} from '../../lib/api';

/** A lookup of block-type metadata keyed by type id. */
export type TypeIndex = Record<string, BlockTypeMeta>;

/** Build a `{ [id]: meta }` index from the block-type catalog. */
export function indexTypes(types: readonly BlockTypeMeta[]): TypeIndex {
  return Object.fromEntries(types.map((t) => [t.id, t]));
}

/** Slugify a name into a stable pipeline id (matches the desktop slug()). */
export function slug(name: string): string {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || `pipeline-${Date.now().toString(36)}`;
}

/**
 * A fresh node id of the form `${type}-${n}`, unique within the pipeline.
 * `seq` is the caller's running counter; we return both the id and the counter
 * value used so the caller can advance its own monotonic sequence.
 */
export function nextNodeId(
  pipeline: Pipeline,
  type: string,
  seq: number
): { id: string; seq: number } {
  let n = seq;
  let id = `${type}-${n}`;
  const taken = (candidate: string): boolean => pipeline.nodes.some((node) => node.id === candidate);
  while (taken(id)) {
    n += 1;
    id = `${type}-${n}`;
  }
  return { id, seq: n };
}

/**
 * Append a node of `type` at `pos`. Returns a new pipeline; the node id is
 * generated to be unique. No-op (returns the same pipeline) if the type id is
 * unknown to the registry.
 */
export function addNode(
  pipeline: Pipeline,
  types: TypeIndex,
  type: string,
  id: string,
  pos: { x: number; y: number }
): Pipeline {
  if (!types[type]) {
    return pipeline;
  }
  const node: PipelineNode = { id, type, pos };
  return { ...pipeline, nodes: [...pipeline.nodes, node] };
}

/** Remove a node and any edges touching it. Returns a new pipeline. */
export function removeNode(pipeline: Pipeline, id: string): Pipeline {
  return {
    ...pipeline,
    nodes: pipeline.nodes.filter((n) => n.id !== id),
    edges: pipeline.edges.filter((e) => e.fromNode !== id && e.toNode !== id)
  };
}

/** Move a node to a new position. Returns a new pipeline (and new node object). */
export function moveNode(
  pipeline: Pipeline,
  id: string,
  pos: { x: number; y: number }
): Pipeline {
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((n) => (n.id === id ? { ...n, pos } : n))
  };
}

/** Patch a node's configurable fields. Returns a new pipeline + node. */
export function updateNode(
  pipeline: Pipeline,
  id: string,
  patch: Partial<PipelineNode>
): Pipeline {
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
  };
}

/** Result of a connect attempt: the next pipeline, or an error to surface. */
export interface ConnectResult {
  pipeline: Pipeline;
  error: string | null;
}

/**
 * Connect output(fromNode) → input(toNode.toPort) when the port types match.
 * Enforces: no self-loop, the target port exists, output type === input type,
 * and exactly one inbound edge per (toNode,toPort) — a new edge REPLACES any
 * existing one on that port (matches the desktop). Returns the same pipeline +
 * an error string on a rejected connection; otherwise the new pipeline.
 */
export function connect(
  pipeline: Pipeline,
  types: TypeIndex,
  fromNode: string,
  toNode: string,
  toPort: string
): ConnectResult {
  if (fromNode === toNode) {
    return { pipeline, error: 'cannot connect a node to itself' };
  }
  const from = pipeline.nodes.find((n) => n.id === fromNode);
  const to = pipeline.nodes.find((n) => n.id === toNode);
  if (!from || !to) {
    return { pipeline, error: 'unknown node' };
  }
  const fromType = types[from.type];
  const toType = types[to.type];
  if (!fromType || !toType) {
    return { pipeline, error: 'unknown block type' };
  }
  const port = (toType.inputs || []).find((p) => p.name === toPort);
  if (!port) {
    return { pipeline, error: `no input port "${toPort}"` };
  }
  if (port.type !== fromType.outputType) {
    return { pipeline, error: `Type mismatch: ${fromType.outputType} → ${port.type}` };
  }
  const edge: PipelineEdge = { fromNode, fromPort: 'out', toNode, toPort };
  const edges = pipeline.edges
    .filter((e) => !(e.toNode === toNode && e.toPort === toPort))
    .concat(edge);
  return { pipeline: { ...pipeline, edges }, error: null };
}

/** Remove a specific edge (by its 4-tuple). Returns a new pipeline. */
export function removeEdge(pipeline: Pipeline, edge: PipelineEdge): Pipeline {
  return {
    ...pipeline,
    edges: pipeline.edges.filter(
      (e) =>
        !(
          e.fromNode === edge.fromNode &&
          e.toNode === edge.toNode &&
          e.toPort === edge.toPort &&
          e.fromPort === edge.fromPort
        )
    )
  };
}

/**
 * Seed a brand-new editable pipeline from a base (the Expert preset). Deep-clones
 * the base, strips its id/builtin flag, and names it for the user to edit.
 */
export function cloneAsNew(base: Pipeline, name = 'My pipeline'): Pipeline {
  const copy: Pipeline = JSON.parse(JSON.stringify(base));
  return {
    ...copy,
    id: '',
    name,
    builtin: false,
    version: 'custom_v1'
  };
}

/**
 * Build the persistable pipeline from the working copy + the name field. A custom
 * (non-builtin) pipeline keeps its id; a builtin (or unsaved) gets a slug of the
 * name so "Save" on a builtin creates a new editable copy (matches the desktop).
 */
export function buildForSave(pipeline: Pipeline, nameInput: string): Pipeline {
  const name = nameInput.trim() || 'My pipeline';
  const id = pipeline.id && !pipeline.builtin ? pipeline.id : slug(name);
  return {
    ...pipeline,
    id,
    name,
    builtin: false,
    version: pipeline.version || 'custom_v1'
  };
}

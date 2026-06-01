// Pipeline data model + validation for the customizable interviewer pipeline.
// SP1 foundation. A Pipeline is a serializable typed DAG of blocks; the engine
// (pipeline-engine.js) runs it. Built-in presets (presets.js) express today's
// Expert chain in this format so the engine reproduces current behavior.

// Port types — the "lanes" that connect blocks. An edge may only join a source
// output port to a target input port of the SAME type. `context` is ambient
// (candidate answer / resume / JD / history / session state) and is never wired.
const PORT_TYPES = ['claims', 'gaps', 'state', 'candidates', 'ranking', 'verdict', 'final', 'text'];

/**
 * @typedef {Object} PipelineNode
 * @property {string} id            unique within the pipeline
 * @property {string} type          a block-type id (see block-types.js)
 * @property {string} [model]       per-node model override
 * @property {Object} [thinking]    per-node thinking override {type:'disabled'} | {type:'enabled',budget_tokens}
 * @property {string} [promptBody]  per-node instruction-body override
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {{x:number,y:number}} [pos]  editor-only; ignored by the engine
 *
 * @typedef {Object} PipelineEdge
 * @property {string} fromNode
 * @property {string} fromPort   output port name on the source node's type
 * @property {string} toNode
 * @property {string} toPort     input port name on the target node's type
 *
 * @typedef {Object} Pipeline
 * @property {string} id
 * @property {string} name
 * @property {boolean} builtin
 * @property {PipelineNode[]} nodes
 * @property {PipelineEdge[]} edges
 * @property {string} version
 */

// Validate a pipeline against a block-type registry. Returns { ok, errors[] }.
// Pure — no I/O. Used by the engine (hard gate) and later the editor (live).
function validatePipeline(pipeline, registry) {
  const errors = [];
  if (!pipeline || typeof pipeline !== 'object') return { ok: false, errors: ['pipeline must be an object'] };
  const nodes = Array.isArray(pipeline.nodes) ? pipeline.nodes : [];
  const edges = Array.isArray(pipeline.edges) ? pipeline.edges : [];
  if (nodes.length === 0) errors.push('pipeline has no nodes');

  const nodeById = new Map();
  for (const n of nodes) {
    if (!n || !n.id) { errors.push('a node is missing an id'); continue; }
    if (nodeById.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeById.set(n.id, n);
    if (!registry[n.type]) errors.push(`node ${n.id}: unknown type "${n.type}"`);
  }

  // Edge type-compatibility + port existence.
  const inboundByNodePort = new Map(); // `${node}.${port}` -> count
  for (const e of edges) {
    const from = nodeById.get(e.fromNode);
    const to = nodeById.get(e.toNode);
    if (!from) { errors.push(`edge from unknown node "${e.fromNode}"`); continue; }
    if (!to) { errors.push(`edge to unknown node "${e.toNode}"`); continue; }
    const fromType = registry[from.type];
    const toType = registry[to.type];
    if (!fromType || !toType) continue;
    if (fromType.outputType !== e.fromPort && e.fromPort !== 'out') {
      // outputs are single-port; accept either the type name or the literal 'out'
    }
    const outType = fromType.outputType;
    const inPort = (toType.inputs || []).find((p) => p.name === e.toPort);
    if (!inPort) { errors.push(`node ${to.id}: no input port "${e.toPort}"`); continue; }
    if (inPort.type !== outType) {
      errors.push(`edge ${from.id}->${to.id}.${e.toPort}: type ${outType} cannot connect to ${inPort.type}`);
    }
    const key = `${e.toNode}.${e.toPort}`;
    inboundByNodePort.set(key, (inboundByNodePort.get(key) || 0) + 1);
  }

  // Cycle detection (DAG) via DFS.
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (adj.has(e.fromNode)) adj.get(e.fromNode).push(e.toNode);
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.id, WHITE]));
  let hasCycle = false;
  function dfs(u) {
    color.set(u, GRAY);
    for (const v of (adj.get(u) || [])) {
      if (color.get(v) === GRAY) { hasCycle = true; return; }
      if (color.get(v) === WHITE) dfs(v);
    }
    color.set(u, BLACK);
  }
  for (const n of nodes) if (color.get(n.id) === WHITE) dfs(n.id);
  if (hasCycle) errors.push('pipeline has a cycle (must be a DAG)');

  // Exactly one terminal `final` producer.
  const finalNodes = nodes.filter((n) => registry[n.type] && registry[n.type].outputType === 'final');
  if (finalNodes.length === 0) errors.push('pipeline has no node producing a "final" output');
  if (finalNodes.length > 1) errors.push(`pipeline has ${finalNodes.length} "final" producers; expected exactly 1`);

  // Required inputs satisfied (a node whose declared input has no inbound edge
  // would always fall back — warn as an error so the editor surfaces it).
  for (const n of nodes) {
    const t = registry[n.type];
    if (!t) continue;
    for (const p of (t.inputs || [])) {
      if (p.optional) continue;
      if (!inboundByNodePort.get(`${n.id}.${p.name}`)) {
        errors.push(`node ${n.id}: required input "${p.name}" (${p.type}) is not connected`);
      }
    }
  }

  return { ok: errors.length === 0, errors, terminalId: finalNodes[0] ? finalNodes[0].id : null };
}

module.exports = { PORT_TYPES, validatePipeline };

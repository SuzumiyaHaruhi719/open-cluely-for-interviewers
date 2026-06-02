// Built-in pipeline presets. EXPERT_PRESET re-expresses today's hardcoded Expert
// 7-block chain as a typed DAG. Node ids are the schema letters A..G so the
// engine's trace/blocks/fallbackTriggered keys match the legacy orchestrator
// exactly (makes equivalence checking clean). Edges encode the same dependencies
// the legacy `runExpertChain` threaded by hand:
//   A∥C → B → D → E → F → G  (with B,C feeding D/E/G; D,E feeding F/G).

const e = (fromNode, toNode, toPort) => ({ fromNode, fromPort: 'out', toNode, toPort });

const EXPERT_PRESET = {
  id: 'builtin-expert',
  name: 'Expert 1.0',
  blurb: '原版 7-block 链 (A–G)，独立的排序块 E 精选 top-2。质量最稳，速度较慢 (~30–38s on 长面试)。',
  builtin: true,
  version: 'expert_v1',
  nodes: [
    { id: 'A', type: 'anatomy', pos: { x: 40, y: 40 } },
    { id: 'C', type: 'state-update', pos: { x: 40, y: 200 } },
    { id: 'B', type: 'evidence-gap', pos: { x: 240, y: 40 } },
    { id: 'D', type: 'question-pool', pos: { x: 440, y: 120 } },
    { id: 'E', type: 'rank-score', pos: { x: 640, y: 120 } },
    { id: 'F', type: 'safety-audit', pos: { x: 840, y: 120 } },
    { id: 'G', type: 'final-render', pos: { x: 1040, y: 120 } }
  ],
  edges: [
    e('A', 'B', 'claims'),
    e('A', 'D', 'claims'),
    e('B', 'D', 'gaps'),
    e('C', 'D', 'state'),
    e('A', 'E', 'claims'),
    e('B', 'E', 'gaps'),
    e('C', 'E', 'state'),
    e('D', 'E', 'candidates'),
    e('D', 'F', 'candidates'),
    e('E', 'F', 'ranking'),
    e('D', 'G', 'candidates'),
    e('E', 'G', 'ranking'),
    e('F', 'G', 'verdict'),
    e('B', 'G', 'gaps'),
    e('C', 'G', 'state')
  ]
};

// Expert-Fast: merged DE — Block E is removed; Block D orders candidates best-first
// (q1=primary, q2=alternative) so F/G use D's own ranking (ranking inputs are
// optional). One fewer serial LLM call than Expert → ~6s faster, same blocks
// otherwise. Quality is re-proven via the eval before this becomes the default.
const EXPERT_FAST_PRESET = {
  id: 'builtin-expert-fast',
  name: 'Expert 2.0',
  blurb: '合并 DE：D 直接最优排序 (q1=首选)、去掉独立排序块 E，少一次串行调用。更快 (~23s)，质量与 1.0 相当。',
  builtin: true,
  version: 'expert_fast_v1',
  nodes: [
    { id: 'A', type: 'anatomy', pos: { x: 40, y: 40 } },
    { id: 'C', type: 'state-update', pos: { x: 40, y: 200 } },
    { id: 'B', type: 'evidence-gap', pos: { x: 240, y: 40 } },
    { id: 'D', type: 'question-pool', pos: { x: 440, y: 120 } },
    { id: 'F', type: 'safety-audit', pos: { x: 700, y: 120 } },
    { id: 'G', type: 'final-render', pos: { x: 900, y: 120 } }
  ],
  edges: [
    e('A', 'B', 'claims'),
    e('A', 'D', 'claims'),
    e('B', 'D', 'gaps'),
    e('C', 'D', 'state'),
    e('D', 'F', 'candidates'),
    e('D', 'G', 'candidates'),
    e('F', 'G', 'verdict'),
    e('B', 'G', 'gaps'),
    e('C', 'G', 'state')
  ]
};

module.exports = { EXPERT_PRESET, EXPERT_FAST_PRESET };

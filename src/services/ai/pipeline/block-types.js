// Block-type registry for the pipeline engine. Each entry declares typed input
// ports, an output type, per-node defaults, and prepare/build/fallback hooks that
// REUSE the legacy Expert builders + fallback synthesizers so a pipeline that
// re-expresses Expert reproduces today's output exactly.
//
// Expert-specific glue (resolving E.top_2_ids → candidate objects, the safety
// swap) lives in the safety-audit / final-render `prepare` hooks — the engine
// itself stays generic (it only resolves typed edges + runs nodes).

const { buildBlockA, DEFAULT_BODY: A_BODY } = require('../interviewer-prompts/expert/block-a-answer-anatomy');
const { buildBlockB, DEFAULT_BODY: B_BODY } = require('../interviewer-prompts/expert/block-b-evidence-gap');
const { buildBlockC, DEFAULT_BODY: C_BODY } = require('../interviewer-prompts/expert/block-c-state-update');
const { buildBlockD, DEFAULT_BODY: D_BODY } = require('../interviewer-prompts/expert/block-d-question-pool');
const { buildBlockE, DEFAULT_BODY: E_BODY } = require('../interviewer-prompts/expert/block-e-rank-score');
const { buildBlockF, runHardRules, DEFAULT_BODY: F_BODY } = require('../interviewer-prompts/expert/block-f-safety-audit');
const { buildBlockG, DEFAULT_BODY: G_BODY } = require('../interviewer-prompts/expert/block-g-final-render');

const orch = require('../../../main-process/features/interviewer/expert-orchestrator');
const {
  BLOCK_MODELS, BLOCK_THINKING, BLOCK_TEMPERATURES, BLOCK_MAX_TOKENS, BLOCK_TIMEOUTS_MS,
  blockAFallback, blockBFallback, blockCFallback, blockDFallback, blockEFallback, blockFFallback, blockGFallback
} = orch;

// Per-schema-letter defaults pulled from the legacy maps so behavior matches.
function defaultsFor(letter) {
  return {
    model: BLOCK_MODELS[letter],
    thinking: BLOCK_THINKING[letter],
    temperature: BLOCK_TEMPERATURES[letter],
    maxTokens: BLOCK_MAX_TOKENS[letter],
    timeoutMs: BLOCK_TIMEOUTS_MS[letter]
  };
}

// Resolve primary/alternative candidate objects from E.ranking ∩ D.candidates —
// identical to the legacy orchestrator logic.
function resolvePrimaryAlt(ranking, candidates) {
  const cands = (candidates && candidates.candidates) || [];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const top2 = Array.isArray(ranking && ranking.top_2_ids) ? ranking.top_2_ids : [];
  const primary = byId.get(top2[0]) || cands[0] || null;
  const alternative = byId.get(top2[1]) || cands[1] || null;
  return { primary, alternative };
}

const BLOCK_TYPES = {
  anatomy: {
    label: '拆解回答', schemaId: 'A', outputType: 'claims', phase: { id: 'answer', index: 1 },
    inputs: [], defaults: defaultsFor('A'),
    build: (ctx, _inputs, body) => buildBlockA({ candidateAnswer: ctx.candidateAnswer, resumeChunk: ctx.resumeChunk, questionHistory: ctx.questionHistory, sessionState: ctx.sessionState, promptBody: body }),
    fallback: () => blockAFallback()
  },
  'state-update': {
    label: '梳理上下文', schemaId: 'C', outputType: 'state', phase: { id: 'answer', index: 1 },
    inputs: [], defaults: defaultsFor('C'),
    build: (ctx, _inputs, body) => buildBlockC({ candidateAnswer: ctx.candidateAnswer, questionHistory: ctx.questionHistory, sessionState: ctx.sessionState, jobDescription: ctx.jobDescription, promptBody: body }),
    fallback: (ctx) => blockCFallback(ctx.sessionState)
  },
  'evidence-gap': {
    label: '查找证据缺口', schemaId: 'B', outputType: 'gaps', phase: { id: 'gaps', index: 2 },
    inputs: [{ name: 'claims', type: 'claims' }], defaults: defaultsFor('B'),
    build: (ctx, inputs, body) => buildBlockB({ blockAResult: inputs.claims, candidateAnswer: ctx.candidateAnswer, resumeChunk: ctx.resumeChunk, jobDescription: ctx.jobDescription, questionHistory: ctx.questionHistory, sessionState: ctx.sessionState, promptBody: body }),
    fallback: () => blockBFallback()
  },
  'question-pool': {
    label: '生成候选问题', schemaId: 'D', outputType: 'candidates', phase: { id: 'pool', index: 3 },
    inputs: [{ name: 'claims', type: 'claims' }, { name: 'gaps', type: 'gaps' }, { name: 'state', type: 'state' }], defaults: defaultsFor('D'),
    build: (ctx, inputs, body) => buildBlockD({ blockAResult: inputs.claims, blockBResult: inputs.gaps, blockCResult: inputs.state, candidateAnswer: ctx.candidateAnswer, resumeChunk: ctx.resumeChunk, jobDescription: ctx.jobDescription, questionHistory: ctx.questionHistory, promptBody: body }),
    fallback: () => blockDFallback()
  },
  'rank-score': {
    label: '排序打分', schemaId: 'E', outputType: 'ranking', phase: { id: 'rank', index: 4 },
    inputs: [{ name: 'claims', type: 'claims' }, { name: 'gaps', type: 'gaps' }, { name: 'state', type: 'state' }, { name: 'candidates', type: 'candidates' }], defaults: defaultsFor('E'),
    build: (ctx, inputs, body) => buildBlockE({ blockAResult: inputs.claims, blockBResult: inputs.gaps, blockCResult: inputs.state, blockDResult: inputs.candidates, candidateAnswer: ctx.candidateAnswer, resumeChunk: ctx.resumeChunk, jobDescription: ctx.jobDescription, questionHistory: ctx.questionHistory, promptBody: body }),
    fallback: (_ctx, inputs) => blockEFallback(inputs.candidates)
  },
  'safety-audit': {
    label: '安全审查', schemaId: 'F', outputType: 'verdict', phase: { id: 'safety', index: 5 },
    inputs: [{ name: 'candidates', type: 'candidates' }, { name: 'ranking', type: 'ranking' }], defaults: defaultsFor('F'),
    prepare: (_ctx, inputs) => {
      const { primary, alternative } = resolvePrimaryAlt(inputs.ranking, inputs.candidates);
      const regexHits = [
        ...runHardRules(primary && primary.question ? primary.question : ''),
        ...runHardRules(alternative && alternative.question ? alternative.question : '')
      ];
      return { primary, alternative, regexHits };
    },
    build: (ctx, _inputs, body, derived) => buildBlockF({ candidateQuestions: [derived.primary, derived.alternative].filter(Boolean), regexHits: derived.regexHits, jobDescription: ctx.jobDescription, promptBody: body }),
    fallback: () => blockFFallback()
  },
  'final-render': {
    label: '整理成稿', schemaId: 'G', outputType: 'final', phase: { id: 'render', index: 6 },
    inputs: [
      { name: 'ranking', type: 'ranking' }, { name: 'candidates', type: 'candidates' },
      { name: 'verdict', type: 'verdict' }, { name: 'gaps', type: 'gaps' }, { name: 'state', type: 'state' }
    ], defaults: defaultsFor('G'),
    prepare: (_ctx, inputs) => {
      const { primary, alternative } = resolvePrimaryAlt(inputs.ranking, inputs.candidates);
      let chosenPrimary = primary; let chosenAlt = alternative;
      const verdict = inputs.verdict || {};
      if (verdict.verdict === 'block') {
        const altRegex = runHardRules(alternative && alternative.question ? alternative.question : '');
        const altRulesBlocked = altRegex.some((h) => ['personal-protected-attr', 'harassment', 'legally-sensitive'].includes(h.rule));
        if (alternative && !altRulesBlocked) { chosenPrimary = alternative; chosenAlt = null; } else { chosenPrimary = null; chosenAlt = null; }
      }
      if (!chosenPrimary) {
        return { skipToFallback: true, fallbackData: blockGFallback({ primary: null, alternative: null }), chosenPrimary: null, chosenAlt: null };
      }
      return { chosenPrimary, chosenAlt, safetyVerdict: verdict.verdict || 'pass' };
    },
    build: (ctx, inputs, body, derived) => buildBlockG({ primaryCandidate: derived.chosenPrimary, alternativeCandidate: derived.chosenAlt, blockBResult: inputs.gaps, blockCResult: inputs.state, safetyVerdict: derived.safetyVerdict, candidateAnswer: ctx.candidateAnswer, resumeChunk: ctx.resumeChunk, outputLanguage: ctx.outputLanguage, promptBody: body }),
    fallback: (_ctx, _inputs, derived) => blockGFallback({ primary: derived && derived.chosenPrimary, alternative: derived && derived.chosenAlt })
  },
  // Generic free-LLM block (defined for SP2/SP3; not used by the Expert preset).
  // Reads ambient context + an optional upstream text, emits text.
  llm: {
    label: '自定义 LLM', schemaId: null, outputType: 'text', phase: { id: 'llm', index: 99 },
    inputs: [{ name: 'in', type: 'text', optional: true }],
    defaults: { model: BLOCK_MODELS.A, thinking: BLOCK_THINKING.A, temperature: 0.3, maxTokens: 1200, timeoutMs: BLOCK_TIMEOUTS_MS.A },
    build: (ctx, inputs, body) => {
      const upstream = inputs.in && inputs.in.text ? `\n\n[Upstream]\n${inputs.in.text}` : '';
      return `${body || 'Respond helpfully.'}\n\n[Candidate answer]\n${ctx.candidateAnswer || ''}\n\n[Resume]\n${ctx.resumeChunk || ''}\n\n[Job description]\n${ctx.jobDescription || ''}${upstream}`;
    },
    fallback: () => ({ text: '' })
  }
};

// Serializable metadata for the editor palette / Customize UI (the registry
// entries hold functions, which can't cross IPC). Defaults' thinking is reported
// as a simple flag + budget the UI can toggle.
// Default editable instruction body per type — shown in the editor so users can
// fine-tune the default rather than start from a blank textarea.
const DEFAULT_BODIES = {
  anatomy: A_BODY,
  'state-update': C_BODY,
  'evidence-gap': B_BODY,
  'question-pool': D_BODY,
  'rank-score': E_BODY,
  'safety-audit': F_BODY,
  'final-render': G_BODY,
  llm: ''
};

function blockTypeMeta() {
  return Object.entries(BLOCK_TYPES).map(([id, t]) => ({
    id,
    label: t.label,
    schemaId: t.schemaId,
    inputs: (t.inputs || []).map((p) => ({ name: p.name, type: p.type, optional: Boolean(p.optional) })),
    outputType: t.outputType,
    defaultBody: DEFAULT_BODIES[id] || '',
    defaults: {
      model: t.defaults.model,
      thinking: t.defaults.thinking,
      temperature: t.defaults.temperature,
      maxTokens: t.defaults.maxTokens
    }
  }));
}

module.exports = { BLOCK_TYPES, resolvePrimaryAlt, blockTypeMeta };

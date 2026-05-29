// ============================================================================
// Expert-mode block schemas (V3 spec).
//
// Each block's output is JSON; schemas live here as plain objects + a hand-rolled
// validator. We don't import Ajv to keep the runtime dependency-free — DashScope
// LLMs are not always strict JSON producers, so our validator is permissive on
// extra keys but strict on required-field presence + type + enum membership.
//
// The validator's contract:
//   validate(blockId, parsedJson) -> { ok: boolean, errors: string[], data: object }
// On failure the orchestrator triggers a single repair retry with the errors
// pasted back into the prompt. After one repair miss, the orchestrator falls
// back per block (see expert-orchestrator.js BLOCK_FALLBACK_POLICY).
// ============================================================================

const BLOCK_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const QUESTION_TYPES = [
  'metric-pin',
  'timeline-pin',
  'named-entity-pin',
  'action-attribution',
  'resume-contradiction-pin',
  'hypothetical',
  'counterfactual',
  'teach-back',
  'chain-of-decisions',
  'tradeoff-articulation',
  'failure-mode',
  'cost-of-decision'
];

const CLAIM_TYPES = [
  'metric',
  'action',
  'role',
  'tool',
  'timeline',
  'outcome',
  'opinion',
  'team-attribution'
];

const EVIDENCE_TYPES = [
  'metric',
  'timeline',
  'named-tool',
  'owner-of-action',
  'resume-vs-verbal-overclaim',
  'tradeoff-reasoning',
  'failure-handling',
  'cost-awareness'
];

const SAFETY_RULES = [
  'personal-protected-attr',
  'legally-sensitive',
  'harassment',
  'unprofessional',
  'leading',
  'hostile-tone',
  'private-personal-life',
  'irrelevant-to-role'
];

const COMPETENCIES = [
  'technical-depth',
  'communication',
  'ownership',
  'leadership',
  'collaboration',
  'judgement-tradeoffs',
  'numbers-fluency',
  'failure-handling',
  'motivation',
  'role-fit',
  'culture-fit',
  'integrity'
];

const ANSWER_QUALITY_LABELS = [
  'concrete',
  'evasive',
  'mixed',
  'deflection',
  'hostile',
  'rambling',
  'over-packaged',
  'silent-then-recovered',
  'off-topic'
];

const SAFETY_VERDICTS = ['pass', 'block', 'rewrite'];

// ─── Per-block schemas ──────────────────────────────────────────────────────

const BLOCK_SCHEMAS = {
  A: {
    description: 'Answer Anatomy — extract claims with raw_span anchoring.',
    required: ['claims', 'star_coverage', 'answer_quality_label'],
    shape: {
      claims: { type: 'array', minLength: 0, item: {
        required: ['id', 'raw_span', 'claim_type'],
        types: { id: 'string', raw_span: 'string', claim_type: 'enum:CLAIM_TYPES', subject: 'string?', value: 'string?' }
      }},
      star_coverage: { required: ['S', 'T', 'A', 'R'], types: { S: 'boolean', T: 'boolean', A: 'boolean', R: 'boolean' } },
      answer_quality_label: 'enum:ANSWER_QUALITY_LABELS',
      language_register: 'string?'
    }
  },
  B: {
    description: 'Evidence Gap — CoVe-style reverse check on missing evidence + overclaims.',
    required: ['missing_evidence', 'overclaim_flags', 'contradictions'],
    shape: {
      missing_evidence: { type: 'array', item: {
        required: ['competency', 'evidence_type', 'why_missing', 'verifier_check'],
        types: { competency: 'enum:COMPETENCIES', evidence_type: 'enum:EVIDENCE_TYPES', why_missing: 'string', verifier_check: 'string' }
      }},
      overclaim_flags: { type: 'array', item: {
        required: ['resume_claim', 'verbal_claim', 'delta'],
        types: { resume_claim: 'string', verbal_claim: 'string', delta: 'string' }
      }},
      contradictions: { type: 'array', item: {
        required: ['claim_a', 'claim_b', 'why_contradicts'],
        types: { claim_a: 'string', claim_b: 'string', why_contradicts: 'string' }
      }}
    }
  },
  C: {
    description: 'State Update — pure-function next-state for the interview session.',
    required: ['next_competency_target', 'depth_remaining_on_current_topic', 'should_pivot', 'drilled_topics_after'],
    shape: {
      topic_just_drilled: 'string?',
      next_competency_target: 'enum:COMPETENCIES',
      depth_remaining_on_current_topic: { type: 'enum', values: ['exhausted', 'one-more', 'deep-vein'] },
      should_pivot: 'boolean',
      drilled_topics_after: { type: 'array', item: { types: { topic: 'string', depth: 'integer' } } }
    }
  },
  D: {
    description: 'Question Pool — 5 candidates with ≥3 distinct question_types.',
    required: ['candidates'],
    shape: {
      candidates: { type: 'array', minLength: 5, maxLength: 5, item: {
        required: ['id', 'question', 'question_type', 'anchors', 'expected_yield'],
        types: {
          id: 'string',
          question: 'string',
          question_type: 'enum:QUESTION_TYPES',
          anchors: { type: 'array', item: 'string' },
          fills_evidence_gap: 'string?',
          expected_yield: 'string'
        }
      }}
    },
    extraValidator: (data) => {
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      if (candidates.length !== 5) return ['D requires exactly 5 candidates'];
      const types = new Set(candidates.map((c) => c?.question_type).filter(Boolean));
      if (types.size < 3) return [`D requires >=3 distinct question_types, got ${types.size}: ${Array.from(types).join(',')}`];
      return [];
    }
  },
  E: {
    description: 'Rank & Score — six-dim rubric, top-2 with reasoning.',
    required: ['ranked', 'top_2_ids'],
    shape: {
      ranked: { type: 'array', minLength: 5, maxLength: 5, item: {
        required: ['id', 'rubric', 'total', 'reasoning'],
        types: {
          id: 'string',
          rubric: {
            required: ['evidence_value', 'specificity', 'non_redundancy', 'interviewer_usability', 'risk_of_dodge_inverse', 'expected_signal_density'],
            types: {
              evidence_value: 'integer:1-5',
              specificity: 'integer:1-5',
              non_redundancy: 'integer:1-5',
              interviewer_usability: 'integer:1-5',
              risk_of_dodge_inverse: 'integer:1-5',
              expected_signal_density: 'integer:1-5'
            }
          },
          total: 'number',
          reasoning: 'string'
        }
      }},
      top_2_ids: { type: 'array', minLength: 2, maxLength: 2, item: 'string' }
    },
    extraValidator: (data) => {
      const errors = [];
      const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
      const ids = new Set(ranked.map((r) => r?.id).filter(Boolean));
      const top2 = Array.isArray(data?.top_2_ids) ? data.top_2_ids : [];
      for (const id of top2) {
        if (!ids.has(id)) errors.push(`top_2_ids contains "${id}" which is not in ranked[].id`);
      }
      if (top2.length === 2 && top2[0] === top2[1]) errors.push('top_2_ids must contain two distinct ids');
      return errors;
    }
  },
  F: {
    description: 'Safety Audit — regex hard rule + Flash soft rule.',
    required: ['verdict', 'violations', 'regex_hits', 'soft_rule_findings'],
    shape: {
      verdict: 'enum:SAFETY_VERDICTS',
      violations: { type: 'array', item: {
        required: ['rule', 'evidence'],
        types: { rule: 'enum:SAFETY_RULES', evidence: 'string', severity: 'string?' }
      }},
      regex_hits: { type: 'array', item: 'string' },
      soft_rule_findings: { type: 'array', item: {
        required: ['rule', 'evidence'],
        types: { rule: 'string', evidence: 'string' }
      }}
    }
  },
  G: {
    description: 'Final Render — pure-template output for the renderer.',
    required: ['primary_question', 'rationale_for_interviewer', 'anchor_quotes', 'expected_evidence_yield', 'iteration_version'],
    shape: {
      primary_question: 'string',
      alternative_question: 'string?',
      rationale_for_interviewer: 'string',
      anchor_quotes: { type: 'array', item: 'string' },
      expected_evidence_yield: 'string',
      iteration_version: 'string'
    }
  }
};

const ENUM_BANKS = {
  CLAIM_TYPES,
  EVIDENCE_TYPES,
  COMPETENCIES,
  QUESTION_TYPES,
  SAFETY_RULES,
  SAFETY_VERDICTS,
  ANSWER_QUALITY_LABELS
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateScalar(value, spec, fieldPath) {
  const errors = [];
  const optional = typeof spec === 'string' && spec.endsWith('?');
  const baseSpec = optional ? spec.slice(0, -1) : spec;

  if (value === undefined || value === null) {
    if (!optional) errors.push(`${fieldPath} is required`);
    return errors;
  }

  if (baseSpec === 'string') {
    if (typeof value !== 'string') errors.push(`${fieldPath} must be string, got ${typeof value}`);
    return errors;
  }
  if (baseSpec === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${fieldPath} must be boolean, got ${typeof value}`);
    return errors;
  }
  if (baseSpec === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${fieldPath} must be number`);
    return errors;
  }
  if (baseSpec === 'integer') {
    if (!Number.isInteger(value)) errors.push(`${fieldPath} must be integer`);
    return errors;
  }
  if (baseSpec.startsWith('integer:')) {
    const [, range] = baseSpec.split(':');
    const [lo, hi] = range.split('-').map((n) => Number.parseInt(n, 10));
    if (!Number.isInteger(value)) {
      errors.push(`${fieldPath} must be integer in [${lo},${hi}]`);
    } else if (value < lo || value > hi) {
      errors.push(`${fieldPath} must be in [${lo},${hi}], got ${value}`);
    }
    return errors;
  }
  if (baseSpec.startsWith('enum:')) {
    const bankName = baseSpec.slice('enum:'.length);
    const bank = ENUM_BANKS[bankName];
    if (!Array.isArray(bank)) {
      errors.push(`${fieldPath}: unknown enum bank ${bankName}`);
      return errors;
    }
    if (!bank.includes(value)) errors.push(`${fieldPath} must be one of [${bank.join(',')}], got "${value}"`);
    return errors;
  }

  errors.push(`${fieldPath}: unknown spec "${baseSpec}"`);
  return errors;
}

function validateShape(data, shape, path) {
  const errors = [];
  if (!isPlainObject(data)) {
    errors.push(`${path || '(root)'} must be object`);
    return errors;
  }
  for (const [key, spec] of Object.entries(shape)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const value = data[key];

    if (typeof spec === 'string') {
      errors.push(...validateScalar(value, spec, fieldPath));
      continue;
    }
    if (!isPlainObject(spec)) continue;

    if (spec.type === 'array') {
      if (value === undefined || value === null) {
        errors.push(`${fieldPath} is required (array)`);
        continue;
      }
      if (!Array.isArray(value)) {
        errors.push(`${fieldPath} must be array`);
        continue;
      }
      if (typeof spec.minLength === 'number' && value.length < spec.minLength) {
        errors.push(`${fieldPath} requires length >= ${spec.minLength}, got ${value.length}`);
      }
      if (typeof spec.maxLength === 'number' && value.length > spec.maxLength) {
        errors.push(`${fieldPath} requires length <= ${spec.maxLength}, got ${value.length}`);
      }
      if (spec.item) {
        value.forEach((entry, index) => {
          const itemPath = `${fieldPath}[${index}]`;
          if (typeof spec.item === 'string') {
            errors.push(...validateScalar(entry, spec.item, itemPath));
          } else if (isPlainObject(spec.item)) {
            if (Array.isArray(spec.item.required)) {
              for (const req of spec.item.required) {
                if (entry?.[req] === undefined || entry?.[req] === null || entry?.[req] === '') {
                  errors.push(`${itemPath}.${req} is required`);
                }
              }
            }
            if (isPlainObject(spec.item.types)) {
              errors.push(...validateShape(entry, spec.item.types, itemPath));
            }
          }
        });
      }
      continue;
    }
    if (spec.type === 'enum') {
      if (value === undefined || value === null) {
        errors.push(`${fieldPath} is required (enum)`);
        continue;
      }
      if (!Array.isArray(spec.values) || !spec.values.includes(value)) {
        errors.push(`${fieldPath} must be one of [${(spec.values || []).join(',')}], got "${value}"`);
      }
      continue;
    }
    if (Array.isArray(spec.required) || isPlainObject(spec.types)) {
      if (value === undefined || value === null) {
        errors.push(`${fieldPath} is required (object)`);
        continue;
      }
      if (Array.isArray(spec.required)) {
        for (const req of spec.required) {
          if (value?.[req] === undefined || value?.[req] === null) {
            errors.push(`${fieldPath}.${req} is required`);
          }
        }
      }
      if (isPlainObject(spec.types)) {
        errors.push(...validateShape(value, spec.types, fieldPath));
      }
    }
  }
  return errors;
}

function validateBlock(blockId, data) {
  const schema = BLOCK_SCHEMAS[blockId];
  if (!schema) {
    return { ok: false, errors: [`Unknown block "${blockId}"`], data: null };
  }
  if (!isPlainObject(data)) {
    return { ok: false, errors: ['Output is not a JSON object'], data: null };
  }
  const errors = [];
  for (const req of schema.required || []) {
    if (data[req] === undefined || data[req] === null) {
      errors.push(`Missing required field: ${req}`);
    }
  }
  errors.push(...validateShape(data, schema.shape || {}, ''));
  if (typeof schema.extraValidator === 'function') {
    errors.push(...schema.extraValidator(data));
  }
  return { ok: errors.length === 0, errors, data };
}

module.exports = {
  BLOCK_IDS,
  BLOCK_SCHEMAS,
  QUESTION_TYPES,
  CLAIM_TYPES,
  EVIDENCE_TYPES,
  SAFETY_RULES,
  SAFETY_VERDICTS,
  COMPETENCIES,
  ANSWER_QUALITY_LABELS,
  validateBlock
};

// ============================================================================
// Customize-mode "one-sentence → pipeline" builder
// ----------------------------------------------------------------------------
// Backs POST /api/pipelines/generate (Settings → Customize "② 一句话让 AI 生成").
//
// Strategy (deliberately NOT free-form, so the model can never break the graph):
//   1. Start from a deep clone of EXPERT_PRESET — a known-valid 7-block DAG.
//   2. Ask the model, in ONE chat call, to act as an interview-pipeline TUNER:
//      given the recruiter's one-sentence intent, return STRICT JSON with a
//      display name, a short focus phrase, and per-block prompt HINTS keyed by
//      the Expert block ids (A/B/C/D/E/F/G).
//   3. APPEND each hint to that block's instruction body (`promptBody`) — we
//      never replace the block's proven mission/frame, only aim it at this hire.
//      Nodes start without a `promptBody`, so the block-type DEFAULT_BODY (from
//      blockTypeMeta) is the base we append onto.
//   4. VALIDATE the result; on any parse/validation failure, fall back to the
//      pristine cloned Expert preset with a name derived from the prompt.
//
// The DAG (nodes + edges + types) is fixed throughout — only prompt text and the
// name/focus/description metadata vary — so the returned pipeline is always a
// valid, runnable Customize pipeline. Mirrors the desktop pipeline-generator.js
// philosophy (fixed frame, AI tunes the lens) but tunes every role-sensitive
// block via hints rather than only node D's lens.
// ============================================================================

import { blockTypeMeta, validatePipeline, BLOCK_TYPES } from '@open-cluely/copilot-core';

/** A serializable pipeline node. Extra fields (pos, etc.) are preserved. */
interface PipelineNode {
  id: string;
  type: string;
  promptBody?: string;
  [key: string]: unknown;
}

interface Pipeline {
  id: string;
  name: string;
  version: string;
  nodes: PipelineNode[];
  edges: Array<Record<string, unknown>>;
  builtin?: boolean;
  blurb?: string;
  description?: string;
  focus?: string;
  [key: string]: unknown;
}

/** The model's expected tuning output. All fields optional — parsed defensively. */
export interface PipelineHints {
  name?: string;
  focus?: string;
  blockPromptHints?: Record<string, string>;
}

const MAX_NAME_CHARS = 40;
const MAX_FOCUS_CHARS = 200;
const MAX_HINT_CHARS = 600;
const GENERATED_VERSION = 'custom_v1';

/**
 * Tolerant JSON extraction, mirroring the desktop brain's `safeJsonParse`
 * (expert-orchestrator.js): strip a ```json fence, try a direct parse, then fall
 * back to the first {...} block. Returns null on anything unparseable.
 */
export function safeJsonParse(text: string | null | undefined): unknown {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_2) {
        return null;
      }
    }
    return null;
  }
}

/** Strict-JSON tuning instruction. Block ids are the Expert schema letters A–G. */
export function buildSystemPrompt(blockIds: readonly string[]): string {
  return [
    'You configure an interview FOLLOW-UP-QUESTION generator for a recruiter.',
    'You are a pipeline TUNER, not an author: the block graph is fixed and proven;',
    "you only aim it at the recruiter's specific hire by writing short per-block hints.",
    '',
    'You will receive a one-sentence description of the role/interview the recruiter wants.',
    'Keep the core principle on every block — probe the candidate\'s reasoning, judgment,',
    'ownership, and potential, NOT facts a transcript already holds — and aim it at THIS role.',
    '',
    'Return STRICT JSON only (no markdown, no prose) of EXACTLY this shape:',
    '{',
    '  "name": "<short display name for this interview, in the description\'s language, <=24 chars>",',
    '  "focus": "<one short phrase naming this role\'s highest-signal traits to probe>",',
    '  "blockPromptHints": {',
    '    "<blockId>": "<one extra instruction to APPEND to that block, aiming it at this role>"',
    '  }',
    '}',
    '',
    `Valid blockId values are exactly: ${blockIds.join(', ')}.`,
    'Block roles: A=answer anatomy, B=evidence-gap detection, C=context/state,',
    'D=question-pool generation (the main lens), E=ranking, F=safety, G=final rationale.',
    'Only include blocks you actually want to tune (D is usually the most valuable).',
    'Each hint is appended verbatim after the block\'s existing instructions — keep it',
    'short, role-specific, and additive (never tell the block to ignore its prior rules).'
  ].join('\n');
}

/** Map of block-type id -> its default instruction body (from the live registry). */
function defaultBodyByType(): Map<string, string> {
  const map = new Map<string, string>();
  for (const meta of blockTypeMeta()) {
    map.set(meta.id, typeof meta.defaultBody === 'string' ? meta.defaultBody : '');
  }
  return map;
}

/** Trim + cap a free-text field; empty/whitespace becomes ''. */
function clamp(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Derive a human display name from the raw prompt when the model gives none.
 * First sentence/line, collapsed whitespace, capped — never empty.
 */
export function deriveName(prompt: string): string {
  const firstLine = prompt
    .split(/[\n。.!?！？]/u)[0]
    ?.replace(/\s+/gu, ' ')
    .trim();
  const base = firstLine && firstLine.length > 0 ? firstLine : prompt.replace(/\s+/gu, ' ').trim();
  const capped = base.slice(0, MAX_NAME_CHARS).trim();
  return capped.length > 0 ? capped : 'AI 生成的面试';
}

/** Deep clone via structuredClone when available, else JSON round-trip. */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Fresh id for a generated (non-persisted) pipeline. */
function freshId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `custom-${globalThis.crypto.randomUUID()}`;
  }
  return `custom-${Date.now()}`;
}

/**
 * A pristine clone of the Expert preset retagged as a fresh, non-builtin custom
 * pipeline with the derived name + prompt stored as focus/description. Always
 * valid (it is the Expert DAG verbatim). Used as the guaranteed fallback.
 */
export function buildFallbackPipeline(expertPreset: unknown, prompt: string): Pipeline {
  const clone = deepClone(expertPreset) as Pipeline;
  const name = deriveName(prompt);
  return {
    ...clone,
    id: freshId(),
    name,
    builtin: false,
    version: GENERATED_VERSION,
    blurb: clone.blurb ?? '',
    focus: prompt.trim(),
    description: prompt.trim()
  };
}

/**
 * Apply the model's hints onto a clone of the Expert preset. Sets name/focus and
 * APPENDS each `blockPromptHints[nodeId]` to that node's `promptBody` (base =
 * existing promptBody or the block-type's default body). Structure is untouched.
 */
export function applyHints(expertPreset: unknown, prompt: string, hints: PipelineHints): Pipeline {
  const base = buildFallbackPipeline(expertPreset, prompt);
  const name = clamp(hints.name, MAX_NAME_CHARS) || deriveName(prompt);
  const focus = clamp(hints.focus, MAX_FOCUS_CHARS) || prompt.trim();
  const rawHints = hints.blockPromptHints;
  const hintMap =
    rawHints && typeof rawHints === 'object' && !Array.isArray(rawHints)
      ? (rawHints as Record<string, unknown>)
      : {};
  const defaults = defaultBodyByType();

  const nodes: PipelineNode[] = base.nodes.map((node) => {
    const hint = clamp(hintMap[node.id], MAX_HINT_CHARS);
    if (!hint) return node;
    const currentBody =
      typeof node.promptBody === 'string' && node.promptBody.length > 0
        ? node.promptBody
        : defaults.get(node.type) ?? '';
    const promptBody = currentBody ? `${currentBody}\n\n[ROLE FOCUS — ${name}] ${hint}` : hint;
    return { ...node, promptBody };
  });

  return { ...base, name, focus, description: prompt.trim(), nodes };
}

/**
 * Build a guaranteed-valid Customize pipeline from a one-sentence prompt and the
 * model's raw tuning reply. Parses the reply tolerantly, applies hints, validates,
 * and falls back to the pristine Expert clone on any parse/validation failure.
 */
export function buildPipelineFromReply(
  expertPreset: unknown,
  prompt: string,
  modelReply: string
): Pipeline {
  const parsed = safeJsonParse(modelReply);
  let candidate: Pipeline;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    candidate = applyHints(expertPreset, prompt, parsed as PipelineHints);
  } else {
    candidate = buildFallbackPipeline(expertPreset, prompt);
  }

  const result = validatePipeline(candidate, BLOCK_TYPES);
  if (result.ok) return candidate;

  // Hints somehow produced an invalid pipeline — return the pristine Expert clone.
  const fallback = buildFallbackPipeline(expertPreset, prompt);
  const fallbackResult = validatePipeline(fallback, BLOCK_TYPES);
  // The Expert clone is valid by construction; if validation still fails the
  // registry/preset themselves are broken, which the route surfaces as a 500.
  if (!fallbackResult.ok) {
    throw new Error(`expert fallback failed validation: ${fallbackResult.errors.join('; ')}`);
  }
  return fallback;
}

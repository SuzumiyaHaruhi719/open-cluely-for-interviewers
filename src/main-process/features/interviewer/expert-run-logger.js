// ============================================================================
// Expert-chain run logger
// ----------------------------------------------------------------------------
// Every Generate-Q in Expert mode runs the 7-block chain and returns a `trace`
// (one entry per block attempt: { block, attempt, ms, ok, errors, model,
// usage }). This module turns that trace into:
//   • a human-readable per-block summary (model · purpose · duration · ok ·
//     attempts · tokens) logged to the main-process console, and
//   • a structured JSONL record appended to logs/generate-q.jsonl
// so a follow-up debugging session can read exactly what each block did.
//
// summarizeExpertRun is a pure function (testable); logExpertRun does the I/O.
// ============================================================================

const fs = require('fs');
const path = require('path');

// What each block does, for the "made sense of what" column in the log.
const BLOCK_PURPOSE = {
  A: 'answer-anatomy',
  B: 'evidence-gap',
  C: 'state-update',
  D: 'question-pool',
  E: 'rank-score',
  F: 'safety-audit',
  G: 'final-render'
};

const BLOCK_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function tokenCount(usage, key) {
  const n = usage && typeof usage[key] === 'number' ? usage[key] : 0;
  return Number.isFinite(n) ? n : 0;
}

// Aggregate the (possibly multi-attempt) trace entries for one block into a
// single summary row.
function summarizeBlock(blockId, entries) {
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  let ms = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of entries) {
    ms += Number.isFinite(e.ms) ? e.ms : 0;
    inputTokens += tokenCount(e.usage, 'input_tokens');
    outputTokens += tokenCount(e.usage, 'output_tokens');
  }
  return {
    block: blockId,
    purpose: BLOCK_PURPOSE[blockId] || 'unknown',
    model: last.model || '(unknown)',
    ms,
    ok: Boolean(last.ok),
    attempts: entries.length,
    inputTokens,
    outputTokens
  };
}

/**
 * Build a structured record + human-readable text from an Expert chain result.
 * Pure — no I/O.
 * @param {{ requestId: (string|null), trace: Array, fallbackTriggered: Array, elapsedMs: number }} args
 * @returns {{ record: object, text: string }}
 */
function summarizeExpertRun({ requestId = null, trace = [], fallbackTriggered = [], elapsedMs = 0 } = {}) {
  const fellBack = new Set(Array.isArray(fallbackTriggered) ? fallbackTriggered : []);

  // Group trace entries by block.
  const byBlock = {};
  for (const e of Array.isArray(trace) ? trace : []) {
    if (!e || !e.block) continue;
    (byBlock[e.block] = byBlock[e.block] || []).push(e);
  }

  const blocks = [];
  for (const id of BLOCK_ORDER) {
    const summary = summarizeBlock(id, byBlock[id] || []);
    if (!summary) continue;
    summary.fallback = fellBack.has(id);
    blocks.push(summary);
  }

  const record = {
    ts: new Date().toISOString(),
    requestId: requestId != null ? String(requestId) : null,
    elapsedMs,
    fallbackTriggered: Array.from(fellBack),
    blocks
  };

  // ── Human-readable block ──────────────────────────────────────────────────
  const header = `[GenerateQ req#${record.requestId ?? '?'}] expert chain — total ${elapsedMs}ms`
    + (record.fallbackTriggered.length ? ` — fallbacks: ${record.fallbackTriggered.join(', ')}` : ' — no fallbacks');
  const rows = blocks.map((b) => {
    const status = b.fallback ? 'FALLBACK' : (b.ok ? 'ok' : 'fail');
    const attempts = b.attempts > 1 ? ` (${b.attempts} attempts)` : '';
    const tokens = (b.inputTokens || b.outputTokens) ? `  in/out ${b.inputTokens}/${b.outputTokens}` : '';
    return `  ${b.block}  ${b.purpose.padEnd(15)} ${String(b.model).padEnd(18)} ${String(b.ms).padStart(6)}ms  ${status.padEnd(8)}${attempts}${tokens}`;
  });
  const text = [header, ...rows].join('\n');

  return { record, text };
}

/**
 * Log an Expert run: console summary + JSONL append. Never throws.
 * @param {object} args - same shape as summarizeExpertRun's argument.
 * @param {string} [logDir] - directory for generate-q.jsonl (defaults to <repo>/logs).
 */
function logExpertRun(args, logDir) {
  let summary;
  try {
    summary = summarizeExpertRun(args);
  } catch (err) {
    console.error('[GenerateQ] failed to summarize run:', err?.message || err);
    return;
  }

  // Console summary (captured in the dev run log).
  console.log(summary.text);

  // Structured JSONL for later debugging. Best-effort — logging must never
  // affect the user-facing flow.
  try {
    const dir = logDir || path.join(__dirname, '..', '..', '..', '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'generate-q.jsonl'), JSON.stringify(summary.record) + '\n', 'utf8');
  } catch (err) {
    console.error('[GenerateQ] failed to write generate-q.jsonl:', err?.message || err);
  }
}

module.exports = {
  summarizeExpertRun,
  logExpertRun,
  BLOCK_PURPOSE
};

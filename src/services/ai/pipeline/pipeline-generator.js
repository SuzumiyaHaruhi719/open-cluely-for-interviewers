// AI one-click pipeline generation. HR types a plain-language description of the
// interview ("招个能扛事、会带团队的资深后端"); the LLM writes a focused "role lens"
// — the question-generator's mission for this hire — and we drop it onto the
// fixed, validated Expert DAG. The graph is never AI-authored (so it can't be
// broken); only the lens text varies. Result: a runnable, on-philosophy pipeline
// that a non-technical user produced from one sentence.

const { assembleFromLens } = require('./role-templates');
const { validatePipeline } = require('./pipeline-schema');
const { BLOCK_TYPES } = require('./block-types');

function buildGenPrompt(description) {
  return `You configure an interview follow-up-question generator. Given HR's plain-language
description of the role/interview they want, write a focused "role lens": 2-4 sentences
telling the question generator WHICH judgment, traits, and decisions to probe for THIS
specific hire. The lens must keep the core principle — probe the candidate's reasoning,
ownership, and potential, NOT facts a transcript already holds — and aim it at this role.

Also produce a short display name and a one-line Chinese blurb.

HR's description:
"""
${String(description || '').trim()}
"""

Write the lens in English (it is a system instruction), starting with "Role focus:".
Name and blurb in the same language as the description (Chinese if Chinese).

Output STRICT JSON only:
{"name":"<short role name, <=12 chars>","blurb":"<one-line Chinese summary of what this interview digs into>","lens":"Role focus: <2-4 sentence lens aimed at this role's highest-signal traits and decisions>"}`;
}

// chat: an async ({apiKey, model, prompt, temperature, maxTokens, timeoutMs, thinking}) => {text}
// (pass the orchestrator's dashscopeChat). model/FLASH_MODEL supplied by caller.
async function generatePipeline({ description, apiKey, chat, model, safeJsonParse }) {
  const desc = String(description || '').trim();
  if (!desc) return { ok: false, error: 'empty-description' };
  if (!apiKey) return { ok: false, error: 'no-api-key' };
  let parsed = null;
  try {
    const { text } = await chat({
      apiKey, model, prompt: buildGenPrompt(desc),
      temperature: 0.4, maxTokens: 700, timeoutMs: 60000, thinking: { type: 'disabled' }
    });
    parsed = safeJsonParse(text);
  } catch (error) {
    return { ok: false, error: `generate-failed: ${error.message}` };
  }
  if (!parsed || !parsed.lens) return { ok: false, error: 'bad-generation' };
  const pipeline = assembleFromLens({
    name: String(parsed.name || 'AI 生成的面试').slice(0, 24),
    blurb: String(parsed.blurb || desc).slice(0, 80),
    lens: parsed.lens
  });
  // Belt-and-suspenders: the structure is fixed, but validate before returning so
  // a malformed lens can never yield an unrunnable pipeline.
  const v = validatePipeline(pipeline, BLOCK_TYPES);
  if (!v.ok) return { ok: false, error: `invalid: ${(v.errors || []).join('; ')}` };
  return { ok: true, pipeline };
}

module.exports = { generatePipeline, buildGenPrompt };

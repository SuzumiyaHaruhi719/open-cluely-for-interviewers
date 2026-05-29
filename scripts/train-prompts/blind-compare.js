// Fast vs Expert blind comparison via deepseek-v4-pro judge.
//
// Runs both Fast and Expert chains on N fixtures, presents the two outputs
// to the Pro judge in randomized A/B order, and records the verdict. Each
// fixture is judged twice with the order swapped to neutralize position bias.
//
// Usage:
//   DASHSCOPE_API_KEY=... node scripts/train-prompts/blind-compare.js [--n 50]

const fs = require('fs');
const path = require('path');

const { runExpertChain } = require('../../src/main-process/features/interviewer/expert-orchestrator');
const {
  buildHookDetectionPrompt,
  buildFollowUpQuestionPrompt
} = require('../../src/services/ai/interviewer-prompts');
const { getDashscopeBaseUrl, getDefaultInterviewerModel } = require('../../src/config');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const REPORT_DIR = path.join(FIXTURE_DIR, '_manifests');
const ANTHROPIC_VERSION = '2023-06-01';

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(state.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { n: 50 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--n' && args[i + 1]) { out.n = parseInt(args[i + 1], 10); i++; }
  }
  return out;
}

async function dashscopeCall({ apiKey, model, prompt, maxTokens, temperature }) {
  const resp = await fetch(`${getDashscopeBaseUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature })
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  return (json?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
}

function safeJson(text) {
  if (!text) return null;
  const c = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(c); } catch (_) {
    const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (_2) { return null; } }
    return null;
  }
}

async function runFast({ apiKey, fixture }) {
  const stage1Prompt = buildHookDetectionPrompt({
    jobDescription: fixture.jd,
    resumeChunk: fixture.resume,
    candidateAnswer: fixture.candidate_last_answer,
    questionHistory: fixture.history.map((h) => h.q || h),
    candidateEmotion: null
  });
  const stage1Text = await dashscopeCall({ apiKey, model: getDefaultInterviewerModel(), prompt: stage1Prompt, maxTokens: 600, temperature: 0.15 });
  const stage1 = safeJson(stage1Text) || {};
  if ((stage1.depth_worth_score || 0) < 4 || stage1.pivot_signal) {
    return { primary_question: '(Fast mode: no follow-up — depth < threshold or pivot signal)', stage1 };
  }
  const stage2Prompt = buildFollowUpQuestionPrompt({
    concreteHooks: stage1.concrete_hooks || [],
    missingStar: stage1.missing_star_element || 'none',
    recommendedDirection: stage1.recommended_direction || 'technical-depth',
    candidateAnswer: fixture.candidate_last_answer,
    questionHistory: fixture.history.map((h) => h.q || h),
    resumeChunk: fixture.resume
  });
  const stage2Text = await dashscopeCall({ apiKey, model: getDefaultInterviewerModel(), prompt: stage2Prompt, maxTokens: 800, temperature: 0.4 });
  const stage2 = safeJson(stage2Text) || {};
  const q = stage2.questions?.[0]?.question || '(Fast mode: no question)';
  return { primary_question: q, stage1, stage2 };
}

function buildJudgePrompt({ fixture, sideA, sideB }) {
  return `You are a senior interview-coaching expert judging which of two follow-up questions a copilot should suggest. Be impartial.

[Job description]
${fixture.jd}

[Candidate resume excerpt]
${fixture.resume}

[Candidate's most recent answer — the question you are asked to follow up on]
${fixture.candidate_last_answer}

[Prior questions, oldest first]
${fixture.history.map((h, i) => `${i + 1}. ${h.q || h}`).join('\n')}

[Side A follow-up question]
${sideA}

[Side B follow-up question]
${sideB}

Judge on these criteria, in order of importance:
1. Anchored on a specific span of the candidate's answer or resume (vs. generic).
2. Demands falsifiable evidence (number, named entity, date, counterfactual, tradeoff) — not a qualitative dodge.
3. Closes a real evidence gap given the JD priorities.
4. Speakable in <=35 words.
5. Not redundant with prior questions.

Output strict JSON only.
{
  "winner": "A" | "B" | "tie",
  "why": "<one short paragraph stating the deciding criterion>"
}`;
}

async function main() {
  const { n } = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }

  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.startsWith('fx_') && f.endsWith('.json')).sort();
  // Stratified sample: take every Nth file across the corpus
  const stride = Math.max(1, Math.floor(files.length / n));
  const sample = [];
  for (let i = 0; i < files.length && sample.length < n; i += stride) sample.push(files[i]);

  console.log(`Blind compare on ${sample.length} fixtures (stratified, stride=${stride})`);

  const results = [];
  for (let i = 0; i < sample.length; i++) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, sample[i]), 'utf8'));
    process.stdout.write(`  ${i + 1}/${sample.length} ${fixture.id}...\r`);
    try {
      const [fastResult, expertResult] = await Promise.all([
        runFast({ apiKey, fixture }),
        runExpertChain({
          apiKey,
          candidateAnswer: fixture.candidate_last_answer,
          resumeChunk: fixture.resume,
          jobDescription: fixture.jd,
          questionHistory: fixture.history.map((h) => h.q || h),
          sessionState: fixture.session_state
        })
      ]);
      const fastQ = fastResult.primary_question;
      const expertQ = expertResult.output.primary_question;

      // Round 1: Fast=A, Expert=B
      const j1Prompt = buildJudgePrompt({ fixture, sideA: fastQ, sideB: expertQ });
      const j1Text = await dashscopeCall({ apiKey, model: 'deepseek-v4-pro', prompt: j1Prompt, maxTokens: 400, temperature: 0.1 });
      const j1 = safeJson(j1Text) || { winner: 'tie' };

      // Round 2: swap — Expert=A, Fast=B
      const j2Prompt = buildJudgePrompt({ fixture, sideA: expertQ, sideB: fastQ });
      const j2Text = await dashscopeCall({ apiKey, model: 'deepseek-v4-pro', prompt: j2Prompt, maxTokens: 400, temperature: 0.1 });
      const j2 = safeJson(j2Text) || { winner: 'tie' };

      // Decode: in round 1 "A"=Fast, "B"=Expert; in round 2 "A"=Expert, "B"=Fast.
      const r1Winner = j1.winner === 'A' ? 'Fast' : j1.winner === 'B' ? 'Expert' : 'tie';
      const r2Winner = j2.winner === 'A' ? 'Expert' : j2.winner === 'B' ? 'Fast' : 'tie';

      let verdict;
      if (r1Winner === r2Winner) verdict = r1Winner;
      else if ([r1Winner, r2Winner].includes('tie')) verdict = [r1Winner, r2Winner].find((v) => v !== 'tie');
      else verdict = 'inconsistent';

      results.push({ id: fixture.id, fastQ, expertQ, r1: { winner: r1Winner, why: j1.why }, r2: { winner: r2Winner, why: j2.why }, verdict });
    } catch (err) {
      results.push({ id: fixture.id, error: err.message });
    }
  }
  console.log();

  const tally = { Fast: 0, Expert: 0, tie: 0, inconsistent: 0, errors: 0 };
  for (const r of results) {
    if (r.error) tally.errors += 1;
    else tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  }
  const decided = tally.Fast + tally.Expert;
  const expertWinRate = decided ? tally.Expert / decided : 0;

  const summary = { n_sampled: sample.length, tally, expert_win_rate_on_decided: Number(expertWinRate.toFixed(4)) };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `blind-compare-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report → ${out}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

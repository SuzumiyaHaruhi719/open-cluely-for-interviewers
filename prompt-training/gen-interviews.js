// gen-interviews.js — use the built-in DeepSeek API to synthesize diverse mock
// interviews (résumé + JD + multi-turn history + a long final candidate answer),
// each with >=1000 chars of context. Output one JSON per line to a corpus file
// that gen-questions.js can run Generate Q against.
//
// Usage:
//   DASHSCOPE_TRANSPORT=curl node prompt-training/gen-interviews.js --n 1000 --concurrency 16 \
//     --out prompt-training/corpus/interviews.jsonl
//
// Key: DASHSCOPE_API_KEY env, else cache/app-state.json → dashscopeApiKey.

const fs = require('fs');
const path = require('path');
const { dashscopeChat, safeJsonParse, FLASH_MODEL } = require('../src/main-process/features/interviewer/expert-orchestrator');

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try { return String(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8')).dashscopeApiKey || '').trim(); } catch (_) { return ''; }
}
function parseArgs() {
  const a = process.argv.slice(2); const o = { n: 50, concurrency: 12, out: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--n') o.n = parseInt(a[++i], 10);
    else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10);
    else if (a[i] === '--out') o.out = a[++i];
  }
  return o;
}

// Diversity axes — sampled per interview so 1000 scenarios don't collapse to one.
const INDUSTRIES = ['backend/payments', 'frontend/web', 'ML/ranking', 'data engineering', 'devops/SRE', 'product management', 'growth marketing', 'UX design', 'sales/AE', 'customer success', 'finance/FP&A', 'legal/compliance', 'biotech/clinical', 'hardware/embedded', 'security', 'mobile', 'QA/automation', 'data science', 'engineering management', 'solutions architect'];
const LEVELS = ['junior', 'mid', 'senior', 'staff/principal', 'manager', 'director'];
const LANGS = ['English', 'Chinese', 'mixed Chinese+English technical terms'];
const ANSWER_STYLES = ['STAR-complete and specific', 'vague and evasive', 'team-credit-only (over-uses "we")', 'inflated/unverifiable metrics', 'defensive/pushes back', 'rambling and tangential', 'over-packaged buzzwords', 'deflects blame onto others', 'concise and precise', 'timeline-confused/contradictory'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const MIN_CHARS = (() => { const i = process.argv.indexOf('--minchars'); return i >= 0 ? parseInt(process.argv[i + 1], 10) : 10000; })();

function buildPrompt() {
  const industry = pick(INDUSTRIES); const level = pick(LEVELS); const lang = pick(LANGS); const style = pick(ANSWER_STYLES);
  return `You are authoring ONE LONG, realistic job-interview transcript for stress-testing an interviewer-copilot.
Constraints:
- Industry/role: ${industry}; seniority: ${level}; language: ${lang}; the candidate's FINAL answer style: ${style}.
- Output STRICT JSON only (no markdown), shape:
  {"resume":"<450-650 words: companies, scope, stack, quantified wins, multiple projects>","jd":"<200-300 words>","history":[{"q":"<interviewer question, full sentence>","a":"<candidate's substantive answer, 60-120 words>"}, … 10 to 12 such turns],"candidate_last_answer":"<a LONG, detailed final answer, 350-500 words, enacting the '${style}' style — multiple paragraphs, specific decisions/metrics/tradeoffs>"}
- The transcript must be DENSE, coherent, and TOTAL at least ${MIN_CHARS} characters across resume + jd + every history q AND a + candidate_last_answer. Write real depth, not filler.
- Vary wording; no boilerplate. Real company-ish details and real metrics.
Emit only the JSON object.`;
}

async function genOne(apiKey, i) {
  try {
    const { text } = await dashscopeChat({ apiKey, model: FLASH_MODEL, prompt: buildPrompt(), temperature: 0.9, maxTokens: 8000, timeoutMs: 180000, thinking: { type: 'disabled' } });
    const p = safeJsonParse(text);
    if (!p || !p.candidate_last_answer || !p.resume) return null;
    // history items may be {q,a} turns or bare question strings — normalize to {q,a}.
    const history = (Array.isArray(p.history) ? p.history : []).map((h) => (
      typeof h === 'string' ? { q: h, a: '' } : { q: String(h.q || ''), a: String(h.a || '') }
    ));
    const historyChars = history.reduce((n, t) => n + t.q.length + t.a.length, 0);
    const ctxLen = String(p.resume).length + String(p.jd || '').length + historyChars + String(p.candidate_last_answer).length;
    if (ctxLen < MIN_CHARS) return null; // enforce the >=MIN_CHARS context floor
    return {
      id: `gi_${String(i).padStart(4, '0')}`,
      resume: p.resume,
      jd: p.jd,
      history,
      candidate_last_answer: String(p.candidate_last_answer),
      session_state: null,
      ctx_chars: ctxLen
    };
  } catch (_) { return null; }
}

async function pool(total, concurrency, worker, onDone) {
  let idx = 0; let done = 0;
  async function next() {
    const i = idx++;
    if (i >= total) return;
    const r = await worker(i);
    onDone(++done, total, r);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, next));
}

async function main() {
  const o = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }
  const outPath = o.out || path.join('prompt-training', 'corpus', `interviews-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  let ok = 0; let bad = 0;
  console.error(`gen-interviews: target ${o.n}, concurrency ${o.concurrency} → ${outPath}`);
  const t0 = Date.now();
  await pool(o.n, o.concurrency, (i) => genOne(apiKey, i), (done, total, r) => {
    if (r) { stream.write(JSON.stringify(r) + '\n'); ok++; } else { bad++; }
    if (done % 25 === 0 || done === total) process.stderr.write(`  ${done}/${total} ok=${ok} bad=${bad}\n`);
  });
  stream.end();
  console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${ok} interviews (${bad} rejected) → ${outPath}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

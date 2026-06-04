#!/usr/bin/env node
// ============================================================================
// gen-interview.mjs — DeepSeek-driven interview-transcript generator (mic-less harness).
// ----------------------------------------------------------------------------
// Calls DeepSeek over DashScope's Anthropic-shape Messages endpoint — the SAME
// auth/endpoint convention the server uses in server/src/dashscope.ts:
//   POST ${DASHSCOPE_BASE_URL}/v1/messages
//   headers: { 'x-api-key': <key>, 'anthropic-version': '2023-06-01' }
//   body:    { model, max_tokens, system, messages:[{role,content}] }
//   parse:   concat of response.content[].text
// Creds come from web-app/.env (DASHSCOPE_API_KEY + DASHSCOPE_BASE_URL +
// INTERVIEWER_MODEL, default model 'deepseek-v4-flash').
//
// Generates N (default 3) realistic Chinese STRUCTURED-INTERVIEW (考公/结构化面试)
// transcripts. Each is an array of turns alternating speaker — interviewer
// (speakerId 0) asks, candidate (speakerId 1) answers — 8–14 turns, each 1–3
// sentences. Writes each to scripts/sim/fixtures/interview-<i>.json as
// [{speakerId, text}]. ROBUST: retries once on API error; if the API totally
// fails it writes a small hardcoded fallback fixture so the harness still runs.
//
// Usage:  node scripts/sim/gen-interview.mjs [--count N]
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '..', '.env');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_MODEL = 'deepseek-v4-flash';
const MAX_TOKENS = 2048;

// --- tiny .env parser (no dependency on dotenv from this standalone script) ---
function loadEnv(path) {
  const env = {};
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

function parseArgs(argv) {
  const args = { count: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--count' || a === '-n') args.count = Math.max(1, parseInt(argv[++i], 10) || 3);
  }
  return args;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// One Anthropic-shape chat completion. Returns concatenated content[].text.
// Throws on any non-OK / timeout (the caller handles retry + fallback).
async function chat({ baseUrl, apiKey, model, system, messages, maxTokens }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`DashScope ${resp.status}: ${text.slice(0, 300)}`);
    }
    const json = await resp.json();
    const blocks = Array.isArray(json.content) ? json.content : [];
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = [
  '你是一名资深结构化面试（考公/事业单位）命题与模拟专家。',
  '请生成一段真实可信的中文结构化面试对话转写文本。',
  '对话在“考官”与“考生”之间交替进行：考官提问，考生作答，再追问，循环。',
  '内容要符合结构化面试风格：综合分析题、人际沟通题、应急应变题、组织管理题、岗位匹配题等。',
  '考生的回答要有具体内容（举例、分点、有逻辑），不要空泛口号。',
  '严格只输出 JSON，不要任何解释或 markdown 代码块围栏。'
].join('');

function userPrompt(idx) {
  // Vary the theme per fixture so the three chats aren't identical.
  const themes = [
    '综合分析 + 应急应变（如：基层工作中遇到群众投诉与突发舆情）',
    '组织管理 + 人际沟通（如：牵头组织一次社区活动并协调多方）',
    '岗位匹配 + 综合分析（如：为什么报考该岗位，以及对一项政策的看法）'
  ];
  const theme = themes[idx % themes.length];
  return [
    `请生成第 ${idx + 1} 套结构化面试模拟转写，主题侧重：${theme}。`,
    '要求：',
    '1) 8 到 14 轮对话，考官(speakerId=0)与考生(speakerId=1)严格交替，考官先开口。',
    '2) 每一轮 1 到 3 句话，口语化、自然，像真实转写。',
    '3) 只输出一个 JSON 数组，元素形如 {"speakerId": 0, "text": "..."}，speakerId 仅取 0 或 1。',
    '示例（仅示意，请勿照抄内容）：',
    '[{"speakerId":0,"text":"你好，请先做个简单的自我介绍。"},{"speakerId":1,"text":"各位考官好，我叫……"}]'
  ].join('\n');
}

// Pull the first JSON array out of the model's text and validate it into the
// [{speakerId:int, text:str}] shape. Returns null on any malformed output.
function parseTranscript(text) {
  if (!text) return null;
  let cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let arr;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      arr = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const turns = arr
    .map((t) => ({
      speakerId: t && (t.speakerId === 1 || t.speakerId === '1') ? 1 : 0,
      text: t && typeof t.text === 'string' ? t.text.trim() : ''
    }))
    .filter((t) => t.text.length > 0);
  return turns.length >= 2 ? turns : null;
}

// Hardcoded fallback so the harness ALWAYS has a usable two-speaker script even
// if DeepSeek is unreachable. Themed slightly per index for variety.
function fallbackTranscript(idx) {
  const base = [
    { speakerId: 0, text: '你好，欢迎参加今天的面试，请先用一分钟做个简单的自我介绍。' },
    { speakerId: 1, text: '各位考官好，我叫李明，毕业于行政管理专业，曾在街道办事处实习半年，主要负责群众接待和材料整理工作。' },
    { speakerId: 0, text: '假设你在窗口工作，一位群众因为材料不全无法办理业务，情绪非常激动，你会怎么处理？' },
    { speakerId: 1, text: '我会先安抚对方情绪，请他到旁边坐下，倒杯水，耐心听他把诉求讲完。然后逐条说明缺少哪些材料、为什么需要，并打印一份清单给他。最后留下我的联系方式，告诉他补齐后我优先帮他办理。' },
    { speakerId: 0, text: '如果他坚持认为是你们故意刁难，还要投诉你，你怎么办？' },
    { speakerId: 1, text: '我会保持冷静，明确告诉他投诉是他的权利，并主动提供投诉电话和流程。同时我会把办理依据和沟通记录留存好，确保经得起复核。事后我也会反思流程能否优化，比如提前在网上公示所需材料。' },
    { speakerId: 0, text: '你刚才提到优化流程，能不能具体说说你会从哪几个方面入手？' },
    { speakerId: 1, text: '我会从三个方面入手：一是材料清单上墙上网，让群众来之前就清楚；二是设置帮办代办岗，对老年人等群体提供协助；三是建立回访机制，定期收集群众意见持续改进。' },
    { speakerId: 0, text: '最后一个问题，你为什么报考我们这个岗位？' },
    { speakerId: 1, text: '一方面我的专业和实习经历与岗位高度匹配，另一方面我真心喜欢基层服务工作，能直接帮助到群众让我很有成就感。我希望能在这个岗位上踏实做事，长期发展。' }
  ];
  // Light per-index tweak so three fallbacks aren't byte-identical.
  if (idx % 3 === 1) base[1].text = '各位考官好，我叫王芳，计算机专业毕业，做过两年社区网格员，熟悉信息登记和居民协调工作。';
  if (idx % 3 === 2) base[1].text = '各位考官好，我叫张伟，法学专业，曾在司法所参与普法宣传和纠纷调解，沟通能力是我的强项。';
  return base;
}

async function generateOne(cfg, idx) {
  const messages = [{ role: 'user', content: userPrompt(idx) }];
  // Try the API; one retry on any error before giving up to the fallback.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await chat({ ...cfg, system: SYSTEM, messages, maxTokens: MAX_TOKENS });
      const turns = parseTranscript(text);
      if (turns) return { turns, source: 'deepseek' };
      throw new Error('unparseable model output');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (attempt === 0) {
        console.warn(`  [${idx}] attempt 1 failed (${msg}); retrying once...`);
        await delay(1500);
        continue;
      }
      console.warn(`  [${idx}] attempt 2 failed (${msg}); using hardcoded fallback.`);
      return { turns: fallbackTranscript(idx), source: 'fallback' };
    }
  }
  return { turns: fallbackTranscript(idx), source: 'fallback' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(ENV_PATH);
  const apiKey = (env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
  const baseUrl = (env.DASHSCOPE_BASE_URL || process.env.DASHSCOPE_BASE_URL || '').trim();
  const model = (env.INTERVIEWER_MODEL || process.env.INTERVIEWER_MODEL || DEFAULT_MODEL).trim();

  mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log(`gen-interview: generating ${args.count} transcript(s)`);
  console.log(`  endpoint: ${baseUrl ? baseUrl + '/v1/messages' : '(no DASHSCOPE_BASE_URL — fallback only)'}`);
  console.log(`  model:    ${model}`);
  console.log(`  apiKey:   ${apiKey ? apiKey.slice(0, 6) + '…(' + apiKey.length + ' chars)' : '(missing — fallback only)'}`);

  const noApi = !apiKey || !baseUrl;
  const cfg = { baseUrl, apiKey, model };

  const summary = [];
  for (let i = 0; i < args.count; i += 1) {
    let result;
    if (noApi) {
      console.warn(`  [${i}] no API creds — using hardcoded fallback.`);
      result = { turns: fallbackTranscript(i), source: 'fallback' };
    } else {
      result = await generateOne(cfg, i);
    }
    const file = resolve(FIXTURES_DIR, `interview-${i}.json`);
    writeFileSync(file, JSON.stringify(result.turns, null, 2) + '\n', 'utf8');
    const speakers = [...new Set(result.turns.map((t) => t.speakerId))].sort();
    summary.push({ i, file, turns: result.turns.length, speakers, source: result.source });
  }

  console.log('\n=== gen-interview summary ===');
  for (const s of summary) {
    console.log(
      `  interview-${s.i}.json  turns=${s.turns}  speakers=[${s.speakers.join(',')}]  source=${s.source}`
    );
  }
  const anyFallback = summary.some((s) => s.source === 'fallback');
  console.log(
    `\nWrote ${summary.length} fixture(s) to ${FIXTURES_DIR}` +
      (anyFallback ? '  (NOTE: at least one used the hardcoded fallback)' : '')
  );
}

main().catch((err) => {
  console.error('gen-interview FATAL:', err && err.stack ? err.stack : err);
  process.exit(1);
});

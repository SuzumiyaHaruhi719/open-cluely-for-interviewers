/**
 * verify-summary.mjs — Live E2E verification of streaming summary + model selection
 *                      + custom prompt (Features 1+2+3).
 *
 * For each of the 4 supported summary models + one custom-prompt run:
 *   1. Connect to ws://localhost:8787/ws
 *   2. Wait for `ready`
 *   3. Send configure with asrProvider:'sim', simScript, summaryModel (+ prompt if custom)
 *   4. Send audio-control start → sim provider replays the script as finals
 *   5. Once all sim finals arrive, send summarize
 *   6. Listen for summary-chunk (proves streaming), summary-done, or summary-error
 *   7. Report: streamed? valid report? elapsed s? chunks? first 300 chars / error
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:8787/ws';

// Short two-speaker transcript — enough for a real summary but fast to process.
const SIM_SCRIPT = [
  { speakerId: 0, text: '请介绍一下你最近负责的一个复杂项目。' },
  {
    speakerId: 1,
    text: '我主导了一个订单系统重构，把五分钟轮询改成消息队列驱动，把延迟从 300ms 降到 20ms 以内，上线后无故障运行三个月。'
  },
  { speakerId: 0, text: '你们遇到了哪些技术挑战？' },
  {
    speakerId: 1,
    text: '主要挑战是幂等性保证和消息顺序问题。我们用数据库乐观锁加消息去重表解决了幂等，用分区键保证了同一订单的消息顺序。'
  }
];

const MODELS = [
  { id: 'deepseek-v4-pro',   label: 'deepseek-v4-pro (深度·慢·默认)' },
  { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash (快)' },
  { id: 'qwen3-7b-max',      label: 'qwen3.7-max' },
  { id: 'glm-4-5',           label: 'glm-5.2' }
];

/**
 * Run one verification: configure, wait for all sim finals, summarize, collect result.
 * @param {object} opts
 * @param {string} opts.modelId     — summaryModel value
 * @param {string} opts.label       — display label for the results table
 * @param {string} [opts.customPrompt] — when set, sends summaryPromptMode:'custom'
 */
function tryRun({ modelId, label, customPrompt }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const ws = new WebSocket(WS_URL);
    let chunks = [];
    let done = false;
    // Guard: only send summarize once.
    let summarizeSent = false;
    // Count how many finals we've seen (sim has 4 turns).
    let finalsReceived = 0;
    const TOTAL_FINALS = SIM_SCRIPT.length;

    const finish = (result) => {
      if (done) return;
      done = true;
      ws.close();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({
        label,
        streamed: chunks.length > 0,
        chunkCount: chunks.length,
        elapsedS: ((Date.now() - startedAt) / 1000).toFixed(1),
        reportLen: 0,
        first300: '',
        error: 'TIMEOUT after 200s'
      });
    }, 200000);

    const sendSummarize = () => {
      if (summarizeSent) return;
      summarizeSent = true;
      const reqId = `verify-${modelId}-${Date.now()}`;
      ws.send(JSON.stringify({ type: 'summarize', requestId: reqId }));
    };

    ws.on('error', (err) => {
      clearTimeout(timeout);
      finish({ label, streamed: false, chunkCount: 0, elapsedS: 0, reportLen: 0, first300: '', error: err.message });
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'ready') {
        const cfg = {
          asrProvider: 'sim',
          simScript: SIM_SCRIPT,
          summaryModel: modelId
        };
        if (customPrompt) {
          cfg.summaryPromptMode = 'custom';
          cfg.summaryPromptText = customPrompt;
        }
        ws.send(JSON.stringify({ type: 'configure', config: cfg }));
        ws.send(JSON.stringify({ type: 'audio-control', action: 'start', source: 'display' }));
        return;
      }

      if (msg.type === 'transcript' && msg.isFinal) {
        finalsReceived += 1;
        // Once we have all finals, wait a short tick then summarize.
        if (finalsReceived >= TOTAL_FINALS) {
          setTimeout(sendSummarize, 400);
        }
        return;
      }

      if (msg.type === 'summary-chunk') {
        chunks.push(msg.text ?? '');
        process.stdout.write('.');
        return;
      }

      if (msg.type === 'summary-done') {
        clearTimeout(timeout);
        const fullText = chunks.join('') || (msg.text ?? '');
        console.log(''); // newline after dots
        finish({
          label,
          streamed: chunks.length > 0,
          chunkCount: chunks.length,
          elapsedS: ((Date.now() - startedAt) / 1000).toFixed(1),
          reportLen: fullText.length,
          first300: fullText.slice(0, 300),
          error: null
        });
        return;
      }

      if (msg.type === 'summary-error') {
        clearTimeout(timeout);
        console.log('');
        finish({
          label,
          streamed: chunks.length > 0,
          chunkCount: chunks.length,
          elapsedS: ((Date.now() - startedAt) / 1000).toFixed(1),
          reportLen: 0,
          first300: '',
          error: `DASHSCOPE ERROR: ${msg.message}`
        });
      }
    });
  });
}

console.log('=== Streaming Summary E2E Verification (Features 1+2+3) ===\n');

const results = [];

// ── Features 1+2: all 4 models ────────────────────────────────────────────────
for (const { id, label } of MODELS) {
  console.log(`\n--- Model: ${label} ---`);
  process.stdout.write('Chunks: ');
  const r = await tryRun({ modelId: id, label });
  results.push(r);
  console.log(`  Streamed:   ${r.streamed} (${r.chunkCount} chunks)`);
  console.log(`  Elapsed:    ${r.elapsedS}s`);
  console.log(`  Report len: ${r.reportLen} chars`);
  if (r.error) console.log(`  ERROR:      ${r.error}`);
  else         console.log(`  First 300:  ${r.first300.replace(/\n/g, ' \\n ')}`);
}

// ── Feature 3: custom prompt run ─────────────────────────────────────────────
const CUSTOM_PROMPT = '你是一位极度简洁的面试评估助手。仅用三句话总结候选人的整体表现和录用建议，不要输出任何标题或结构。';
console.log(`\n--- Feature 3: custom prompt (deepseek-v4-flash) ---`);
process.stdout.write('Chunks: ');
const customResult = await tryRun({
  modelId: 'deepseek-v4-flash',
  label: 'deepseek-v4-flash + custom prompt',
  customPrompt: CUSTOM_PROMPT
});
results.push(customResult);
console.log(`  Streamed:   ${customResult.streamed} (${customResult.chunkCount} chunks)`);
console.log(`  Elapsed:    ${customResult.elapsedS}s`);
console.log(`  Report len: ${customResult.reportLen} chars`);
if (customResult.error) console.log(`  ERROR:      ${customResult.error}`);
else                    console.log(`  First 300:  ${customResult.first300.replace(/\n/g, ' \\n ')}`);

// ── Feature 3: empty custom prompt (should fall back to default) ──────────────
console.log(`\n--- Feature 3: empty custom prompt → falls back to default (deepseek-v4-flash) ---`);
process.stdout.write('Chunks: ');
const emptyPromptResult = await tryRun({
  modelId: 'deepseek-v4-flash',
  label: 'deepseek-v4-flash + empty custom (fallback)',
  customPrompt: ''   // empty → server falls back to SUMMARY_SYSTEM
});
results.push(emptyPromptResult);
console.log(`  Streamed:   ${emptyPromptResult.streamed} (${emptyPromptResult.chunkCount} chunks)`);
console.log(`  Elapsed:    ${emptyPromptResult.elapsedS}s`);
console.log(`  Report len: ${emptyPromptResult.reportLen} chars`);
if (emptyPromptResult.error) console.log(`  ERROR:      ${emptyPromptResult.error}`);
else                         console.log(`  First 300:  ${emptyPromptResult.first300.replace(/\n/g, ' \\n ')}`);

// ── Results table ─────────────────────────────────────────────────────────────
console.log('\n\n=== Per-run Results Table ===');
console.log('Run                                        | Streamed | Valid | Elapsed s | Chunks | Error');
console.log('-------------------------------------------+----------+-------+-----------+--------+----------------------------');
for (const r of results) {
  const streamed = r.streamed ? 'YES' : 'NO ';
  const valid    = r.reportLen > 50 ? 'YES' : 'NO ';
  const err      = r.error ? r.error.slice(0, 40) : '-';
  console.log(
    `${r.label.padEnd(42)} | ${streamed}      | ${valid}   | ${String(r.elapsedS).padEnd(9)} | ${String(r.chunkCount).padEnd(6)} | ${err}`
  );
}

process.exit(0);

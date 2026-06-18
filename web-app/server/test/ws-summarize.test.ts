import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleSummarize, type SummarizeDeps } from '../src/ws';
import { createSummaryTelemetry } from '../src/summary-telemetry';
import { resolveSummarySystemPrompt, SUMMARY_SYSTEM } from '../src/interview-analysis';
import type { ServerMessage } from '@open-cluely/contract';
import type { SummaryResult, StreamCallbacks, AnalyzeSummaryStreamDeps } from '../src/interview-analysis';

// ----------------------------------------------------------------------------
// handleSummarize is the server-side summary entrypoint. We exercise it directly
// (no real WS server, no network) via a fake socket that captures sent frames and
// an injected `analyze`. This pins:
//   #8 — an empty transcript replies with a DISTINCT empty notice (`empty:true`),
//        not a plain report that the modal would render as a real evaluation.
//   #5/obs — the lifecycle is recorded in the telemetry log.
//   the happy path + the fellBack note + the error path.
// ----------------------------------------------------------------------------

/** A fake WebSocket that captures the JSON frames the server sends. */
function fakeWs(): { ws: any; frames: ServerMessage[] } {
  const frames: ServerMessage[] = [];
  const ws = {
    OPEN: 1,
    readyState: 1,
    send(data: string) {
      frames.push(JSON.parse(data) as ServerMessage);
    }
  };
  return { ws, frames };
}

function ok(text: string, model = 'deepseek-v4-pro', fellBack = false): SummaryResult {
  return { text, model, fellBack };
}

test('#8 empty transcript → a summary-done flagged empty:true (a notice, not a report)', async () => {
  const { ws, frames } = fakeWs();
  // analyze must NEVER be called for an empty transcript.
  let analyzeCalls = 0;
  const deps: SummarizeDeps = {
    analyze: async () => {
      analyzeCalls += 1;
      return ok('should not happen');
    }
  };
  await handleSummarize(ws, () => '', 'req-empty', deps);

  assert.equal(analyzeCalls, 0, 'analyze must not run on an empty transcript');
  assert.equal(frames.length, 1);
  const msg = frames[0];
  assert.equal(msg.type, 'summary-done');
  if (msg.type === 'summary-done') {
    assert.equal(msg.requestId, 'req-empty');
    assert.equal(msg.empty, true, 'the empty case must be flagged empty:true');
    assert.ok((msg.text ?? '').length > 0, 'the notice still carries friendly text');
  }
});

test('happy path → a summary-done with the report text + model, NOT flagged empty', async () => {
  const { ws, frames } = fakeWs();
  const deps: SummarizeDeps = {
    analyze: async (input) => {
      assert.match(input, /面试/);
      return ok('## 候选人概况\n不错。', 'deepseek-v4-pro');
    }
  };
  await handleSummarize(ws, () => '面试记录…', 'req-1', deps);

  assert.equal(frames.length, 1);
  const msg = frames[0];
  assert.equal(msg.type, 'summary-done');
  if (msg.type === 'summary-done') {
    assert.equal(msg.requestId, 'req-1');
    assert.equal(msg.text, '## 候选人概况\n不错。');
    assert.equal(msg.model, 'deepseek-v4-pro');
    assert.notEqual(msg.empty, true);
  }
});

test('fellBack → the report text is prefixed with the fallback notice', async () => {
  const { ws, frames } = fakeWs();
  const deps: SummarizeDeps = {
    analyze: async () => ok('## 报告', 'deepseek-v4-flash', true)
  };
  await handleSummarize(ws, () => '面试记录…', 'req-fb', deps);

  const msg = frames[0];
  assert.equal(msg.type, 'summary-done');
  if (msg.type === 'summary-done') {
    assert.match(msg.text ?? '', /已回退到 deepseek-v4-flash/);
    assert.match(msg.text ?? '', /## 报告/);
    assert.equal(msg.model, 'deepseek-v4-flash');
  }
});

test('analyze failure → a summary-error with the message', async () => {
  const { ws, frames } = fakeWs();
  const deps: SummarizeDeps = {
    analyze: async () => {
      throw new Error('DashScope 500: boom');
    }
  };
  await handleSummarize(ws, () => '面试记录…', 'req-err', deps);

  const msg = frames[0];
  assert.equal(msg.type, 'summary-error');
  if (msg.type === 'summary-error') {
    assert.equal(msg.requestId, 'req-err');
    assert.match(msg.message, /boom/);
  }
});

test('telemetry: the happy path records requested → input-built, then delegates to analyze', async () => {
  const { ws } = fakeWs();
  const tel = createSummaryTelemetry({ now: () => 0 });
  // The injected analyze stands in for analyzeSummary, which (in production) owns
  // the model-call-* + done events. The stub mimics that so the full lifecycle is
  // observable end-to-end through the SAME recorder the wrapper threads in.
  const deps: SummarizeDeps = {
    analyze: async (_input, d) => {
      d?.telemetry?.record('done', { requestId: d.requestId });
      return ok('## 报告');
    },
    telemetry: tel
  };
  await handleSummarize(ws, () => '面试记录…', 'req-tel', deps);

  const types = tel.snapshot().map((e) => e.type);
  // The wrapper owns requested + input-built; the recorder is threaded into analyze
  // so its done lands in the SAME log (end-to-end observability).
  assert.ok(types.includes('requested'), `missing requested: ${types.join(',')}`);
  assert.ok(types.includes('input-built'), `missing input-built: ${types.join(',')}`);
  assert.ok(types.includes('done'), `missing done: ${types.join(',')}`);
  // input-built carries the built length, and the recorder threaded through to analyze.
  const built = tel.snapshot().find((e) => e.type === 'input-built');
  assert.ok((built?.inputChars ?? 0) > 0);
});

test('telemetry: the empty case records requested but NOT a model call', async () => {
  const { ws } = fakeWs();
  const tel = createSummaryTelemetry({ now: () => 0 });
  const deps: SummarizeDeps = { analyze: async () => ok('x'), telemetry: tel };
  await handleSummarize(ws, () => '', 'req-e', deps);

  const types = tel.snapshot().map((e) => e.type);
  assert.ok(types.includes('requested'));
  assert.ok(!types.includes('model-call-start'), 'no model call on empty');
  // It still resolves as done (the friendly notice was "produced").
  assert.ok(types.includes('done'));
});

test('telemetry: an error records an error event', async () => {
  const { ws } = fakeWs();
  const tel = createSummaryTelemetry({ now: () => 0 });
  const deps: SummarizeDeps = {
    analyze: async () => {
      throw new Error('nope');
    },
    telemetry: tel
  };
  await handleSummarize(ws, () => '面试记录…', 'req-e2', deps);
  const types = tel.snapshot().map((e) => e.type);
  assert.ok(types.includes('error'), `missing error: ${types.join(',')}`);
});

// ── Streaming path (Feature 1) ───────────────────────────────────────────────

test('streaming path: summary-chunk events emitted per delta, no text on summary-done', async () => {
  const { ws, frames } = fakeWs();

  const analyzeStream = async (
    _input: string,
    callbacks: StreamCallbacks,
    _deps: { telemetry?: unknown; requestId?: string; model?: string }
  ): Promise<SummaryResult> => {
    callbacks.onDelta('## 候选人');
    callbacks.onDelta('概况\n不错。');
    callbacks.onUsage({ input: 10, output: 20 });
    return { text: '## 候选人概况\n不错。', model: 'deepseek-v4-pro', fellBack: false };
  };

  const deps: SummarizeDeps = { analyzeStream };
  await handleSummarize(ws, () => '面试记录…', 'req-stream', deps);

  const chunks = frames.filter((f) => f.type === 'summary-chunk');
  const done = frames.find((f) => f.type === 'summary-done');

  assert.equal(chunks.length, 2, 'should emit one chunk per delta');
  if (chunks[0].type === 'summary-chunk') assert.equal(chunks[0].text, '## 候选人');
  if (chunks[1].type === 'summary-chunk') assert.equal(chunks[1].text, '概况\n不错。');

  assert.ok(done, 'should emit summary-done at the end');
  if (done?.type === 'summary-done') {
    assert.equal(done.requestId, 'req-stream');
    // In streaming mode, text is absent on summary-done (client has accumulated it).
    assert.equal(done.text, undefined);
    assert.equal(done.model, 'deepseek-v4-pro');
    assert.notEqual(done.empty, true);
  }
});

test('streaming path fellBack: a notice chunk is emitted before summary-done', async () => {
  const { ws, frames } = fakeWs();

  const analyzeStream = async (
    _input: string,
    callbacks: StreamCallbacks,
    _deps: { telemetry?: unknown; requestId?: string; model?: string }
  ): Promise<SummaryResult> => {
    callbacks.onDelta('# 报告');
    callbacks.onUsage({ input: 5, output: 10 });
    return { text: '# 报告', model: 'deepseek-v4-flash', fellBack: true };
  };

  await handleSummarize(ws, () => '面试记录…', 'req-fb-stream', { analyzeStream });

  const chunks = frames.filter((f) => f.type === 'summary-chunk');
  // One delta chunk + one notice chunk prepended for fellBack.
  const noticeChunk = chunks.find(
    (c) => c.type === 'summary-chunk' && c.text.includes('已回退到 deepseek-v4-flash')
  );
  assert.ok(noticeChunk, 'fallback notice should be emitted as a chunk');
  const done = frames.find((f) => f.type === 'summary-done');
  assert.ok(done);
  if (done?.type === 'summary-done') {
    assert.equal(done.model, 'deepseek-v4-flash');
  }
});

test('streaming path error → summary-error (no chunks sent after failure)', async () => {
  const { ws, frames } = fakeWs();

  const analyzeStream = async (): Promise<SummaryResult> => {
    throw new Error('stream broken');
  };

  await handleSummarize(ws, () => '面试记录…', 'req-err-stream', { analyzeStream });

  const chunks = frames.filter((f) => f.type === 'summary-chunk');
  assert.equal(chunks.length, 0, 'no chunks on hard failure');
  const errMsg = frames.find((f) => f.type === 'summary-error');
  assert.ok(errMsg);
  if (errMsg?.type === 'summary-error') {
    assert.match(errMsg.message, /stream broken/);
  }
});

// ── Feature 2: per-session model override ────────────────────────────────────

test('Feature 2: summaryModel in deps is forwarded to analyzeStream', async () => {
  const { ws } = fakeWs();
  let capturedModel: string | undefined;

  const analyzeStream = async (
    _input: string,
    callbacks: StreamCallbacks,
    deps: { telemetry?: unknown; requestId?: string; model?: string }
  ): Promise<SummaryResult> => {
    capturedModel = deps.model;
    callbacks.onDelta('ok');
    callbacks.onUsage({ input: 1, output: 1 });
    return { text: 'ok', model: deps.model ?? 'deepseek-v4-pro', fellBack: false };
  };

  await handleSummarize(ws, () => '面试记录…', 'req-model', {
    analyzeStream,
    summaryModel: 'deepseek-v4-flash'
  });

  assert.equal(capturedModel, 'deepseek-v4-flash', 'selected model must be forwarded');
});

// ── Feature 3: per-session custom system prompt ───────────────────────────────

test('Feature 3: resolveSummarySystemPrompt — non-empty custom prompt is used as-is', () => {
  const custom = 'You are a brief interviewer.';
  assert.equal(resolveSummarySystemPrompt(custom), custom);
});

test('Feature 3: resolveSummarySystemPrompt — empty string falls back to SUMMARY_SYSTEM', () => {
  assert.equal(resolveSummarySystemPrompt(''), SUMMARY_SYSTEM);
  assert.equal(resolveSummarySystemPrompt('   '), SUMMARY_SYSTEM);
});

test('Feature 3: resolveSummarySystemPrompt — undefined falls back to SUMMARY_SYSTEM', () => {
  assert.equal(resolveSummarySystemPrompt(undefined), SUMMARY_SYSTEM);
});

test('Feature 3: summarySystemPrompt in deps is forwarded to analyzeStream', async () => {
  const { ws } = fakeWs();
  let capturedDeps: AnalyzeSummaryStreamDeps & { model?: string } = {};

  const analyzeStream = async (
    _input: string,
    callbacks: StreamCallbacks,
    deps: AnalyzeSummaryStreamDeps & { model?: string }
  ): Promise<SummaryResult> => {
    capturedDeps = deps;
    callbacks.onDelta('ok');
    callbacks.onUsage({ input: 1, output: 1 });
    return { text: 'ok', model: 'deepseek-v4-pro', fellBack: false };
  };

  const customPrompt = 'Be concise. One sentence summary only.';
  await handleSummarize(ws, () => '面试记录…', 'req-prompt', {
    analyzeStream,
    summarySystemPrompt: customPrompt
  });

  assert.equal(capturedDeps.summarySystemPrompt, customPrompt, 'custom prompt must reach analyzeStream');
});

test('Feature 3: empty summarySystemPrompt in deps is forwarded (falls back inside resolveSummarySystemPrompt)', async () => {
  const { ws } = fakeWs();
  let capturedPrompt: string | undefined = 'sentinel';

  const analyzeStream = async (
    _input: string,
    callbacks: StreamCallbacks,
    deps: AnalyzeSummaryStreamDeps & { model?: string }
  ): Promise<SummaryResult> => {
    capturedPrompt = deps.summarySystemPrompt;
    callbacks.onDelta('ok');
    callbacks.onUsage({ input: 1, output: 1 });
    return { text: 'ok', model: 'deepseek-v4-pro', fellBack: false };
  };

  // No summarySystemPrompt in deps → should be undefined (and resolveSummarySystemPrompt
  // inside analyzeSummaryStream will pick the default).
  await handleSummarize(ws, () => '面试记录…', 'req-no-prompt', { analyzeStream });

  assert.equal(capturedPrompt, undefined, 'absent prompt must arrive as undefined, not a string');
});

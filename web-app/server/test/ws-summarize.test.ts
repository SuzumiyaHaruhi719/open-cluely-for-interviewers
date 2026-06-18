import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleSummarize, type SummarizeDeps } from '../src/ws';
import { createSummaryTelemetry } from '../src/summary-telemetry';
import type { ServerMessage } from '@open-cluely/contract';
import type { SummaryResult } from '../src/interview-analysis';

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

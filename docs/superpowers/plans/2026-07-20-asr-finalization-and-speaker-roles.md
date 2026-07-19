# ASR Finalization and Speaker Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Xunfei the truthful default ASR, preserve provider final transcripts during stop/reconnect, and automatically finalize interviewer/candidate roles after sufficient evidence.

**Architecture:** Change the common ASR session contract from fire-and-forget `stop(): void` to bounded asynchronous `stop(): Promise<AsrStopResult>`. Provider clients send their final frame, wait for the provider terminal event or timeout, and only then close. The relay serializes stop/reconnect per source and emits explicit runtime status. The existing Flash speaker partitioner runs only after drain completion and retains native cluster IDs.

**Tech Stack:** Node 20, TypeScript, `ws`, Node test runner through `tsx --test`, Zod WebSocket protocol validation.

## Global Constraints

- Xunfei is the default ASR; no silent fallback.
- Use native speaker IDs when available and preserve over-clustering.
- Use `deepseek-v4-flash` only for semantic role mapping after enough evidence.
- Do not add CAM++.
- Stop waits are bounded and never hang a WebSocket connection.
- Provider errors must not look like healthy live capture.
- No credentials enter renderer payloads or logs.
- Every task ends with a focused commit and push to `origin/main`.

---

## File structure

- Modify `web-app/packages/contract/index.d.ts` and `index.js` — runtime ASR status messages and Xunfei-default documentation.
- Modify `web-app/server/src/asr-relay.ts` — async source lifecycle and status emission.
- Modify `web-app/server/src/paraformer-client.ts` — terminal-event drain.
- Modify `web-app/server/src/volc-client.ts` — final-frame/terminal drain.
- Modify `web-app/server/src/xfyun-client.ts` — end-frame drain while accepting final result frames.
- Modify `web-app/server/src/sim-client.ts` — immediate compatible stop result.
- Modify `web-app/server/src/ws.ts` — await stop before final role partition and configure-time reconnect.
- Modify `web-app/server/test/*client.test.ts`, `asr-relay.test.ts`, and WebSocket integration tests.
- Modify `web-app/web/src/lib/messages.ts`, `useCopilotSocket.ts`, and capture UI to render runtime status.

### Task 1: Define the asynchronous stop/result contract

**Files:**
- Modify: `web-app/server/src/asr-relay.ts`
- Modify: `web-app/server/src/sim-client.ts`
- Modify: `web-app/server/test/asr-relay.test.ts`

**Interfaces:**
- Produces: `AsrStopResult { finalReceived: boolean; timedOut: boolean; reason?: string }`.
- Produces: `AsrSession.stop(): Promise<AsrStopResult>`.
- Produces: `AsrRelay.handleAudioControl(control): Promise<AsrStopResult | null>`.

- [ ] **Step 1: Write a relay test proving stop waits for the fake session**

```ts
let releaseStop!: () => void;
const stopped = new Promise<void>((resolve) => { releaseStop = resolve; });
const session = {
  isReady: true,
  sendAudio() {},
  async stop() {
    await stopped;
    return { finalReceived: true, timedOut: false };
  }
};
const stopPromise = relay.handleAudioControl({ action: 'stop', source: 'mic' });
assert.equal(relay.isCapturing(), true);
releaseStop();
assert.deepEqual(await stopPromise, { finalReceived: true, timedOut: false });
assert.equal(relay.isCapturing(), false);
```

- [ ] **Step 2: Run the relay test and confirm `stop(): void` fails the contract**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="stop waits"`

Expected: FAIL on the old synchronous session interface.

- [ ] **Step 3: Add the shared result and async relay lifecycle**

```ts
export interface AsrStopResult {
  finalReceived: boolean;
  timedOut: boolean;
  reason?: string;
}

export interface AsrSession {
  sendAudio(pcm: Buffer): void;
  stop(): Promise<AsrStopResult>;
  readonly isReady: boolean;
}
```

Keep the session in `sessions[source]` while it drains. Set it to `null` only in `finally`; concurrent stop calls share the same pending promise and audio frames are ignored once stopping begins.

- [ ] **Step 4: Make Sim return immediately**

```ts
async stop(): Promise<AsrStopResult> {
  clearPendingTimers();
  return { finalReceived: true, timedOut: false };
}
```

- [ ] **Step 5: Run relay and Sim tests**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="ASR relay|sim"`

Expected: PASS with deterministic stop results.

- [ ] **Step 6: Commit and push the lifecycle contract**

```bash
git add web-app/server/src/asr-relay.ts web-app/server/src/sim-client.ts web-app/server/test/asr-relay.test.ts web-app/server/test/sim-client.test.ts
git commit -m "refactor: make ASR shutdown await finalization"
git push origin main
```

### Task 2: Drain provider terminal events instead of terminating immediately

**Files:**
- Modify: `web-app/server/src/paraformer-client.ts`
- Modify: `web-app/server/src/volc-client.ts`
- Modify: `web-app/server/src/xfyun-client.ts`
- Modify: `web-app/server/test/paraformer-client.test.ts`
- Modify: `web-app/server/test/volc-client.test.ts`
- Modify: `web-app/server/test/xfyun-client.test.ts`

**Interfaces:**
- Consumes: `AsrStopResult` from Task 1.
- Produces: provider `stop()` implementations with a 1500 ms default drain timeout.

- [ ] **Step 1: Add one terminal-drain test per provider**

```ts
const stop = session.stop();
assert.equal(ws.terminated, false);
ws.receive(taskFinishedFrameWithFinalTranscript('最后一句'));
assert.deepEqual(await stop, { finalReceived: true, timedOut: false });
assert.deepEqual(finals, ['最后一句']);
```

For Xunfei, assert the end frame is sent and a later result frame carrying `speakerId` is still delivered before close. For Volc, assert the final audio/config sequence is sent before close.

- [ ] **Step 2: Run all three client suites and confirm immediate termination failures**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="Paraformer|Volc|Xunfei"`

Expected: FAIL because current clients mark `finished` and terminate immediately.

- [ ] **Step 3: Implement a single-settle drain promise in each client**

```ts
let stopPromise: Promise<AsrStopResult> | null = null;
function stop(): Promise<AsrStopResult> {
  if (stopPromise) return stopPromise;
  stopPromise = new Promise((resolve) => {
    sendFinishFrame();
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ finalReceived, timedOut: true, reason: 'provider finalization timeout' });
    }, stopTimeoutMs);
    settleStop = (result) => {
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
  });
  return stopPromise;
}
```

Do not set the flag that drops late frames until the terminal provider frame is processed. `onError` settles pending stop exactly once.

- [ ] **Step 4: Add bounded-timeout tests**

Use an injected timer or `stopTimeoutMs: 5` and assert `{ timedOut:true }` plus socket termination when the provider never responds.

- [ ] **Step 5: Run client tests and server typecheck**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="Paraformer|Volc|Xunfei" && npm run typecheck --workspace @open-cluely/server`

Expected: PASS with no unhandled promise or interface mismatch.

- [ ] **Step 6: Commit and push provider final draining**

```bash
git add web-app/server/src/paraformer-client.ts web-app/server/src/volc-client.ts web-app/server/src/xfyun-client.ts web-app/server/test/paraformer-client.test.ts web-app/server/test/volc-client.test.ts web-app/server/test/xfyun-client.test.ts
git commit -m "fix: drain final ASR results before closing"
git push origin main
```

### Task 3: Finalize speaker roles only after ASR drain

**Files:**
- Modify: `web-app/server/src/ws.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Create: `web-app/server/test/ws-audio-finalization.test.ts`

**Interfaces:**
- Consumes: async `handleAudioControl()` and existing `SpeakerPartitioner.finalize()`.
- Produces: ordered stop sequence `provider drain -> final transcript ingestion -> Flash final partition -> capture stopped`.

- [ ] **Step 1: Write an ordering integration test**

```ts
const order: string[] = [];
relay.handleAudioControl = async () => {
  order.push('drain-start');
  emitFinal({ text: '最后一句回答', speakerId: 1 });
  order.push('drain-done');
  return { finalReceived: true, timedOut: false };
};
partitioner.finalize = async () => { order.push('partition'); };
await dispatchAudioStop();
assert.deepEqual(order, ['drain-start', 'drain-done', 'partition']);
```

- [ ] **Step 2: Run the new integration test and confirm finalization races stop**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="audio finalization"`

Expected: FAIL because `speakerLifecycle.finalize()` currently starts without awaiting provider drain.

- [ ] **Step 3: Await stop and then finalize**

```ts
case 'audio-control': {
  const result = await asrRelay.handleAudioControl(msg);
  trigger.setCapturing(asrRelay.isCapturing());
  if (msg.action === 'stop' && !asrRelay.isCapturing()) {
    await speakerLifecycle.finalize();
    send(ws, { type: 'asr-status', source: msg.source, state: result?.timedOut ? 'partial' : 'stopped' });
  }
  break;
}
```

Update dispatch plumbing to return/await a promise while preserving per-connection message ordering.

- [ ] **Step 4: Strengthen evidence thresholds without recording-specific rules**

Keep native IDs and allow multiple IDs per role. Require either two content-bearing turns per seen ID or at least six total final turns before live assignment; always run once on final stop when at least two content-bearing turns exist.

- [ ] **Step 5: Run speaker and WebSocket tests**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="speaker|audio finalization|ws"`

Expected: PASS; final segment appears in the partition input.

- [ ] **Step 6: Commit and push ordered finalization**

```bash
git add web-app/server/src/ws.ts web-app/server/src/speaker-partitioner.ts web-app/server/test/speaker-partitioner.test.ts web-app/server/test/ws-audio-finalization.test.ts
git commit -m "fix: finalize speaker roles after ASR drain"
git push origin main
```

### Task 4: Report truthful provider capability and runtime status

**Files:**
- Modify: `web-app/packages/contract/index.d.ts`
- Modify: `web-app/packages/contract/index.js`
- Create: `web-app/server/src/asr-capabilities.ts`
- Modify: `web-app/server/src/routes/health.ts`
- Modify: `web-app/server/test/health.test.ts`
- Modify: `web-app/web/src/lib/api.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.ts`
- Modify: `web-app/web/src/lib/messages.ts`
- Modify: capture/status components and tests.

**Interfaces:**
- Produces: health `asrProviders: Record<'xfyun'|'paraformer'|'volc', { configured:boolean; available:boolean; reason?:string }>`.
- Produces: `ServerMessage { type:'asr-status'; source; provider; state:'connecting'|'live'|'finalizing'|'stopped'|'partial'|'failed'; message?:string }`.

- [ ] **Step 1: Add health and message parsing tests**

```ts
assert.equal(body.asrProviders.xfyun.configured, true);
expect(parseServerMessage(JSON.stringify({
  type: 'asr-status', source: 'mic', provider: 'xfyun', state: 'failed', message: '鉴权失败'
}))).toMatchObject({ type: 'asr-status', state: 'failed' });
```

- [ ] **Step 2: Confirm tests fail before the capability/status contract exists**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="health" && npm test --workspace @open-cluely/web -- --run src/lib/messages.test.ts`

Expected: FAIL on missing fields/message type.

- [ ] **Step 3: Implement non-secret capability reporting**

```ts
export function getAsrCapabilities(): AsrCapabilities {
  return {
    xfyun: { configured: hasXfyunCredentials(), available: hasXfyunCredentials() },
    paraformer: { configured: hasDashScopeKey(), available: false, reason: '启动捕获时验证模型权限' },
    volc: { configured: hasVolcCredentials(), available: hasVolcCredentials() }
  };
}
```

Configuration presence is not runtime health. On upstream open/error/terminal events, emit `asr-status`; only an actual successful provider start may set `live`.

- [ ] **Step 4: Render runtime status and gate unavailable options**

The client Settings list shows only configured/available providers, with Xunfei selected by default. A failed status overrides the optimistic local capture flag and displays the concise server reason.

- [ ] **Step 5: Run server/web suites and build**

Run: `cd web-app && npm test && npm run build`

Expected: PASS; direct upstream rejection can no longer leave the UI labelled “实时”.

- [ ] **Step 6: Commit and push capability truthfulness**

```bash
git add web-app/packages/contract web-app/server/src/asr-capabilities.ts web-app/server/src/routes/health.ts web-app/server/test/health.test.ts web-app/web/src
git commit -m "feat: surface truthful ASR runtime health"
git push origin main
```

### Task 5: Update notes and verify with the supplied local recording

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/asr-pipeline.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-offline-speaker-diarization.md`

**Interfaces:**
- Produces: implementation notes and an auditable real-audio result.

- [ ] **Step 1: Update notes with Purpose, Entry points, Data flow, Config/state, and Gotchas**

Record the async drain invariant, timeout behavior, native-ID preservation, over-clustering, and final partition ordering.

- [ ] **Step 2: Run server release gates**

Run: `cd web-app && npm run test:server && npm run typecheck --workspace @open-cluely/server && npm run build --workspace @open-cluely/server`

Expected: PASS.

- [ ] **Step 3: Replay `/tmp/interviewer-copilot-source-16k.wav` through Xunfei**

Expected evidence: no transport error; the final transcript is retained; native IDs include candidate 1 and examiner/announcer 2/3; semantic mapping assigns 1 to candidate and 2/3 to interviewer without ID-specific prompt rules.

- [ ] **Step 4: Verify stop timing and transcript completeness**

Record source duration, elapsed time, number of finals, speaker switches, final segment text, stop result, and partition status. Treat a drain timeout or missing final segment as a release blocker.

# Offline Speaker Diarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In offline (single room-mic) interview mode, label every spoken segment interviewer-vs-candidate with a self-hosted FunASR streaming service, render speaker-coloured bubbles, and gate Generate-Q to candidate speech only.

**Architecture:** Add a 3rd ASR provider `funasr` to the existing pluggable relay (`asr-relay.ts`), pointed at a self-hosted FunASR streaming-SPK WebSocket (`serve_realtime_ws.py`) that returns `{sentences:[{text,spk}], partial, is_final}`. A per-connection `SpeakerRoleMap` maps cluster ids → interviewer/candidate; `ws.ts` stamps the role on each `transcript` and feeds only candidate finals to the trigger/analysis path. The web client renders speaker lanes and a one-tap role toggle, and wires offline single-mic routing (currently unwired on web).

**Tech Stack:** TypeScript, Node `ws`, zod, `node:test`+`tsx --test` (server), Vitest + React (web), Docker Compose, FunASR (self-hosted).

**Spec:** `docs/superpowers/specs/2026-06-03-offline-speaker-diarization-design.md`

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `web-app/packages/contract/index.js` | Add `funasr` to `ASR_PROVIDERS`; add `SET_SPEAKER_ROLE` C2S tag | Modify |
| `web-app/packages/contract/index.d.ts` | `speaker`/`speakerId` on transcript; `funasrUrl` on SessionConfig; `SpeakerRole`; `set-speaker-role` msg | Modify |
| `web-app/server/src/speaker-roles.ts` | Pure per-session cluster-id → role map | **Create** |
| `web-app/server/src/funasr-client.ts` | FunASR streaming-SPK WS client (mirrors paraformer-client surface) | **Create** |
| `web-app/server/src/asr-relay.ts` | `funasr` provider branch; carry `speakerId` on the transcript emit | Modify |
| `web-app/server/src/config.ts` | `FUNASR_WS_URL` env default | Modify |
| `web-app/server/src/ws.ts` | funasr in zod + `applyAsrConfig`; resolve role + gate candidate finals; `set-speaker-role` dispatch | Modify |
| `web-app/web/src/lib/messages.ts` | Parse `speaker`/`speakerId` on transcript | Modify |
| `web-app/web/src/lib/useCopilotSocket.ts` | Offline speaker-segment list + role-override map + `setSpeakerRole()` | Modify |
| `web-app/web/src/desktop/TranscriptStream.tsx` | Render offline speaker bubbles + role toggle | Modify |
| `web-app/web/src/desktop/Shell.tsx` | Thread `interviewType`; offline single-mic routing | Modify |
| `web-app/web/src/desktop/Composer.tsx` | Hide display channel + relabel mic when offline | Modify |
| `web-app/web/src/web-extras.css` | Role-toggle chip styles | Modify |
| `web-app/docker-compose.yml`, `web-app/DEPLOY.md`, `web-app/.env.example` | FunASR service + docs + attribution | Modify |

**Shared types (defined in Task 1, used everywhere — keep names identical):**
- `SpeakerRole = 'interviewer' | 'candidate' | 'unknown'`
- `AsrProvider = 'paraformer' | 'volc' | 'funasr'`
- transcript adds `speakerId?: number | null` and `speaker?: SpeakerRole`
- `FunasrTranscript = { text: string; isFinal: boolean; speakerId: number | null }`
- `set-speaker-role` C2S: `{ type: 'set-speaker-role'; speakerId: number; role: SpeakerRole }`

---

## Phase 0 — Spike: stand up FunASR + pin the WS protocol

### Task 0: Confirm the streaming-SPK server + its start frame

**Files:** none (spike notes appended to the spec's "Open questions" section).

- [ ] **Step 1: Run the FunASR streaming-SPK service locally**

```bash
# GPU box (recommended). See docs/vllm_guide.md §6 in modelscope/FunASR.
docker run --rm --gpus all -p 10096:10096 \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12 \
  bash -c "cd /workspace/FunASR/runtime && python -m funasr.bin.serve_realtime_ws --port 10096 --spk true"
```
Expected: a WS server listening on `:10096` (path per docs, e.g. `/ws`). If the image/entrypoint differs, follow `runtime/docs/SDK_tutorial_online.md` + `docs/vllm_guide.md` §6.3.

- [ ] **Step 2: Capture the exact START frame + result frames**

Connect a throwaway `wscat`/python client, send a start JSON + a PCM16 16 kHz file + `"STOP"`, and record: (a) the exact start-frame JSON keys the server accepts, (b) a sample result frame. Confirm result matches `{"sentences":[{"text","start","end","spk"}],"partial":"…","is_final":false}`.

- [ ] **Step 3: Write the findings into the spec**

Append the confirmed start-frame JSON + WS path under "Open questions / spikes" in `docs/superpowers/specs/2026-06-03-offline-speaker-diarization-design.md`. Task 4 below uses this exact start frame.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-03-offline-speaker-diarization-design.md
git commit -m "docs(spec): pin FunASR serve_realtime_ws start frame + WS path from spike"
```

> If the start frame differs from Task 4's `buildStartFrame()`, update only that function — the unit tests assert our framing/parsing logic, not the server's bytes, so they stay valid.

---

## Phase 1 — Server: provider, role map, gating

### Task 1: Contract — speaker fields, funasr provider, set-speaker-role

**Files:**
- Modify: `web-app/packages/contract/index.js`
- Modify: `web-app/packages/contract/index.d.ts`

- [ ] **Step 1: Add the C2S tag + funasr provider (index.js)**

In `web-app/packages/contract/index.js`, add `SET_SPEAKER_ROLE` to the `C2S` map and `'funasr'` to the providers list:

```javascript
// Client -> server message type tags.
const C2S = Object.freeze({
  CONFIGURE: 'configure',
  ANALYZE: 'analyze',
  AUDIO: 'audio',
  AUDIO_CONTROL: 'audio-control',
  SET_SPEAKER_ROLE: 'set-speaker-role'
});

// Realtime ASR providers the relay supports.
const ASR_PROVIDERS = Object.freeze(['paraformer', 'volc', 'funasr']);
```
(If `ASR_PROVIDERS` does not yet exist, add it next to the `C2S`/`S2C` exports and include it in `module.exports`.)

- [ ] **Step 2: Add the types (index.d.ts)**

In `web-app/packages/contract/index.d.ts`:

```typescript
export type AsrProvider = 'paraformer' | 'volc' | 'funasr';
export type SpeakerRole = 'interviewer' | 'candidate' | 'unknown';
```
Extend the `transcript` S2C member and add the new C2S member in the `ServerMessage`/`ClientMessage` unions:

```typescript
// S2C transcript (was: { type:'transcript'; source; text; isFinal })
| { type: 'transcript'; source: AudioSource; text: string; isFinal: boolean; speakerId?: number | null; speaker?: SpeakerRole }

// C2S new member
| { type: 'set-speaker-role'; speakerId: number; role: SpeakerRole }
```
Add `funasrUrl` to `SessionConfig` (and ensure `asrProvider?: AsrProvider`):

```typescript
  /** FunASR streaming-SPK WS URL (used only when asrProvider === 'funasr'). */
  funasrUrl?: string;
```

- [ ] **Step 3: Commit**

```bash
git add web-app/packages/contract/index.js web-app/packages/contract/index.d.ts
git commit -m "feat(contract): funasr provider, transcript speaker fields, set-speaker-role"
```

---

### Task 2: SpeakerRoleMap (pure, per-session)

**Files:**
- Create: `web-app/server/src/speaker-roles.ts`
- Test: `web-app/server/test/speaker-roles.test.ts`

- [ ] **Step 1: Write the failing test**

`web-app/server/test/speaker-roles.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerRoleMap } from '../src/speaker-roles.ts';

test('first speaker seen defaults to interviewer, second to candidate', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(0), 'interviewer');
  assert.equal(m.resolve(1), 'candidate');
  assert.equal(m.resolve(0), 'interviewer'); // stable
});

test('further speakers default to candidate', () => {
  const m = createSpeakerRoleMap();
  m.resolve(0); m.resolve(1);
  assert.equal(m.resolve(2), 'candidate');
});

test('null/unknown speaker id resolves to unknown without consuming a slot', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(null), 'unknown');
  assert.equal(m.resolve(0), 'interviewer'); // first real id still becomes interviewer
});

test('setRole overrides the default and sticks', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(0), 'interviewer');
  m.setRole(0, 'candidate');
  assert.equal(m.resolve(0), 'candidate');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/server`
Expected: FAIL — `Cannot find module '../src/speaker-roles.ts'`.

- [ ] **Step 3: Implement**

`web-app/server/src/speaker-roles.ts`:

```typescript
import type { SpeakerRole } from '@open-cluely/contract';

export interface SpeakerRoleMap {
  /** Map a FunASR cluster id to a role; null ids are 'unknown'. First real id
   *  seen becomes 'interviewer' (they open the interview), the rest 'candidate'. */
  resolve(speakerId: number | null): SpeakerRole;
  /** One-tap correction: pin a cluster id to a role. */
  setRole(speakerId: number, role: SpeakerRole): void;
}

export function createSpeakerRoleMap(): SpeakerRoleMap {
  const roles = new Map<number, SpeakerRole>();
  const order: number[] = [];

  function defaultFor(id: number): SpeakerRole {
    if (!order.includes(id)) order.push(id);
    return order[0] === id ? 'interviewer' : 'candidate';
  }

  return {
    resolve(speakerId) {
      if (speakerId === null || speakerId === undefined) return 'unknown';
      return roles.get(speakerId) ?? defaultFor(speakerId);
    },
    setRole(speakerId, role) {
      if (!order.includes(speakerId)) order.push(speakerId);
      roles.set(speakerId, role);
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/server`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add web-app/server/src/speaker-roles.ts web-app/server/test/speaker-roles.test.ts
git commit -m "feat(server): per-session speaker cluster-id -> role map"
```

---

### Task 3: FunASR client — result parsing (locked sentences + partial + speaker)

**Files:**
- Create: `web-app/server/src/funasr-client.ts`
- Test: `web-app/server/test/funasr-client.test.ts`

- [ ] **Step 1: Write the failing test**

`web-app/server/test/funasr-client.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WsLike, WsConstructor } from '../src/funasr-client.ts';
import { createFunasrSession } from '../src/funasr-client.ts';

class FakeWs implements WsLike {
  static OPEN = 1;
  static instances: FakeWs[] = [];
  readyState = FakeWs.OPEN;
  sent: Array<string | Buffer> = [];
  private listeners: Record<string, Array<(...a: any[]) => void>> = {};
  constructor(public url: string) { FakeWs.instances.push(this); }
  on(e: string, l: (...a: any[]) => void) { (this.listeners[e] ??= []).push(l); }
  send(d: string | Buffer) { this.sent.push(d); }
  close() { this.emit('close'); }
  emit(e: string, ...a: any[]) { for (const fn of this.listeners[e] ?? []) fn(...a); }
}
const FakeWsCtor = FakeWs as unknown as WsConstructor;

test('locked sentences emit once as finals carrying their speaker id', () => {
  FakeWs.instances = [];
  const got: Array<{ text: string; isFinal: boolean; speakerId: number | null }> = [];
  createFunasrSession({ WebSocket: FakeWsCtor, url: 'ws://x', onTranscript: (t) => got.push(t) });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ sentences: [{ text: '你好', spk: 0 }], partial: '世界', is_final: false }), false);
  ws.emit('message', JSON.stringify({ sentences: [{ text: '你好', spk: 0 }, { text: '请坐', spk: 1 }], partial: '', is_final: false }), false);

  assert.deepEqual(got, [
    { text: '世界', isFinal: false, speakerId: null }, // partial after msg 1
    { text: '你好', isFinal: true, speakerId: 0 },      // new locked sentence 1
    { text: '请坐', isFinal: true, speakerId: 1 }       // new locked sentence 2 (msg 2)
  ]);
});

test('stop sends the STOP sentinel', () => {
  FakeWs.instances = [];
  const s = createFunasrSession({ WebSocket: FakeWsCtor, url: 'ws://x', onTranscript: () => {} });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  s.stop();
  assert.ok(ws.sent.some((m) => typeof m === 'string' && m.includes('STOP')));
});
```

> Note the ordering: a locked sentence is emitted only the first time it appears; `partial` is emitted on each frame that carries non-empty partial text. The first frame emits its partial then (next frame) the newly-locked sentence — adjust the expected array only if the spike shows the server locks differently.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/server`
Expected: FAIL — `Cannot find module '../src/funasr-client.ts'`.

- [ ] **Step 3: Implement**

`web-app/server/src/funasr-client.ts` (mirrors `paraformer-client.ts`'s `WsLike`/`WsConstructor` + factory shape):

```typescript
export interface WsLike {
  readonly readyState: number;
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
}
export interface WsConstructor {
  new (url: string, options?: { headers?: Record<string, string> }): WsLike;
  readonly OPEN: number;
}

export interface FunasrTranscript { text: string; isFinal: boolean; speakerId: number | null; }

export interface FunasrSessionDeps {
  WebSocket: WsConstructor;
  url: string;
  sampleRate?: number;     // browser worklet emits 16 kHz
  speakerNum?: number;     // optional hint
  onTranscript: (t: FunasrTranscript) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}
export interface FunasrSession {
  sendAudio(pcm: Buffer): void;
  stop(): void;
  readonly isReady: boolean;
}

/** Start frame per docs/vllm_guide.md §6.3 — CONFIRM field names in Task 0. */
export function buildStartFrame(deps: FunasrSessionDeps): string {
  return JSON.stringify({
    mode: '2pass',
    chunk_size: [5, 10, 5],
    wav_format: 'pcm',
    audio_fs: deps.sampleRate ?? 16000,
    is_speaking: true,
    spk: true,
    ...(deps.speakerNum ? { speaker_num: deps.speakerNum } : {})
  });
}

export function createFunasrSession(deps: FunasrSessionDeps): FunasrSession {
  const ws = new deps.WebSocket(deps.url);
  let ready = false;
  let lockedCount = 0;   // how many locked sentences we've already emitted

  ws.on('open', () => {
    ready = true;
    ws.send(buildStartFrame(deps));
    deps.onReady?.();
  });
  ws.on('error', (err: unknown) => deps.onError?.(err instanceof Error ? err.message : String(err)));
  ws.on('message', (raw: unknown) => {
    let msg: any;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw!.toString()); } catch { return; }
    const partial: string = typeof msg.partial === 'string' ? msg.partial : '';
    if (partial) deps.onTranscript({ text: partial, isFinal: false, speakerId: null });
    const sentences: any[] = Array.isArray(msg.sentences) ? msg.sentences : [];
    for (let i = lockedCount; i < sentences.length; i++) {
      const s = sentences[i];
      deps.onTranscript({
        text: String(s?.text ?? ''),
        isFinal: true,
        speakerId: typeof s?.spk === 'number' ? s.spk : null
      });
    }
    lockedCount = Math.max(lockedCount, sentences.length);
  });

  return {
    sendAudio(pcm: Buffer) { if (ready) ws.send(pcm); },
    stop() { try { ws.send('STOP'); } finally { ws.close(); } },
    get isReady() { return ready; }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/server`
Expected: PASS (2 new tests).

- [ ] **Step 5: Commit**

```bash
git add web-app/server/src/funasr-client.ts web-app/server/test/funasr-client.test.ts
git commit -m "feat(server): FunASR streaming-SPK WS client (locked sentences + partial + spk)"
```

---

### Task 4: config — FUNASR_WS_URL env default

**Files:**
- Modify: `web-app/server/src/config.ts`

- [ ] **Step 1: Add the field**

In the frozen `config` object in `web-app/server/src/config.ts`, add next to the Volc fallbacks:

```typescript
  // FunASR streaming-SPK WS URL fallback — per-session configure wins.
  funasrWsUrl: String(process.env.FUNASR_WS_URL ?? '').trim(),
```
Add `funasrWsUrl: string` to the `ServerConfig` interface.

- [ ] **Step 2: Commit**

```bash
git add web-app/server/src/config.ts
git commit -m "feat(server): FUNASR_WS_URL env default"
```

---

### Task 5: Relay — funasr provider branch + carry speakerId on the emit

**Files:**
- Modify: `web-app/server/src/asr-relay.ts`
- Test: `web-app/server/test/asr-relay.test.ts`

- [ ] **Step 1: Write the failing test** (append to `asr-relay.test.ts`)

```typescript
test('funasr provider emits transcripts carrying the speaker id', () => {
  const emits: any[] = [];
  const created: any[] = [];
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: 'k',
    sessionFactory: () => { throw new Error('paraformer factory should not run'); },
    funasrSessionFactory: (deps: any) => {
      const s = { isReady: true, sendAudio() {}, stop() {}, deps };
      created.push(s);
      return s;
    }
  });
  relay.setAsrProvider('funasr', undefined, { url: 'ws://funasr:10096' });
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  created[0].deps.onTranscript({ text: '你好', isFinal: true, speakerId: 1 });

  assert.deepEqual(emits, [{ source: 'mic', text: '你好', isFinal: true, speakerId: 1 }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/server`
Expected: FAIL — `funasrSessionFactory` not accepted / provider 'funasr' not started.

- [ ] **Step 3: Implement**

In `asr-relay.ts`:
1. Extend the relay deps with `funasrSessionFactory?` (default `createFunasrSession`) and import it. Add `funasrUrl` to the relay's provider state.
2. Extend `setAsrProvider` to a 3rd arg: `setAsrProvider(provider: AsrProvider, volc?: VolcCredentials, funasr?: { url: string }): void` — store `funasrUrl = funasr?.url ?? config.funasrWsUrl`.
3. Add `startFunasr(source)` and branch in `startSource`:

```typescript
function startSource(source: AudioSource): void {
  if (disposed || sessions[source]) return;
  if (provider === 'volc') startVolc(source);
  else if (provider === 'funasr') startFunasr(source);
  else startParaformer(source);
}

function startFunasr(source: AudioSource): void {
  sessions[source] = funasrSessionFactory({
    WebSocket: WebSocketCtor,
    url: funasrUrl,
    sampleRate: 16000,
    onTranscript: (t) => onTranscript(source, t),
    onError: (message) => onError(source, message)
  }) as unknown as ProviderSession;
}
```
4. Widen the emit to carry `speakerId` (the field is optional, so paraformer/volc emits are unchanged):

```typescript
function onTranscript(source: AudioSource, t: { text: string; isFinal: boolean; speakerId?: number | null }): void {
  deps.emit({ source, text: t.text, isFinal: t.isFinal, speakerId: t.speakerId ?? undefined });
```
Add `speakerId?: number | null` to the `TranscriptEmit` type.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/server`
Expected: PASS — new test green; existing paraformer/volc relay tests still green (emit now has an optional `speakerId`, absent for them).

> If an existing relay test does `assert.deepEqual` on emits without `speakerId`, that still passes because the field is `undefined` and omitted by the spread above. If a test fails on an extra key, the implementation above omits `speakerId` when nullish — keep it that way.

- [ ] **Step 5: Commit**

```bash
git add web-app/server/src/asr-relay.ts web-app/server/test/asr-relay.test.ts
git commit -m "feat(server): relay funasr provider branch + speakerId passthrough"
```

---

### Task 6: ws.ts — funasr config, role stamping, candidate-only gating, set-speaker-role

**Files:**
- Modify: `web-app/server/src/ws.ts`
- Test: `web-app/server/test/ws-speaker.test.ts`

- [ ] **Step 1: Write the failing test**

`web-app/server/test/ws-speaker.test.ts` — unit-test the two pure helpers ws.ts will expose (`resolveTranscriptRole`, `shouldGateToAnalysis`) so we don't need a live socket:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerRoleMap } from '../src/speaker-roles.ts';
import { stampRole, isCandidateFinal } from '../src/ws-speaker.ts';

test('stampRole adds resolved role + keeps speakerId', () => {
  const roles = createSpeakerRoleMap();
  const out = stampRole(roles, { source: 'mic', text: 'hi', isFinal: true, speakerId: 0 });
  assert.deepEqual(out, { source: 'mic', text: 'hi', isFinal: true, speakerId: 0, speaker: 'interviewer' });
});

test('isCandidateFinal: only final candidate segments gate to analysis', () => {
  const roles = createSpeakerRoleMap();
  roles.resolve(0); // interviewer
  assert.equal(isCandidateFinal(roles, { isFinal: true, speakerId: 1 }), true);  // candidate final
  assert.equal(isCandidateFinal(roles, { isFinal: false, speakerId: 1 }), false); // candidate partial
  assert.equal(isCandidateFinal(roles, { isFinal: true, speakerId: 0 }), false);  // interviewer final
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/server`
Expected: FAIL — `Cannot find module '../src/ws-speaker.ts'`.

- [ ] **Step 3: Implement the helpers**

`web-app/server/src/ws-speaker.ts`:

```typescript
import type { SpeakerRole } from '@open-cluely/contract';
import type { SpeakerRoleMap } from './speaker-roles.ts';

interface Emit { source?: string; text?: string; isFinal: boolean; speakerId?: number | null; }

export function stampRole<T extends Emit>(roles: SpeakerRoleMap, t: T): T & { speaker: SpeakerRole } {
  return { ...t, speaker: roles.resolve(t.speakerId ?? null) };
}

export function isCandidateFinal(roles: SpeakerRoleMap, t: Emit): boolean {
  return t.isFinal === true && roles.resolve(t.speakerId ?? null) === 'candidate';
}
```

- [ ] **Step 4: Wire into ws.ts**

In `web-app/server/src/ws.ts`:
1. `import { createSpeakerRoleMap } from './speaker-roles.ts';` and `import { stampRole, isCandidateFinal } from './ws-speaker.ts';`
2. Per-connection: `const roles = createSpeakerRoleMap();` alongside `relay`/`trigger`/`session`.
3. Zod: add `funasrUrl: z.string().optional()` to `sessionConfigSchema`, and `asrProvider: z.enum(['paraformer', 'volc', 'funasr']).optional()`. Add a `set-speaker-role` member to `clientMessageSchema`: `z.object({ type: z.literal('set-speaker-role'), speakerId: z.number(), role: z.enum(['interviewer','candidate','unknown']) })`.
4. `applyAsrConfig`: when `cfg.funasrUrl` present (or `cfg.asrProvider==='funasr'`), call `relay.setAsrProvider('funasr', undefined, { url: cfg.funasrUrl ?? '' })`.
5. The relay emit callback (currently `send(ws, { type:'transcript', source: t.source, text: t.text, isFinal: t.isFinal })`) becomes:

```typescript
emit: (t) => {
  const stamped = stampRole(roles, t);
  send(ws, { type: 'transcript', source: stamped.source, text: stamped.text, isFinal: stamped.isFinal, speakerId: stamped.speakerId, speaker: stamped.speaker });
  // Offline funasr: only candidate finals feed the interviewee-answer path (the
  // online analogue is display finals). Interviewer segments never auto-trigger.
  if (isCandidateFinal(roles, t)) trigger.onIntervieweeFinal?.(stamped.text ?? '');
}
```
(Use whatever method the trigger/auto-analyze path already exposes for a finalized interviewee answer — match the call the `display`-final path uses.)
6. Dispatch: add `case 'set-speaker-role': roles.setRole(msg.speakerId, msg.role); return;`

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace @open-cluely/server`
Expected: PASS — 2 new helper tests; existing ws/relay tests still green.

- [ ] **Step 6: Commit**

```bash
git add web-app/server/src/ws.ts web-app/server/src/ws-speaker.ts web-app/server/test/ws-speaker.test.ts
git commit -m "feat(server): stamp speaker role on transcripts, gate candidate finals, set-speaker-role"
```

---

## Phase 2 — Web: parse, render, toggle, offline routing

### Task 7: messages.ts — parse speaker fields

**Files:**
- Modify: `web-app/web/src/lib/messages.ts`
- Test: `web-app/web/src/lib/messages.test.ts` (if absent, create it)

- [ ] **Step 1: Write the failing test** (append)

```typescript
import { describe, it, expect } from 'vitest';
import { parseServerMessage } from './messages';

describe('transcript speaker fields', () => {
  it('carries speaker + speakerId through', () => {
    const out = parseServerMessage({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate' });
    expect(out).toEqual({ type: 'transcript', source: 'mic', text: 'hi', isFinal: true, speakerId: 1, speaker: 'candidate' });
  });
  it('still parses transcripts with no speaker (online)', () => {
    const out = parseServerMessage({ type: 'transcript', source: 'display', text: 'hi', isFinal: false });
    expect(out).toMatchObject({ type: 'transcript', source: 'display', text: 'hi', isFinal: false });
  });
});
```
(Use the real exported parser name from messages.ts; the agent saw a `switch` keyed by `S2C.TRANSCRIPT`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/web`
Expected: FAIL — speaker/speakerId dropped.

- [ ] **Step 3: Implement**

In the `S2C.TRANSCRIPT` branch of `messages.ts`, include the optional fields when present:

```typescript
return {
  type: 'transcript',
  source: data.source,
  text: data.text,
  isFinal: data.isFinal,
  ...(typeof data.speakerId === 'number' ? { speakerId: data.speakerId } : {}),
  ...(data.speaker === 'interviewer' || data.speaker === 'candidate' || data.speaker === 'unknown' ? { speaker: data.speaker } : {})
};
```
Extend the client-side transcript message type with optional `speakerId?: number; speaker?: SpeakerRole`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/lib/messages.ts web-app/web/src/lib/messages.test.ts
git commit -m "feat(web): parse transcript speaker/speakerId"
```

---

### Task 8: useCopilotSocket — offline speaker segments + role override + setSpeakerRole

**Files:**
- Modify: `web-app/web/src/lib/useCopilotSocket.ts`
- Test: `web-app/web/src/lib/useCopilotSocket.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCopilotSocket } from './useCopilotSocket';
// Drive the socket's message handler with a transcript carrying a speaker, then
// assert speakerSegments holds an ordered candidate/interviewer line, and that
// setSpeakerRole(id,'candidate') flips a segment's effective role.

describe('offline speaker segments', () => {
  it('appends finalized speaker-tagged segments in order', () => {
    const { result } = renderHook(() => useCopilotSocket('ws://x'));
    act(() => result.current._test_onMessage({ type: 'transcript', source: 'mic', text: '你好', isFinal: true, speakerId: 0, speaker: 'interviewer' }));
    act(() => result.current._test_onMessage({ type: 'transcript', source: 'mic', text: '我做过分布式', isFinal: true, speakerId: 1, speaker: 'candidate' }));
    expect(result.current.speakerSegments.map((s) => [s.role, s.text])).toEqual([
      ['interviewer', '你好'],
      ['candidate', '我做过分布式']
    ]);
  });

  it('setSpeakerRole re-labels all segments of a cluster id', () => {
    const { result } = renderHook(() => useCopilotSocket('ws://x'));
    act(() => result.current._test_onMessage({ type: 'transcript', source: 'mic', text: 'a', isFinal: true, speakerId: 0, speaker: 'interviewer' }));
    act(() => result.current.setSpeakerRole(0, 'candidate'));
    expect(result.current.speakerSegments[0].role).toBe('candidate');
  });
});
```
(If the hook has no test seam, expose a tiny `_test_onMessage` in test builds, or refactor the message handler into an exported pure reducer and unit-test that instead — preferred. The agent saw the handler as an inline `switch`; extract `applyMessage(state, msg)` and test it directly.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/web`
Expected: FAIL — `speakerSegments` / `setSpeakerRole` undefined.

- [ ] **Step 3: Implement**

Add to the hook's state + handler:

```typescript
export interface SpeakerSegment { id: number; speakerId: number | null; role: SpeakerRole; text: string; }

// state
const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);
const roleOverrideRef = useRef<Map<number, SpeakerRole>>(new Map());
const segSeq = useRef(0);

function effectiveRole(speakerId: number | null, serverRole: SpeakerRole | undefined): SpeakerRole {
  if (speakerId !== null && roleOverrideRef.current.has(speakerId)) return roleOverrideRef.current.get(speakerId)!;
  return serverRole ?? 'unknown';
}

// in the 'transcript' case, AFTER the existing lane update:
if (message.isFinal && (message.speaker !== undefined || message.speakerId !== undefined)) {
  const speakerId = message.speakerId ?? null;
  const role = effectiveRole(speakerId, message.speaker);
  setSpeakerSegments((prev) => [...prev, { id: segSeq.current++, speakerId, role, text: message.text }]);
}
```
Expose `setSpeakerRole`:

```typescript
const setSpeakerRole = useCallback((speakerId: number, role: SpeakerRole) => {
  roleOverrideRef.current.set(speakerId, role);
  setSpeakerSegments((prev) => prev.map((s) => (s.speakerId === speakerId ? { ...s, role } : s)));
  sendRef.current?.({ type: 'set-speaker-role', speakerId, role }); // also fix server-side gating
}, []);
```
Return `speakerSegments` and `setSpeakerRole` from the hook. Reset `speakerSegments`/`roleOverrideRef` in the same place the lanes reset on a new session.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/lib/useCopilotSocket.ts web-app/web/src/lib/useCopilotSocket.test.ts
git commit -m "feat(web): offline speaker segments + client role-override + setSpeakerRole"
```

---

### Task 9: TranscriptStream — render offline speaker bubbles + role toggle

**Files:**
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: `web-app/web/src/web-extras.css`
- Test: `web-app/web/src/desktop/TranscriptStream.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TranscriptStream } from './TranscriptStream';

describe('offline speaker bubbles', () => {
  it('renders candidate/interviewer bubbles and fires the role toggle', () => {
    const onSetRole = vi.fn();
    render(
      <TranscriptStream
        offline
        speakerSegments={[{ id: 1, speakerId: 0, role: 'interviewer', text: '你好' }]}
        onSetSpeakerRole={onSetRole}
        /* other required props as the component already declares them */
      />
    );
    expect(screen.getByText('你好')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /候选人|candidate/i }));
    expect(onSetRole).toHaveBeenCalledWith(0, 'candidate');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/web`
Expected: FAIL — `offline`/`speakerSegments`/`onSetSpeakerRole` props don't exist.

- [ ] **Step 3: Implement**

Reuse the existing `LaneLine` (its `lane` prop is `'candidate' | 'interviewer'`). When `offline`, render `speakerSegments` instead of the two source lanes, mapping `role` → lane (role `'unknown'` → `'candidate'` for display). Add a one-tap toggle on the bubble:

```tsx
function roleToLane(role: SpeakerRole): 'candidate' | 'interviewer' {
  return role === 'interviewer' ? 'interviewer' : 'candidate';
}

// in render, when `offline`:
{speakerSegments.map((seg) => (
  <div key={seg.id} className={`chat-message lane-${roleToLane(seg.role)} has-role-toggle`}>
    <div className="message-header">
      <span className="message-icon" aria-hidden="true">{seg.role === 'interviewer' ? '●' : '◐'}</span>
      <span className="message-label">{seg.role === 'interviewer' ? '面试官' : '候选人'}</span>
      {seg.speakerId !== null && (
        <button
          type="button"
          className="speaker-role-toggle"
          onClick={() => onSetSpeakerRole(seg.speakerId!, seg.role === 'interviewer' ? 'candidate' : 'interviewer')}
        >
          {seg.role === 'interviewer' ? '标为候选人' : '标为面试官'}
        </button>
      )}
    </div>
    <div className="message-content">{seg.text}</div>
  </div>
))}
```
Add the prop types `offline?: boolean; speakerSegments?: SpeakerSegment[]; onSetSpeakerRole?: (speakerId: number, role: SpeakerRole) => void;`. Online mode is unchanged (props default off / undefined). Add `.speaker-role-toggle` chip styling in `web-extras.css` (small, reuses `--lane-accent`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/desktop/TranscriptStream.tsx web-app/web/src/web-extras.css web-app/web/src/desktop/TranscriptStream.test.tsx
git commit -m "feat(web): offline speaker bubbles + one-tap role toggle"
```

---

### Task 10: Shell + Composer — offline single-mic routing

**Files:**
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/desktop/Composer.tsx`
- Test: `web-app/web/src/desktop/Shell.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```typescript
// In Shell.test.tsx, render Shell for an offline session and assert:
//  - the "computer audio" (display) channel is NOT rendered
//  - the mic channel is relabelled to a room mic
//  - configure was sent with asrProvider 'funasr' + funasrUrl from settings
it('offline session hides display channel, relabels mic, configures funasr', async () => {
  // arrange: mount Shell with a loaded offline session + a funasrUrl setting
  // act: wait for configure
  // assert per above (match the existing Shell.test.tsx harness style)
});
```
(Flesh out using the existing `Shell.test.tsx` harness — it already mounts Shell, stubs the socket, and asserts `configure` payloads.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @open-cluely/web`
Expected: FAIL — display channel still present offline / no funasr configure.

- [ ] **Step 3: Implement**

1. Thread `interviewType` from the loaded/created session into Shell render state (it's currently only used at create — Shell.tsx:410).
2. Pass `offline={interviewType === 'offline'}` to `Composer` and `TranscriptStream`; pass `speakerSegments`/`onSetSpeakerRole` (from `useCopilotSocket`) to `TranscriptStream`.
3. In `Composer.tsx`, when `offline`: render only the mic `ChannelCard` with `title="房间麦克风 / Room mic"` (hide the `display` card).
4. In Shell's `fullConfigRef` configure effect, when offline set `asrProvider: 'funasr'` + `funasrUrl` (from `useAppSettings`); online keeps the current provider. Add a `funasrUrl` field to the Settings model + a Settings input (mirror the Volc creds fields).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @open-cluely/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/desktop/Shell.tsx web-app/web/src/desktop/Composer.tsx web-app/web/src/desktop/Shell.test.tsx
git commit -m "feat(web): offline single-mic routing + funasr configure"
```

---

## Phase 3 — Deploy + attribution

### Task 11: docker-compose FunASR service + docs + attribution

**Files:**
- Modify: `web-app/docker-compose.yml`, `web-app/.env.example`, `web-app/DEPLOY.md`

- [ ] **Step 1: Add the service** (compose)

```yaml
  funasr:
    image: registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12
    command: ["bash","-lc","cd /workspace/FunASR/runtime && python -m funasr.bin.serve_realtime_ws --port 10096 --spk true"]
    ports: ["10096:10096"]
    # GPU: uncomment for low-latency streaming SPK
    # deploy: { resources: { reservations: { devices: [{ capabilities: [gpu] }] } } }
```
Point the server at it: add `FUNASR_WS_URL=ws://funasr:10096` to the server service env.

- [ ] **Step 2: .env.example + DEPLOY.md + attribution**

Add `FUNASR_WS_URL=` to `.env.example`. In `DEPLOY.md`: a "Offline speaker diarization (FunASR)" section — GPU recommended / CPU fallback (per-turn labels), the exact image, and the **attribution line** required by `MODEL_LICENSE` §2.2: *"Speech recognition & speaker diarization powered by FunASR (Paraformer / CAM++), © Alibaba Group, used under the FunASR Model License."*

- [ ] **Step 3: Commit**

```bash
git add web-app/docker-compose.yml web-app/.env.example web-app/DEPLOY.md
git commit -m "chore(deploy): FunASR streaming-SPK service + offline-mode docs + attribution"
```

---

## Phase 4 — Integration

### Task 12: End-to-end against the live FunASR server

**Files:** none (manual verification; record results in the spec).

- [ ] **Step 1:** `cd web-app && docker compose up funasr server`, open the SPA, start an **offline** interview, share/speak two voices into the room mic.
- [ ] **Step 2:** Verify the transcript shows candidate (teal) + interviewer (amber) bubbles; the first-speaker default is interviewer; the one-tap toggle re-labels a cluster.
- [ ] **Step 3:** Verify Generate-Q fires only after **candidate** finals, never on the interviewer's own speech.
- [ ] **Step 4:** Kill the funasr container mid-session → verify the UI shows the error and degrades to label-less mic transcription (interview not blocked).
- [ ] **Step 5:** Record latency + accuracy + the chosen model in the spec's "Open questions" section; commit that note.

---

## Self-Review

**1. Spec coverage:**
- 3rd provider `funasr` → Tasks 1,3,4,5. Live per-sentence spk → Task 3. Role map (first-seen + one-tap) → Tasks 2,6,8,9. Candidate-only Generate-Q gating → Task 6. Web offline single-mic routing → Task 10. Speaker-coloured bubbles → Task 9. Degradation when FunASR down → Tasks 6 (error path) + 12 (verify). Deploy + attribution → Task 11. License/protocol spikes → Task 0 + 12. **All spec sections covered.**

**2. Placeholder scan:** No "TBD"/"add error handling" — error paths are concrete (onError in Task 3, degradation in Task 6/12). Test bodies are real. The one judgement call (`trigger.onIntervieweeFinal?.`) is flagged to match the existing display-final call — acceptable, it names the exact existing seam to reuse.

**3. Type consistency:** `SpeakerRole`, `AsrProvider`, `FunasrTranscript {text,isFinal,speakerId}`, transcript `speakerId?/speaker?`, `set-speaker-role {speakerId,role}`, `setAsrProvider(provider, volc?, funasr?)`, `createSpeakerRoleMap().resolve/setRole`, `speakerSegments`/`setSpeakerRole` — names are identical across Tasks 1→11.

**4. Known soft spots (resolve during execution):** exact FunASR start-frame (Task 0 gates Task 3's `buildStartFrame`); the trigger's interviewee-final method name (Task 6); whether messages.ts exposes a pure parser vs inline switch (Task 7/8 prefer extracting a pure reducer to test).

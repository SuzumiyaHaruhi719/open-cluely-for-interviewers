# Qwen Audio 3.0 TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only, capability-gated Qwen Audio 3.0 TTS service with visible Plus/Flash selection and optional interviewer-controlled playback of generated Chinese questions.

**Architecture:** Implement the DashScope WebSocket protocol behind a small `TtsService` interface; credentials, endpoint, voice, and entitlement remain server-side. A capability endpoint reports only model availability. A binary HTTP synthesis endpoint returns audio for a bounded validated Chinese text payload and an allowlisted selected model. Settings shows both Qwen models and disables unavailable entitlements. The client exposes a non-autoplay “朗读” action on generated questions.

**Tech Stack:** Node 20, TypeScript, `ws`, Express, Node test runner, React/Vitest, browser `Audio` playback.

## Global Constraints

- Support model identifiers `qwen-audio-3.0-tts-plus` and `qwen-audio-3.0-tts-flash`.
- Plus is the default; both Plus and Flash remain visible choices.
- Capability probes independently enable each model; never alias Flash to Plus or Plus to Flash.
- Credentials, endpoint, and voice are server environment values only.
- Empty voice is rejected before provider connection; default to a verified built-in voice.
- Chinese is the product/output default.
- TTS never autoplays and never blocks capture, finalization, speaker mapping, or manual interviewing.
- Every task ends with a focused commit and push to `origin/main`.

---

## File structure

- Modify `web-app/server/src/config.ts` — TTS environment configuration.
- Create `web-app/server/src/qwen-tts.ts` — WebSocket protocol and audio assembly.
- Create `web-app/server/test/qwen-tts.test.ts` — protocol, validation, timeout, and entitlement tests.
- Create `web-app/server/src/routes/tts.ts` — capability and synthesis HTTP routes.
- Create `web-app/server/test/tts-route.test.ts` — secret-safe API tests.
- Modify `web-app/server/src/app.ts` — mount TTS router.
- Modify `web-app/web/src/lib/api.ts` and tests — capability/synthesis wrappers.
- Modify `web-app/web/src/desktop/useAppSettings.ts` and tests — persisted allowlisted `ttsModel`.
- Modify `web-app/web/src/desktop/SettingsModal.tsx` and tests — visible Plus/Flash selector and capability state.
- Modify `web-app/web/src/desktop/QuestionCard.tsx` and tests — opt-in playback.
- Create `web-app/web/src/lib/useQuestionSpeech.ts` and test — object-URL lifecycle and concurrency.

### Task 1: Add server-only TTS configuration and validation

**Files:**
- Modify: `web-app/server/src/config.ts`
- Create: `web-app/server/test/tts-config.test.ts`

**Interfaces:**
- Produces: `ttsWsUrl`, `ttsDefaultModel`, `ttsVoice`, and `ttsTimeoutMs` on `ServerConfig`.
- Produces: `getTtsConfig(): ValidTtsConfig | { available:false; reason:string }`.

- [ ] **Step 1: Write configuration validation tests**

```ts
assert.deepEqual(validateTtsConfig({ apiKey: 'sk', voice: '' }), {
  available: false,
  reason: 'TTS voice is not configured'
});
assert.equal(validateTtsConfig({ apiKey: 'sk', voice: 'longanlingxi' }).available, true);
```

- [ ] **Step 2: Run the focused test and confirm the validator is absent**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="TTS config"`

Expected: FAIL because the TTS configuration fields/helper do not exist.

- [ ] **Step 3: Add environment-only config**

```ts
ttsWsUrl: String(process.env.DASHSCOPE_TTS_WS_URL ?? '').trim() || 'wss://llm-opv63ugogbbsgk6i.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
ttsDefaultModel: String(process.env.QWEN_TTS_MODEL ?? '').trim() || 'qwen-audio-3.0-tts-plus',
ttsVoice: String(process.env.QWEN_TTS_VOICE ?? '').trim() || 'longanlingxi',
ttsTimeoutMs: toInt(process.env.QWEN_TTS_TIMEOUT_MS, 10000)
```

Reuse the server DashScope key. Do not expose these fields in `/api/health`, renderer state, logs, or WebSocket configure.

- [ ] **Step 4: Run config tests and typecheck**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="TTS config" && npm run typecheck --workspace @open-cluely/server`

Expected: PASS.

- [ ] **Step 5: Commit and push TTS configuration**

```bash
git add web-app/server/src/config.ts web-app/server/test/tts-config.test.ts
git commit -m "feat: configure Qwen TTS on the server"
git push origin main
```

### Task 2: Implement the Qwen Audio WebSocket client

**Files:**
- Create: `web-app/server/src/qwen-tts.ts`
- Create: `web-app/server/test/qwen-tts.test.ts`

**Interfaces:**
- Produces: `QwenTtsModel = 'qwen-audio-3.0-tts-plus' | 'qwen-audio-3.0-tts-flash'`.
- Produces: `synthesizeQwenTts(input, deps): Promise<{ audio:Buffer; contentType:'audio/mpeg'; model; elapsedMs }>`.

- [ ] **Step 1: Write protocol success, provider error, and timeout tests with a fake WebSocket**

```ts
const result = await synthesizeQwenTts({
  text: '请具体说明您在这个项目中的个人决策。',
  model: 'qwen-audio-3.0-tts-plus',
  voice: 'longanlingxi'
}, fakeDeps);
assert.ok(result.audio.length > 0);
assert.equal(result.model, 'qwen-audio-3.0-tts-plus');
assert.equal(result.contentType, 'audio/mpeg');
```

Assert an empty voice rejects before WebSocket construction, Flash entitlement error is returned as `TtsUnavailableError`, and timeout closes the socket exactly once.

- [ ] **Step 2: Run the focused test and confirm the client is absent**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="Qwen TTS"`

Expected: FAIL because `qwen-tts.ts` does not exist.

- [ ] **Step 3: Implement protocol framing and audio assembly**

```ts
export async function synthesizeQwenTts(input: TtsInput, deps: TtsDeps): Promise<TtsAudio> {
  const text = input.text.trim();
  if (!text || text.length > 500) throw new TtsInputError('朗读文本长度必须为 1–500 字符');
  if (!input.voice.trim()) throw new TtsInputError('TTS voice is not configured');
  // connect with Authorization: Bearer <server key>
  // send run-task with model/voice/audio format
  // send continue-task text, then finish-task
  // append binary/audio payloads until task-finished
  // settle once, enforcing deps.timeoutMs
}
```

Model and voice values come from validated server allowlists, not arbitrary client input.

- [ ] **Step 4: Run protocol tests and typecheck**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="Qwen TTS" && npm run typecheck --workspace @open-cluely/server`

Expected: PASS with no unhandled socket events.

- [ ] **Step 5: Commit and push the TTS client**

```bash
git add web-app/server/src/qwen-tts.ts web-app/server/test/qwen-tts.test.ts
git commit -m "feat: synthesize speech with Qwen Audio 3.0"
git push origin main
```

### Task 3: Add capability-gated TTS HTTP routes

**Files:**
- Create: `web-app/server/src/routes/tts.ts`
- Create: `web-app/server/test/tts-route.test.ts`
- Modify: `web-app/server/src/app.ts`

**Interfaces:**
- Produces: `GET /api/tts/capabilities -> { defaultModel; models: [{id; available; reason?}] }`.
- Produces: `POST /api/tts/synthesize { text; model } -> audio/mpeg` using only an allowlisted, currently available model.

- [ ] **Step 1: Write route security/capability tests**

```ts
const capabilities = await (await fetch(`${base}/api/tts/capabilities`)).json();
assert.equal(capabilities.defaultModel, 'qwen-audio-3.0-tts-plus');
assert.equal(JSON.stringify(capabilities).includes('sk-'), false);
assert.equal(JSON.stringify(capabilities).includes('longanlingxi'), false);

const res = await fetch(`${base}/api/tts/synthesize`, post({ text: '请介绍一个具体案例。', model: 'qwen-audio-3.0-tts-plus' }));
assert.equal(res.headers.get('content-type'), 'audio/mpeg');
assert.ok((await res.arrayBuffer()).byteLength > 0);
```

- [ ] **Step 2: Run route tests and confirm missing endpoints**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="TTS route"`

Expected: FAIL with 404.

- [ ] **Step 3: Implement cached capability probes and synthesis route**

```ts
router.get('/capabilities', async (_req, res) => res.json(await capabilities.getPublicStatus()));
router.post('/synthesize', async (req, res, next) => {
  try {
    const text = textSchema.parse(req.body).text;
    const result = await service.synthesize(text);
    res.type(result.contentType).set('Cache-Control', 'no-store').send(result.audio);
  } catch (error) {
    next(toPublicTtsError(error));
  }
});
```

Probe Plus and Flash independently. Cache results for five minutes; invalidate the selected model after provider denial. Client input may choose only the two allowlisted IDs and never an unavailable model.

- [ ] **Step 4: Run route tests, server suite, and build**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="TTS" && npm run build --workspace @open-cluely/server`

Expected: PASS; error bodies contain no key, endpoint token, or raw provider frame.

- [ ] **Step 5: Commit and push TTS routes**

```bash
git add web-app/server/src/routes/tts.ts web-app/server/test/tts-route.test.ts web-app/server/src/app.ts
git commit -m "feat: expose capability-gated question speech"
git push origin main
```

### Task 4: Add opt-in generated-question playback

**Files:**
- Modify: `web-app/web/src/lib/api.ts`
- Modify: `web-app/web/src/lib/api.test.ts`
- Create: `web-app/web/src/lib/useQuestionSpeech.ts`
- Create: `web-app/web/src/lib/useQuestionSpeech.test.tsx`
- Modify: `web-app/web/src/desktop/QuestionCard.tsx`
- Modify: `web-app/web/src/desktop/QuestionCard.test.tsx`

**Interfaces:**
- Produces: `synthesizeQuestion(text, model): Promise<Blob>`.
- Produces: `useQuestionSpeech() { state:'idle'|'loading'|'playing'|'error'; play(text); stop() }`.

- [ ] **Step 1: Write object-URL and non-autoplay tests**

```tsx
render(<QuestionCard result={result} />);
expect(synthesizeQuestion).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole('button', { name: '朗读追问' }));
await waitFor(() => expect(synthesizeQuestion).toHaveBeenCalledWith(result.output.primary_question, 'qwen-audio-3.0-tts-plus'));
expect(audio.play).toHaveBeenCalledTimes(1);
```

Assert a second play stops/revokes the previous object URL and unmount revokes any remaining URL.

- [ ] **Step 2: Run focused web tests and confirm playback is absent**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/useQuestionSpeech.test.tsx src/desktop/QuestionCard.test.tsx src/lib/api.test.ts`

Expected: FAIL until the hook/action exist.

- [ ] **Step 3: Implement safe playback lifecycle**

```ts
const blob = await synthesizeQuestion(text, model);
const url = URL.createObjectURL(blob);
const audio = new Audio(url);
audio.onended = cleanup;
audio.onerror = failAndCleanup;
await audio.play();
```

Use the existing icon library for the action. Render `正在生成语音`, `停止朗读`, or a concise Chinese failure; never autoplay and never persist the audio.

- [ ] **Step 4: Run focused tests and web build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/useQuestionSpeech.test.tsx src/desktop/QuestionCard.test.tsx src/lib/api.test.ts && npm run build --workspace @open-cluely/web`

Expected: PASS.

- [ ] **Step 5: Commit and push playback**

```bash
git add web-app/web/src/lib/api.ts web-app/web/src/lib/api.test.ts web-app/web/src/lib/useQuestionSpeech.ts web-app/web/src/lib/useQuestionSpeech.test.tsx web-app/web/src/desktop/QuestionCard.tsx web-app/web/src/desktop/QuestionCard.test.tsx
git commit -m "feat: read generated interview questions aloud"
git push origin main
```

### Task 5: Live capability, audio validity, and round-trip verification

**Files:**
- Create: `web-app/server/scripts/probe-qwen-tts.ts`
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/qwen-audio-tts.md`

**Interfaces:**
- Produces: a non-secret JSON report per model with entitlement, elapsed time, bytes, duration, and ASR round-trip text.

- [ ] **Step 1: Add a probe that uses the production adapter**

```ts
interface ProbeRow {
  model: QwenTtsModel;
  available: boolean;
  elapsedMs?: number;
  bytes?: number;
  durationMs?: number;
  roundTripText?: string;
  publicReason?: string;
}
```

- [ ] **Step 2: Run release tests first**

Run: `cd web-app && npm test && npm run build`

Expected: PASS.

- [ ] **Step 3: Probe both models with the environment account**

Run: `cd web-app && npx tsx server/scripts/probe-qwen-tts.ts`

Acceptance: Plus produces valid non-empty MP3 and intelligible Xunfei round trip; Flash is either independently valid or explicitly unavailable. No secret appears in output.

- [ ] **Step 4: Exercise playback in the in-app browser**

Generate a Chinese Expert question, click `朗读追问`, verify the audio starts only after the click, stop/replay works, capture remains usable, and a provider failure leaves the interview workflow operational.

- [ ] **Step 5: Write the implementation note**

Include Purpose, Entry points, Data flow, Config/state, Gotchas, capability cache, voice validation, object-URL cleanup, and non-blocking failure behavior.

- [ ] **Step 6: Commit and push probe tooling**

```bash
git add web-app/server/scripts/probe-qwen-tts.ts
git commit -m "test: probe Qwen TTS capabilities and quality"
git push origin main
```

# Doubao-Only ASR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Xunfei and all interviewer-facing ASR/Auto controls so every normal interview uses Doubao Seed ASR 2.0 Duration with automatic Expert follow-ups enabled.

**Architecture:** Product policy becomes fixed in the renderer and Electron startup instead of browser/state preferences. The server keeps Paraformer as internal compatibility and `sim` for deterministic QA, but removes the Xunfei client, credentials, protocol member, capability, and routing branch. Doubao native speaker IDs use semantic role mapping without first-seen guessing.

**Tech Stack:** React 18, TypeScript, Vitest, Node test runner, Zod WebSocket protocol, Electron/CommonJS, Volcengine Seed ASR 2.0.

## Global Constraints

- Normal interviews always configure `asrProvider: 'volc'` and `autoGenerate: true`.
- Settings and the top bar expose neither an ASR provider control nor an Auto-follow-up control.
- `volc.seedasr.sauc.duration` remains server/environment owned; credentials never move into browser state.
- Xunfei must disappear from active code, contracts, capabilities, settings, and runtime state.
- Paraformer remains internal and `sim` remains test-only.
- Work directly on `main`; commit and push each independently verified checkpoint.

---

### Task 1: Fix web product policy and remove both controls

**Files:**
- Modify: `web-app/web/src/desktop/useAppSettings.test.tsx`
- Modify: `web-app/web/src/desktop/SettingsModal.test.tsx`
- Modify: `web-app/web/src/desktop/Topbar.test.tsx`
- Modify: `web-app/web/src/desktop/Shell.test.tsx`
- Modify: `web-app/web/src/desktop/useAppSettings.ts`
- Modify: `web-app/web/src/desktop/SettingsModal.tsx`
- Modify: `web-app/web/src/desktop/Topbar.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`

**Interfaces:**
- Consumes: `SessionConfig.asrProvider`, `SessionConfig.autoGenerate`, microphone and summary-model preferences.
- Produces: fixed `{ asrProvider: 'volc', autoGenerate: true }` normal-session configuration and a Settings modal containing only microphone and evaluation-model controls.

- [ ] **Step 1: Write failing preference tests**

Add assertions that retired keys are purged and no longer appear in returned settings:

```ts
localStorage.setItem('open-cluely.asrProvider', 'xfyun');
localStorage.setItem('open-cluely.autoGenerate', 'false');
const { result } = renderHook(() => useAppSettings());
expect(result.current.settings).not.toHaveProperty('asrProvider');
expect(result.current.settings).not.toHaveProperty('autoGenerate');
expect(localStorage.getItem('open-cluely.asrProvider')).toBeNull();
expect(localStorage.getItem('open-cluely.autoGenerate')).toBeNull();
```

- [ ] **Step 2: Write failing UI and configuration tests**

Assert Settings has no `语音识别`, `自动追问`, Xunfei, or Paraformer control; Topbar has no `auto-indicator`; and the first/full configuration is fixed:

```ts
expect(screen.queryByLabelText('语音识别')).not.toBeInTheDocument();
expect(screen.queryByRole('checkbox', { name: '自动追问' })).not.toBeInTheDocument();
expect(document.getElementById('auto-indicator')).toBeNull();
expect(lastConfig(ws)).toMatchObject({ asrProvider: 'volc', autoGenerate: true });
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test --workspace @open-cluely/web -- --run src/desktop/useAppSettings.test.tsx src/desktop/SettingsModal.test.tsx src/desktop/Topbar.test.tsx src/desktop/Shell.test.tsx
```

Expected: failures show the current Xunfei default/provider selector and Auto controls still exist.

- [ ] **Step 4: Implement the minimal fixed web policy**

Remove ASR/Auto keys and setters from `useAppSettings`, add both keys to `RETIRED_KEYS`, simplify Settings/Topbar props, and make Shell configuration explicit:

```ts
const FIXED_ASR_PROVIDER: AsrProvider = 'volc';
const FIXED_AUTO_GENERATE = true;

fullConfigRef.current = {
  ...EXPERT_CONFIG,
  asrProvider: FIXED_ASR_PROVIDER,
  diarize: true,
  autoGenerate: FIXED_AUTO_GENERATE,
  autoMode: 'agent',
  summaryModel: s.summaryModel
};
```

Keep test-only simulation injection at the test boundary rather than in Settings.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all four files pass.

- [ ] **Step 6: Commit and push**

```bash
git add web-app/web/src/desktop
git commit -m "feat: fix Doubao and Auto as product policy"
git push origin main
```

---

### Task 2: Remove Xunfei from the web protocol and server runtime

**Files:**
- Modify: `web-app/packages/contract/index.js`
- Modify: `web-app/packages/contract/index.d.ts`
- Modify: `web-app/web/src/lib/messages.test.ts`
- Modify: `web-app/web/src/lib/messages.ts`
- Modify: `web-app/server/test/health.test.ts`
- Modify: `web-app/server/test/asr-relay.test.ts`
- Modify: `web-app/server/test/ws-audio-finalization.test.ts`
- Modify: `web-app/server/src/config.ts`
- Modify: `web-app/server/src/asr-capabilities.ts`
- Modify: `web-app/server/src/asr-relay.ts`
- Modify: `web-app/server/src/ws.ts`
- Delete: `web-app/server/src/xfyun-client.ts`
- Delete: `web-app/server/test/xfyun-client.test.ts`
- Delete: `web-app/server/test/asr-relay-xfyun-speakers.test.ts`

**Interfaces:**
- Consumes: `AsrProvider`, `createVolcSession()`, `VolcCredentials`, `SpeakerRoleMap.setGuess()`.
- Produces: Xunfei-free contract/capability/runtime with Doubao selected before any renderer configuration.

- [ ] **Step 1: Write failing contract, health, and role-policy tests**

```ts
expect(ASR_PROVIDERS).toEqual(['volc', 'paraformer', 'sim']);
expect(parseServerMessage(JSON.stringify({
  type: 'asr-status', source: 'mic', provider: 'xfyun', state: 'live'
}))).toBeNull();
expect(health.body.asrProviders).not.toHaveProperty('xfyun');
expect(relay.getProvider()).toBe('volc');
```

Add a WebSocket configuration test whose role-map spy proves `volc` invokes `setGuess(false)`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test --workspace @open-cluely/server -- test/health.test.ts test/asr-relay.test.ts test/ws-audio-finalization.test.ts
npm test --workspace @open-cluely/web -- --run src/lib/messages.test.ts
```

Expected: Xunfei still appears in the contract, health response, parser, relay default, and WebSocket role policy.

- [ ] **Step 3: Remove Xunfei and select Doubao by default**

Set the contract to:

```ts
export type AsrProvider = 'paraformer' | 'volc' | 'sim';
export const ASR_PROVIDERS: readonly ['volc', 'paraformer', 'sim'];
```

Remove `XFYUN_*` config, client import/factory/branch, and health capability. Initialize the relay with `let provider: AsrProvider = 'volc'`; normalize unknown runtime values to `volc`. In `applyAsrConfig`, resolve normal/omitted providers to `volc` and use:

```ts
roles.setGuess(textProvider !== 'volc' && textProvider !== 'sim');
```

Seed new connections with `relay.setAsrProvider('volc', resolveVolcCreds())`.

- [ ] **Step 4: Delete provider-specific files and update affected fixtures**

Delete the Xunfei client and dedicated tests. Convert generic status/finalization fixtures from `xfyun` to `volc` or `sim`; do not delete provider-neutral coverage.

- [ ] **Step 5: Run focused and full server/web tests**

Run Step 2, then:

```bash
npm test
```

Expected: core, question-bank, server, and web suites pass with no Xunfei runtime member.

- [ ] **Step 6: Commit and push**

```bash
git add web-app/packages/contract web-app/server web-app/web/src/lib
git commit -m "refactor: remove Xunfei web runtime"
git push origin main
```

---

### Task 3: Remove Xunfei and provider selection from Electron

**Files:**
- Modify: `test/app-state-persistence.test.js`
- Modify: `test/save-settings-merge.test.js`
- Modify: `src/services/state/app-state.js`
- Modify: `src/main-process/features/settings/ipc.js`
- Modify: `src/main-process/startup-logging.js`
- Modify: `src/main-process/start-application.js`
- Modify: `src/services/asr-router.js`
- Modify: `src/services/asr-ipc.js`
- Modify: `src/windows/assistant/renderer.html`
- Modify: `src/windows/assistant/renderer.js`
- Modify: `src/windows/assistant/styles.css`
- Modify: `src/windows/assistant/renderer/features/settings/settings-panel-manager.js`
- Delete: `src/services/xfyun-rtasr/service.js`

**Interfaces:**
- Consumes: `sanitizeAppState()`, `registerSettingsIpc()`, `createAsrRouter()`.
- Produces: Electron startup/state/settings that always choose `volc` and never retain Xunfei credentials.

- [ ] **Step 1: Write failing state and Settings IPC tests**

```js
saveAppState(app, { asrProvider: 'xfyun', xfyunAppId: 'old', xfyunApiKey: 'old-key' });
const state = loadAppState(app);
assert.strictEqual(state.asrProvider, 'volc');
assert.ok(!Object.hasOwn(state, 'xfyunAppId'));
assert.ok(!Object.hasOwn(state, 'xfyunApiKey'));

const settings = await handlers['get-settings']();
assert.strictEqual(settings.asrProvider, 'volc');
assert.ok(!Object.hasOwn(settings, 'hasXfyunCredentials'));
```

- [ ] **Step 2: Run focused Electron tests and verify RED**

Run:

```bash
node --test test/app-state-persistence.test.js test/save-settings-merge.test.js
```

Expected: legacy state preserves Xunfei fields and provider selection.

- [ ] **Step 3: Remove Xunfei state/service/startup wiring**

Set `getDefaultAppState().asrProvider` to `'volc'`, drop Xunfei state fields/sanitization, remove service creation and router member, and make the router's canonical provider `providers.volc`:

```js
const canonical = providers.volc;
if (!canonical) throw new Error('asr-router requires the Doubao provider');
```

- [ ] **Step 4: Remove provider controls from legacy UI code**

Delete the ASR `<select>`, Xunfei credential group, provider visibility logic, Xunfei DOM references, and Xunfei styles. Render the existing indicator as fixed Doubao metadata. Ignore any `asrProvider` field received by `save-settings` and return `asrProvider: 'volc'` from `get-settings`.

- [ ] **Step 5: Delete the Xunfei service and verify GREEN**

Delete `src/services/xfyun-rtasr/service.js`, run Step 2, then run all root tests:

```bash
node --test test/*.test.js
```

Expected: all Electron tests pass.

- [ ] **Step 6: Commit and push**

```bash
git add src test
git commit -m "refactor: remove Xunfei desktop runtime"
git push origin main
```

---

### Task 4: Documentation, production verification, and acceptance

**Files:**
- Modify: `web-app/README.md`
- Modify: `web-app/DEPLOY.md`
- Modify: `web-app/HANDOFF.md`
- Modify: `docs/FEATURES.md`
- Delete: `web-app/docs/xfyun-handoff-fix-report.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-audio-capture.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/doubao-only-asr-policy.md`

**Interfaces:**
- Consumes: final executable behavior and QA commands from Tasks 1–3.
- Produces: current product documentation, implementation notes, rebuilt server, and visible acceptance evidence.

- [ ] **Step 1: Update active docs and implementation notes**

Document fixed Doubao Duration, server-only credentials, native clustering, fixed Auto policy, internal-only Paraformer/sim, and the absence of provider controls. Each Obsidian note must include Purpose, Entry points, Data flow, Config/state, and Gotchas.

- [ ] **Step 2: Search for active Xunfei remnants**

Run:

```bash
rg -n -i "xfyun|xunfei|讯飞|iflytek" src test web-app/packages web-app/server web-app/web web-app/README.md web-app/DEPLOY.md web-app/HANDOFF.md docs/FEATURES.md
```

Expected: no active-code/product-document matches. Historical specs/plans may remain.

- [ ] **Step 3: Run complete verification**

```bash
node --test test/*.test.js
cd web-app && npm test && npm run build
git diff --check
```

Expected: zero test/build/diff failures.

- [ ] **Step 4: Restart and health-check port 8788**

Restart only the validated repository-owned listener, then run:

```bash
curl -fsS http://127.0.0.1:8788/api/health
```

Expected: `ok:true`; capabilities contain Doubao and no Xunfei.

- [ ] **Step 5: Perform in-app browser acceptance**

Reload `http://127.0.0.1:8788/`. Verify Settings has microphone and evaluation model only, the main bar shows Doubao 2.0, no Auto control exists, and the page console has no errors.

- [ ] **Step 6: Commit and push final checkpoint**

```bash
git add docs web-app
git commit -m "docs: record fixed Doubao interview policy"
git push origin main
```

- [ ] **Step 7: Verify repository parity**

```bash
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
```

Expected: clean `main`, `0 0` parity.

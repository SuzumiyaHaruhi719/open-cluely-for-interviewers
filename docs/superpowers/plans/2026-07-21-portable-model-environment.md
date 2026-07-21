# Portable Model Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one root environment file sufficient to migrate every active Doubao and DashScope model binding to another device, while keeping real credentials out of Git and logs.

**Architecture:** Load environment values with precedence `OS environment > root .env > legacy web-app/.env`. Centralize every active model binding in server config, add an allowlisted exporter that produces a mode-0600 `.env.portable`, and expand the tracked root template without copying obsolete provider secrets.

**Tech Stack:** Node.js/CommonJS and ESM filesystem APIs, `dotenv`, Node test runner, TypeScript server config.

## Global Constraints

- Work directly on `main` with pushed checkpoints.
- Never print, stage, commit, or embed real credentials in source, tests, logs, notes, or responses.
- The generated `.env.portable` must be ignored by Git and mode `0600`.
- Export only allowlisted active keys; exclude Xunfei, CAM++, TTS, ASR 1.0, Gemini, and arbitrary legacy variables.
- Qwen and DeepSeek share `DASHSCOPE_API_KEY`; Doubao Seed ASR 2.0 uses `VOLC_APP_ID`, `VOLC_ACCESS_TOKEN`, and `volc.seedasr.sauc.duration`.
- Root `.env` is canonical; `web-app/.env` remains read-only compatibility fallback.
- Observe RED before every production behavior change.

---

### Task 1: Deterministic root/legacy environment loader

**Files:**
- Create: `web-app/server/src/environment.ts`
- Create: `web-app/server/test/environment.test.ts`
- Modify: `web-app/server/src/config.ts`

**Interfaces:**
- Produces: `loadServerEnvironment({ rootPath, legacyPath, target })` and config model fields.

- [ ] **Step 1: Write failing precedence tests**

```ts
test('environment precedence is OS then root then legacy', () => {
  const target = { INTERVIEWER_MODEL: 'os-model' } as NodeJS.ProcessEnv;
  loadServerEnvironment({ rootPath, legacyPath, target });
  assert.equal(target.INTERVIEWER_MODEL, 'os-model');
  assert.equal(target.DASHSCOPE_API_KEY, 'root-key');
  assert.equal(target.VOLC_APP_ID, 'legacy-app');
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/environment.test.ts`

Expected: FAIL because `environment.ts` is missing.

- [ ] **Step 3: Implement the loader and central model bindings**

```ts
export function loadServerEnvironment({ rootPath, legacyPath, target }: LoadOptions): void {
  for (const filePath of [rootPath, legacyPath]) {
    if (!existsSync(filePath)) continue;
    const parsed = dotenv.parse(readFileSync(filePath));
    for (const [key, value] of Object.entries(parsed)) {
      if (target[key] === undefined) target[key] = value;
    }
  }
}
```

Add config fields for `dashscopeBaseUrl`, `speakerPartitionModel`, `expertQuestionModel`, `interviewerContextModel`, and `interviewerSummaryModel`, with the approved DeepSeek defaults.

- [ ] **Step 4: Run focused test and server typecheck**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/environment.test.ts && npm run typecheck --workspace @open-cluely/server`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add web-app/server/src/environment.ts web-app/server/test/environment.test.ts web-app/server/src/config.ts
git commit -m "feat: load server models from root environment"
git push origin main
```

### Task 2: Route every active model through centralized config

**Files:**
- Modify: `web-app/server/src/dashscope.ts`
- Modify: `web-app/server/src/auto-monitor.ts`
- Modify: `web-app/server/src/expert-question.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Modify: `web-app/server/src/interview-analysis.ts`
- Modify: relevant tests under `web-app/server/test/`

**Interfaces:**
- Consumes: model bindings from `config`.
- Produces: no hardcoded active model path outside config defaults.

- [ ] **Step 1: Write failing model-binding tests**

```ts
test('all active model bindings resolve from centralized config', () => {
  assert.equal(config.autoMonitorModel, process.env.AUTO_MONITOR_MODEL);
  assert.equal(config.speakerPartitionModel, process.env.SPEAKER_PARTITION_MODEL);
  assert.equal(config.expertQuestionModel, process.env.EXPERT_QUESTION_MODEL);
  assert.equal(getContextModel(), process.env.INTERVIEWER_CONTEXT_MODEL);
  assert.equal(getSummaryModel(), process.env.INTERVIEWER_SUMMARY_MODEL);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd web-app && npm run test:server -- --test-name-pattern="model binding"`

Expected: FAIL because several modules still export hardcoded model IDs.

- [ ] **Step 3: Replace hardcoded active model bindings**

```ts
export const AUTO_MONITOR_MODEL = config.autoMonitorModel;
export const EXPERT_QUESTION_MODEL = config.expertQuestionModel;
export const SPEAKER_PARTITION_MODEL = config.speakerPartitionModel;

export function getContextModel(): string {
  return config.interviewerContextModel;
}

export function getSummaryModel(): string {
  return config.interviewerSummaryModel;
}
```

Make `getDashscopeBaseUrl()` prefer `config.dashscopeBaseUrl` before the core default.

- [ ] **Step 4: Run server tests and typecheck**

Run: `cd web-app && npm run test:server && npm run typecheck --workspace @open-cluely/server`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add web-app/server/src/dashscope.ts web-app/server/src/auto-monitor.ts web-app/server/src/expert-question.ts web-app/server/src/speaker-partitioner.ts web-app/server/src/interview-analysis.ts web-app/server/test
git commit -m "refactor: centralize production model bindings"
git push origin main
```

### Task 3: Safe portable environment exporter

**Files:**
- Create: `scripts/export-portable-env.mjs`
- Create: `test/portable-env.test.js`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `exportPortableEnvironment(options)` and `npm run env:export`.

- [ ] **Step 1: Write failing exporter tests**

```js
test('exporter allowlists active keys and writes owner-only output', async () => {
  const { exportPortableEnvironment } = await import('../scripts/export-portable-env.mjs');
  exportPortableEnvironment({ rootEnvPath, legacyEnvPath, outputPath, processEnv: {} });
  const output = fs.readFileSync(outputPath, 'utf8');
  assert.match(output, /DASHSCOPE_API_KEY=root-key/);
  assert.match(output, /VOLC_APP_ID=legacy-app/);
  assert.doesNotMatch(output, /XFYUN|CAMPP|TTS|GEMINI/);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
});

test('exporter fails without required credentials and prints no values', () => {
  assert.throws(() => exportPortableEnvironment(emptyOptions), /Missing required keys/);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/portable-env.test.js`

Expected: FAIL because exporter is missing.

- [ ] **Step 3: Implement allowlisted export**

```js
export const PORTABLE_ENV_KEYS = [
  'DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'INTERVIEWER_MODEL',
  'AUTO_MONITOR_MODEL', 'SPEAKER_PARTITION_MODEL', 'EXPERT_QUESTION_MODEL',
  'INTERVIEWER_CONTEXT_MODEL', 'INTERVIEWER_SUMMARY_MODEL',
  'VOLC_APP_ID', 'VOLC_ACCESS_TOKEN', 'VOLC_RESOURCE_ID', 'VOLC_MODEL',
  'VOLC_SAMPLE_RATE', 'AUTO_COOLDOWN_MS', 'AUTO_MIN_NEW_CHARS',
  'AUTO_DEBOUNCE_MS', 'PORT', 'HIDE_FROM_SCREEN_CAPTURE', 'START_HIDDEN',
  'MAX_SCREENSHOTS', 'SCREENSHOT_DELAY', 'NODE_ENV', 'NODE_OPTIONS'
];

export function exportPortableEnvironment(options = {}) {
  // Resolve process > root > legacy > documented defaults, require the three
  // credentials, serialize only PORTABLE_ENV_KEYS, write atomically with 0600,
  // and return key names/missing names only—never values.
}
```

Add `.env.portable` to `.gitignore` and `"env:export": "node scripts/export-portable-env.mjs"` to root scripts.

- [ ] **Step 4: Run exporter tests and verify GREEN**

Run: `node --test test/portable-env.test.js`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add scripts/export-portable-env.mjs test/portable-env.test.js package.json .gitignore
git commit -m "feat: export one-file portable model environment"
git push origin main
```

### Task 4: Complete template and generate the local migration file

**Files:**
- Modify: `.env.example`
- Modify: `web-app/.env.example`
- Generate, never stage: `.env.portable`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/model-environment.md`

**Interfaces:**
- Consumes: `npm run env:export`.
- Produces: one local migration file that can be copied to root `.env` on another device.

- [ ] **Step 1: Write a failing template-coverage assertion**

Extend `test/portable-env.test.js` to load `.env.example` and assert every `PORTABLE_ENV_KEYS` entry appears exactly once, while `XFYUN`, `CAMPP`, and TTS keys are absent.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/portable-env.test.js`

Expected: FAIL because the current root template omits DashScope and model bindings.

- [ ] **Step 3: Expand the safe template and compatibility notice**

Use placeholders for credentials and exact production defaults for model IDs. Replace `web-app/.env.example` contents with a short compatibility notice directing new deployments to root `.env.example`; do not duplicate a second credential template.

- [ ] **Step 4: Generate and inspect metadata only**

Run: `npm run env:export && test -f .env.portable && test "$(stat -f '%Lp' .env.portable)" = "600" && git check-ignore .env.portable`

Expected: exporter reports only written key names/count, file exists with mode `600`, and Git confirms it is ignored. Never print the file content.

- [ ] **Step 5: Update implementation note, commit, and push**

Document Purpose, Entry points, Data flow, Config/state, and Gotchas, especially precedence and secret-handling. Then:

```bash
git add .env.example web-app/.env.example test/portable-env.test.js
git add /Users/thomasli/Documents/github/Obsidian/Interview\ Copilot/Implementation/model-environment.md
git commit -m "docs: provide portable model environment manifest"
git push origin main
```

### Task 5: Migration verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: generated `.env.portable` and root loader.
- Produces: fresh evidence that one file contains every active deployment binding without Git exposure.

- [ ] **Step 1: Run environment and exporter tests**

Run: `node --test test/portable-env.test.js && cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/environment.test.ts`

Expected: PASS.

- [ ] **Step 2: Run a redacted model inventory check**

Run a Node script that loads `.env.portable`, reports only each allowlisted key name and `present/missing`, and exits non-zero if any required production binding is missing. Do not print values.

Expected: every required key reports `present`.

- [ ] **Step 3: Run full tests and build**

Run: `cd web-app && npm test && npm run typecheck --workspace @open-cluely/server && npm run build`

Expected: all commands exit `0`.

- [ ] **Step 4: Verify secret hygiene and remote sync**

Run: `git status --short --branch && git check-ignore .env .env.portable && git rev-parse HEAD && git rev-parse origin/main`

Expected: real environment files are ignored, tracked tree is clean, and local/remote hashes match.

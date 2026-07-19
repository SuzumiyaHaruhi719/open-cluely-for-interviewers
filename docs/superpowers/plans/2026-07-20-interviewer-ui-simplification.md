# Interviewer UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the configuration-heavy web interviewer with a GLP-consistent fixed-Expert workspace, compact essential settings, and a New Interview flow that owns JD selection.

**Architecture:** Keep `Shell` as the renderer orchestrator but move immutable product policy into small constants and data modules. `useAppSettings` owns only validated user-operable preferences; `InterviewTypeModal` returns structured interview context; `SettingsModal` becomes a compact controlled form. Remove all Pipeline Studio renderer/API surfaces and keep compatibility-only wire fields out of the active UI.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Vite, CSS using the existing GLP tokens.

## Global Constraints

- Keep the existing GLP palette, tokens, spacing, radii, typography, and motion character.
- Realtime generation is fixed to `deepseek-v4-flash` with `mode='expert'` and `outputLanguage='zh'`.
- Xunfei is the default ASR provider.
- No language, prompt, mode, secret, workspace, opacity, shortcut, or pipeline-editor settings.
- No App ID, API key, Access Token, or provider secret may enter renderer state, persisted browser data, or WebSocket configuration.
- JD is structured Expert context, never a replacement system prompt.
- Preserve the existing user-owned `Shell` change that keeps interview history after capture stops.
- Every task ends with a focused commit and push to `origin/main`.

---

## File structure

- Create `web-app/web/src/desktop/jobProfiles.ts` — typed saved JD profiles and Property Manager data.
- Create `web-app/web/src/desktop/jobProfiles.test.ts` — validates profile completeness and separation from prompt policy.
- Create `web-app/web/src/desktop/SettingsModal.test.tsx` — compact-settings behavior independent of the large Shell fixture.
- Modify `web-app/web/src/desktop/useAppSettings.ts` — validated essential preferences only.
- Modify `web-app/web/src/desktop/useAppSettings.test.tsx` — migration/default contracts.
- Modify `web-app/web/src/desktop/SettingsModal.tsx` — essentials-only GLP panel.
- Modify `web-app/web/src/desktop/InterviewTypeModal.tsx` — interview type + JD/profile review flow.
- Modify `web-app/web/src/desktop-ui/interview-type.css` — staged New Interview layout using existing tokens.
- Modify `web-app/web/src/desktop-ui/settings.css` — compact modal layout using existing tokens.
- Modify `web-app/web/src/desktop/Shell.tsx` — fixed Expert config, JD choice application, and removal of Studio state/handlers.
- Modify `web-app/web/src/desktop/Shell.test.tsx` — end-to-end renderer contracts while retaining user-owned history tests.
- Modify `web-app/web/src/desktop/Topbar.tsx` and `web-app/web/src/desktop-ui/styles.css` — clearer fixed-Expert/runtime status hierarchy.
- Modify `web-app/web/src/lib/api.ts` — remove pipeline-editor client API and types.
- Delete `web-app/web/src/desktop/useCustomizePipelines.ts`.
- Delete `web-app/web/src/desktop/studio/` and `web-app/web/src/desktop-ui/studio.css`.
- Modify `web-app/web/src/main.tsx` or the stylesheet import owner — remove `studio.css` import.

### Task 1: Reduce and validate application settings

**Files:**
- Modify: `web-app/web/src/desktop/useAppSettings.ts`
- Modify: `web-app/web/src/desktop/useAppSettings.test.tsx`

**Interfaces:**
- Produces: `AppSettings { asrProvider: UserAsrProvider; micDeviceId: string; autoGenerate: boolean; autoMode: AutoMode; autoIntervalSec: number; summaryModel: SummaryModel }`.
- Produces: setters for exactly those six user-operable settings.
- Consumes: browser `localStorage` through the existing safe persistence helpers.

- [ ] **Step 1: Write migration/default tests that fail against the old settings surface**

```tsx
localStorage.setItem('open-cluely.asrProvider', 'paraformer');
localStorage.setItem('open-cluely.summaryModel', 'removed-model');
localStorage.setItem('open-cluely.autoIntervalSec', '2');
const { result } = renderHook(() => useAppSettings());
expect(result.current.settings.asrProvider).toBe('xfyun');
expect(result.current.settings.summaryModel).toBe('deepseek-v4-pro');
expect(result.current.settings.autoIntervalSec).toBe(5);
expect(result.current.settings).not.toHaveProperty('outputLanguage');
expect(result.current.settings).not.toHaveProperty('volcAccessToken');
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/useAppSettings.test.tsx`

Expected: FAIL because the old state still defaults to Paraformer and exposes removed fields.

- [ ] **Step 3: Replace the state contract with validated essentials**

```ts
export const DEFAULT_ASR_PROVIDER: UserAsrProvider = 'xfyun';
export const DEFAULT_SUMMARY_MODEL: SummaryModel = 'deepseek-v4-pro';
const USER_ASR_PROVIDERS = new Set<UserAsrProvider>(['xfyun', 'volc', 'paraformer']);
const SUMMARY_MODELS = new Set<SummaryModel>(['deepseek-v4-pro', 'deepseek-v4-flash']);

function readAsrProvider(): UserAsrProvider {
  const value = readString(KEYS.asrProvider, DEFAULT_ASR_PROVIDER);
  return value === 'xfyun' ? value : DEFAULT_ASR_PROVIDER;
}

function readSummaryModel(): SummaryModel {
  const value = readString(KEYS.summaryModel, DEFAULT_SUMMARY_MODEL);
  return SUMMARY_MODELS.has(value as SummaryModel)
    ? (value as SummaryModel)
    : DEFAULT_SUMMARY_MODEL;
}
```

Delete secret, language, AI-model, prompt-mode/text, opacity, and Volc credential keys/setters. Keep `sim` outside `UserAsrProvider`; test fixtures may still configure it directly through the socket.

- [ ] **Step 4: Run the focused tests and typecheck via the web build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/useAppSettings.test.tsx && npm run build --workspace @open-cluely/web`

Expected: all focused tests PASS and TypeScript compilation succeeds.

- [ ] **Step 5: Commit and push the validated settings state**

```bash
git add web-app/web/src/desktop/useAppSettings.ts web-app/web/src/desktop/useAppSettings.test.tsx
git commit -m "refactor: keep only essential interviewer settings"
git push origin main
```

### Task 2: Replace Settings with the compact Essentials panel

**Files:**
- Create: `web-app/web/src/desktop/SettingsModal.test.tsx`
- Modify: `web-app/web/src/desktop/SettingsModal.tsx`
- Modify: `web-app/web/src/desktop-ui/settings.css`

**Interfaces:**
- Consumes: the reduced `AppSettings` from Task 1.
- Produces: `SettingsModal` callbacks `onAsrProviderChange`, `onMicDeviceChange`, `onAutoGenerateChange`, `onAutoModeChange`, `onAutoIntervalChange`, and `onSummaryModelChange`.

- [ ] **Step 1: Write a compact-surface regression test**

```tsx
render(<SettingsModal open settings={essentialSettings} onClose={vi.fn()} {...callbacks} />);
expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
expect(screen.getByLabelText('语音识别')).toHaveValue('xfyun');
expect(screen.getByLabelText('评估报告模型')).toHaveValue('deepseek-v4-pro');
expect(screen.queryByText('面试模式')).not.toBeInTheDocument();
expect(screen.queryByLabelText('输出语言')).not.toBeInTheDocument();
expect(screen.queryByText(/Access Token|API Key|App ID/i)).not.toBeInTheDocument();
expect(screen.queryByText(/Pipeline|Customize|自定义提示词/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify the test fails against the existing modal**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/SettingsModal.test.tsx`

Expected: FAIL because the existing modal renders mode, language, prompt, credential, opacity, shortcuts, and pipeline controls.

- [ ] **Step 3: Implement the essentials-only controlled modal**

```tsx
<section className="settings-section" aria-labelledby="settings-audio-title">
  <h3 id="settings-audio-title" className="settings-section__title">音频与识别</h3>
  <label className="settings-field">
    <span className="settings-field__label">语音识别</span>
    <select value={settings.asrProvider} onChange={(event) => onAsrProviderChange(event.target.value)}>
      <option value="xfyun">讯飞实时转写 · 原生说话人分离</option>
    </select>
  </label>
</section>
```

Render the microphone, automatic-follow-up toggle/mode, conditional interval, and evaluation model in two short sections. Derive interval copy from `settings.autoIntervalSec`, for example `每 45 秒检查一次`, rather than hard-coding 30 seconds.

- [ ] **Step 4: Rework Settings CSS with existing semantic tokens**

```css
.settings-dialog { width: min(520px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); }
.settings-body { display: grid; gap: var(--space-4); padding: var(--space-4); }
.settings-section { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-raised); }
```

Do not introduce hard-coded brand colors or new radius/spacing scales.

- [ ] **Step 5: Run component tests and production build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/SettingsModal.test.tsx src/desktop/useAppSettings.test.tsx && npm run build --workspace @open-cluely/web`

Expected: PASS with no removed-setting text in the rendered modal.

- [ ] **Step 6: Commit and push the compact Settings surface**

```bash
git add web-app/web/src/desktop/SettingsModal.tsx web-app/web/src/desktop/SettingsModal.test.tsx web-app/web/src/desktop-ui/settings.css
git commit -m "feat: replace settings with interviewer essentials"
git push origin main
```

### Task 3: Add Property Manager context to New Interview

**Files:**
- Create: `web-app/web/src/desktop/jobProfiles.ts`
- Create: `web-app/web/src/desktop/jobProfiles.test.ts`
- Modify: `web-app/web/src/desktop/InterviewTypeModal.tsx`
- Create: `web-app/web/src/desktop/InterviewTypeModal.test.tsx`
- Modify: `web-app/web/src/desktop-ui/interview-type.css`

**Interfaces:**
- Produces: `JobProfile { id; title; department; reportsTo; summary; jobDescription; interviewGuide: string[] }`.
- Produces: `InterviewTypeChoice { interviewType; jobProfileId; jobDescription; interviewGuide }`.
- Consumes: no prompt-builder or pipeline API.

- [ ] **Step 1: Write profile and modal behavior tests**

```tsx
expect(PROPERTY_MANAGER_PROFILE.title).toBe('物业经理');
expect(PROPERTY_MANAGER_PROFILE.jobDescription).toContain('现场的安全及消防');
expect(PROPERTY_MANAGER_PROFILE.interviewGuide).toContain('突发事件应对与复盘');

render(<InterviewTypeModal open onClose={vi.fn()} onPick={onPick} />);
fireEvent.change(screen.getByLabelText('职位背景'), { target: { value: 'property-manager' } });
fireEvent.click(screen.getByRole('button', { name: '线下面试' }));
fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
  interviewType: 'offline',
  jobProfileId: 'property-manager',
  jobDescription: expect.stringContaining('物业经理')
}));
```

- [ ] **Step 2: Run tests and confirm missing profile/staged flow failures**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/jobProfiles.test.ts src/desktop/InterviewTypeModal.test.tsx`

Expected: FAIL because `jobProfiles.ts` and staged confirmation do not exist.

- [ ] **Step 3: Add typed Property Manager data**

```ts
export interface JobProfile {
  id: string;
  title: string;
  department: string;
  reportsTo: string;
  summary: string;
  jobDescription: string;
  interviewGuide: string[];
}

export const PROPERTY_MANAGER_PROFILE: JobProfile = {
  id: 'property-manager',
  title: '物业经理',
  department: '区域运营服务',
  reportsTo: '城市负责人',
  summary: '驻扎在园区现场，负责物业运营落地的园区负责人',
  jobDescription: PROPERTY_MANAGER_JD,
  interviewGuide: ['综合体或园区独立运营', '团队管理与招聘培训', '突发事件应对与复盘']
};
```

Store the complete user-supplied responsibilities and requirements in `PROPERTY_MANAGER_JD`; do not prepend model instructions.

- [ ] **Step 4: Replace sample selection with type + JD selection + review**

```tsx
const [interviewType, setInterviewType] = useState<InterviewType>('offline');
const [profileId, setProfileId] = useState('property-manager');
const [customJd, setCustomJd] = useState('');
const selected = JOB_PROFILES.find((profile) => profile.id === profileId);

const submit = () => onPick({
  interviewType,
  jobProfileId: selected?.id ?? 'custom',
  jobDescription: selected?.jobDescription ?? customJd.trim(),
  interviewGuide: selected?.interviewGuide ?? []
});
```

Use a single explicit `开始面试` action after review; do not start when the channel card itself is clicked.

- [ ] **Step 5: Run focused tests and build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/jobProfiles.test.ts src/desktop/InterviewTypeModal.test.tsx && npm run build --workspace @open-cluely/web`

Expected: PASS; the modal shows Property Manager summary and no sample-conversation selector.

- [ ] **Step 6: Commit and push the New Interview context flow**

```bash
git add web-app/web/src/desktop/jobProfiles.ts web-app/web/src/desktop/jobProfiles.test.ts web-app/web/src/desktop/InterviewTypeModal.tsx web-app/web/src/desktop/InterviewTypeModal.test.tsx web-app/web/src/desktop-ui/interview-type.css
git commit -m "feat: choose job context when starting interviews"
git push origin main
```

### Task 4: Remove Customize and Pipeline Studio from the product surface

**Files:**
- Modify: `web-app/web/src/lib/api.ts`
- Modify: `web-app/web/src/lib/api.test.ts`
- Modify: stylesheet import owner found by `rg -n "studio.css" web-app/web/src`
- Delete: `web-app/web/src/desktop/useCustomizePipelines.ts`
- Delete: `web-app/web/src/desktop/studio/Canvas.tsx`
- Delete: `web-app/web/src/desktop/studio/ConfigPanel.tsx`
- Delete: `web-app/web/src/desktop/studio/Palette.tsx`
- Delete: `web-app/web/src/desktop/studio/PipelineStudio.test.tsx`
- Delete: `web-app/web/src/desktop/studio/PipelineStudio.tsx`
- Delete: `web-app/web/src/desktop/studio/StudioTopbar.tsx`
- Delete: `web-app/web/src/desktop/studio/Wires.tsx`
- Delete: `web-app/web/src/desktop/studio/studioState.test.ts`
- Delete: `web-app/web/src/desktop/studio/studioState.ts`
- Delete: `web-app/web/src/desktop/studio/usePipelineStudio.ts`
- Delete: `web-app/web/src/desktop/studio/wirePath.ts`
- Delete: `web-app/web/src/desktop-ui/studio.css`

**Interfaces:**
- Produces: no renderer import, fetch wrapper, stylesheet, test, or route call mentioning Pipeline Studio.
- Consumes: the fixed Expert path only.

- [ ] **Step 1: Add a source-level absence test**

```ts
const source = await readFile(new URL('./api.ts', import.meta.url), 'utf8');
expect(source).not.toMatch(/fetchPipelines|generatePipeline|savePipeline|PipelineNode/);
```

- [ ] **Step 2: Confirm the test fails while pipeline APIs remain**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/api.test.ts`

Expected: FAIL with a remaining pipeline API symbol.

- [ ] **Step 3: Delete pipeline-only renderer modules and API definitions**

Remove the entire `Pipelines (Customize-mode node editor)` section from `api.ts`, the `studio.css` import, and the listed editor modules. Keep unrelated assistant/resume/question-bank APIs unchanged.

- [ ] **Step 4: Verify there are no active renderer references**

Run: `rg -n "PipelineStudio|useCustomizePipelines|generatePipeline|activePipelineId|mode: 'customize'|studio.css" web-app/web/src`

Expected: no matches outside migration/absence-test text intentionally asserting removal.

- [ ] **Step 5: Run the web suite and build**

Run: `cd web-app && npm run test:web && npm run build --workspace @open-cluely/web`

Expected: PASS after obsolete Studio tests are deleted.

- [ ] **Step 6: Commit and push removal**

```bash
git add -A web-app/web/src/desktop/studio web-app/web/src/desktop/useCustomizePipelines.ts web-app/web/src/desktop-ui/studio.css web-app/web/src/lib/api.ts web-app/web/src/lib/api.test.ts web-app/web/src
git commit -m "refactor: remove pipeline editor from interviewer app"
git push origin main
```

### Task 5: Remove server-side Pipeline Studio endpoints

**Files:**
- Modify: `web-app/server/src/app.ts`
- Modify: `web-app/server/src/ws.ts`
- Modify: `web-app/server/test/health.test.ts`
- Delete: `web-app/server/src/routes/pipelines.ts`
- Delete: `web-app/server/src/services/pipeline-generate.ts`
- Delete: `web-app/server/test/pipelines.test.ts`
- Delete: `web-app/server/test/pipelines-generate.test.ts`
- Delete: `web-app/server/test/pipelines-generate-nokey.test.ts`

**Interfaces:**
- Produces: `/api/pipelines` returns 404 and WebSocket sessions no longer resolve user-authored pipeline directories.
- Preserves: the internal fixed Expert implementation in `@open-cluely/copilot-core`; deleting the editor must not delete the production Expert engine.

- [ ] **Step 1: Add an endpoint-absence test**

```ts
const res = await fetch(`http://127.0.0.1:${port}/api/pipelines`);
assert.equal(res.status, 404);
```

- [ ] **Step 2: Run the health/app test and confirm the route still exists**

Run: `cd web-app && npm test --workspace @open-cluely/server -- --test-name-pattern="health|pipelines removed"`

Expected: FAIL because `/api/pipelines` still returns the editor catalog.

- [ ] **Step 3: Unmount and delete editor-only server code**

Remove `createPipelinesRouter` from `app.ts`. Remove the Customize `pipelinesDir()` path and `pipelinesDir` session option from `ws.ts`; fixed Expert must keep using its built-in production path. Delete the editor route, AI pipeline-authoring service, and their route-only tests.

- [ ] **Step 4: Verify no HTTP/editor dependencies remain**

Run: `rg -n "createPipelinesRouter|routes/pipelines|pipeline-generate|/api/pipelines|pipelinesDir" web-app/server/src web-app/server/test`

Expected: only the explicit 404 assertion text may match.

- [ ] **Step 5: Run server tests, typecheck, and build**

Run: `cd web-app && npm run test:server && npm run typecheck --workspace @open-cluely/server && npm run build --workspace @open-cluely/server`

Expected: PASS; the fixed Expert path still generates questions without editor routes.

- [ ] **Step 6: Commit and push endpoint removal**

```bash
git add -A web-app/server/src/app.ts web-app/server/src/ws.ts web-app/server/src/routes/pipelines.ts web-app/server/src/services/pipeline-generate.ts web-app/server/test
git commit -m "refactor: remove pipeline editor server endpoints"
git push origin main
```

### Task 6: Wire fixed Expert, fixed Chinese, and JD context through Shell

**Files:**
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/desktop/Shell.test.tsx`
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: `web-app/web/src/lib/followUpCopy.ts`

**Interfaces:**
- Consumes: `InterviewTypeChoice` from Task 3 and essential settings from Task 1.
- Produces: every full configure contains fixed `{ mode:'expert', interviewerModel:'deepseek-v4-flash', outputLanguage:'zh' }` and the selected `jobDescription`.

- [ ] **Step 1: Update Shell tests without deleting the existing history-preservation test**

```tsx
expect(lastConfig(ws)).toMatchObject({
  mode: 'expert',
  interviewerModel: 'deepseek-v4-flash',
  outputLanguage: 'zh',
  asrProvider: 'xfyun'
});
expect(screen.queryByText('Customize')).not.toBeInTheDocument();

fireEvent.click(screen.getByText('新建面试'));
fireEvent.change(screen.getByLabelText('职位背景'), { target: { value: 'property-manager' } });
fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
expect(lastConfig(ws).jobDescription).toContain('负责园区物业人员的培训');
```

- [ ] **Step 2: Run the Shell tests and confirm stale settings/Studio wiring failures**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/Shell.test.tsx`

Expected: FAIL because Shell still consumes mode/language/secrets/pipelines and sample choice.

- [ ] **Step 3: Make product policy immutable in Shell**

```ts
const EXPERT_CONFIG = {
  mode: 'expert',
  interviewerModel: 'deepseek-v4-flash',
  outputLanguage: 'zh'
} as const;

fullConfigRef.current = {
  ...EXPERT_CONFIG,
  jobDescription: config.jobDescription,
  resumeText: config.resumeText,
  asrProvider: normalizeAsrProvider(settings.asrProvider),
  diarize: config.interviewType === 'offline',
  autoGenerate: settings.autoGenerate,
  autoMode: settings.autoMode,
  autoIntervalMs: settings.autoIntervalSec * 1000,
  summaryModel: settings.summaryModel
};
```

Remove `onModeChange`, `onLanguageChange`, Volc secret handlers, Studio state/handlers/imports, `activePipelineId`, and prompt configuration. Apply `choice.jobDescription` on New Interview and keep later right-rail JD editing as direct context data.

- [ ] **Step 4: Collapse follow-up copy to Chinese**

```ts
export const FOLLOW_UP_COPY = {
  title: '专家追问',
  generate: '生成追问',
  rationale: '提问依据'
} as const;
```

Remove `outputLanguage` renderer props and branches that can produce mixed English/Chinese UI copy.

- [ ] **Step 5: Run focused and full web verification**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/Shell.test.tsx src/desktop/TranscriptStream.test.tsx src/lib/messages.test.ts && npm run test:web && npm run build --workspace @open-cluely/web`

Expected: all tests PASS, including the user-owned test that stopping capture preserves transcript history.

- [ ] **Step 6: Stage only assistant-owned Shell hunks, commit, and push**

Use a patch generated from the pre-task working copy so the pre-existing history-preservation diff remains unstaged.

```bash
git diff --cached --check
git commit -m "feat: make Expert the fixed Chinese interviewer"
git push origin main
```

### Task 7: Refresh the visible workspace within GLP

**Files:**
- Modify: `web-app/web/src/desktop/Topbar.tsx`
- Modify: `web-app/web/src/desktop/Composer.tsx`
- Modify: `web-app/web/src/desktop/RightRail.tsx`
- Modify: `web-app/web/src/desktop-ui/styles.css`
- Modify: `web-app/web/src/desktop-ui/chat.css`
- Modify: `web-app/web/src/desktop-ui/channel-control.css`
- Modify: `web-app/web/src/desktop-ui/session-context.css`
- Test: closest existing component tests for each changed component.

**Interfaces:**
- Produces: clearer status/primary-action hierarchy with unchanged routes and GLP tokens.
- Consumes: actual socket/capture state; does not invent health from selected settings.

- [ ] **Step 1: Capture the reference screen at the current in-app-browser viewport**

Save Settings closed, empty workspace, live capture, and New Interview states. Record viewport dimensions and use the same dimensions for after screenshots.

- [ ] **Step 2: Add component assertions for runtime status and primary action labels**

```tsx
expect(screen.getByText('专家模式')).toBeInTheDocument();
expect(screen.getByText('讯飞')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /开始录音|停止录音/ })).toBeInTheDocument();
```

- [ ] **Step 3: Implement hierarchy changes using only existing tokens/components**

Keep one primary capture action, one compact status cluster, transcript as the largest surface, and JD/résumé/session context in the right rail. Preserve transparent Tour mask and current between-step motion.

- [ ] **Step 4: Run component tests and build**

Run: `cd web-app && npm run test:web && npm run build --workspace @open-cluely/web`

Expected: PASS with no layout/type errors.

- [ ] **Step 5: Compare reference and refreshed screenshots together**

Use identical viewport/state. Inspect overflow, padding, margins, font weights, border radii, contrast, tooltip targeting, and motion. Fix visible mismatches before accepting the comparison.

- [ ] **Step 6: Commit and push the GLP refresh**

```bash
git add web-app/web/src/desktop/Topbar.tsx web-app/web/src/desktop/Composer.tsx web-app/web/src/desktop/RightRail.tsx web-app/web/src/desktop-ui web-app/web/src/desktop/*.test.tsx
git commit -m "feat: refresh the GLP interviewer workspace"
git push origin main
```

### Task 8: Update implementation notes and run UI release verification

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/settings-and-persistence.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/settings-panel-and-shortcuts-ui.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-pipeline-studio.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-sessions-resume-customize.md`
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-new-interview-job-context.md`

**Interfaces:**
- Produces: contributor documentation matching the final renderer implementation.

- [ ] **Step 1: Update notes with required sections**

Each note contains Purpose, Entry points, Data flow, Config/state, and Gotchas. Mark Pipeline Studio as removed from the product surface and record that legacy contract fields are compatibility-only.

- [ ] **Step 2: Run the full web release gate**

Run: `cd web-app && npm test && npm run build`

Expected: all core, question-bank, server, and web tests PASS; both production bundles build.

- [ ] **Step 3: Run source/security absence checks**

Run: `rg -n "volcAccessToken|volcAppId|API Key|Access Token|outputLanguage.*select|PipelineStudio|useCustomizePipelines" web-app/web/src`

Expected: no credential/settings/editor product-surface matches; compatibility type references are excluded from this renderer-only search.

- [ ] **Step 4: Commit and push documentation changes from the Obsidian repository according to its session-end workflow**

Do not mix vault files into the application repository commit.

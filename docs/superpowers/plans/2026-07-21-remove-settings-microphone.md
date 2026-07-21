# Single Microphone Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate microphone selector from Settings while preserving the main-page selector and its persisted capture behavior.

**Architecture:** `SettingsModal` becomes a report-model-only surface and no longer enumerates audio devices. `Shell`, `Composer`, `ChannelCard`, and `useAppSettings` retain the existing main-page microphone data flow unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite.

## Global Constraints

- The main-page microphone selector remains the only microphone selector.
- `mic.inputDeviceId` persistence and audio capture behavior remain unchanged.
- Settings retains the evaluation-report model control.
- No new setting or replacement microphone UI is introduced.

---

### Task 1: Remove the duplicate Settings control

**Files:**
- Modify: `web-app/web/src/desktop/SettingsModal.test.tsx`
- Modify: `web-app/web/src/desktop/SettingsModal.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Delete: `web-app/web/src/desktop/useMicDevices.ts`
- Delete: `web-app/web/src/desktop/useMicDevices.test.tsx`
- Verify: `web-app/web/src/desktop/ChannelCard.test.tsx`

**Interfaces:**
- Consumes: `SettingsModalProps.settings.summaryModel` and `onSummaryModelChange(value)`.
- Produces: a `SettingsModal` with no microphone props, enumeration, or Audio section.
- Preserves: `Composer.micDeviceId`, `Composer.onMicDeviceChange`, and `ChannelCard` device selection.

- [x] **Step 1: Write the failing Settings regression test**

Change the Settings essentials assertion to require the duplicate controls to be absent:

```tsx
expect(screen.queryByRole('heading', { name: '音频' })).not.toBeInTheDocument();
expect(screen.queryByLabelText('麦克风')).not.toBeInTheDocument();
expect(screen.getByLabelText('评估报告模型')).toHaveValue('deepseek-v4-pro');
```

Remove the obsolete Settings recording-lock test because the capture-owned selector remains covered by `ChannelCard.test.tsx`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app
npm test --workspace @open-cluely/web -- SettingsModal.test.tsx
```

Expected: FAIL because Settings still renders the Audio heading and microphone selector.

- [x] **Step 3: Remove the Settings-only microphone path**

In `SettingsModal.tsx`, remove `useMicDevices`, `onMicDeviceChange`, `micDeviceDisabled`, and the Audio section. Keep the report-model section unchanged.

The resulting props are:

```tsx
interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSummaryModelChange: (value: SummaryModel) => void;
}
```

In `Shell.tsx`, render Settings without microphone props:

```tsx
<SettingsModal
  open={settingsOpen}
  settings={appSettings.settings}
  onClose={() => setSettingsOpen(false)}
  onSummaryModelChange={(value) => {
    appSettings.setSummaryModel(value);
    pushConfig({ summaryModel: value });
  }}
/>
```

Delete the now-unreferenced Settings-only `useMicDevices.ts` hook and its test. Do not change the independent main-page device hook inside `ChannelCard.tsx`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd web-app
npm test --workspace @open-cluely/web -- SettingsModal.test.tsx ChannelCard.test.tsx useAppSettings.test.tsx
```

Expected: all focused tests pass; Settings has no microphone control and the main-page selector remains controlled and persistent.

- [x] **Step 5: Commit the behavior change**

```bash
git add web-app/web/src/desktop/SettingsModal.tsx \
  web-app/web/src/desktop/SettingsModal.test.tsx \
  web-app/web/src/desktop/Shell.tsx \
  web-app/web/src/desktop/useMicDevices.ts \
  web-app/web/src/desktop/useMicDevices.test.tsx
git commit -m "fix: keep microphone selection on main page"
```

### Task 2: Document and release the simplified Settings surface

**Files:**
- Modify: matching note under `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/`
- Modify: `docs/superpowers/plans/2026-07-21-remove-settings-microphone.md`

**Interfaces:**
- Consumes: Task 1's final Settings and main-page data flow.
- Produces: contributor documentation, a clean production build, and a deployed `main` checkpoint.

- [x] **Step 1: Update implementation notes**

Document that microphone selection is intentionally main-page-only, while `useAppSettings` continues to persist the selected id for capture.

- [x] **Step 2: Run full verification**

```bash
cd web-app
npm test
npm run typecheck --workspace @open-cluely/server
npm run build
cd ..
git diff --check
```

Expected: all tests pass, server typecheck and both builds succeed, and no whitespace errors are reported.

- [x] **Step 3: Rebuild/restart and verify the real UI**

Restart the production server on port `8788`, reload `http://127.0.0.1:8788/`, and verify:

```text
Main page: microphone selector visible beside the microphone Start button.
Settings: no Audio heading and no microphone selector; evaluation model remains visible.
```

- [ ] **Step 4: Commit documentation and push `main`**

```bash
git add docs/superpowers/plans/2026-07-21-remove-settings-microphone.md
git commit -m "docs: record single microphone control release"
git push origin main
```

Expected: the worktree is clean and local `HEAD`, `origin/main`, and remote `main` match.

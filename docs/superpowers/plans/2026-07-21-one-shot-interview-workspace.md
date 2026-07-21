# One-shot Interview Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the configuration-heavy desktop shell with a GLP-minimal resume/JD preparation screen, a focused live transcript workspace, and a collapsible automatic session-context drawer.

**Architecture:** Keep `Shell` as the socket/config lifecycle owner. Add small presentation components for preparation, live header, context drawer, and bottom dock; adapt `TranscriptStream` to the flat timestamped timeline while reusing the existing ASR, diarization, automatic-question, note, and summary data. Leave retired components unreferenced so this UI change does not broaden into backend deletions.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Vite, existing GLP CSS tokens, Phosphor React icons.

**Plan state:** Tasks 1–6 describe the implemented baseline. Tasks 7–9 are approved product corrections and supersede earlier snippets that show an always-visible JD textarea, summary generation inside `onEndInterview`, or an ended live workspace.

## Global Constraints

- Work directly on `main`, as explicitly requested by the user.
- Keep Doubao Seed ASR 2.0 (`asrProvider:'volc'`), DeepSeek v4 Flash Expert, Chinese output, and automatic follow-up fixed internally.
- JD and resume are context fields, not user-authored prompts.
- Preserve speaker role correction, progressive live captions, anchored automatic questions, audio controls, notes, and summary.
- Keep automatic session context in a collapsible single-purpose drawer.
- Do not render Question Bank, history, Settings, mobile entry, model/language/provider controls, Tour, pipeline editor, or manual Generate-Q.
- Use existing GLP semantic tokens and a coherent icon library; no visible emoji, text glyph icons, custom SVGs, CSS art, or gradients in the new shell.
- Use TDD for every behavior change, verify before each commit, push every completed task to `main`, and update Obsidian Implementation notes before handoff.

---

## File structure

- Create `web-app/web/src/desktop/InterviewSetup.tsx` — resume/JD preparation form.
- Create `web-app/web/src/desktop/InterviewSetup.test.tsx` — form validation and submission.
- Create `web-app/web/src/desktop/InterviewHeader.tsx` — brand, live metadata, clear/context/end controls.
- Create `web-app/web/src/desktop/InterviewHeader.test.tsx` — essential header contract.
- Create `web-app/web/src/desktop/SessionContextDrawer.tsx` — accessible drawer around the existing automatic context panel.
- Create `web-app/web/src/desktop/SessionContextDrawer.test.tsx` — open/close and content preservation.
- Create `web-app/web/src/desktop/InterviewDock.tsx` — compact audio lanes and note input using `ChannelCard`.
- Create `web-app/web/src/desktop/InterviewDock.test.tsx` — capture and note actions.
- Create `web-app/web/src/desktop-ui/one-shot-interview.css` — selected visual implementation and responsive rules.
- Modify `web-app/web/src/main.tsx` — load the new shell stylesheet and icon CSS requirements.
- Modify `web-app/web/package.json` and `web-app/package-lock.json` — add Phosphor React icons.
- Modify `web-app/web/src/desktop/Shell.tsx` — two-state lifecycle and removal of retired surfaces.
- Modify `web-app/web/src/desktop/Shell.test.tsx` — one-shot workflow and fixed-policy integration tests.
- Modify `web-app/web/src/desktop/TranscriptStream.tsx` and test — timestamped flat timeline and icon-library controls.
- Modify `web-app/web/src/lib/speakerSegments.ts` and test — arrival timestamps that survive coalescing/repartition.
- Modify `web-app/web/src/lib/useCopilotSocket.ts` and tests — timestamp question events and speaker finals.
- Modify `web-app/web/src/desktop/ResumeDropzone.tsx` — replace its inline remove SVG with the shared icon library.
- Modify `web-app/web/src/desktop/QuestionCard.tsx` — simplify to the inline selected visual while preserving metadata and ranked details.
- Update `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/` notes for the new shell and transcript timestamp invariant.
- Create project-root `design-qa.md` after browser comparison.

### Task 7: Restore JD profiles and split End from Summary

**Files:**
- Modify: `web-app/web/src/desktop/jobProfiles.ts` and tests
- Modify: `web-app/web/src/desktop/InterviewSetup.tsx` and tests
- Modify: `web-app/web/src/desktop/InterviewHeader.tsx` and tests
- Modify: `web-app/web/src/desktop/Shell.tsx` and tests

**Interfaces:**
- `searchJobProfiles(query)` fuzzy-filters built-ins without changing their stored JD.
- `InterviewSetupSubmit` includes `jobProfileId`, selected `jobDescription`, and derived `interviewGuide`.
- `InterviewHeader` separates `onSummary` from `onEnd` and receives truthful `ended` state.
- `Shell.onEndInterview()` stops capture only; `Shell.onSummarize()` owns modal/report generation.

- [ ] Write failing profile-picker, custom-JD, header action, and Shell separation tests.
- [ ] Run focused tests and verify RED.
- [ ] Implement the searchable picker, selected profile preview, ended state, and independent summary action.
- [ ] Run focused tests/build, commit, and push.

### Task 8: Unify audio controls and make context independently scrollable

**Files:**
- Modify: `web-app/web/src/desktop/ChannelCard.tsx` and tests
- Modify: `web-app/web/src/desktop/SessionContextDrawer.tsx` and tests
- Modify: `web-app/web/src/desktop-ui/one-shot-interview.css`
- Add/modify: CSS contract tests

- [ ] Write failing DOM/CSS contract tests for common source-field geometry and drawer-body scrolling/focus.
- [ ] Run focused tests and verify RED.
- [ ] Normalize both channel rows and add the dedicated context scroll viewport.
- [ ] Run focused tests/build, browser-check long content at 1280×720, commit, and push.

### Task 9: Return to preparation when the interview ends

**Files:**
- Modify: `web-app/web/src/desktop/Shell.test.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Update: `docs/superpowers/specs/2026-07-21-one-shot-interview-workspace-design.md`
- Update: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-one-shot-interview-workspace.md`

**Interfaces:**
- `Shell.onEndInterview()` sends stop controls for both audio sources, closes live-only overlays, resets the elapsed clock, and changes `phase` from `live` to `setup`.
- `Shell.onSummarize()` remains the only summary-generation entry point.
- `Shell.onStartInterview()` retains the existing `clearSession()` boundary before the next live workspace begins.

- [x] Change the Shell lifecycle test to expect the preparation heading immediately after End, no summary dialog, and no summarize frame.
- [x] Run the focused Shell test and verify RED because the current handler leaves the ended live workspace mounted.
- [x] Implement the minimal lifecycle transition in `onEndInterview()`.
- [x] Run focused tests, full tests, build, in-app-browser End-flow QA, commit, and push.

### Task 1: Lock the one-shot preparation contract

**Files:**
- Create: `web-app/web/src/desktop/InterviewSetup.test.tsx`
- Create: `web-app/web/src/desktop/InterviewSetup.tsx`

**Interfaces:**
- Produces: `InterviewSetupSubmit { jobDescription: string; resumeText: string }`.
- Produces: `onStart(payload)` only when trimmed JD is non-empty and the connection is ready.
- Consumes: existing `ResumeDropzone` extraction callbacks.

- [ ] **Step 1: Write the failing component tests**

```tsx
render(<InterviewSetup ready resumeText="" onResumeTextChange={vi.fn()} onStart={onStart} />);
expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
expect(screen.getByLabelText('职位描述')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '开始面试' })).toBeDisabled();
fireEvent.change(screen.getByLabelText('职位描述'), { target: { value: '物业经理\n负责园区运营。' } });
fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
expect(onStart).toHaveBeenCalledWith({ jobDescription: '物业经理\n负责园区运营。', resumeText: '' });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/InterviewSetup.test.tsx`

Expected: FAIL because `InterviewSetup` does not exist.

- [ ] **Step 3: Implement the minimal preparation form**

```tsx
export interface InterviewSetupSubmit { jobDescription: string; resumeText: string }

export function InterviewSetup(props: InterviewSetupProps) {
  const [jobDescription, setJobDescription] = useState('');
  const submit = () => {
    const jd = jobDescription.trim();
    if (!props.ready || !jd) return;
    props.onStart({ jobDescription: jd, resumeText: props.resumeText.trim() });
  };
  return (
    <main className="interview-setup">
      <section className="interview-setup__panel" aria-labelledby="setup-title">
        <h1 id="setup-title">准备本次面试</h1>
        <ResumeDropzone
          resumeText={props.resumeText}
          onExtracted={props.onResumeTextChange}
          onCleared={() => props.onResumeTextChange('')}
        />
        <label htmlFor="setup-jd">职位描述</label>
        <textarea
          id="setup-jd"
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
        />
        <button type="button" disabled={!props.ready || !jobDescription.trim()} onClick={submit}>
          开始面试
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/InterviewSetup.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add web-app/web/src/desktop/InterviewSetup.tsx web-app/web/src/desktop/InterviewSetup.test.tsx
git commit -m "feat: add one-shot interview preparation"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

### Task 2: Add stable transcript timestamps

**Files:**
- Modify: `web-app/web/src/lib/speakerSegments.ts`
- Modify: `web-app/web/src/lib/speakerSegments.test.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.ts`
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: `web-app/web/src/desktop/TranscriptStream.test.tsx`

**Interfaces:**
- `SpeakerSegment.createdAtMs: number` records first-final arrival.
- `CopilotQuestionEvent.createdAtMs: number` records result arrival.
- `TranscriptMessage.createdAtMs?: number` supports notes/seeded lines.
- `TranscriptStream.startedAtMs?: number | null` formats `HH:MM:SS` elapsed labels.

- [ ] **Step 1: Add failing timestamp/coalescing tests**

```ts
const first = appendSegment([], { id: 1, speakerId: 7, role: 'candidate', text: '第一句', createdAtMs: 1200 });
const second = appendSegment(first, { id: 2, speakerId: 7, role: 'candidate', text: '第二句', createdAtMs: 2400 });
expect(second[0]).toMatchObject({ text: '第一句 第二句', createdAtMs: 1200 });
```

```tsx
render(<TranscriptStream startedAtMs={1_000} speakerSegments={[{ id:1, speakerId:7, role:'candidate', text:'回答', createdAtMs:4_500 }]} {...baseProps} />);
expect(screen.getByText('00:03')).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/speakerSegments.test.ts src/desktop/TranscriptStream.test.tsx`

Expected: FAIL because timestamp fields/rendering do not exist.

- [ ] **Step 3: Implement timestamp storage and formatting**

Add `createdAtMs` to appended and partitioned segments, preserving an existing segment timestamp by `id`. Render a semantic `<time className="transcript-time">` before every timeline item. Use a pure helper:

```ts
export function formatTranscriptTime(createdAtMs: number, startedAtMs: number | null): string {
  const elapsed = Math.max(0, createdAtMs - (startedAtMs ?? createdAtMs));
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const previousTimes = new Map(speakerSegmentsRef.current.map((segment) => [segment.id, segment.createdAtMs]));
const next = message.segments.map((segment) => ({
  id: segment.seq,
  speakerId: segment.speakerId,
  role: effectiveRole(segment.speakerId, segment.role, roleOverrideRef.current),
  text: segment.text,
  createdAtMs: previousTimes.get(segment.seq) ?? Date.now()
}));
```

- [ ] **Step 4: Run focused socket, segment, and transcript tests**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/speakerSegments.test.ts src/lib/useCopilotSocket.test.ts src/desktop/TranscriptStream.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add web-app/web/src/lib/speakerSegments.ts web-app/web/src/lib/speakerSegments.test.ts web-app/web/src/lib/useCopilotSocket.ts web-app/web/src/desktop/TranscriptStream.tsx web-app/web/src/desktop/TranscriptStream.test.tsx
git commit -m "feat: timestamp interview transcript turns"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

### Task 3: Build the live header, context drawer, and dock

**Files:**
- Create: `web-app/web/src/desktop/InterviewHeader.tsx`
- Create: `web-app/web/src/desktop/InterviewHeader.test.tsx`
- Create: `web-app/web/src/desktop/SessionContextDrawer.tsx`
- Create: `web-app/web/src/desktop/SessionContextDrawer.test.tsx`
- Create: `web-app/web/src/desktop/InterviewDock.tsx`
- Create: `web-app/web/src/desktop/InterviewDock.test.tsx`
- Modify: `web-app/web/src/desktop/ChannelCard.tsx`
- Modify: `web-app/web/src/desktop/ResumeDropzone.tsx`
- Modify: `web-app/web/package.json`
- Modify: `web-app/package-lock.json`

**Interfaces:**
- `InterviewHeader` exposes `onClear`, `onToggleContext`, and `onEnd`.
- `SessionContextDrawer` receives `open`, `state`, and `onClose` and owns Escape/focus semantics.
- `InterviewDock` receives the existing audio lanes/start/stop/device/note callbacks.

- [ ] **Step 1: Install the icon library and add failing component tests**

Run: `cd web-app && npm install @phosphor-icons/react --workspace @open-cluely/web`

Tests assert the visible header metadata, drawer `aria-expanded` lifecycle and state content, and dock note/audio callbacks without relying on icon implementation.

- [ ] **Step 2: Run component tests and verify RED**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/InterviewHeader.test.tsx src/desktop/SessionContextDrawer.test.tsx src/desktop/InterviewDock.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the three focused components**

Use Phosphor `Brain`, `X`, `Trash`, `StopCircle`, `Microphone`, `Desktop`, `ArrowReturnDown`, `UploadSimple`, and `CheckCircle` icons. Keep `SessionContextPanel` as the drawer body. Keep the existing `ChannelCard` capture/device logic but simplify visible markup and remove emoji/inline SVG icon fallbacks. The drawer contract is:

```tsx
export function SessionContextDrawer({ open, state, onClose }: SessionContextDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <aside id="session-context-drawer" className="context-drawer" data-open={open} aria-hidden={!open}>
      <header><h2>会话上下文</h2><button aria-label="关闭会话上下文" onClick={onClose}><X /></button></header>
      <SessionContextPanel state={state} />
    </aside>
  );
}
```

- [ ] **Step 4: Run focused component tests and web build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/InterviewHeader.test.tsx src/desktop/SessionContextDrawer.test.tsx src/desktop/InterviewDock.test.tsx src/desktop/ChannelCard.test.tsx && npm run build --workspace @open-cluely/web`

Expected: PASS and TypeScript build exit 0.

- [ ] **Step 5: Commit and push**

```bash
git add web-app/package-lock.json web-app/web/package.json web-app/web/src/desktop/InterviewHeader.tsx web-app/web/src/desktop/InterviewHeader.test.tsx web-app/web/src/desktop/SessionContextDrawer.tsx web-app/web/src/desktop/SessionContextDrawer.test.tsx web-app/web/src/desktop/InterviewDock.tsx web-app/web/src/desktop/InterviewDock.test.tsx web-app/web/src/desktop/ChannelCard.tsx web-app/web/src/desktop/ResumeDropzone.tsx
git commit -m "feat: add focused live interview controls"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

### Task 4: Replace the old shell and selected visual layer

**Files:**
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/desktop/Shell.test.tsx`
- Modify: `web-app/web/src/desktop/QuestionCard.tsx`
- Create: `web-app/web/src/desktop-ui/one-shot-interview.css`
- Modify: `web-app/web/src/main.tsx`

**Interfaces:**
- Shell state is `phase:'setup'|'live'`, config context, timer, drawer state, and summary visibility.
- The live surface imports only `InterviewHeader`, `TranscriptStream`, `SessionContextDrawer`, `InterviewDock`, and `SummaryModal`.

- [ ] **Step 1: Replace retired-shell assertions with failing one-shot workflow tests**

```tsx
render(<Shell />);
expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
expect(screen.queryByText('题库')).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: /移动端/ })).not.toBeInTheDocument();
fireEvent.change(screen.getByLabelText('职位描述'), { target: { value: '物业经理\n负责园区运营。' } });
fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
expect(await screen.findByRole('button', { name: '结束面试' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '打开会话上下文' })).toBeInTheDocument();
```

Retain and adapt tests for fixed config, progressive caption, speaker role correction, auto-result anchoring, capture-stop history preservation, and summary.

- [ ] **Step 2: Run Shell tests and verify RED**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/Shell.test.tsx`

Expected: FAIL because the old nav/right-rail shell still renders.

- [ ] **Step 3: Implement the phase-based Shell**

Remove imports/rendering for `QuestionBank`, `TitleBar`, `Sidebar`, `Topbar`, `Composer`, `RightRail`, `SettingsModal`, `InterviewTypeModal`, `SpotlightTour`, and view/rail/tour state. Keep socket lifecycles, full fixed config, candidate buffer derivation, note handling, clear/reset, timer, speaker role callbacks, and summary. Wire lifecycle actions explicitly:

```ts
const onStartInterview = ({ jobDescription, resumeText }: InterviewSetupSubmit): void => {
  onClearSession();
  setConfig({ jobDescription, resumeText, interviewGuide: [], interviewType: 'online' });
  pushConfig({ jobDescription, resumeText, interviewGuide: [], diarize: true });
  setInterviewTitle(inferInterviewTitle(jobDescription));
  setPhase('live');
};

const onEndInterview = (): void => {
  stopAudio('display');
  stopAudio('mic');
  setSummaryOpen(true);
  startSummary(clientSummaryTranscript);
};
```

- [ ] **Step 4: Implement the visual layer**

`one-shot-interview.css` recreates the selected reference using existing tokens: thin header, centered timeline, timestamp gutter/guide, flat role turns, slim AI insert, fixed dock, and responsive context drawer. It explicitly overrides legacy chat/channel styles under `.one-shot-app` without gradients or large rounded cards.

- [ ] **Step 5: Run Shell/transcript/component tests and build**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/desktop/Shell.test.tsx src/desktop/TranscriptStream.test.tsx src/desktop/QuestionCard.test.tsx && npm run build --workspace @open-cluely/web`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit and push**

```bash
git add web-app/web/src/desktop/Shell.tsx web-app/web/src/desktop/Shell.test.tsx web-app/web/src/desktop/QuestionCard.tsx web-app/web/src/desktop-ui/one-shot-interview.css web-app/web/src/main.tsx
git commit -m "feat: launch the minimal GLP interview workspace"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

### Task 5: Documentation, full verification, rebuild, and design QA

**Files:**
- Update: matching notes in `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/`
- Create: `design-qa.md`

**Interfaces:**
- Produces: a running production build at `http://127.0.0.1:8788/`.
- Produces: `design-qa.md` with `final result: passed` only after visible P0/P1/P2 issues are fixed.

- [ ] **Step 1: Update implementation notes**

Document purpose, entry points, data flow, config/state, and gotchas for one-shot shell, automatic context drawer, and timestamp preservation.

- [ ] **Step 2: Run fresh full verification**

Run: `cd web-app && npm test && npm run build`

Expected: every package test passes and production build exits 0.

- [ ] **Step 3: Restart the production server**

Stop the old port-8788 server, run `PORT=8788 npm start` from `web-app`, and keep it running.

- [ ] **Step 4: Verify in the in-app browser**

Exercise initial preparation, JD entry, start, context drawer, clear action, audio controls, progressive partial display, role toggle, anchored AI result, note entry, and end-summary interaction. Inspect console-visible errors through the selected browser surface.

- [ ] **Step 5: Run blocking visual QA**

Capture the implementation at the same interaction state as the selected reference, place both images in one side-by-side comparison artifact, inspect typography/layout/spacing/color/icons/states/responsiveness/accessibility, fix all P0/P1/P2 findings, and repeat until project-root `design-qa.md` says `final result: passed`.

- [ ] **Step 6: Commit, push, and verify remote main**

```bash
git add design-qa.md docs/superpowers/specs/2026-07-21-one-shot-interview-workspace-design.md docs/superpowers/plans/2026-07-21-one-shot-interview-workspace.md
git commit -m "docs: verify one-shot interview workspace"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
git fetch git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:refs/remotes/origin/main
git rev-parse HEAD origin/main
```

Expected: local `HEAD` and `origin/main` hashes match.

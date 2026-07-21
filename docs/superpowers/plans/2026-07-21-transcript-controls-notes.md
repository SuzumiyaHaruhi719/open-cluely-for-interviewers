# Transcript Controls and Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore manual Expert questioning, make long live transcripts independently scrollable, and place timestamped notes correctly in the transcript and Session Context.

**Architecture:** Reuse the existing `useCopilotSocket().analyze()` transport and `InterviewHeader` action surface. Constrain the live stage so `TranscriptStream` owns vertical overflow, merge timestamped message/ASR items before rendering, and pass the same local note records into the context drawer.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS Grid, WebSocket client.

## Global Constraints

- Keep the current GLP design language and one-shot interview workflow.
- Doubao remains the only user-facing ASR provider.
- Expert and Auto share the existing one-call DeepSeek Flash generation path.
- Notes must be ordered by elapsed interview time, not by event type.
- Preserve all existing audio, summary, speaker-role, and question anchoring behavior.

---

### Task 1: Restore manual Expert questioning

**Files:**
- Modify: `web-app/web/src/desktop/InterviewHeader.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/desktop-ui/one-shot-interview.css`
- Test: `web-app/web/src/desktop/InterviewHeader.test.tsx`
- Test: `web-app/web/src/desktop/Shell.test.tsx`

**Interfaces:**
- Consumes: `useCopilotSocket().analyze(candidateAnswer, questionHistory)`.
- Produces: `InterviewHeader` props `canAnalyze`, `isAnalyzing`, and `onAnalyze`.

- [ ] **Step 1: Write failing header and shell tests**

```tsx
expect(screen.getByRole('button', { name: '手动追问' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: '手动追问' }));
expect(sentMessages(ws)).toContainEqual(expect.objectContaining({
  type: 'analyze',
  candidateAnswer: expect.stringContaining('候选人证据')
}));
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test --workspace @open-cluely/web -- InterviewHeader.test.tsx Shell.test.tsx`

Expected: FAIL because the one-shot header has no manual question action.

- [ ] **Step 3: Implement the minimal manual action**

```tsx
const manualCandidateAnswer = speakerSegments
  .filter((segment) => segment.role === 'candidate')
  .map((segment) => segment.text.trim())
  .filter(Boolean)
  .join(' ')
  .slice(-6000);

const onAnalyze = () => {
  if (!isReady || isAnalyzing || !manualCandidateAnswer) return;
  analyze(manualCandidateAnswer, questionEvents.map((event) => event.result.output.primary_question));
};
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace @open-cluely/web -- InterviewHeader.test.tsx Shell.test.tsx`

Expected: both files pass and the emitted request uses `trigger: manual` when the server replies.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/desktop/InterviewHeader.tsx web-app/web/src/desktop/Shell.tsx web-app/web/src/desktop-ui/one-shot-interview.css web-app/web/src/desktop/InterviewHeader.test.tsx web-app/web/src/desktop/Shell.test.tsx
git commit -m "feat: restore manual expert follow-ups"
```

### Task 2: Make the transcript a real user-controlled scroll viewport

**Files:**
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: `web-app/web/src/desktop-ui/one-shot-interview.css`
- Test: `web-app/web/src/desktop/TranscriptStream.test.tsx`
- Test: `web-app/web/src/desktop/oneShotInterviewStyles.test.ts`

**Interfaces:**
- Consumes: existing `autoScroll` prop.
- Produces: scroll-follow state derived from distance to the bottom.

- [ ] **Step 1: Write failing behavior and CSS-contract tests**

```tsx
fireEvent.scroll(log, { target: { scrollTop: 100 } });
rerender(<TranscriptStream {...propsWithNewPartial} />);
expect(log.scrollTop).toBe(100);
```

```ts
expect(workspaceRule).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
expect(messagesRule).toMatch(/scrollbar-gutter:\s*stable/);
expect(messagesRule).toMatch(/overscroll-behavior-y:\s*contain/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @open-cluely/web -- TranscriptStream.test.tsx oneShotInterviewStyles.test.ts`

Expected: FAIL because the stage expands with content and Auto always forces the bottom.

- [ ] **Step 3: Implement constrained layout and follow suspension**

```tsx
const followLatestRef = useRef(true);
const onScroll = () => {
  const el = containerRef.current;
  if (el) followLatestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
};
```

```css
.interview-workspace { display: grid; grid-template-rows: minmax(0, 1fr); }
.interview-stage { height: 100%; }
.one-shot-app .chat-messages {
  scrollbar-gutter: stable;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace @open-cluely/web -- TranscriptStream.test.tsx oneShotInterviewStyles.test.ts`

Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/desktop/TranscriptStream.tsx web-app/web/src/desktop-ui/one-shot-interview.css web-app/web/src/desktop/TranscriptStream.test.tsx web-app/web/src/desktop/oneShotInterviewStyles.test.ts
git commit -m "fix: make live transcripts independently scrollable"
```

### Task 3: Merge notes chronologically and show them in Session Context

**Files:**
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: `web-app/web/src/desktop/SessionContextDrawer.tsx`
- Modify: `web-app/web/src/desktop/SessionContextPanel.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/desktop-ui/one-shot-interview.css`
- Test: `web-app/web/src/desktop/TranscriptStream.test.tsx`
- Test: `web-app/web/src/desktop/SessionContextPanel.test.tsx`
- Test: `web-app/web/src/desktop/Shell.test.tsx`

**Interfaces:**
- Consumes: `TranscriptMessage.createdAtMs`, `SpeakerSegment.createdAtMs`, and `startedAtMs`.
- Produces: stable chronological timeline items and `SessionContextPanel` notes `{ text, createdAtMs }[]`.

- [ ] **Step 1: Write failing chronology tests**

```tsx
expect(timeline.map((node) => node.textContent)).toEqual([
  expect.stringContaining('第一段转写'),
  expect.stringContaining('03:54 备注'),
  expect.stringContaining('第二段转写')
]);
expect(within(context).getByText('03:54 备注')).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @open-cluely/web -- TranscriptStream.test.tsx SessionContextPanel.test.tsx Shell.test.tsx`

Expected: FAIL because notes are prepended and the context panel has no note input.

- [ ] **Step 3: Implement stable timeline merging and context-note rendering**

```ts
const ordered = [...messages, ...segments].sort((left, right) =>
  left.createdAtMs - right.createdAtMs || left.stableIndex - right.stableIndex
);
```

Render notes in a dedicated `面试备注` context block, sorted ascending and timestamped with `formatTranscriptTime`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace @open-cluely/web -- TranscriptStream.test.tsx SessionContextPanel.test.tsx Shell.test.tsx`

Expected: all focused files pass.

- [ ] **Step 5: Commit**

```bash
git add web-app/web/src/desktop/TranscriptStream.tsx web-app/web/src/desktop/SessionContextDrawer.tsx web-app/web/src/desktop/SessionContextPanel.tsx web-app/web/src/desktop/Shell.tsx web-app/web/src/desktop-ui/one-shot-interview.css web-app/web/src/desktop/TranscriptStream.test.tsx web-app/web/src/desktop/SessionContextPanel.test.tsx web-app/web/src/desktop/Shell.test.tsx
git commit -m "fix: order interview notes by timeline time"
```

### Task 4: Release verification and portable environment handoff

**Files:**
- Update: `C:\\Users\\Thomas\\Documents\\Obsidian\\WTATC\\Interview Copilot\\Implementation\\live-transcript.md`
- Create locally: `/Users/thomasli/Downloads/open-cluely-models.env`

**Interfaces:**
- Consumes: root `.env.portable` and production build.
- Produces: rebuilt app, MP3 browser acceptance state, synchronized `origin/main`, and a mode-0600 portable environment file in Downloads.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test && npm run build` from `web-app`.

Expected: all core, question-bank, server, and web tests pass; production assets build.

- [ ] **Step 2: Rebuild/restart and replay the supplied recording**

Use `BlackHole 2ch` to feed the normalized recording into the actual frontend. Verify the manual button, visible scrollbar, upward scrolling without snap-back, chronological note placement, context-note section, and an Auto question under its evidence.

- [ ] **Step 3: Update implementation notes**

Document entry points, layout/data flow, state, and the parent-height/chronological-merge gotchas in the Obsidian `Implementation` note.

- [ ] **Step 4: Export the portable environment file**

Run: `npm run env:export`, copy `.env.portable` to `/Users/thomasli/Downloads/open-cluely-models.env`, set mode `0600`, and verify the destination contains the same active-key count without printing secrets.

- [ ] **Step 5: Commit and push**

```bash
git add <changed project files>
git commit -m "fix: complete live interview transcript controls"
git push origin main
```

Expected: `HEAD`, `origin/main`, and remote `refs/heads/main` match.

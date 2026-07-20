# Remove Legacy Assistant Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete meeting-notes, insights, and unused free-form assistant subsystem while preserving the GLP topbar, final interview summary, inline Expert follow-ups, live context, and clear-session action.

**Architecture:** Delete the legacy assistant path at its boundaries: topbar controls and floating panel in React, typed HTTP wrappers in the client, and the Express assistant router on the server. Keep the existing summary WebSocket and Expert pipeline untouched. Tests first assert the simplified menu and unmounted endpoints, then the implementation removes all unreachable code and panel-only styling.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Express, Node test runner, CSS, npm workspaces.

## Global Constraints

- Keep the current GLP layout and styling.
- Keep “总结面试,” automatic/manual inline Expert follow-ups, live session context, and “清空会话.”
- Do not change summary prompts/models, automatic Expert triggering, or speaker-role correction.
- Removed `/api/assistant/*` endpoints must return the normal application 404.
- Work directly on `main`; commit and push each independently verifiable checkpoint.

---

### Task 1: Simplify the GLP topbar and remove the dead client subsystem

**Files:**
- Create: `web-app/web/src/desktop/Topbar.test.tsx`
- Modify: `web-app/web/src/desktop/Topbar.tsx`
- Modify: `web-app/web/src/desktop/Shell.tsx`
- Modify: `web-app/web/src/lib/api.ts`
- Modify: `web-app/web/src/lib/api.test.ts`
- Modify: `web-app/web/src/desktop-ui/styles.css`
- Modify: `web-app/web/src/web-extras.css`
- Delete: `web-app/web/src/desktop/ResultsPanel.tsx`
- Delete: `web-app/web/src/desktop/useAssistantPanel.ts`

**Interfaces:**
- Consumes: existing `TopbarProps`, `Shell`, `sendJson()`, GLP `.more-menu*` classes.
- Produces: `Topbar` with `onClearSession` as the only more-menu action; no assistant-panel state or assistant HTTP wrappers.

- [x] **Step 1: Write the failing topbar test**

Create `Topbar.test.tsx` with a complete baseline render and assert the menu contains only the retained destructive utility:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Topbar } from './Topbar';

describe('Topbar interviewer actions', () => {
  test('keeps clear-session but removes legacy meeting notes and insights', () => {
    render(
      <Topbar
        title="物业经理面试"
        mode="expert"
        asrProvider="xfyun"
        status="open"
        capturing={false}
        timer="00:00"
        isLive={false}
        screenshotCount={0}
        canAnalyze
        isAnalyzing={false}
        onAnalyze={vi.fn()}
        onClearSession={vi.fn()}
        onSummarize={vi.fn()}
        autoGenerate
        autoMonitorStatus="waiting"
        onToggleAuto={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('menuitem', { name: '清空会话' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '会议纪要' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '洞察' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '总结面试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成追问' })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test --workspace @open-cluely/web -- Topbar.test.tsx
```

Expected: FAIL because current `TopbarProps` still requires `onMeetingNotes`, `onInsights`, and `assistantBusy`, and the menu still renders both removed actions.

- [x] **Step 3: Remove the legacy client path**

Apply these exact interface changes:

```tsx
// TopbarProps retains only:
onSummarize: () => void;
autoGenerate: boolean;
autoMonitorStatus?: AutoMonitorStatus;
onToggleAuto: () => void;
```

Remove the two legacy menu buttons while retaining the existing separator-free “清空会话” item. In `Shell.tsx`, remove `ResultsPanel`, `useAssistantPanel`, `assistant`, `transcriptText`, `onMeetingNotes`, `onInsights`, their `Topbar` props, and the `<ResultsPanel />` render. In `api.ts`, delete `AssistantReplyResponse`, `assistantAsk`, `assistantNotes`, and `assistantInsights`. Remove their three request assertions/imports from `api.test.ts`. Delete the two dead component/hook files and remove `.results-*`, `.result-text`, panel-only scrollbar selectors, and the panel-only `.plain-text__p` rule.

- [x] **Step 4: Run focused and full web tests**

Run:

```bash
npm test --workspace @open-cluely/web -- Topbar.test.tsx
npm run test:web
```

Expected: PASS with no references to meeting notes, insights, `ResultsPanel`, `useAssistantPanel`, or `/api/assistant/*` under `web-app/web/src`.

- [x] **Step 5: Commit and push the client checkpoint**

```bash
git add web-app/web/src
git commit -m "refactor: remove legacy assistant actions from workspace"
git push origin main
```

### Task 2: Unmount and delete the legacy server routes

**Files:**
- Create: `web-app/server/test/removed-assistant-routes.test.ts`
- Modify: `web-app/server/src/app.ts`
- Delete: `web-app/server/src/routes/assistant.ts`
- Modify: `web-app/server/test/assistant.test.ts` (remove the three assistant-route cases; retain its résumé-chat coverage)

**Interfaces:**
- Consumes: `createApp(): Express` and Express default 404 behavior.
- Produces: no mounted `/api/assistant` router; all three legacy endpoint requests receive HTTP 404 without a DashScope call.

- [x] **Step 1: Write the failing removed-route test**

Create `removed-assistant-routes.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

test('legacy assistant endpoints are not mounted', async () => {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    for (const path of ['ask', 'notes', 'insights']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x', transcript: 'x' })
      });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
```

- [x] **Step 2: Run the focused server test and verify RED**

Run:

```bash
npm test --workspace @open-cluely/server -- removed-assistant-routes.test.ts
```

Expected: FAIL because `/api/assistant/ask`, `/notes`, and `/insights` are still mounted and return 200 with configured test credentials or 503 without them, not 404.

- [x] **Step 3: Remove the server subsystem**

Delete the import and mount from `server/src/app.ts`:

```ts
// delete
import { createAssistantRouter } from './routes/assistant';
app.use('/api/assistant', createAssistantRouter());
```

Delete `server/src/routes/assistant.ts`. Remove only the three assistant-route cases from `assistant.test.ts`; retain the fetch stub and résumé-chat tests because `/api/resume/chat` still uses DashScope.

- [x] **Step 4: Run focused and full server tests plus typecheck**

Run:

```bash
npm test --workspace @open-cluely/server -- removed-assistant-routes.test.ts
npm run test:server
npm run typecheck --workspace @open-cluely/server
```

Expected: PASS and `rg -n "createAssistantRouter|/api/assistant|assistantNotes|assistantInsights" web-app/server/src web-app/web/src` returns no matches.

- [x] **Step 5: Commit and push the server checkpoint**

```bash
git add web-app/server/src web-app/server/test
git commit -m "refactor: retire unused assistant HTTP routes"
git push origin main
```

### Task 3: Document, verify, rebuild, and accept the simplified UI

**Files:**
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/interviewer-ai-surfaces.md`
- Modify: no product code unless verification exposes a regression.

**Interfaces:**
- Consumes: production build served by `PORT=8788 npm start`, in-app browser at `http://127.0.0.1:8788/`.
- Produces: a contributor-facing implementation note and browser-verified production artifact.

- [ ] **Step 1: Write the implementation note**

Create a note containing the required sections:

```markdown
# Interviewer AI Surfaces

## Purpose
Explain that live Expert follow-ups, live context, and final summary are the only retained AI surfaces.

## Entry points
List `web-app/web/src/desktop/Topbar.tsx:Topbar`, `Shell.tsx:Shell`, and the summary/Expert WebSocket entry points.

## Data flow
Describe transcript → sentinel → Expert inline question and transcript/JD → summary.

## Config / state
List `autoGenerate`, `summaryModel`, socket question events, session context, and summary state.

## Gotchas
State that generic assistant HTTP routes and floating results panels must not be reintroduced because they bypass corrected roles and JD-grounded Expert context.
```

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: all suites and both production builds pass; no whitespace errors; the application repository is clean after its code checkpoints. The Obsidian note appears only in the vault repository.

- [ ] **Step 3: Verify the implementation note is queued for vault sync**

```bash
git -C /Users/thomasli/Documents/github/Obsidian status --short -- 'Interview Copilot/Implementation/interviewer-ai-surfaces.md'
```

Expected: the note is listed as added or modified. The vault's session-end automation owns its commit and push, as required by this repository's `AGENTS.md`.

- [ ] **Step 4: Rebuild and launch the production server**

Run:

```bash
PORT=8788 npm start
```

Expected: health endpoint returns HTTP 200 and the rebuilt browser client loads at `http://127.0.0.1:8788/`.

- [ ] **Step 5: Verify in the in-app browser**

Open the topbar more-menu and assert visually/semantically:

```text
Present: 总结面试, 生成追问, 更多操作, 清空会话
Absent: 会议纪要, 洞察
```

Keep the app tab deliverable and finalize the browser session.

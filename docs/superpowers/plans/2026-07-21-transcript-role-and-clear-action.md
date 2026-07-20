# Transcript Role Repair and Visible Clear Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one continuous candidate answer in the candidate lane after Doubao acoustic-ID drift, preserve genuine interviewer/evaluation turns, and expose “清空会话” directly in the GLP topbar.

**Architecture:** The server keeps DeepSeek cluster/turn inference as the primary role source, then applies a small pure local-override function to the resolved chronological turns before candidate/interviewer events are emitted. The override is deliberately turn-scoped: it repairs a candidate/interviewer/candidate answer-plan sandwich and unmistakable score announcements, then routes the suggested role through the existing manual-role resolver. The renderer removes the now-empty overflow menu and renders the existing clear callback as a normal secondary action.

**Tech Stack:** TypeScript, Node test runner, React 18, Vitest/Testing Library, Vite, existing GLP CSS.

## Global Constraints

- ASR remains fixed to Doubao Seed ASR 2.0; do not add a provider setting or fallback.
- Speaker-role monitoring remains `deepseek-v4-flash`, thinking disabled, with the existing 8-second request budget.
- Never remap a whole acoustic cluster from a local semantic exception.
- Manual speaker corrections always win.
- Multiple interviewer clusters and one candidate must remain supported.
- Keep the existing GLP visual language; add no new settings or menus.

---

### Task 1: Conservative turn-level role repair

**Files:**
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-offline-speaker-diarization.md`

**Interfaces:**
- Consumes: `SpeakerTurn`, `SpeakerRole`, the resolved cluster/turn role inside `createSpeakerPartitioner().schedule()`, and `deps.resolveTurnRole(speakerId, inferredRole)`.
- Produces: `findLocalRoleOverrides(turns): Map<number, SpeakerRole>` (module-local), applied before `onCandidateTurn`, `onInterviewerTurn`, `coalesce()`, and `onPartition()`.

- [ ] **Step 1: Write the failing real-transcript regression**

Add a test whose model response maps speaker `1` to candidate and speaker `2` to interviewer, then records these consecutive native turns:

```ts
[
  [0, 2, '好，请听第三题。某小区自来水管道总是破裂，如果你是社区工作人员应该怎么解决？'],
  [1, 1, '各位考官，作为社区工作人员，我会立即赶赴现场，拉开争执双方并说明应当冷静协商。'],
  [2, 2, '目前会向双方进行一下询问，首先向居民询问水管破裂频次以及是否通过正规渠道反映。'],
  [3, 1, '然后向维修人员询问破裂原因，并根据情况协调处理和跟踪复验。'],
  [4, 1, '最高分八十九分，最低分八十三点五分，二号考生最终成绩为八十点六分。'],
  [5, 2, '好，请考生确认分数并离场。']
]
```

Assert final roles are `interviewer, candidate, candidate, candidate, interviewer, interviewer`; candidate release includes seq `1,2,3`; interviewer release includes seq `0,4,5`. Add a second assertion case showing `请具体说明你本人做了什么？` between candidate turns remains interviewer.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app/server && npx tsx --test --test-name-pattern='repairs the real Seed answer split' test/speaker-partitioner.test.ts
```

Expected: FAIL because seq `2` follows the interviewer acoustic baseline and seq `4` follows the candidate baseline.

- [ ] **Step 3: Implement the minimal local override**

In `speaker-partitioner.ts`, add high-precision Chinese predicates:

```ts
const INTERVIEWER_HANDOFF = /^(?:好[，,。]?|谢谢|请(?:听|问|介绍|说明|结合|谈|回答|确认)|下面|下一题|接下来请|你(?:如何|为什么|是否|能否)|能否|请考生)/;
const CANDIDATE_PLAN = /(?:^|[，。；：,\s])(?:我(?:会|将|要|先|再|还|可以|需要|负责|认为|觉得|就)|作为[^，。]{0,18}我|首先|其次|然后|随后|那么|目前(?:我)?会|根据[^，。]{0,24}(?:情况|结果))/;
const SCORE_ANNOUNCEMENT = /(?:最高分|最低分).{0,100}(?:号)?考生(?:的)?最终成绩/;
```

Build preliminary resolved turns first. Suggest `interviewer` for a score announcement. Suggest `candidate` only when a middle interviewer turn has direct same-source candidate neighbours, matches `CANDIDATE_PLAN` or a bounded (≤80 non-whitespace characters) `CONTINUATION_PREFIX`, and does not match `INTERVIEWER_HANDOFF`. Treat directed connective questions such as `所以你当时如何…` as hand-offs. Symmetrically, repair a ≤120-character interviewer question stem only when it is between direct interviewer neighbours, the next turn is an explicit prompt tail (`对此，请谈谈…`), and the middle lacks a strong candidate-answer opening. Defer either ambiguous live tail for one semantic turn so it cannot close or trigger Auto prematurely. Apply each native-turn suggestion through `resolveTurnRole()` so a manual lock can reject it. Feed Auto and coalesce only after the repaired roles are final.

- [ ] **Step 4: Run focused and full speaker tests and verify GREEN**

Run:

```bash
cd web-app/server && npx tsx --test test/speaker-partitioner.test.ts test/speaker-roles.test.ts test/ws-speaker.test.ts test/ws-audio-finalization.test.ts
```

Expected: all tests PASS, including existing multi-interviewer and manual-precedence cases.

- [ ] **Step 5: Update implementation notes and commit**

Document the local answer-envelope/evaluation override, its manual-precedence path, and the real Seed boundary in the two implementation notes. Then run `git diff --check` and commit:

```bash
git add web-app/server/src/speaker-partitioner.ts web-app/server/test/speaker-partitioner.test.ts
git commit -m "fix: keep split candidate answers together"
```

The Obsidian notes are outside the application repository and remain un-staged here.

---

### Task 2: Visible Clear Session action

**Files:**
- Modify: `web-app/web/src/desktop/Topbar.test.tsx`
- Modify: `web-app/web/src/desktop/Topbar.tsx`
- Modify: `web-app/web/src/desktop-ui/styles.css`

**Interfaces:**
- Consumes: existing `TopbarProps.onClearSession: () => void`.
- Produces: one direct `button#clear-btn.action-btn` with accessible name `清空会话`; removes the empty `more-menu` surface.

- [ ] **Step 1: Write the failing topbar test**

Render `Topbar`, assert `screen.getByRole('button', { name: '清空会话' })` is visible without opening a menu, assert `screen.queryByRole('button', { name: '更多操作' })` is absent, click clear, and assert the callback was called once.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app/web && npx vitest run src/desktop/Topbar.test.tsx
```

Expected: FAIL because the clear action is still a hidden `menuitem` and `更多操作` still renders.

- [ ] **Step 3: Implement the minimal topbar change**

Remove `useEffect`, `useRef`, `useState`, `KebabIcon`, and all overflow state/markup from `Topbar.tsx`. Render:

```tsx
<button id="clear-btn" className="action-btn" type="button" onClick={onClearSession}>
  清空会话
</button>
```

Delete the now-unused `.more-menu*` styles and update narrow-topbar comments to describe the visible action set.

- [ ] **Step 4: Run focused and full web tests and verify GREEN**

Run:

```bash
cd web-app/web && npx vitest run src/desktop/Topbar.test.tsx src/desktop/Shell.test.tsx
npm test
```

Expected: all tests PASS and no test looks for the removed overflow button.

- [ ] **Step 5: Commit and push the UI checkpoint**

```bash
git add web-app/web/src/desktop/Topbar.tsx web-app/web/src/desktop/Topbar.test.tsx web-app/web/src/desktop-ui/styles.css
git commit -m "fix: expose clear session in topbar"
git push origin main
```

---

### Task 3: Product-level verification and rebuild

**Files:**
- Verify: `web-app/server/src/speaker-partitioner.ts`
- Verify: `web-app/web/src/desktop/Topbar.tsx`
- Verify: production outputs generated by existing build scripts (do not commit ignored build artifacts).

**Interfaces:**
- Consumes: server speaker partitions and renderer toolbar.
- Produces: fresh test/build evidence and a rebuilt app at the existing local preview URL.

- [ ] **Step 1: Run static and regression verification**

Run:

```bash
cd web-app
npm run typecheck --workspace @open-cluely/server
npm test
cd ..
git diff --check
```

Expected: server typecheck and all core/question-bank/server/web tests pass; `git diff --check` prints nothing.

- [ ] **Step 2: Build server and web production bundles**

Run:

```bash
cd web-app && npm run build
```

Expected: the Vite client and bundled Node server both exit `0` with no TypeScript error.

- [ ] **Step 3: Restart the validated local production listener**

Resolve the listener before stopping anything:

```bash
qa_listener_pid="$(lsof -tiTCP:8788 -sTCP:LISTEN)"
lsof -nP -iTCP:8788 -sTCP:LISTEN
ps -p "$qa_listener_pid" -o pid=,command=
```

Only if the command is the repository-owned `web-app/server/dist/index.js`, stop that exact PID, then launch from `web-app`:

```bash
kill "$qa_listener_pid"
PORT=8788 npm start
curl -fsS http://127.0.0.1:8788/api/health
```

Expected: the health endpoint returns HTTP 200 with `ok:true`; do not add a second product configuration.

- [ ] **Step 4: Browser acceptance**

Confirm `清空会话` is directly visible, `更多操作` is absent, replay the MP3 through BlackHole, verify the candidate answer fragment remains candidate, verify the score announcement/interviewer prompt remain interviewer, and confirm an inline automatic Expert follow-up still appears in under 10 seconds with non-zero token usage.

- [ ] **Step 5: Final commit/push only if verification produced tracked fixes**

Run `git status --short --branch`, commit any intentional verification fix with a scoped message, push `main`, and verify local `HEAD` equals `origin/main`.

# Tour Theme and Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the onboarding tour follow the active app theme and automatically reveal or safely fall back for hidden step targets.

**Architecture:** Theme behavior is CSS-only through semantic `--tour-*` variables mapped to the existing app tokens. Positioning is step-aware and run-scoped: right-rail steps trigger the existing rail toggle before measurement, every navigation invalidates old geometry, and unavailable targets render centered instead of reusing stale coordinates.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, vanilla ES modules, CSS custom properties, Electron renderer DOM.

## Global Constraints

- Preserve tour copy, step order, keyboard controls, progress, animation, and session persistence.
- Do not introduce separate tour theme state; follow `html[data-theme]`.
- Reopen the right rail through `#toggle-rail-btn`, never by directly changing React state or storage.
- Hidden targets must use centered fallback and must never retain previous geometry.
- Run `npm run build` from `web-app/` after implementation.

---

### Task 1: Web hidden-target regression coverage

**Files:**
- Create: `web-app/web/src/desktop/SpotlightTour.test.tsx`
- Modify: `web-app/web/src/desktop/SpotlightTour.tsx`

**Interfaces:**
- Consumes: `SpotlightTour()` and DOM ids `#toggle-rail-btn`, `#btn-new-interview`, `#jd-input`, `#resume-dropzone`.
- Produces: step metadata `requiresRightRail?: boolean`, run-scoped `reposition(idx)` behavior, and centered fallback state.

- [ ] **Step 1: Write failing rail-reveal and fallback tests**

Create a Testing Library harness with deterministic rectangles. The collapsed harness toggle removes `body.rail-collapsed`; the JD rectangle returns zero while collapsed and a distinct rectangle after expansion.

```tsx
test('reopens the right rail before positioning the JD step', async () => {
  document.body.classList.add('rail-collapsed');
  const onToggleRail = vi.fn(() => document.body.classList.remove('rail-collapsed'));
  render(<TourHarness onToggleRail={onToggleRail} jdVisible />);
  await openTourAndAdvanceToJd();
  expect(onToggleRail).toHaveBeenCalledTimes(1);
  expect(screen.getByText('② 粘贴岗位描述')).toBeInTheDocument();
  expect(document.querySelector<HTMLElement>('.tour-spotlight-ring')?.style.left).toBe('494px');
});

test('centers the current step when its target remains unavailable', async () => {
  render(<TourHarness jdVisible={false} />);
  await openTourAndAdvanceToJd();
  expect(screen.getByText('② 粘贴岗位描述')).toBeInTheDocument();
  expect(document.querySelector('.tour-spotlight-ring')).toBeNull();
  expect(document.querySelector<HTMLElement>('.tour-tooltip')?.style.left).toBe('50%');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test --workspace @open-cluely/web -- src/desktop/SpotlightTour.test.tsx`

Expected: FAIL because the rail toggle is never clicked and unavailable JD retains the preceding geometry or disappears.

- [ ] **Step 3: Implement run-scoped target reveal and fallback**

Add right-rail metadata to JD/résumé steps and helpers with these contracts:

```ts
interface TourStep {
  selector: string | null;
  title: string;
  desc: string;
  icon: string;
  isWelcome?: boolean;
  isFinal?: boolean;
  requiresRightRail?: boolean;
}

function revealStepContainer(step: TourStep): number {
  if (step.requiresRightRail && document.body.classList.contains('rail-collapsed')) {
    document.querySelector<HTMLButtonElement>('#toggle-rail-btn')?.click();
    return 350;
  }
  return 0;
}
```

At the start of `reposition`, increment `positionRunRef`, clear `rect`/`ttPos`, clear fallback, and capture the run id. After reveal + scroll delays, ignore callbacks whose run id is stale. If measurement fails, set `centeredFallback` for the current run. Treat `centeredFallback` as centered in render.

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run: `npm test --workspace @open-cluely/web -- src/desktop/SpotlightTour.test.tsx`

Expected: both tests PASS.

---

### Task 2: Theme-aware tour chrome

**Files:**
- Create: `web-app/web/src/desktop/tourTheme.test.ts`
- Modify: `web-app/web/src/web-extras.css`
- Modify: `web-app/web/src/desktop/SpotlightTour.tsx`
- Modify: `src/windows/assistant/tour.css`
- Modify: `src/windows/assistant/tour.js`

**Interfaces:**
- Consumes: web GLP tokens (`--surface-elevated`, `--text-primary`, `--text-secondary`, `--border-default`, `--brand-500`) and `html[data-theme]`.
- Produces: semantic `--tour-mask`, `--tour-surface`, `--tour-surface-end`, `--tour-border`, `--tour-title`, `--tour-desc`, `--tour-muted`, `--tour-hover`, `--tour-dot`, `--tour-arrow`, and `--tour-shadow` variables.

- [ ] **Step 1: Write failing CSS contract test**

```ts
/// <reference types="vite/client" />
import tourCss from '../web-extras.css?raw';

test('tour chrome uses semantic variables that follow the app theme', () => {
  expect(tourCss).toContain('--tour-surface: var(--surface-elevated)');
  expect(tourCss).toContain('html[data-theme="dark"]');
  expect(tourCss).toMatch(/\.tour-tooltip\s*\{[^}]*var\(--tour-surface\)/s);
  expect(tourCss).toMatch(/\.tour-title\s*\{[^}]*var\(--tour-title\)/s);
});
```

- [ ] **Step 2: Run CSS test and confirm RED**

Run: `npm test --workspace @open-cluely/web -- src/desktop/tourTheme.test.ts`

Expected: FAIL because tour styles contain hard-coded dark colors.

- [ ] **Step 3: Replace hard-coded tour colors with semantic variables**

Define light values from GLP tokens and dark overrides under `html[data-theme="dark"]`; update mask, surface gradient, border, text, dots, ghost controls, sheen, arrow, and shadows. Change React arrow triangle colors and Electron arrow triangle colors to `var(--tour-arrow)` so a live theme switch updates without rerender.

- [ ] **Step 4: Mirror the contract in Electron CSS**

Keep the current dark values in the default `src/windows/assistant/tour.css` variables and add `html[data-theme="light"]` overrides. Use the same `--tour-*` names so both renderers share the semantic contract.

- [ ] **Step 5: Run CSS and positioning tests**

Run: `npm test --workspace @open-cluely/web -- src/desktop/tourTheme.test.ts src/desktop/SpotlightTour.test.tsx`

Expected: PASS.

---

### Task 3: Electron parse and positioning parity

**Files:**
- Create: `test/tour-module-syntax.test.js`
- Modify: `src/windows/assistant/tour.js`

**Interfaces:**
- Consumes: the same step metadata and DOM toggle ids as the web tour.
- Produces: a parseable module with monotonic `positionRun`, `showCenteredStep`, `revealStepContainer`, and stale-callback guards.

- [ ] **Step 1: Write the failing module syntax test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

test('Electron tour module parses as ESM', () => {
  const source = fs.readFileSync('src/windows/assistant/tour.js', 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 2: Run syntax test and confirm RED**

Run: `node --test test/tour-module-syntax.test.js`

Expected: FAIL with `Identifier 'dismissed' has already been declared`.

- [ ] **Step 3: Fix parse error and mirror safe positioning**

Remove the duplicate declaration. Add `positionRun`, increment it on every `goToStep`, hide ring/arrow and reset the mask before asynchronous work, auto-click the rail toggle for right-rail steps, ignore superseded callbacks, and call `showCenteredStep(idx)` if the target remains unavailable. Increment `positionRun` in `finish` so pending callbacks become inert.

- [ ] **Step 4: Run syntax test and confirm GREEN**

Run: `node --test test/tour-module-syntax.test.js`

Expected: PASS.

---

### Task 4: Documentation and full verification

**Files:**
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/spotlight-tour.md`

**Interfaces:**
- Produces: implementation note with Purpose, Entry points, Data flow, Config/state, and Gotchas.

- [ ] **Step 1: Write the implementation note**

Document both renderer implementations, `TOUR_STEPS`, theme-token flow, rail reveal, run-id cancellation, centered fallback, storage keys, and the invariant that hidden targets never reuse previous geometry.

- [ ] **Step 2: Run complete tests**

Run: `npm test --workspace @open-cluely/web && node --test test/tour-module-syntax.test.js`

Expected: all web and Electron syntax tests PASS.

- [ ] **Step 3: Run required build**

Run: `npm run build` from `web-app/`.

Expected: TypeScript, Vite, and server esbuild all exit 0.

- [ ] **Step 4: Audit and live health check**

Run: `git diff --check && curl -fsS http://localhost:5173/ >/dev/null && curl -fsS http://localhost:8787/api/health`

Expected: no whitespace errors, web returns 200, health returns `"ok":true`.

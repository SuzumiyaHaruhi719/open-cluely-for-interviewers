# open-cluely — project context for Codex

## What this project is

An Electron interview-copilot desktop app. Recent direction: the "interviewer copilot pivot" — generates follow-up questions for the interviewer-side instead of answering for the candidate. See `git log` for current state; do not duplicate that history here.

## Obsidian notes location

This project's implementation notes live in the Obsidian vault at:

```
C:\Users\Thomas\Documents\Obsidian\WTATC\Interview Copilot\Implementation\
```

The vault root (`Documents\Obsidian\WTATC\`) is its own git repo pushing to `github.com:SuzumiyaHaruhi719/Obsidian`. Every Codex session-end auto-pushes the vault, so writes to `Implementation/` propagate to GitHub without manual intervention.

The `Interview Copilot/` folder also contains prompt-engineering iterations (`00-IRON-RULES.md`, `FINAL_PROMPT_*.md`, `iterations/`, `simulations/`). **Keep implementation notes inside the `Implementation/` subfolder so they don't mix with prompt work.**

## MANDATORY: update Implementation notes after code changes

After making non-trivial changes to this project (a new feature, a behavior change, a fix that reveals an unexpected invariant), update or create the matching note in `Implementation/` before ending the session. This is how the vault stays in sync with the code.

**Scope — what counts:**
- New feature, new IPC channel, new renderer surface, new service → new note `<feature-name>.md`
- Behavioral change to an existing feature → update its note
- Bug fix that exposes a hidden constraint or invariant → add a "Gotchas" line to the relevant note
- Refactor that moves files or renames symbols → update paths/symbol references in affected notes

**Skip — what doesn't count:**
- Typo fixes, comment-only edits, dependency bumps with no behavior change
- Pure formatting / lint fixes
- Exploratory work that didn't land

**What each note must contain:**
- **Purpose** — one sentence: what this feature does and why it exists
- **Entry points** — file paths + symbols (e.g., `src/main-process/features/assistant/ipc.js:42 — handleStart()`)
- **Data flow** — how data moves through main → renderer (or vice versa), 3–6 bullets
- **Config / state** — which `src/config.js` keys, which `app-state.js` fields
- **Gotchas** — non-obvious constraints, race conditions, platform quirks

Notes describe *implementation*, not *task history* — write them so a new contributor reading only the note + the code can understand the feature. Don't reference PRs, dates, or "we recently changed". The git log handles that.

## Where things live in the codebase

- `src/main-process/` — main process: features, services, IPC handlers
- `src/windows/` — per-window renderer + preload bundles (assistant, mobile, etc.)
- `src/services/` — cross-process services (ai/, state/, audio/, etc.)
- `src/config.js` — runtime config, model selection, feature flags

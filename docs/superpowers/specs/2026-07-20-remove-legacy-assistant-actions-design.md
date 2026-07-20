# Remove Legacy Assistant Actions — Design

## Purpose

Keep the interviewer workspace focused on the two product-grade AI surfaces: inline Expert follow-up questions during the interview and the final interview summary. Remove the legacy “会议纪要” and “洞察” actions because they generate isolated generic-chat output that is not grounded in the selected JD, corrected speaker roles, or the Expert workflow.

## Current problem

- “会议纪要” and “洞察” are hidden in the topbar more-menu but open a separate floating results panel.
- Their input is assembled from lane-level transcript strings, so shared-microphone and corrected speaker-role sessions can receive incorrect role labels.
- Their generic prompts do not include the selected JD, interview scorecard, résumé, session evidence state, or inline follow-ups.
- “洞察” duplicates the live evidence-gap/session-context workflow; “会议纪要” duplicates the final “总结面试” report.
- The current web client has no remaining caller for the legacy free-form `/api/assistant/ask` endpoint, so the entire assistant panel/router is dead product surface.

## Considered approaches

1. **Hide only the two menu items.** Lowest immediate risk, but leaves unused client state, API calls, server routes, tests, and CSS behind.
2. **Remove only notes and insights while retaining the free-form assistant endpoint.** Preserves hypothetical API compatibility, but no current product flow calls it and it keeps the abandoned subsystem alive.
3. **Remove the legacy assistant subsystem end-to-end.** Recommended. Delete the two menu actions, results panel/hook, client API wrappers, server router, route tests, and panel-only CSS. Keep “清空会话” as a visible GLP toolbar action.

## Approved behavior

- The topbar keeps its current GLP layout and styling.
- “清空会话” is directly visible in the topbar; an overflow menu is not rendered when there are no remaining overflow actions.
- “总结面试” remains the end-of-interview evaluation surface.
- Automatic and manual Expert follow-ups remain inline under the transcript evidence that triggered them.
- Live session context remains the during-interview insight surface.
- Requests to removed `/api/assistant/*` endpoints return the normal application 404 rather than invoking an AI model.

## Architecture and data flow

- `Topbar` no longer accepts meeting-notes, insights, or assistant-busy callbacks.
- `Shell` no longer derives a lane-labelled transcript solely for legacy actions and no longer owns `useAssistantPanel` state.
- Delete `ResultsPanel` and `useAssistantPanel`; no replacement surface is introduced.
- Delete assistant API wrappers from `web/src/lib/api.ts`.
- Unmount the legacy assistant router from `server/src/app.ts` and delete its route module.
- Preserve summary WebSocket flow, live session-context flow, and Expert question generation unchanged.

## Error handling

There is no new failure state. Removing the actions removes their loading/error panel. Existing summary and inline-question error handling stays unchanged.

## Verification

- Component test: the topbar directly exposes “清空会话”, renders no empty overflow menu, and exposes neither “会议纪要” nor “洞察.”
- Server test: `/api/assistant/ask`, `/api/assistant/notes`, and `/api/assistant/insights` are not mounted.
- Regression suites: web tests, server tests, type checks, and production build.
- Browser acceptance: confirm “清空会话”, “总结面试”, and “生成追问” are directly visible and the empty overflow button is absent.

## Non-goals

- Do not change summary prompts or models.
- Do not change the automatic Expert trigger or speaker-role correction.
- Do not redesign the topbar or GLP visual language.

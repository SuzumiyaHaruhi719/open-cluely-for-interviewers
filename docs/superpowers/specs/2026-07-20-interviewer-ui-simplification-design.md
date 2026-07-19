# Interviewer workspace simplification and fixed Expert experience

**Status:** Approved direction; written design checkpoint pending user review
**Scope:** `web-app/web/`, `web-app/server/`, and `web-app/packages/contract/`

## Problem

The interviewer workspace exposes implementation details instead of a focused interview workflow. Settings mix model choices, secrets, prompt authoring, pipeline editing, appearance controls, and provider-specific fields. Several controls have unclear or delayed effects, invalid persisted values can leave selectors blank, and provider failures can still look healthy in the UI. Starting an interview also happens before the interviewer has selected the relevant job description, so Expert generation lacks reliable role context.

## Product decisions

- Keep the existing GLP visual language, tokens, spacing, radii, typography, and motion character.
- Replace Fast/Expert/Customize choices with one fixed **Expert** experience using `deepseek-v4-flash` and a ten-second response budget.
- Fix the application language and generated interviewer output to **Simplified Chinese**. Remove the language setting.
- Make **Xunfei** the default ASR provider. Do not silently fall back to another provider.
- Remove the Pipeline Studio and all Customize-mode product surfaces.
- Move job-description selection into **New interview**.
- Treat the selected JD as structured context for the existing Expert request. It must not become a second prompt system or replace the Expert system prompt.
- Remove all App ID, API key, Access Token, workspace, and secret fields from the renderer. Credentials are read only from the server environment.
- Keep only settings that an interviewer can understand, change safely, and observe taking effect.

## Goals

1. Let an interviewer start a correctly contextualized session in one short flow.
2. Produce expert-quality Chinese follow-up questions in under ten seconds under normal provider conditions.
3. Make every retained setting truthful about when it takes effect.
4. Make provider failure visible and actionable instead of showing a false healthy state.
5. Preserve native provider speaker clustering, then use DeepSeek Flash only to map stable speaker IDs to interviewer/candidate roles after enough evidence exists.
6. Deliver a visibly cleaner workspace without replacing the GLP design system.

## Non-goals

- No user-authored system prompts, report prompts, or alternate prompt modes.
- No pipeline graph, pipeline template, block editor, or Customize mode.
- No user-selectable Fast/Expert quality mode.
- No language selector.
- No client-side credential management.
- No CAM++ diarization.
- No optimization for one supplied recording at the expense of the general interviewer experience.

## Information architecture

### New interview

`New interview` becomes the only place to establish interview context. The dialog contains:

1. Interview channel: online or offline.
2. Job profile: a saved preset, including **Property Manager**, or a custom JD pasted as plain text.
3. A compact review of the selected title and JD before starting.

Starting the session writes the selected interview type and JD into the existing session configuration. It always selects Expert internally. An empty JD is allowed but is explicitly shown as “未提供职位背景”; no synthetic prompt is generated.

The selected JD is passed as `jobDescription` data in the Expert request context. It is delimited as untrusted reference material and cannot override the fixed system instructions. Changing the JD starts a new interview context; it does not mutate the history of an active session.

### Settings

Settings becomes a single compact GLP panel with progressive disclosure only where the retained option genuinely needs it.

#### Essentials

- **Speech recognition:** Xunfei by default. Only providers confirmed available by server capability checks are selectable.
- **Microphone:** the actual input device used for the next capture.
- **Automatic follow-up:** on/off and trigger strategy. A fixed interval is shown only when that strategy is selected; its label reflects the current value instead of hard-coding 30 seconds.
- **Evaluation model:** DeepSeek v4 Pro or Flash for the post-interview report. This does not alter realtime Expert generation.

TTS is not exposed as a selector while only one configured model is usable. The server chooses the best verified model and reports its runtime status.

#### Removed controls

- Mode, Fast/Expert/Customize selector, and pipeline selector.
- Pipeline Studio entry points and editor.
- Output-language selector; Chinese is fixed.
- Custom report prompt and prompt-mode selector.
- DashScope, Doubao, Xunfei, or other provider credential fields.
- Workspace and endpoint-secret fields.
- System-audio selector until it controls a working capture path.
- Window opacity, shortcut editing, Tour replay, and help links from Settings.
- Provider/model choices that the current server credentials cannot use.

Tour replay and help may remain in a lightweight Help menu outside Settings if they are still needed. Keyboard shortcuts continue to work with safe fixed defaults; they are not configured in this simplified panel.

### Interview workspace

The workspace keeps the current GLP palette and component vocabulary while strengthening hierarchy:

- The topbar shows session state, active ASR provider, connection health, and one primary capture action.
- The transcript remains the main working surface with clear interviewer/candidate labels once mapping is confident.
- The right rail prioritizes JD context, résumé context, and generated follow-ups; configuration chrome is removed.
- The capture dock reports listening, reconnecting, finalizing, stopped, and failed as distinct states.
- Service badges describe observed runtime health, not merely the selected configuration.

No new color palette, icon family, radius scale, or page route is introduced.

The existing transparent spotlight mask and between-step Tour motion remain part of the GLP experience and must not regress during the refresh.

## Property Manager job profile

Add a first-class saved profile with:

- Title: 物业经理
- Department: 区域运营服务
- Reports to: 城市负责人
- Summary: 驻扎在园区现场，负责物业运营落地的园区负责人
- Full responsibilities and requirements supplied by the user, stored as JD context rather than prompt text.

The associated interview guide is structured product data used by Expert as reference context. It covers:

1. Independent operation of a complex or industrial park.
2. Team hiring, training, attendance, discipline, and performance management.
3. Safety, fire control, emergency response, and incident review.
4. Security, traffic, access control, sanitation, landscaping, and pest control.
5. Equipment inspection, preventive maintenance, repair, power distribution, and fire systems.
6. Tenant onboarding/offboarding, service coordination, and rent/utility collection.
7. Government/company inspections, budgets, plans, approvals, and operating records.
8. Communication, pressure tolerance, digital-tool proficiency, and relevant certificates.

The guide gives Expert evaluation dimensions and evidence targets. It does not create a separate user-editable prompt or pipeline.

## Expert generation contract

- Realtime generation model is fixed to `deepseek-v4-flash`.
- The server owns the model identifier, timeout, system instructions, Chinese-output constraint, and schema.
- One request receives recent role-labelled transcript, prior asked questions, selected JD, résumé context when present, and the structured interview guide.
- The response contains one concise Chinese follow-up question plus evidence/rationale fields needed by the UI; only the interviewer-facing question is prominent.
- The normal response budget is under ten seconds. Timeout or invalid output produces a deterministic Chinese fallback and an explicit degraded-state marker.
- Automatic generation waits for sufficient new final transcript evidence, avoids overlapping calls, observes a cooldown, and does not repeat already-covered competencies.
- Manual generation remains available and shares the same in-flight and cooldown state.

## ASR, speaker roles, and finalization

### Provider behavior

- Default to Xunfei for new and migrated installations.
- The server reports provider capability separately from provider selection.
- Selecting an unavailable provider is blocked with a reason; a failed upstream connection transitions the UI to failed instead of “实时”.
- Switching provider or microphone during capture performs a controlled reconnect and clearly states that the change affects the next audio frame after reconnection.

### Speaker behavior

1. Preserve native provider `speakerId` values on every final segment.
2. Accumulate enough final, content-bearing samples before assigning semantic roles.
3. Ask `deepseek-v4-flash` to map one or more stable native IDs to `interviewer` or `candidate` using speech acts and conversation context.
4. Support native over-clustering: multiple speaker IDs may map to the same product role.
5. Keep the assignment provisional until confidence/evidence thresholds are met; avoid relabelling stable history on one ambiguous turn.
6. On capture stop, gracefully drain provider final events before closing the socket, run a final role-partition pass, then publish the finalized transcript.

If a provider has no native speaker separation, keep segments unassigned until Flash has enough textual evidence. Do not invent acoustic identity from text alone, and do not add CAM++.

## Qwen Audio 3.0 TTS

- Add a server-only DashScope TTS adapter for `qwen-audio-3.0-tts-plus` and `qwen-audio-3.0-tts-flash` using the supported WebSocket API.
- Resolve the API key, endpoint, model entitlement, and voice on the server. An empty `voice` is invalid; the adapter must select a verified built-in voice or fail with a configuration error before synthesis.
- Probe model capability at server startup and expose only a non-secret availability summary to the client.
- Use Plus as the initial production default because the configured account has been verified to synthesize successfully. Keep Flash unavailable in the UI until its entitlement probe succeeds; do not silently alias Flash to Plus.
- Cache capability results for a bounded period and recheck after a provider error so a new entitlement can become available without a client release.
- TTS output is Chinese by default and is tested for non-empty valid audio, bounded latency, and round-trip intelligibility through the selected ASR.
- TTS failures never block capture, transcript finalization, speaker mapping, or manual interviewing.

## Configuration and migration

- Client defaults: `asrProvider='xfyun'`, `aiMode='expert'`, `outputLanguage='zh-CN'` internally.
- `aiMode` and `outputLanguage` are compatibility values, not visible controls.
- Validate every persisted enum, number, device ID, and model before use. Invalid or retired values migrate to supported defaults.
- Legacy Customize/pipeline selections are ignored and removed from active client state.
- Credentials never enter renderer state, WebSocket `configure` payloads, logs, or persisted browser data.
- Setting-effect semantics are explicit:
  - microphone and ASR provider: next capture/reconnect;
  - automatic-follow-up controls: immediately for the next eligibility check;
  - evaluation model: next report generation;
  - JD: next interview only.

## Error handling

- Capability check failure: show “无法验证服务” and keep capture unavailable until a real connection succeeds.
- ASR upstream denial/disconnect: surface provider name and a concise server-provided reason; never remain in a live-looking state.
- Graceful-stop timeout: close after a bounded drain period, retain received finals, mark transcript finalization as partial, and still run role mapping.
- Expert timeout/invalid schema: show a Chinese deterministic fallback with a degraded badge; do not silently present it as model output.
- Missing JD: continue with general interviewing criteria and visibly mark the session as lacking job context.
- Stale persisted values: normalize during settings initialization without requiring the user to repair them.

## Removal boundaries

- Remove Pipeline Studio navigation, renderer components, hooks, tests, styles, and client API calls when no longer referenced.
- Remove server pipeline-editor routes and generation handlers if repository-wide dependency checks find no external consumer.
- Legacy wire-contract fields may remain temporarily for compatibility, but the current client never exposes or sends Customize/pipeline state.
- Preserve unrelated interview-history behavior already modified in the working tree.

## Testing and acceptance

### Automated

- Settings renders only retained controls; secrets, language, prompt, mode, opacity, shortcuts, and pipeline controls are absent.
- Xunfei is the default after a clean start and after migration from invalid/retired provider values.
- New interview requires an explicit context review and sends the chosen Property Manager JD as `jobDescription`, not as a prompt override.
- Realtime Expert always requests `deepseek-v4-flash`, enforces Chinese output, and respects the ten-second budget.
- Auto-follow-up copy reflects the selected trigger/interval and never claims a fixed 30-second cadence incorrectly.
- Provider/model changes affect the documented lifecycle and cannot display healthy state after upstream rejection.
- ASR stop drains final events before speaker finalization; timeout behavior is deterministic.
- Native speaker IDs survive ingestion; the supplied interview fixture maps candidate ID 1 and examiner/announcer IDs 2 and 3 to the correct product roles without recording-specific rules.
- Pipeline Studio and Customize entry points are absent from the built client.
- Full web tests, server tests, type checks, and production build pass.

### Browser and audio QA

- Exercise New interview, Property Manager selection, capture, provider switching, automatic follow-up, report generation, stop/finalize, reload, and a second interview in the in-app browser.
- Re-run the supplied local recording through Xunfei and inspect transcript completeness, native clusters, final role mapping, and the final-segment drain.
- Capture the old and refreshed screens at the same viewport and state, combine them into one comparison input, and correct visible GLP spacing, hierarchy, overflow, contrast, and motion defects.
- Verify no credentials appear in DOM-visible settings, renderer requests, browser persistence controlled by the app, or client logs.

## Success criteria

1. A new interviewer can choose a JD and begin capture without seeing pipelines, prompts, secrets, or quality modes.
2. The Property Manager JD reaches the fixed Expert as context data and cannot redefine its system behavior.
3. Chinese is the only product/output language and Xunfei is the default ASR.
4. Realtime Expert normally returns one high-quality follow-up in under ten seconds.
5. Stopping capture retains provider final events and automatically finalizes speaker roles.
6. Every retained setting has a tested, visible effect and unavailable providers never look live.
7. The refreshed workspace is visibly simpler while remaining recognizably GLP.

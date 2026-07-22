# P8 complete replay — five-layer acceptance record

## Acceptance identity

- Artifact: `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`
- Downloads handoff: `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`
- Source audio SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`
- Audio duration: `493,517ms`
- Transcript evidence: 48 Doubao Seed ASR 2.0 final events, three voiceprints
- Summary capture: production P8 prompt/profile through `deepseek-v4-pro`, no fallback
- Browser: user's in-app browser; the byte-identical artifact is served through a temporary local static server because automated `file://` reload is restricted by browser policy

## Layer 1 — complete evidence, not an excerpt

**Observed problem:** the presentation replayed only 84 seconds. A report from that excerpt could not make a complete P8 hiring recommendation.

**Red gate:** tests rejected the excerpt audio, the `84,000ms` contract, incomplete transcript count, and absent voiceprint-level role assignments.

**Fix:** packaged the exact full MP3, reduced the verified Seed ASR run to a non-secret fixture, and derived the UI timeline from all 48 final events. The three provider voiceprints remain explicit: interviewer, candidate, and unknown/non-participant.

**Evidence:** exact audio SHA-256, `493,517ms`, 48 chronological finals, three voiceprints, and byte-identical source/package tests pass.

## Layer 2 — presentation-speed replay without false timing

**Observed problem:** waiting 8m13s in a boss demo hides the final summary and invites manual, inaccurate seeking.

**Red gate:** pure-state tests required exact `60×` advancement, monotonic time, exact end clamping, and completion in no more than `8.3s` from the beginning.

**Fix:** added `快进至总结`. It mutes audio, advances the real media clock, updates transcript/roles/questions/context/progress from that clock, and cancels on pause, seek, reset, ordinary play, or Escape.

**Evidence:** in the in-app browser, the button changed to `60× 快进中`, the clock/progress visibly advanced, and the modal appeared at `08:13`. Automated duration is `8.226s`.

## Layer 3 — real production DeepSeek report

**Observed problem:** the prior summary copy was a manually authored placeholder and did not prove use of the complete transcript or the production scoring prompt.

**Red gate:** fixture tests required the production model, full transcript metadata, prompt/transcript/JD/input hashes, provider usage, required headings, evidence citations, and a decisive recommendation.

**Fix:** `scripts/generate-full-summary.mts` imports `SUMMARY_SYSTEM`, `buildSummaryInput()`, the production stream analyzer, and the built-in P8 profile. It submitted the complete role-resolved transcript and captured the untouched result without secrets.

**Evidence:** `deepseek-v4-pro`, no fallback, `29.414s`, `2,600` input tokens, `1,119` output tokens, 3,450 transcript characters, 4,374 input characters, and conclusion `不推荐录用` are stored in `fixtures/p8-full-summary.json`.

## Layer 4 — visible scoring workflow and complete result

**Observed problem:** a final report that simply appears does not show that evidence, the P8 rubric, and the model were all used; the old modal also lacked the complete report.

**Red gate:** tests required four ordered replay phases, progressive safe Markdown, all five production headings, provenance, copy, regenerate, close, and backward-seek dismissal.

**Fix:** the production modal now replays `完整记录 48 条 → P8 评分模板 → DeepSeek 专家评分 → 证据报告完成` in `3.2s`, then renders the full allow-listed Markdown report. Regenerate replays the captured production transition instead of claiming a new offline model call.

**Evidence:** browser acceptance found exactly one of each required heading: 综合结论与录用建议, 能力维度评分, 亮点, 风险与顾虑, 进一步考察建议. It also found the exact model and token provenance and visibly replayed `校验完整证据` after `重新生成`.

## Layer 5 — single-file browser integrity

**Observed problem:** after the complete MP3 was embedded, the product iframe was blank. The base64 iframe URL grew to roughly 7.2MB and exceeded the browser's practical data-URL navigation limit.

**Red gate:** artifact/player tests reject `iframe src="data:text/html;base64,..."` and require a separately embedded payload assigned through `iframe.srcdoc`.

**Fix:** the outer presentation decodes the complete product payload into `iframe.srcdoc`. It remains a portable one-file artifact while avoiding URL-length navigation failure.

**Evidence:** after rebuilding, the in-app browser found one `快进至总结` control, rendered the complete production workspace, ran the fast-forward, opened the summary dialog, displayed the completed report, and replayed the generation transition. The full demo suite passes `40/40` tests.

## Final requirement audit

| Requirement | Result |
| --- | --- |
| Complete real MP3 | Passed — exact hash and `493,517ms` |
| Complete Seed transcript | Passed — 48 finals, chronological |
| Voiceprint-level role assignment | Passed — speaker 0/1 stable, speaker 2 unknown |
| Visible fast-forward effect | Passed — `60×`, muted, interruptible, `8.226s` |
| Full production DeepSeek summary | Passed — production prompt, P8 JD, full transcript, no fallback |
| Five production report sections | Passed — all rendered and browser-located |
| Summary generation effect | Passed — four visible phases and progressive report |
| Single portable HTML | Passed — no server/model/device required at runtime |
| Repository/Downloads identity | Passed — both are `7,573,120` bytes with SHA-256 `7c316538eef9712b9410e152e44b69cca851c282abab2a1362eee8097f116091` |

final result: passed

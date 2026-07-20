# Evidence-ranked Expert fallback — Design

**Status:** Approved under the user's standing instruction to work automatically

## Problem

The normal `deepseek-v4-flash` question path returns a JD-aware, evidence-grounded question within the ten-second SLO. A transient provider or schema-validation failure falls back locally, but the current fallback always anchors the final sentence. Real ASR frequently ends with boilerplate or a truncated fragment such as “以上就是……”, which produced a weak question during BlackHole + DashScope QA.

## Decision

Keep the existing single Flash call, strict response validation, eight-second timeout, and no-retry latency policy. Improve only the deterministic fallback: split the candidate answer into source-exact sentence candidates, penalize boilerplate and incomplete endings, reward concrete action/decision/result language, and select the highest-signal quote. If no meaningful candidate exists, retain the current bounded final-fragment behavior.

Alternatives rejected:

- Retrying the model can exceed the ten-second ceiling.
- Relaxing anchor validation can admit fabricated quotes.
- Using the JD as an alternate prompt system violates the fixed Expert architecture.

## Data flow

1. `generateExpertQuestion()` makes one `deepseek-v4-flash` call.
2. A valid response follows the existing model-output path unchanged.
3. Timeout, provider failure, or invalid output invokes `fallbackOutput()`.
4. The fallback ranks exact fragments from `candidateAnswer` and anchors one deterministic ownership question to the best fragment.
5. The WebSocket and renderer contracts remain unchanged.

## Constraints

- No second network call and no added latency.
- The selected anchor must be an exact substring of the candidate transcript.
- Output remains one simplified-Chinese question.
- Role partitioning, Auto-question admission, model selection, and JD-context wiring do not change.

## Verification

- A regression test with an evidence-bearing action followed by a cut-off “以上就是……” sentence must fail before implementation and pass afterward.
- Existing valid-model, generic-output, Chinese-only, and single-question tests remain green.
- Full server tests, typecheck, web tests, and production builds remain green.

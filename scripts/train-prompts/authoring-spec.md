# Expert-interview fixture authoring spec (Opus subagents)

You are a gold-standard interview-fixture author. You generate evaluation fixtures for an
"Expert-mode" interviewer-copilot. Author them BY YOURSELF — do NOT call any external/generation
API; write each fixture's JSON with the Write tool.

Your dispatch message names your assignment file
(`fixtures/expert-interview/_assign/chunk-0N.json`) and your `assignment_id` N.

## Procedure

1. **Read your assignment file**: `{ assignment_id, count, slots:[{ fixture_id, tags }] }`. Each
   slot is one fixture you must author. Read `fixtures/expert-interview/fx_0001.json` ONCE as a
   shape/quality reference — do NOT copy its content, industry, or wording.
2. **Skip-if-exists**: for each slot, Read `fixtures/expert-interview/<fixture_id>.json` first; if
   it already exists AND parses as JSON with an `id`, SKIP it (never overwrite). Else author it.
3. **Author** each fixture to EXACTLY match the slot's tags, writing to
   `fixtures/expert-interview/<fixture_id>.json`.

## Schema (every field required)

```json
{
  "id": "<fixture_id>",
  "tags": { "...copy the slot's tags object verbatim..." },
  "resume": "<candidate resume>",
  "jd": "<job description for the role being interviewed>",
  "history": [ { "q": "<interviewer question>" } ],
  "candidate_last_answer": "<the candidate's most recent answer — what the interviewer must follow up on>",
  "session_state": { "drilled_topics": ["..."], "current_competency_target": "<competency>", "elapsed_minutes": 0 },
  "ground_truth": {
    "competency_target": "<same string as session_state.current_competency_target>",
    "missing_evidence": [ { "competency": "<...>", "evidence_type": "<metric|timeline|owner-of-action|tradeoff-reasoning|mechanism|scope|named-entity>" } ],
    "safety_flags": [],
    "top_question_traits": [
      "must-anchor-on: <VERBATIM contiguous substring copied from candidate_last_answer>",
      "must-be-question-type: <action-attribution|counterfactual|named-entity-pin|chain-of-decisions|teach-back|metric-pin|timeline-pin|tradeoff-probe>",
      "expected-yield: <what a strong follow-up should force the candidate to reveal>"
    ]
  }
}
```

## Hard invariants (any violation → rejected by validate-fixtures.js)

1. `history` length == `tags.history_length` exactly.
2. Resume size by `resume_type` — `sparse-200words`: ≤350 (count Han chars for zh/mixed, else
   whitespace words); `verbose-1500words`: ≥800 (same unit; aim 900–1200). Other resume types:
   realistic length, no hard bound. NOTE: the validator only switches to Han-char counting when the
   text has a run of 20+ *consecutive* Han chars; a `mixed` verbose resume that code-switches too
   often is word-counted, so give it a long pure-Chinese passage to clear the 800 bar.
3. `candidate_last_answer` ≥5 chars AND contains the exact `must-anchor-on:` substring verbatim
   (copy it character-for-character from the answer — this anchor is load-bearing for Block A).
4. `language`: `zh` = all Chinese; `en` = English; `mixed` = realistic code-switching (Chinese
   narrative + English technical terms/metrics).
5. `answer_quality` visibly enacted in `candidate_last_answer` (vague-empty=evasive/no specifics;
   STAR-complete=full S/T/A/R w/ numbers; STAR-partial=missing one STAR part; defensive-hostile=
   pushes back; inflated-metrics=grand unverifiable numbers; team-credit-only="we"/no personal
   ownership; timeline-confused=contradictory sequence; deflective-blame=blames others;
   nervous-rambling=tangents/filler; overtime-tangent/off-topic=drifts; concise-precise=tight &
   specific; over-packaged=rehearsed buzzwords; counter-question=turns question back).
6. `edge_case` (when not null) realized in the answer: cites-NDA=refuses specifics citing NDA;
   reverses-question/counter-question=turns the question back on the interviewer;
   multi-task-in-one-answer=crams several stories; borderline-compliance=brushes a compliance/ethics
   line (then add a `safety_flags` entry); silent-then-recovered=a pause then answers. Populate
   `safety_flags` ONLY on real risk (e.g. an admitted violation); a legitimate NDA refusal or a
   question-reversal is NOT a safety risk → leave `[]`.
7. `ground_truth.competency_target` == `session_state.current_competency_target`.

## Quality & diversity

- resume, jd, history, and last answer must be mutually coherent and realistic for the
  industry + level.
- The `must-anchor-on` span should be a genuinely weak/dodgy/unsubstantiated phrase a sharp
  interviewer would pin.
- Across YOUR fixtures: no two share the same resume opening line, the same JD first sentence, or
  the same first 8 words of `candidate_last_answer`.

## JSON hygiene

- Strictly valid JSON, written via the Write tool (UTF-8). In Chinese string values NEVER use ASCII
  double-quote characters for inner quotes — use 『 』.

## Scope

- Only create the `fx_<id>.json` files in your assignment. Do NOT modify any other file, run git, or
  touch other fixtures/scripts.

## Finish (report)

End your final message with exactly one fenced ```json block:

```json
{"assignment_id":N,"fixtures_written":W,"fixtures_skipped_existing":S,"ids":["fx_..."],"dup_check":{"duplicate_resume_first_line":0,"duplicate_jd_first_sentence":0,"duplicate_answer_first_8_words":0}}
```

Prioritize correctness over speed; if you can only finish some, report honestly.

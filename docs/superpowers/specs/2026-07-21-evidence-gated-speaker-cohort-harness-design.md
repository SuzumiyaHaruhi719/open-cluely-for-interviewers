# Evidence-gated speaker cohort harness design

## Purpose

Classify newly appearing Doubao acoustic clusters into the interviewer or candidate cohort only after enough independent conversational evidence exists, while keeping ambiguous speech out of automatic-question generation and packaging every production model credential in one portable environment file.

## Context and problem

Doubao Seed ASR 2.0 returns an opaque `speakerId` for an acoustic cluster. A panel interview may legitimately contain several interviewer clusters, and ASR may also split one human into several clusters or occasionally reuse a cluster incorrectly. Therefore `speakerId` is useful acoustic evidence, but it is neither a human identity nor an interview role.

The current partitioner already performs two independent DeepSeek v4 Flash reviews for every required transcript turn. It deliberately ignores model-level `speakerRoles` when releasing turns to Auto, which prevents one mistaken cluster label from contaminating an entire interview. This protects role-sensitive behavior, but it has no stateful process for assimilating a later third or fourth cluster into a stable display cohort after enough evidence accumulates. Such clusters can remain `待确认` longer than necessary, and each refresh makes the model reconstruct the same relationship from scratch.

The requested feature is not a nearest-sentence or voice-similarity matcher. It is a semantic cohort-assimilation harness: compare a new cluster against separately established interviewer and candidate evidence, gather more samples when uncertain, and delegate only after a conservative multi-stage decision.

## Approaches considered

### One-shot continuation matching

Compare a new cluster's latest sentence with the immediately preceding interviewer and candidate text, then choose the smoother continuation. This is fast, but interruptions, hand-offs, rhetorical questions, ASR fragmentation, and scoring announcements make a single adjacency unreliable. A wrong result would become sticky.

### Whole-cluster classification on every refresh

Ask one Flash call to assign every acoustic ID on every partition pass. This uses more history than one-shot matching, but repeatedly spends tokens on established clusters, gives correlated one-shot answers, and still lacks a deterministic evidence gate, revocation policy, or separation between display and Auto authority.

### Hierarchical evidence-gated assimilation harness — selected

Keep the existing per-turn two-pass semantic ledger as the authority for Auto. Add a separate, stateful cohort layer for new or contested acoustic clusters. The cohort layer builds balanced role-specific evidence, runs structured role-fit and counter-evidence reviews, and promotes only when deterministic validation succeeds. It improves stable transcript labeling without weakening the existing Auto safety seam.

## Non-negotiable invariants

- Preserve every provider `speakerId`; never merge, renumber, or rewrite acoustic clusters.
- Allow any number of clusters to map to `interviewer` and any number to map to `candidate`.
- Never infer a role from numeric ID, first-seen order, capture source, speaking duration, or a single convenient continuation.
- An ambiguous cluster stays `unknown` / `待确认` indefinitely. Time alone never forces a choice.
- A cohort role is a reversible display prior, not permission to feed Auto.
- Only an independently confirmed per-turn semantic/manual/local verdict may call candidate or interviewer callbacks.
- Manual correction has highest precedence and remains sticky for that acoustic cluster.
- A direct role flip is forbidden. Contradictory evidence first revokes a delegated cluster to `contested`; the opposite role requires a new evidence-gated promotion.
- Every asynchronous result carries the interview epoch and evidence revision. Stale results are discarded.

## Internal state model

Maintain one `ClusterCohortState` per native acoustic ID:

- `observing`: not enough evidence or no valid decision; UI remains `待确认`.
- `delegated`: the harness assigned `interviewer` or `candidate` with auditable evidence.
- `contested`: later evidence contradicted the delegated role; UI returns to `待确认` while more samples gather.
- `manual`: represented by the existing manual-role map and always overrides the automatic state.

Each automatic state records the role when applicable, minimum consensus confidence, evidence seqs, contradiction seqs, evaluated-through seq, evidence revision, and decision reason code. Transcript text is not copied into telemetry.

Reset clears all cohort state, in-flight work, and evidence revisions atomically with the interview session.

## Evidence gathering gate

An acoustic cluster becomes eligible for cohort evaluation only when all of the following are true:

1. It has at least two finalized substantive utterances. ASR fragments belonging to one grammatical continuation count as one utterance.
2. Those utterances cover at least two conversational adjacency windows rather than two chunks of the same sentence.
3. The cluster contributes at least 48 non-whitespace Chinese/Latin characters in total, with at least 12 characters in each counted utterance.
4. The established interviewer bank and candidate bank each contain at least two high-confidence, per-turn-confirmed anchors from the current interview.
5. No manual correction already determines the cluster.

If any condition is missing, no model call is made. Each later substantive turn updates the revision and rechecks the gate. Short acknowledgements remain useful as neighbouring context but do not satisfy the sample count.

The thresholds are intentionally conservative defaults and remain server constants, not user settings.

## Balanced evidence packet

For one eligible target cluster, build a bounded packet containing:

- Every counted target utterance up to a fixed cap, prioritising the most recent and most substantive samples.
- The direct left and right neighbours of each target utterance.
- A balanced interviewer evidence bank containing diverse confirmed questions, framing, evaluation, and hand-off turns.
- A balanced candidate evidence bank containing diverse confirmed answers, first-person actions, evidence, trade-offs, and results.
- Existing per-turn consensus for the included seqs, marked as evidence rather than ground truth for the target cluster.
- Continuity groups for ASR-fragmented utterances.

Both role banks use the same maximum count and comparable character budget so prompt position or evidence volume cannot bias the decision. Anchors come only from high-confidence per-turn consensus or manual labels; cohort-derived labels never recursively become anchor truth.

The job description and résumé are excluded. They ground Expert questions, but they do not identify who is speaking and could bias the role decision toward job-related vocabulary.

## DeepSeek v4 Flash harness

The harness uses structured JSON, temperature zero, thinking disabled, strict timeouts, and no hidden retry that could exceed the live budget.

### Pass A: balanced role-fit audit

Review every target utterance in context. Return an interviewer-fit score, candidate-fit score, per-target speech-act verdicts, cited supporting seqs, cited contradictory seqs, and an `unknown` option. The prompt lists interviewer evidence first.

### Pass B: order-reversed adversarial audit

Run independently in parallel with the candidate evidence first. The prompt explicitly tries to disprove the apparent role and must identify the strongest alternative explanation. This reduces order anchoring and makes one convenient continuation insufficient.

### Deterministic consensus

No third model call can rescue disagreement. Promotion succeeds only when:

- both responses parse and cover every required target seq;
- both choose the same non-unknown cohort role;
- each reports confidence at or above `0.88`;
- each winning fit exceeds its losing fit by at least `0.18`;
- at least two target utterances support the winning role;
- all cited seqs exist in the supplied packet;
- neither pass reports a high-confidence contradictory target utterance; and
- existing per-turn consensus does not contain a confirmed opposite-role majority.

Otherwise the state remains `observing` or becomes `contested`, and evaluation waits for new evidence. Re-running identical evidence is prohibited; the evidence revision must advance.

This harness cannot honestly guarantee that a probabilistic model is always correct. It does guarantee that the product never forces an ambiguous result, never grants a cluster decision Auto authority, and exposes deterministic conditions that can be regression-tested.

## Promotion, display, and revocation

When consensus promotes a cluster:

- Store the delegated cohort without altering its acoustic ID.
- Re-label historical unresolved turns from that cluster for display only, unless a turn has a stronger manual, local-repair, or per-turn semantic verdict.
- Continue per-turn two-pass review for all future turns. Delegation does not bypass it.
- Emit the full chronological partition so the renderer updates atomically and does not duplicate bubbles.

Display precedence becomes:

1. Manual cluster correction.
2. High-precision local turn repair.
3. Two-pass per-turn semantic consensus.
4. Evidence-gated cohort delegation.
5. `unknown` / `待确认`.

Auto precedence remains stricter and unchanged:

1. Manual role accepted through the existing turn-resolution seam.
2. High-precision local turn repair.
3. Two-pass per-turn semantic consensus.
4. No release.

A delegated cluster is revoked to `contested` when two independently reviewed substantive turns contradict its cohort role, or when the authoritative final audit does not preserve enough supporting evidence. One isolated semantic exception stays turn-scoped and does not revoke the cluster. A contested cluster never flips directly; it must gather a new eligible packet and pass both audits for the opposite role.

## Scheduling and concurrency

- Cohort evaluation runs asynchronously after transcript emission and never blocks live ASR.
- Maintain at most one in-flight evaluation per acoustic cluster.
- If new evidence arrives during a run, mark the current revision stale and schedule one coalesced evaluation for the latest revision.
- Limit global cohort evaluations to the existing model concurrency budget so they cannot starve per-turn classification or Expert question generation.
- Prioritise per-turn role audits and Auto monitoring over cohort display refinement.
- Timeouts, provider errors, malformed output, missing seq coverage, or stale epochs fail closed to the current unresolved state.

## Final reconciliation

Stopping the interview first closes the Auto gate, then drains ASR and runs the existing full per-turn final audit. Cohort states are rebuilt from the final semantic ledger and complete acoustic-cluster evidence rather than trusted from live memory.

- A final cohort must meet the same evidence and consensus rules.
- Failed or contradictory final reviews leave affected clusters and turns `待确认`.
- Final cohort output may improve display labels but cannot generate a late automatic question.
- Manual locks remain authoritative.

## Contract and observability

Extend partition segments with a non-sensitive role source such as `manual`, `local`, `semantic-turn`, `cohort`, or `unknown`. The renderer does not need another visible control; this field supports tests and diagnostics.

Record structured decision events containing interview-local cluster ID, evidence revision, target seqs, model IDs, pass outcomes, confidence/margin, state transition, latency, and reason code. Never log transcript text, credentials, prompt bodies, or model response bodies in production telemetry.

## One-file environment migration

The repository root `.env` becomes the canonical portable deployment file. Runtime environment variables retain highest precedence; the root file is next; the legacy `web-app/.env` is a compatibility-only fallback for keys absent from both.

The tracked root `.env.example` documents every active production model binding and credential:

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `INTERVIEWER_MODEL`
- `AUTO_MONITOR_MODEL`
- `SPEAKER_PARTITION_MODEL`
- `EXPERT_QUESTION_MODEL`
- `INTERVIEWER_CONTEXT_MODEL`
- `INTERVIEWER_SUMMARY_MODEL`
- `VOLC_APP_ID`
- `VOLC_ACCESS_TOKEN`
- `VOLC_RESOURCE_ID=volc.seedasr.sauc.duration`
- `VOLC_MODEL=bigmodel`
- `VOLC_SAMPLE_RATE=16000`
- `PORT`

Qwen and DeepSeek use the same DashScope credential; model IDs are explicit values rather than extra secrets. Doubao Seed ASR 2.0 uses only app ID, access token, and the entitled resource ID. Xunfei, CAM++, TTS, ASR 1.0, and unused legacy provider variables are excluded.

Add an allowlisted export command that reads the effective root and legacy environment files without printing values, writes one git-ignored `.env.portable`, and applies owner-only file permissions. The generated file contains only the keys above plus explicitly documented non-model runtime options; it never copies arbitrary legacy secrets. On another device, copying `.env.portable` to the repository root as `.env` is sufficient.

The real `.env.portable` is never staged, committed, logged, or returned inline. Only its safe placeholder template and missing-key report are tracked.

## Verification harness

Automated scenarios must cover:

- Two interviewer clusters plus one candidate cluster.
- Three interviewer clusters plus an over-clustered candidate.
- A third cluster that stays pending after one long utterance.
- Delegation only after two independent adjacency windows and both role banks exist.
- Candidate answer fragments assigned several acoustic IDs.
- Interviewer hand-offs, interruptions, rhetorical questions, and scoring announcements.
- Equal fit, pass disagreement, low confidence, invalid citations, malformed JSON, timeout, and stale epoch all remain pending.
- A delegated cluster with one exceptional turn remains delegated while that turn keeps its semantic exception.
- Repeated contradictions revoke to `contested`; opposite-role assignment requires a fresh promotion.
- Cohort-only display labels never enter candidate/interviewer Auto callbacks.
- Final reconciliation rebuilds cohort state and never emits a late question.
- Manual corrections override cohort and per-turn inference.
- The environment exporter contains every allowlisted active key, excludes obsolete secrets, never prints values, creates mode `0600`, and its output remains ignored by Git.
- A clean checkout with only the root `.env` reaches Doubao Seed ASR 2.0 and all configured DashScope model paths.

The full server, web, and core test suites, production build, browser smoke test, and real MP3 replay remain release gates.

## Delivery

Implementation is performed directly on `main` in reviewable checkpoints: cohort state/evidence tests, model harness and aggregation, renderer/contract integration, portable environment support, integration verification, implementation notes, rebuild, and final push to `origin/main`.

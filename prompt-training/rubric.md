# PTES — Potential & Trait Elicitation Score (0–100)

A follow-up question is good **to the extent that answering it forces the
candidate to reveal durable potential and work traits** — how they think, decide,
own, and grow — rather than to recite a fact a transcript could already contain.

This rubric is deliberately strict. A question that merely pins a number, a name,
or a date is a BAD interview question for this purpose, even if it is "specific".

## The reference failure (what we are eliminating)

> Candidate: "…I redesigned the order pipeline and introduced an async queue.
> After the rollout, p99 latency dropped a lot and the on-call pages stopped."
> BAD follow-up: "How much exactly did p99 latency drop?"

Why it's bad: the answer is a single number. It reveals nothing about the
candidate's judgment, ownership, or depth. A strong interviewer instead probes
the *decision* and the *person*: e.g. "Introducing an async queue trades
consistency for latency — what broke, or nearly broke, because of that tradeoff,
and how did you catch it?" That forces reasoning, ownership, and self-awareness.

## Dimensions (sum to 100)

### 1. Depth-of-reasoning probe — 30
Does answering require exposing *how the candidate thinks*: the decision and its
alternatives, the tradeoff and its cost, a failure and its diagnosis, why the
obvious choice was wrong?
- 30: cannot be answered without walking through real reasoning / a judgment call.
- 15: invites reasoning but is easy to answer with a rehearsed narrative.
- 0: answerable with a fact, a yes/no, or a buzzword.

### 2. Ownership disambiguation — 20
Does it separate what the candidate *personally* did, decided, or risked from what
"the team" / "we" did?
- 20: structurally forces an "I" answer about a personal decision/action.
- 10: nudges toward ownership but lets "we" slide.
- 0: indifferent to who did what.

### 3. Trait diagnosticity — 25
Would the answer expose a durable work trait — handling ambiguity, conflict,
failure, prioritization under constraint, influence without authority, judgment,
learning/growth?
- 25: the answer is a window into a specific trait an interviewer cares about.
- 12: weakly trait-revealing.
- 0: reveals no trait, only information.

### 4. Anchoring & non-genericness — 15
Is it tied to something concrete THIS candidate actually said, so it can't be
answered with a canned story and can't be asked of anyone?
- 15: clearly anchored to the candidate's specific claim/situation.
- 7: loosely related to the answer.
- 0: generic ("tell me about a time you failed") — askable of anyone.

### 5. Anti-triviality (GATE) — 10
- 10: not a fact-pin; the value is in reasoning, not the datum.
- 0: a pure fact-pin (a number / name / date / yes-no) whose answer is a datum.

**GATE rule:** if dimension 5 scores 0 (it is fundamentally a fact-pin), the TOTAL
is capped at **45** regardless of the other dimensions. A specific, well-anchored
number-pin is still a bad question for mining potential.

## Pass threshold
- **PASS = total ≥ 80.** This requires genuine strength on depth (1) and traits
  (3), real ownership pull (2), concrete anchoring (4), and not being a fact-pin (5).

## Judging discipline (anti-inflation)
- Score the QUESTION as it would be ASKED (use `primary_question`; the rationale is
  context, not credit). A good rationale cannot rescue a shallow question.
- Do not give "specificity" credit for demanding a number — that is the failure
  mode, not a virtue.
- When unsure between two scores, pick the lower.
- Every score must carry a one-sentence justification naming the weakest dimension.

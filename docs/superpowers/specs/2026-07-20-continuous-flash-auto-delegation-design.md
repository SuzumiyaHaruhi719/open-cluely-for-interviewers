# Continuous Flash Auto-Delegation Design

## Goal

Make automatic interviewer follow-ups reliably appear during tightly paced interviews by restoring a dedicated DeepSeek v4 Flash sentinel that delegates only evidence-worthy candidate turns to the existing under-10-second Expert Flash question workflow.

## Observed failure

The current agent trigger waits for a quiet period after every candidate final. Xunfei emits several finalized chunks inside one long answer while browser PCM remains continuously audible. Every audio frame moves the quiet deadline, and the next confirmed interviewer turn clears the pending answer. On the supplied looping MP3 this creates a deterministic failure: role-correct candidate evidence reaches the trigger, but no automatic Expert request ever starts.

## Selected architecture

Use two distinct thinking-disabled `deepseek-v4-flash` calls:

1. **Sentinel:** receives only semantically confirmed candidate evidence plus bounded JD/scorecard context. It returns strict JSON: `wait`, or `ask` with one high-value evidence gap and `focusHint`.
2. **Expert:** runs only after `ask`. It uses the existing Expert Flash prompt to produce one evidence-anchored Chinese question. The sentinel owns the ask/no-ask decision, so an invoked Expert always emits a validated model question or the deterministic evidence-anchored fallback.

The sentinel is continuous at semantic checkpoints, not on raw PCM frames: each eligible candidate final coalesces rapid adjacent finals, then evaluates the newest accumulated candidate window. This keeps cost and concurrency bounded while working during uninterrupted speech.

## State and cancellation rules

- A local floor of 120 new candidate characters prevents calls before the candidate has supplied useful evidence.
- The semantic-final debounce coalesces adjacent Xunfei finals but does not require acoustic silence.
- Continued raw speech never erases a semantically confirmed candidate checkpoint.
- A confirmed interviewer final invalidates a pending sentinel or an in-flight delegated Expert result and clears the previous answer window.
- Stop capture, disable Auto, manual Generate Q, and New Interview remain hard cancellation boundaries.
- Only one sentinel-or-Expert chain may be in flight per WebSocket session.
- Candidate finals arriving during a monitor call are retained and re-evaluated after a `wait`; they are not lost.
- Manual speaker-role corrections remain authoritative because only the semantic partitioner's candidate callback feeds the sentinel.

## Latency and failure behavior

- Sentinel: `deepseek-v4-flash`, thinking disabled, no retries, bounded recent context, 1.8-second timeout.
- Expert: existing `deepseek-v4-flash`, thinking disabled, no retries, 8-second timeout.
- The sequential hard ceiling is kept below ten seconds apart from negligible local serialization.
- Sentinel timeout, invalid JSON, or provider error fails closed as `wait` and may retry on later candidate evidence.
- Expert timeout or invalid output uses the existing evidence-anchored Chinese fallback so a valid delegation never ends with a full progress bar and no question.

## Observability and UI

The server emits a credential-free `auto-monitor` state: `evaluating`, `waiting`, `delegating`, or `idle`, with model and elapsed milliseconds where relevant. The existing GLP Auto pill shows a compact Chinese state (`监控中`, `待证据`, `生成中`) without adding a setting or another panel. Candidate text, model reasoning, and API credentials are never included in telemetry.

## Alternatives considered

- **Keep the single Expert call behind silence detection:** lowest call count, but it is the reproduced reason Auto never fires on tightly paced speech.
- **Generate on every long candidate chunk without a sentinel:** more visible but noisy and likely to produce redundant or premature questions.
- **Selected two-stage sentinel + Expert:** adds one small Flash call but gives explicit delegation, bounded cost, better timing, and diagnosable behavior while preserving question quality.

## Verification

- Unit-test strict sentinel parsing, bounded prompt construction, timeout/no-retry options, and fail-closed behavior.
- State-machine tests prove continuous speech does not cancel candidate checkpoints, confirmed interviewer speech does cancel, and candidate evidence arriving mid-monitor is retried.
- WebSocket integration proves semantic partitioning precedes monitoring and produces one automatic Expert result under continuous candidate speech.
- Client tests prove `auto-monitor` parsing/state and GLP Auto pill labels.
- Full server/web suites, typecheck, and builds must pass.
- Replay the supplied MP3 silently through BlackHole 2ch with Xunfei: observe `监控中`/`生成中`, a meaningful Chinese auto question, correct candidate/interviewer labels, and no question before any confirmed candidate evidence.

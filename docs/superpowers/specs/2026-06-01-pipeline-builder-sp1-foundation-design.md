# SP1 — Pipeline Builder Foundation (engine + data model)

**Date:** 2026-06-01
**Status:** Approved (brainstorming) → implementing
**Part of:** the 3-sub-project "customizable interviewer pipeline" (SP1 foundation →
SP2 Customize form → SP3 2D editor). This spec covers **SP1 only**.

## Purpose

Today the Expert interviewer chain is a hardcoded 7-block DAG in
`expert-orchestrator.js`. SP1 replaces the hardcoding with a **serializable
pipeline data model** and a **generic typed execution engine**, then re-expresses
Expert as a built-in *preset* that runs on the engine and **reproduces today's
output exactly**. This is invisible to users but is the substrate SP2/SP3 ride on.

## Scope (SP1 only)

- IN: pipeline schema; typed block-type registry; generic execution engine;
  prompt frame/body split of the 7 builders (default body = current text);
  Expert built-in preset; `runExpertChain` delegates to the engine; tests +
  eval proving reproduction.
- OUT (later sub-projects): any UI, the "Customize" selector, save/load library,
  import/export, the 2D editor, Fast-as-preset (Fast stays the existing
  lightweight path untouched).

## Data model

```
Pipeline { id, name, builtin:boolean, nodes:Node[], edges:Edge[], version:string }
Node     { id, type, model?, thinking?, promptBody?, temperature?, maxTokens?, pos?:{x,y} }
Edge     { fromNode, fromPort, toNode, toPort }
```
- `type` ∈ block-type registry ids. Per-node `model/thinking/temperature/maxTokens`
  override the type's defaults; `promptBody` overrides the type's default body.
- `pos` is editor-only metadata (ignored by the engine).

### Port types (the "lanes")
`claims · gaps · state · candidates · ranking · verdict · final · text`. Edges may
only connect a `fromPort` whose type equals the `toPort`'s declared type. An
ambient **context** object (candidateAnswer, resumeChunk, jobDescription,
questionHistory, sessionState) is available to every node — never wired.

### Block-type registry (`block-types.js`)
One entry per palette block. SP1 ships the 7 Expert types (the generic `llm`
block is defined but only fully exercised in SP2):

| type | inputs (ports) | output | model | thinking |
|------|----------------|--------|-------|----------|
| anatomy | (context) | claims | flash | off |
| evidence-gap | claims | gaps | flash | off |
| state-update | (context) | state | flash | off |
| question-pool | claims, gaps, state | candidates | flash | budget(1024) |
| rank-score | candidates, gaps, state | ranking | flash | budget(1536) |
| safety-audit | candidates | verdict | flash | off |
| final-render | ranking, candidates, verdict | final | flash | off |

Each entry: `{ id, inputs:[{port,type}], outputType, build(inputs,ctx,body), fallback(inputs,ctx), defaults:{model,thinking,temperature,maxTokens,timeoutMs} }`.
`build`/`fallback`/defaults reference the EXISTING builders + fallbacks + constant
maps in `expert-orchestrator.js` (moved or imported — no behavior change).

## Prompt frame/body split

Each `buildBlockX` gains an optional `promptBody` param. Internally the prompt is
`FRAME_HEAD + (promptBody ?? DEFAULT_BODY) + FRAME_TAIL`, where FRAME_* hold input
injection + output JSON schema + hard rules (engine-owned) and DEFAULT_BODY holds
the role/criteria/style text (today's content verbatim). With no `promptBody`, the
emitted prompt is **byte-identical to today** — this is what makes Expert
reproduction exact. (SP1 may implement this as a minimal split; SP2 polishes the
body boundaries for editing.)

## Execution engine (`pipeline-engine.js`)

`runPipeline({ pipeline, apiKey, context, abortSignal, onProgress, onSessionState })`:
1. **Validate** the pipeline (see below). Invalid → throw (callers catch).
2. **Topo-sort** nodes; run a node once all its input edges' source nodes resolve.
   Independent nodes run concurrently (reproduces today's A∥C parallelism).
3. For each node: gather typed inputs from incoming edges + ambient context, call
   the block type's `build(...)` → LLM via the shared transport (reusing
   `callBlock`: low-temp first attempt, one schema-repair retry, then the type's
   `fallback`). Per-node `model/thinking/temperature/maxTokens` apply.
4. Emit `onProgress({phase:node.id, index, total, status, tokens})` at each node's
   start/done (drives the existing progress card; phase labels map by node type).
5. The pipeline's terminal `final`-output node's result is `output`. Return
   `{ output, blocks, trace, fallbackTriggered, elapsedMs, tokensUsed, sessionStatePromise }`
   — same shape `interviewer-runtime.js` already consumes. Block H consolidation
   stays wired off the critical path as today.

### Validation rules
- Every edge connects matching port types; no unknown node types/ports.
- DAG (no cycles).
- Exactly one node produces `final` (the terminal); it is reachable.
- Every present node's required inputs are satisfied by an edge (else that node
  would always fallback — warn, allowed for `llm` which only needs context).

## Reproduction acceptance

1. **Equivalence unit test** (`test/pipeline-expert-equivalence.test.js`): stub
   `global.fetch` to return canned valid per-block JSON; run the *legacy*
   `runExpertChain` logic and `runPipeline(EXPERT_PRESET)` on the same fixture;
   assert identical `output`, identical block call order, identical progress
   sequence. (Deterministic — no judge noise.)
2. **Delegation:** once equivalent, `runExpertChain(...)` becomes a thin wrapper
   that builds the context and calls `runPipeline(EXPERT_PRESET, ...)`.
3. **Regression:** existing `test/expert-progress.test.js` (6-phase progress,
   throwing-callback safety, fallback-still-advances) passes against the engine.
4. **Quality smoke:** PTES harness on a small stratified sample through the engine
   matches the committed ~88% band (no regression from the refactor).

## Files

- Create: `src/services/ai/pipeline/pipeline-schema.js` (types + validate)
- Create: `src/services/ai/pipeline/block-types.js` (registry → existing builders/fallbacks/defaults)
- Create: `src/services/ai/pipeline/presets.js` (EXPERT_PRESET; Fast left alone)
- Create: `src/services/ai/pipeline/pipeline-engine.js` (`runPipeline`)
- Create: `test/pipeline-expert-equivalence.test.js`
- Modify: `src/services/ai/interviewer-prompts/expert/block-{a..g}.js` (optional `promptBody`)
- Modify: `src/main-process/features/interviewer/expert-orchestrator.js` (`runExpertChain` delegates; shared transport/constants exported or moved)

## Gotchas

- The repair retry, per-block fallback, thinking budgets, model assignment, and
  A∥C parallelism must be preserved exactly — they're load-bearing for the
  current ~88% quality and ~56s latency. The engine reuses them, doesn't reinvent.
- Block H (session consolidation) is off-critical-path and must keep working via
  `sessionStatePromise` / `onSessionState` unchanged.
- `tokensUsed` (added for the follow-up token display) and the
  `interviewer-progress` events must keep flowing identically.

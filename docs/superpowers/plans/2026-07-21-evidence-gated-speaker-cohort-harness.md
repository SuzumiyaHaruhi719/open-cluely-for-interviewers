# Evidence-Gated Speaker Cohort Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assimilate later Doubao acoustic clusters into interviewer/candidate display cohorts only after balanced, two-pass semantic evidence, without letting a cohort prior trigger Auto.

**Architecture:** Add a focused `speaker-cohort.ts` module that owns evidence selection, structured DeepSeek audits, deterministic consensus, and reversible per-cluster state. Integrate it after the existing per-turn semantic ledger: authority roles drive local repair and Auto callbacks first, then cohort roles fill display-only unknowns. Extend the wire contract with `roleSource` so tests can prove the safety boundary.

**Tech Stack:** TypeScript, Node 20 test runner through `tsx --test`, DeepSeek v4 Flash through the existing DashScope helper, Zod-free strict JSON parsing, React/Vitest for renderer parsing.

## Global Constraints

- Work directly on `main`; the user explicitly requested no feature branch.
- Preserve every Doubao `speakerId`; never merge or renumber acoustic clusters.
- Ambiguous clusters remain `unknown` / `待确认`; elapsed time never forces a role.
- Require two substantive target utterances, two adjacency windows, 48 total non-whitespace characters, 12 characters per counted utterance, and two confirmed anchors for each established role.
- Require two independent audits, confidence `>= 0.88`, winning-fit margin `>= 0.18`, complete target coverage, valid citations, and no strong contradiction.
- Cohort delegation is display-only. Auto callbacks remain limited to manual, local, or two-pass per-turn semantic authority.
- Manual corrections remain highest precedence.
- Contradiction revokes to `contested`; never flip directly.
- TDD is mandatory: observe each new test fail for the intended missing behavior before production edits.
- Update the Obsidian implementation note before final verification.

---

### Task 1: Pure cohort evidence and consensus engine

**Files:**
- Create: `web-app/server/src/speaker-cohort.ts`
- Create: `web-app/server/test/speaker-cohort.test.ts`

**Interfaces:**
- Consumes: finalized native turns shaped as `{ seq, source, speakerId?, text }` and confirmed per-turn roles shaped as `{ seq, role, confidence }`.
- Produces: `buildCohortEvidence()`, `parseCohortAudit()`, `consensusCohortAudits()`, `CohortAudit`, `CohortDecision`, and `CohortRoleSource`.

- [ ] **Step 1: Write failing evidence-gate tests**

```ts
test('new cluster stays ineligible until two substantive adjacency windows exist', () => {
  const oneWindow = turns([
    [0, 1, '请说明项目背景。'],
    [1, 3, '我先梳理问题并确定整改负责人，'],
    [2, 3, '然后持续复验直到指标恢复。']
  ]);
  assert.equal(buildCohortEvidence(oneWindow, confirmed, 3), null);

  const twoWindows = turns([
    ...oneWindow,
    [3, 1, '最终结果如何验证？'],
    [4, 3, '我用三周告警和工单数据验证，平均响应时间缩短到五分钟。']
  ]);
  assert.ok(buildCohortEvidence(twoWindows, confirmed, 3));
});

test('evidence packet balances interviewer and candidate anchors', () => {
  const packet = buildCohortEvidence(panelTurns, panelConfirmed, 30);
  assert.equal(packet?.interviewerAnchors.length, 2);
  assert.equal(packet?.candidateAnchors.length, 2);
  assert.equal(packet?.targetSpeakerId, 30);
});
```

- [ ] **Step 2: Run the cohort test and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: FAIL because `../src/speaker-cohort` does not exist.

- [ ] **Step 3: Implement bounded evidence selection**

```ts
export const MIN_COHORT_UTTERANCES = 2;
export const MIN_COHORT_TOTAL_CHARS = 48;
export const MIN_COHORT_UTTERANCE_CHARS = 12;
export const MIN_ROLE_ANCHORS = 2;

export interface CohortEvidencePacket {
  targetSpeakerId: number;
  revision: number;
  targets: CohortTurn[];
  neighbours: CohortTurn[];
  interviewerAnchors: CohortTurn[];
  candidateAnchors: CohortTurn[];
  requiredSeqs: number[];
}

export function buildCohortEvidence(
  turns: readonly CohortTurn[],
  confirmed: readonly ConfirmedTurnRole[],
  targetSpeakerId: number
): CohortEvidencePacket | null {
  // Exclude the target cluster from both anchor banks, collapse grammatical
  // continuations into one evidence window, enforce the exact gates above,
  // then return balanced bounded anchors plus direct neighbours.
}
```

- [ ] **Step 4: Run the cohort test and verify GREEN**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: PASS for evidence gating and balanced anchor selection.

- [ ] **Step 5: Write failing parser and consensus tests**

```ts
test('consensus rejects agreement without fit margin', () => {
  const a = audit('candidate', 0.94, 0.82, 0.72, [4, 8]);
  const b = audit('candidate', 0.93, 0.84, 0.70, [4, 8]);
  assert.equal(consensusCohortAudits(packet, a, b), null);
});

test('consensus accepts complete independently agreeing audits', () => {
  const a = audit('candidate', 0.94, 0.92, 0.30, [4, 8]);
  const b = audit('candidate', 0.91, 0.89, 0.35, [4, 8]);
  assert.deepEqual(consensusCohortAudits(packet, a, b), {
    speakerId: 30,
    role: 'candidate',
    confidence: 0.91,
    evidenceSeqs: [4, 8],
    contradictionSeqs: []
  });
});

test('parser rejects citations outside the supplied packet', () => {
  const parsed = parseCohortAudit('{"role":"candidate","confidence":0.99,"candidateFit":0.95,"interviewerFit":0.1,"targetRoles":[],"evidenceSeqs":[999],"contradictionSeqs":[]}', packet);
  assert.equal(parsed, null);
});
```

- [ ] **Step 6: Run parser/consensus tests and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: FAIL because parser/consensus exports are missing.

- [ ] **Step 7: Implement strict audit parsing and deterministic consensus**

```ts
export interface CohortAudit {
  role: SpeakerRole;
  confidence: number;
  interviewerFit: number;
  candidateFit: number;
  targetRoles: Array<{ seq: number; role: SpeakerRole; confidence: number }>;
  evidenceSeqs: number[];
  contradictionSeqs: number[];
  model: string;
}

export function consensusCohortAudits(
  packet: CohortEvidencePacket,
  primary: CohortAudit | null,
  verification: CohortAudit | null
): CohortDecision | null {
  // Validate identical non-unknown role, >= .88 confidence, >= .18 fit margin,
  // every required target seq, >= 2 supporting target utterances, valid cited
  // seqs, no high-confidence contradiction, and no confirmed opposite majority.
}
```

- [ ] **Step 8: Re-run focused tests and commit**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: all cohort unit tests PASS.

Commit:

```bash
git add web-app/server/src/speaker-cohort.ts web-app/server/test/speaker-cohort.test.ts
git commit -m "feat: add evidence-gated speaker cohort engine"
git push origin main
```

### Task 2: DeepSeek audit prompt and reversible cohort state

**Files:**
- Modify: `web-app/server/src/speaker-cohort.ts`
- Modify: `web-app/server/test/speaker-cohort.test.ts`
- Modify: `web-app/server/src/config.ts`

**Interfaces:**
- Consumes: `chat()` and `config.speakerPartitionModel`.
- Produces: `classifySpeakerCohort(packet, pass)`, `createSpeakerCohortHarness()`, `evaluate()`, `getRole()`, `reset()`.

- [ ] **Step 1: Write failing prompt-order and state tests**

```ts
test('two audit passes reverse evidence order and run independently', async () => {
  const prompts: string[] = [];
  const harness = createSpeakerCohortHarness({
    audit: async (packet, pass) => {
      prompts.push(buildCohortAuditInput(packet, pass));
      return goodAudit('candidate');
    }
  });
  await harness.evaluate(snapshot);
  assert.match(prompts[0], /interviewer-evidence[\s\S]*candidate-evidence/);
  assert.match(prompts[1], /candidate-evidence[\s\S]*interviewer-evidence/);
});

test('identical evidence revision is never evaluated twice', async () => {
  await harness.evaluate(snapshot);
  await harness.evaluate(snapshot);
  assert.equal(auditCalls, 2);
});

test('two confirmed opposite turns revoke delegation to contested', async () => {
  await harness.evaluate(candidateSnapshot);
  assert.equal(harness.getRole(30).role, 'candidate');
  await harness.evaluate(oppositeSnapshot);
  assert.equal(harness.getRole(30).state, 'contested');
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: FAIL because prompt builder and harness are missing.

- [ ] **Step 3: Implement prompt, model call, and state machine**

```ts
export function createSpeakerCohortHarness(deps: SpeakerCohortHarnessDeps = {}) {
  const states = new Map<number, ClusterCohortState>();
  let epoch = 0;
  return {
    async evaluate(input: CohortEvaluationInput): Promise<void> {
      // Revoke on two per-turn-consensus contradictions; otherwise evaluate only
      // eligible clusters whose evidence revision advanced. Run primary and
      // verification concurrently and ignore stale epoch/revision results.
    },
    getRole(speakerId: number): ClusterCohortState,
    reset(): void { epoch += 1; states.clear(); }
  };
}

export async function classifySpeakerCohort(
  packet: CohortEvidencePacket,
  pass: 'primary' | 'verification'
): Promise<CohortAudit | null> {
  const response = await chat({
    system: COHORT_SYSTEM,
    messages: [{ role: 'user', content: buildCohortAuditInput(packet, pass) }],
    model: config.speakerPartitionModel,
    maxTokens: 700,
    temperature: 0,
    thinking: false,
    timeoutMs: 8_000,
    maxRetries: 0
  });
  return parseCohortAudit(response, packet, config.speakerPartitionModel);
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts`

Expected: all cohort harness tests PASS.

- [ ] **Step 5: Commit and push checkpoint**

```bash
git add web-app/server/src/speaker-cohort.ts web-app/server/test/speaker-cohort.test.ts web-app/server/src/config.ts
git commit -m "feat: add reversible Flash cohort assimilation"
git push origin main
```

### Task 3: Integrate display-only cohort fallback into the partitioner

**Files:**
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Modify: `web-app/server/test/speaker-partitioner.test.ts`

**Interfaces:**
- Consumes: `SpeakerCohortHarness.evaluate()` and `getRole()`.
- Produces: partition segments with `roleSource`; callbacks based only on authority-resolved turns.

- [ ] **Step 1: Write failing integration regressions**

```ts
test('cohort labels pending display turns but never releases Auto', async () => {
  const candidates: SpeakerTurn[] = [];
  const partitions: SpeakerPartition[] = [];
  const p = createSpeakerPartitioner({
    classify: semanticClassifierWithTargetUnknown,
    cohortHarness: delegatedCandidateCohort(30),
    applySpeakerRole: (_id, role) => role,
    resolveTurnRole: (_id, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  recordPanel(p);
  await p.finalize();
  assert.deepEqual(candidates, []);
  assert.equal(findSegment(partitions.at(-1), 30).role, 'candidate');
  assert.equal(findSegment(partitions.at(-1), 30).roleSource, 'cohort');
});

test('per-turn semantic verdict outranks opposite cohort display prior', async () => {
  // target speaker 30 is delegated candidate, but one confirmed question seq
  // must render interviewer/source semantic-turn and feed interviewer once.
});
```

- [ ] **Step 2: Run partitioner test and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-partitioner.test.ts`

Expected: FAIL because `cohortHarness` and `roleSource` are unsupported.

- [ ] **Step 3: Refactor schedule into authority and display phases**

```ts
type RoleSource = 'manual' | 'local' | 'semantic-turn' | 'cohort' | 'unknown';

// 1. Build authorityResolved from manual + semantic only.
// 2. Compute local overrides from authorityResolved only.
// 3. Release callbacks from authorityResolved/local only.
// 4. Evaluate cohort state using the semantic/manual anchor ledger.
// 5. Build displayResolved, filling only unknown authority roles from cohort.
// 6. Emit roleSource on every partition segment.
```

- [ ] **Step 4: Run focused partitioner and cohort tests**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts test/speaker-partitioner.test.ts`

Expected: PASS, including existing fail-safe and multi-interviewer regressions.

- [ ] **Step 5: Commit and push checkpoint**

```bash
git add web-app/server/src/speaker-partitioner.ts web-app/server/test/speaker-partitioner.test.ts
git commit -m "feat: integrate display-only speaker cohorts"
git push origin main
```

### Task 4: Extend contract and renderer diagnostics

**Files:**
- Modify: `web-app/packages/contract/index.d.ts`
- Modify: `web-app/web/src/lib/messages.ts`
- Modify: `web-app/web/src/lib/messages.test.ts`
- Modify: `web-app/web/src/lib/speakerSegments.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.test.ts`

**Interfaces:**
- Consumes: server `roleSource` values.
- Produces: typed `SpeakerRoleSource` and client `SpeakerSegment.roleSource` without new settings/UI controls.

- [ ] **Step 1: Write failing parser and socket tests**

```ts
it('preserves a valid cohort role source', () => {
  const out = parseServerMessage(JSON.stringify({
    type: 'speaker-partition', status: 'live', model: 'deepseek-v4-flash',
    segments: [{ seq: 4, speakerId: 30, role: 'candidate', roleSource: 'cohort', text: '回答' }]
  }));
  expect(out?.segments[0].roleSource).toBe('cohort');
});

it('rejects an unknown role source', () => {
  // roleSource: 'voice-guess' must make the entire partition invalid.
});
```

- [ ] **Step 2: Run web tests and verify RED**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/messages.test.ts src/lib/useCopilotSocket.test.ts`

Expected: FAIL because `roleSource` is not parsed or stored.

- [ ] **Step 3: Add the typed field end-to-end**

```ts
export type SpeakerRoleSource = 'manual' | 'local' | 'semantic-turn' | 'cohort' | 'unknown';

export interface SpeakerPartitionSegment {
  seq: number;
  speakerId: number;
  role: SpeakerRole;
  roleSource: SpeakerRoleSource;
  text: string;
}
```

Carry `roleSource` through `parseServerMessage()` and `useCopilotSocket()` into `SpeakerSegment`. Do not add a visible badge or setting; the existing role label remains the user-facing surface.

- [ ] **Step 4: Run web tests and server typecheck**

Run: `cd web-app && npm test --workspace @open-cluely/web -- --run src/lib/messages.test.ts src/lib/useCopilotSocket.test.ts && npm run typecheck --workspace @open-cluely/server`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Commit and push checkpoint**

```bash
git add web-app/packages/contract/index.d.ts web-app/web/src/lib/messages.ts web-app/web/src/lib/messages.test.ts web-app/web/src/lib/speakerSegments.ts web-app/web/src/lib/useCopilotSocket.ts web-app/web/src/lib/useCopilotSocket.test.ts
git commit -m "feat: expose speaker role decision sources"
git push origin main
```

### Task 5: WebSocket, finalization, and implementation notes

**Files:**
- Modify: `web-app/server/src/ws.ts`
- Modify: `web-app/server/test/ws-sim-injection.test.ts`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`

**Interfaces:**
- Consumes: default cohort harness from `createSpeakerPartitioner()`.
- Produces: session-scoped reset/finalization and full partition messages with role sources.

- [ ] **Step 1: Write failing WebSocket regression**

```ts
test('cohort state resets between interviews and finalization cannot emit late Auto', async () => {
  // Run one simulated panel interview with cluster 30, resetGeneration, then a
  // second interview reusing cluster 30. Assert the second begins unknown and
  // no result event appears after stop/final partition.
});
```

- [ ] **Step 2: Run regression and verify RED**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/ws-sim-injection.test.ts`

Expected: FAIL until cohort lifecycle is wired into reset/finalize.

- [ ] **Step 3: Wire lifecycle and update the implementation note**

Ensure `speakerPartitioner.reset()` invalidates cohort epochs, `finalize()` rebuilds final cohort state after the semantic ledger, and stop closes Auto before cohort reconciliation. Update the note with Purpose, Entry points, Data flow, Config/state, and Gotchas, including the display-only/Auto-authority invariant.

- [ ] **Step 4: Run focused server regressions**

Run: `cd web-app && npm exec --workspace @open-cluely/server -- tsx --test test/speaker-cohort.test.ts test/speaker-partitioner.test.ts test/ws-sim-injection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit and push checkpoint**

```bash
git add web-app/server/src/ws.ts web-app/server/test/ws-sim-injection.test.ts
git add /Users/thomasli/Documents/github/Obsidian/Interview\ Copilot/Implementation/speaker-role-auto-partition.md
git commit -m "test: verify panel cohort lifecycle"
git push origin main
```

### Task 6: Full verification and rebuild

**Files:**
- Verify only; modify files solely to fix observed failures through new RED/GREEN cycles.

**Interfaces:**
- Consumes: complete speaker cohort implementation.
- Produces: fresh release evidence.

- [ ] **Step 1: Run all automated tests**

Run: `cd web-app && npm test`

Expected: all core, question-bank, server, and web tests PASS with zero failures.

- [ ] **Step 2: Run typecheck and production build**

Run: `cd web-app && npm run typecheck --workspace @open-cluely/server && npm run build`

Expected: both commands exit `0`.

- [ ] **Step 3: Rebuild/restart the served app**

Run the repository's existing server launch command on port `8788`, verify `/api/health`, and open `http://127.0.0.1:8788/?build=<HEAD-short-hash>` in the in-app browser.

Expected: health is OK and the current build hash is visible in the URL.

- [ ] **Step 4: Run browser smoke QA**

Start an interview, verify a new unresolved speaker renders `待确认`, verify a manually corrected role remains sticky, end the interview, confirm no late question appears, and confirm the UI returns to preparation.

- [ ] **Step 5: Verify Git and push final checkpoint**

Run: `git status --short --branch && git rev-parse HEAD && git rev-parse origin/main`

Expected: clean `main`, identical local/remote hashes.

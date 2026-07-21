import type { AudioSource, SpeakerRole } from '@open-cluely/contract';
import { chat } from './dashscope';
import { config } from './config';
import {
  createSpeakerCohortHarness,
  type ConfirmedTurnRole,
  type SpeakerCohortHarness
} from './speaker-cohort';

export const SPEAKER_PARTITION_MODEL = config.speakerPartitionModel;
const CLASSIFY_TIMEOUT_MS = 8_000;
const MAX_INPUT_CHARS = 6_000;
const MIN_CONTENT_CHARS = 4;
const MIN_NATIVE_CHARS_PER_SPEAKER = 16;
const MIN_NATIVE_TOTAL_CHARS = 48;
const MIN_TOTAL_TURNS = 6;
const REFRESH_TURNS = 3;
const MAX_CLASSIFIER_TURNS = 12;
const MAX_RECENT_NATIVE_TURNS = 8;
const MAX_HYBRID_TEXT_TURNS = 8;
const MAX_CLASSIFIER_TURN_CHARS = 360;
const REVIEW_BATCH_SIZE = 6;
const REVIEW_CONCURRENCY = 4;
const MIN_LIVE_TURN_ROLE_CONFIDENCE = 0.8;
const MIN_FINAL_TURN_ROLE_CONFIDENCE = 0.72;
const MIN_CONTINUITY_EDGE_CONFIDENCE = 0.9;
const MIN_SEMANTIC_REFRESH_CHARS = 48;
const TURN_TERMINAL_PUNCTUATION = /[。！？!?][”’"'）)\]]*$/;
const CONTINUATION_PREFIX = /^(?:[，,、。；;：:\s]*)?(?:但是|但|并且|而且|所以|同时|以及|然后|接着|另外|另一方面|其次|最后|那么|其中|例如|比如|领导|作为|如果|由于|因为|为了|并|也|再|还|或|与|及)/;
const INTERVIEWER_HANDOFF = /^(?:好[，,。]?|谢谢|请(?:听|问|结合|确认|(?:具体)?(?:介绍|说明|谈|回答))|下面|下一题|接下来请|能否|请考生|(?:(?:所以(?:说)?|那么|然后)[，,]?)?(?:你|考生).{0,24}(?:如何|怎么|为什么|是否|能否|做了什么|会怎么))/;
const INTERVIEWER_PROMPT_TAIL = /^(?:(?:对此|关于此事|针对上述|基于上述|就此|那么)[，,]?)?(?:请(?:你|考生)?|你|考生).{0,40}(?:谈谈|说明|介绍|回答|如何|怎么|为什么|看法|理解)/;
const INTERVIEWER_QUESTION_FRAGMENT = /^[^。！？?]{0,56}(?:如何|怎么|为什么|能否|是否|哪(?:个|些)|什么)[^。！？?]{0,10}[？?]$/;
const CANDIDATE_PLAN = /(?:^|[，。；：,\s])(?:我(?:会|将|要|先|再|还|可以|需要|负责|认为|觉得|就)|作为[^，。]{0,18}我|首先|其次|然后|随后|那么|目前(?:我)?会|根据[^，。]{0,24}(?:情况|结果))/;
const CANDIDATE_ANSWER_OPENING = /^(?:各位考官|我|先(?:要|将|把|对|从|进行)|通过|在(?:我|当时|现场|处理)|作为)/;
const SCORE_VALUE = '(?:\\d+(?:\\.\\d+)?|[零〇一二三四五六七八九十百]+(?:点[零〇一二三四五六七八九]+)?)分';
const SCORE_ANNOUNCEMENT = new RegExp(
  `(?:(?:最高分|最低分).{0,100}(?:号)?(?:考生|选手)(?:的)?最终成绩|` +
    `(?:号)?(?:考生|选手)(?:的)?最终成绩|(?:${SCORE_VALUE}[，,、\\s]*){3,})`
);

export interface SpeakerTurn {
  seq: number;
  source: AudioSource;
  speakerId?: number;
  text: string;
}

export interface InferredSpeakerRole {
  speakerId: number;
  role: SpeakerRole;
  confidence: number;
}

export interface InferredTurnRole {
  seq: number;
  role: SpeakerRole;
  confidence: number;
}

export interface SpeakerClassification {
  speakerRoles: InferredSpeakerRole[];
  turnRoles: InferredTurnRole[];
  model: string;
}

export interface SpeakerClassificationRequest {
  final?: boolean;
  prioritySeqs?: readonly number[];
  /** Turns that must receive an explicit semantic verdict in this bounded review. */
  reviewSeqs?: readonly number[];
  /** Independent passes must agree before a turn becomes role-confirmed. */
  auditPass?: 'primary' | 'verification';
}

export interface SpeakerPartitionSegment {
  seq: number;
  speakerId: number;
  role: SpeakerRole;
  roleSource: SpeakerRoleSource;
  text: string;
}

export type SpeakerRoleSource =
  | 'manual'
  | 'local'
  | 'semantic-turn'
  | 'cohort'
  | 'unknown';

export interface SpeakerPartition {
  status: 'live' | 'final';
  model: string;
  segments: SpeakerPartitionSegment[];
}

export interface SpeakerPartitioner {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  record(turn: SpeakerTurn): void;
  finalize(): Promise<void>;
  flush(): Promise<void>;
  reset(): void;
}

export interface SpeakerPartitionerDeps {
  classify?: (
    turns: readonly SpeakerTurn[],
    request?: SpeakerClassificationRequest
  ) => Promise<SpeakerClassification>;
  /** Display-only cohort assimilation; never grants authority to Auto callbacks. */
  cohortHarness?: SpeakerCohortHarness;
  /** Applies an automatic cluster role and returns the effective role (manual corrections may win). */
  applySpeakerRole: (speakerId: number, role: SpeakerRole) => SpeakerRole;
  /** Applies one semantic turn exception without changing the acoustic cluster's stable role. */
  resolveTurnRole?: (speakerId: number, role: SpeakerRole) => SpeakerRole;
  onCandidateTurn: (turn: SpeakerTurn) => void;
  onInterviewerTurn?: (turn: SpeakerTurn) => void;
  onPartition: (partition: SpeakerPartition) => void;
}

const CLASSIFIER_SYSTEM = [
  'You assign speakers in a job interview after enough transcript evidence has accumulated.',
  'Use speech acts and cross-turn context, never numeric speaker order.',
  'An interviewer asks, frames, redirects, or evaluates; a candidate answers with experience, evidence, decisions, and results.',
  'Acoustic diarization may over-cluster one person into multiple speakerIds, so multiple ids may share a role.',
  'A native speakerId is acoustic evidence, never identity. Inspect every required turn and classify its speech act independently of the cluster baseline.',
  'A substantive answer to an adjacent question is candidate even if its acoustic id is mapped interviewer; a genuine new question is interviewer even if its id is mapped candidate.',
  'A short fragment that grammatically continues an adjacent question or answer inherits that same speech act even when its acoustic id changes.',
  'For every required seq return exactly one turnRoles item; use unknown when its semantic role is ambiguous instead of copying the acoustic baseline blindly.',
  'When a continuity-group is listed, its seqs are one grammatical ASR turn and must share one semantic role unless the text contains an explicit interruption.',
  'A turnRoles exception applies only to that seq and must never be used to remap the whole acoustic cluster.',
  'When speakerId is absent, classify each turn by seq. Use unknown when evidence is insufficient.',
  'Return STRICT JSON only:',
  '{"speakerRoles":[{"speakerId":1,"role":"interviewer|candidate|unknown","confidence":0.0}],',
  '"turnRoles":[{"seq":0,"role":"interviewer|candidate|unknown","confidence":0.0}]}'
].join(' ');

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function asRole(value: unknown): SpeakerRole {
  return value === 'interviewer' || value === 'candidate' ? value : 'unknown';
}

function findContinuityGroups(turns: readonly SpeakerTurn[]): SpeakerTurn[][] {
  const groups: SpeakerTurn[][] = [];
  let current: SpeakerTurn[] = [];
  const flush = () => {
    // Two adjacent fragments can still be a real speaker hand-off when ASR omits
    // punctuation. Require a three-part sandwich so matching outer model roles
    // can safely constrain only the lower-confidence middle fragment(s).
    if (current.length >= 3) groups.push(current);
    current = [];
  };

  for (const turn of turns) {
    const previous = current[current.length - 1];
    if (!previous) {
      current = [turn];
      continue;
    }
    const isDirectContinuation =
      turn.seq === previous.seq + 1 &&
      turn.source === previous.source &&
      !TURN_TERMINAL_PUNCTUATION.test(previous.text.trim()) &&
      CONTINUATION_PREFIX.test(turn.text.trim());
    if (isDirectContinuation) {
      current.push(turn);
    } else {
      flush();
      current = [turn];
    }
  }
  flush();
  return groups;
}

function reconcileContinuityTurnRoles(
  assignments: readonly InferredTurnRole[],
  turns: readonly SpeakerTurn[]
): InferredTurnRole[] {
  const roleBySeq = new Map<number, InferredTurnRole>();
  for (const assignment of assignments) {
    const previous = roleBySeq.get(assignment.seq);
    if (!previous || assignment.confidence > previous.confidence) {
      roleBySeq.set(assignment.seq, { ...assignment });
    }
  }

  for (const group of findContinuityGroups(turns)) {
    if (group.length < 3) continue;
    const first = roleBySeq.get(group[0].seq);
    const last = roleBySeq.get(group[group.length - 1].seq);
    if (
      !first ||
      !last ||
      first.role === 'unknown' ||
      first.role !== last.role ||
      first.confidence < MIN_CONTINUITY_EDGE_CONFIDENCE ||
      last.confidence < MIN_CONTINUITY_EDGE_CONFIDENCE
    ) {
      continue;
    }
    const consensusConfidence = Math.min(first.confidence, last.confidence);
    // A standalone clause can receive a confidently wrong speech-act label.
    // Once two high-confidence model edges agree that a 3+ fragment grammatical
    // group is one turn, continuity is stronger evidence than the isolated
    // middle-fragment score. Manual corrections are enforced downstream and
    // therefore remain authoritative.
    for (const turn of group) {
      const existing = roleBySeq.get(turn.seq);
      if (existing?.role === first.role) {
        continue;
      }
      roleBySeq.set(turn.seq, {
        seq: turn.seq,
        role: first.role,
        confidence: consensusConfidence
      });
    }
  }

  return [...roleBySeq.values()].sort((a, b) => a.seq - b.seq);
}

function parseObject(text: string): Record<string, unknown> | null {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const value = JSON.parse(match[0]) as unknown;
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

export function parseSpeakerClassification(
  text: string,
  turns: readonly SpeakerTurn[],
  model = SPEAKER_PARTITION_MODEL
): SpeakerClassification {
  const obj = parseObject(text) ?? {};
  const validSpeakerIds = new Set(
    turns.flatMap((turn) => (typeof turn.speakerId === 'number' ? [turn.speakerId] : []))
  );
  const validSeqs = new Set(turns.map((turn) => turn.seq));
  const speakerRoles = (Array.isArray(obj.speakerRoles) ? obj.speakerRoles : [])
    .flatMap((entry): InferredSpeakerRole[] => {
      if (!entry || typeof entry !== 'object') return [];
      const rec = entry as Record<string, unknown>;
      const speakerId = Number(rec.speakerId);
      if (!Number.isInteger(speakerId) || !validSpeakerIds.has(speakerId)) return [];
      return [{ speakerId, role: asRole(rec.role), confidence: clampConfidence(rec.confidence) }];
    });
  const parsedTurnRoles = (Array.isArray(obj.turnRoles) ? obj.turnRoles : [])
    .flatMap((entry): InferredTurnRole[] => {
      if (!entry || typeof entry !== 'object') return [];
      const rec = entry as Record<string, unknown>;
      const seq = Number(rec.seq);
      if (!Number.isInteger(seq) || !validSeqs.has(seq)) return [];
      return [{ seq, role: asRole(rec.role), confidence: clampConfidence(rec.confidence) }];
    });
  const turnRoles = reconcileContinuityTurnRoles(parsedTurnRoles, turns);
  return { speakerRoles, turnRoles, model };
}

function compactTurnText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLASSIFIER_TURN_CHARS);
}

function formatClassifierTurn(turn: SpeakerTurn): string {
  return `[seq=${turn.seq} source=${turn.source} speaker=${
    typeof turn.speakerId === 'number' ? turn.speakerId : 'none'
  }] ${compactTurnText(turn.text)}`;
}

function groupNativeTurns(nativeTurns: readonly SpeakerTurn[]): Map<number, SpeakerTurn[]> {
  const bySpeaker = new Map<number, SpeakerTurn[]>();
  for (const turn of nativeTurns) {
    const speakerId = turn.speakerId as number;
    const group = bySpeaker.get(speakerId) ?? [];
    group.push(turn);
    bySpeaker.set(speakerId, group);
  }
  return bySpeaker;
}

function mostSubstantiveTurn(turns: readonly SpeakerTurn[]): SpeakerTurn | undefined {
  return turns.reduce<SpeakerTurn | undefined>((best, turn) => {
    if (!best) return turn;
    const chars = turn.text.replace(/\s+/g, '').length;
    const bestChars = best.text.replace(/\s+/g, '').length;
    return chars > bestChars ? turn : best;
  }, undefined);
}

/**
 * Stable acoustic-role mapping needs one substantive anchor per cluster, while
 * weak semantic correction needs the actual recent question/answer adjacency.
 * Keep both without sending a full interview or duplicating recent rows.
 */
function selectNativeClassifierEvidence(
  nativeTurns: readonly SpeakerTurn[],
  limit = MAX_CLASSIFIER_TURNS
): { anchors: SpeakerTurn[]; recent: SpeakerTurn[] } {
  const safeLimit = Math.max(0, limit);
  const recent = nativeTurns.slice(-Math.min(MAX_RECENT_NATIVE_TURNS, safeLimit));
  const recentSeqs = new Set(recent.map((turn) => turn.seq));
  const recentSpeakerIds = new Set(recent.map((turn) => turn.speakerId as number));
  const capacity = Math.max(0, safeLimit - recent.length);
  const candidates = [...groupNativeTurns(nativeTurns).entries()]
    .flatMap(([speakerId, group]) => {
      const outsideRecent = group.filter((turn) => !recentSeqs.has(turn.seq));
      const anchor = mostSubstantiveTurn(outsideRecent);
      return anchor
        ? [{ anchor, missingFromRecent: !recentSpeakerIds.has(speakerId) }]
        : [];
    })
    .sort((a, b) => {
      if (a.missingFromRecent !== b.missingFromRecent) return a.missingFromRecent ? -1 : 1;
      return a.anchor.seq - b.anchor.seq;
    });
  const anchors = candidates
    .slice(0, capacity)
    .map(({ anchor }) => anchor)
    .sort((a, b) => a.seq - b.seq);
  return { anchors, recent };
}

/**
 * Keep long interviews inside a predictable input/output budget. Native ASR
 * needs representative evidence per acoustic cluster, not every verbatim turn;
 * text-only ASR is classified incrementally over a recent turn window.
 */
function selectTextOnlyClassifierEvidence(
  turns: readonly SpeakerTurn[],
  prioritySeqs: readonly number[] = []
): SpeakerTurn[] {
  const validPriorities = [...new Set(prioritySeqs)]
    .filter((seq) => turns.some((turn) => turn.seq === seq))
    .sort((a, b) => a - b);
  if (validPriorities.length === 0) return turns.slice(-MAX_CLASSIFIER_TURNS);

  const bySeq = new Map(turns.map((turn) => [turn.seq, turn]));
  const selected = new Map<number, SpeakerTurn>();
  const add = (turn: SpeakerTurn | undefined) => {
    if (turn && selected.size < MAX_CLASSIFIER_TURNS) selected.set(turn.seq, turn);
  };
  // Reserve room for current interview context so old orphan fragments are not
  // classified in isolation from the conversation that established the roles.
  const priorityBudget = Math.max(1, MAX_CLASSIFIER_TURNS - 4);
  for (const seq of validPriorities) {
    if (selected.size >= priorityBudget) break;
    add(bySeq.get(seq));
  }
  for (const seq of validPriorities) {
    if (selected.size >= priorityBudget) break;
    add(bySeq.get(seq - 1));
    add(bySeq.get(seq + 1));
  }
  for (const turn of turns.slice(-4)) add(turn);
  for (let index = turns.length - 1; index >= 0 && selected.size < MAX_CLASSIFIER_TURNS; index -= 1) {
    add(turns[index]);
  }
  return [...selected.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Build a bounded local context around mandatory semantic-review targets. Add
 * every target before neighbours/anchors so no requested verdict can disappear
 * when a provider has produced many acoustic clusters.
 */
function selectReviewClassifierEvidence(
  turns: readonly SpeakerTurn[],
  reviewSeqs: readonly number[]
): SpeakerTurn[] {
  const bySeq = new Map(turns.map((turn) => [turn.seq, turn]));
  const targets = [...new Set(reviewSeqs)]
    .filter((seq) => bySeq.has(seq))
    .sort((a, b) => a - b)
    .slice(0, MAX_CLASSIFIER_TURNS);
  const selected = new Map<number, SpeakerTurn>();
  const add = (turn: SpeakerTurn | undefined) => {
    if (turn && selected.size < MAX_CLASSIFIER_TURNS) selected.set(turn.seq, turn);
  };

  for (const seq of targets) add(bySeq.get(seq));
  for (const seq of targets) {
    add(bySeq.get(seq - 1));
    add(bySeq.get(seq + 1));
  }

  const nativeAnchors = [...groupNativeTurns(
    turns.filter((turn) => typeof turn.speakerId === 'number')
  ).values()]
    .map((group) => mostSubstantiveTurn(group))
    .filter((turn): turn is SpeakerTurn => Boolean(turn))
    .sort((a, b) => a.seq - b.seq);
  for (const anchor of nativeAnchors) add(anchor);

  for (let index = turns.length - 1; index >= 0 && selected.size < MAX_CLASSIFIER_TURNS; index -= 1) {
    add(turns[index]);
  }
  return [...selected.values()].sort((a, b) => a.seq - b.seq);
}

export function buildSpeakerClassifierInput(
  turns: readonly SpeakerTurn[],
  request: SpeakerClassificationRequest = {}
): string {
  const reviewSeqs = [...new Set(request.reviewSeqs ?? [])]
    .filter((seq) => turns.some((turn) => turn.seq === seq))
    .sort((a, b) => a - b);
  if (reviewSeqs.length > 0) {
    const evidence = selectReviewClassifierEvidence(turns, reviewSeqs);
    return [
      `[classification-mode=${request.final ? 'final' : 'live'}-turn-audit]`,
      `[review-pass=${request.auditPass ?? 'primary'}]`,
      `[required-turn-verdicts seqs=${reviewSeqs.join(',')}]`,
      '必须为 required-turn-verdicts 中的每个 seq 返回且只返回一条 turnRoles。逐条根据提问、回答、评价、追问等语义行为判断角色，不得用 speakerId 直接复制角色；证据不足必须返回 unknown。',
      '相邻上下文只用于理解 required seq；speakerRoles 可以提供声学先验，但不能替代任何 required seq 的 turnRoles。',
      ...findContinuityGroups(evidence).map(
        (group) => `[continuity-group seqs=${group.map((turn) => turn.seq).join(',')}]`
      ),
      ...evidence.map(formatClassifierTurn)
    ]
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
  }

  const nativeTurns = turns.filter((turn) => typeof turn.speakerId === 'number');
  const textOnlyTurns = turns.filter((turn) => typeof turn.speakerId !== 'number');
  if (nativeTurns.length > 0 && textOnlyTurns.length > 0) {
    // Provider changes are intentionally seamless, so one interview can contain
    // native Doubao clusters followed by text-only Paraformer turns (or
    // vice versa). Preserve recent text-only evidence instead of silently
    // switching the entire classifier into native-only mode.
    const recentTextOnly = textOnlyTurns.slice(-MAX_HYBRID_TEXT_TURNS);
    const nativeEvidence = selectNativeClassifierEvidence(
      nativeTurns,
      Math.max(1, MAX_CLASSIFIER_TURNS - recentTextOnly.length)
    );
    const representatives = [
      ...nativeEvidence.anchors,
      ...nativeEvidence.recent,
      ...recentTextOnly
    ]
      .filter(
        (turn, index, all) => all.findIndex((candidate) => candidate.seq === turn.seq) === index
      )
      .sort((a, b) => a.seq - b.seq)
      .slice(-MAX_CLASSIFIER_TURNS);
    return [
      '[classification-mode=hybrid]',
      '请为每个出现的 speakerId 返回一条 speakerRoles；请对每条 speaker=none 的 seq 返回 turnRoles；有 speakerId 的 turn 只在语义角色与该 cluster 主角色冲突时返回高置信度 turnRoles 例外。明显在回答相邻问题的内容应为 candidate；turnRoles 只纠正该 seq，不能重映射整个 cluster。',
      '连续 ASR 可能把同一个人的一句话切成多个 turn；短片段必须结合相邻句继承语义角色，不要仅因片段不完整返回 unknown。',
      ...representatives.map(formatClassifierTurn)
    ]
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
  }
  if (nativeTurns.length > 0) {
    const { anchors, recent } = selectNativeClassifierEvidence(nativeTurns);
    return [
      '[classification-mode=native-clusters]',
      '请为每个出现的 speakerId 返回一条 speakerRoles；confidence 低于 0.75 时返回 unknown。',
      '[cluster-anchors]',
      ...anchors.map(formatClassifierTurn),
      '[recent-context-for-weak-correction]',
      '逐条检查最近上下文：最近上下文中的每个 seq 都必须返回 turnRoles，语义不充分时返回 unknown，不要盲目复制 speakerId 主角色。明显在回答相邻问题的内容应为 candidate；真正提出新问题的内容应为 interviewer；被 ASR 切开的短片段如果在语法上延续相邻的提问或回答，必须继承同一个语义角色，即使 speakerId 改变。turnRoles 只纠正单条 turn，不能重映射整个 cluster。',
      ...findContinuityGroups(recent).map(
        (group) => `[continuity-group seqs=${group.map((turn) => turn.seq).join(',')}]`
      ),
      ...recent.map(formatClassifierTurn)
    ]
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
  }

  const prioritySeqs = request.prioritySeqs ?? [];
  const recentTurns = selectTextOnlyClassifierEvidence(turns, prioritySeqs);
  return [
    '[classification-mode=turns-without-clusters]',
    '请为每个列出的 seq 返回一条 turnRoles；speakerRoles 必须返回空数组。',
    ...(prioritySeqs.length > 0
      ? [
          `[priority-unresolved seqs=${prioritySeqs.join(',')}]`,
          '这些 seq 在实时判断中仍未定角色；请结合同时列出的相邻片段和最近上下文进行弱纠错，不要因为片段短就直接返回 unknown。'
        ]
      : []),
    ...recentTurns.map(formatClassifierTurn)
  ]
    .join('\n')
    .slice(0, MAX_INPUT_CHARS);
}

export async function classifySpeakerTurns(
  turns: readonly SpeakerTurn[],
  request: SpeakerClassificationRequest = {}
): Promise<SpeakerClassification> {
  const transcript = buildSpeakerClassifierInput(turns, request);
  const text = await chat({
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: 'user', content: transcript }],
    model: SPEAKER_PARTITION_MODEL,
    maxTokens: 500,
    temperature: 0,
    thinking: false,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    maxRetries: 0
  });
  return parseSpeakerClassification(text, turns);
}

function isContentBearing(turn: SpeakerTurn): boolean {
  return turn.text.replace(/\s+/g, '').length >= MIN_CONTENT_CHARS;
}

function enoughEvidence(turns: readonly SpeakerTurn[]): boolean {
  const contentTurns = turns.filter(isContentBearing);
  if (contentTurns.length >= MIN_TOTAL_TURNS) return true;
  const nativeIds = new Set(
    contentTurns.flatMap((turn) =>
      typeof turn.speakerId === 'number' ? [turn.speakerId] : []
    )
  );
  if (nativeIds.size < 2) return false;
  const charsBySpeaker = new Map<number, number>();
  for (const turn of contentTurns) {
    if (typeof turn.speakerId !== 'number') continue;
    charsBySpeaker.set(
      turn.speakerId,
      (charsBySpeaker.get(turn.speakerId) ?? 0) + turn.text.replace(/\s+/g, '').length
    );
  }
  const totalChars = [...charsBySpeaker.values()].reduce((sum, chars) => sum + chars, 0);
  return (
    totalChars >= MIN_NATIVE_TOTAL_CHARS &&
    [...nativeIds].every((speakerId) =>
      (charsBySpeaker.get(speakerId) ?? 0) >= MIN_NATIVE_CHARS_PER_SPEAKER
    )
  );
}

function coalesce(segments: SpeakerPartitionSegment[]): SpeakerPartitionSegment[] {
  const out: SpeakerPartitionSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (
      last &&
      last.speakerId === segment.speakerId &&
      last.role === segment.role &&
      last.roleSource === segment.roleSource
    ) {
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      out.push({ ...segment });
    }
  }
  return out;
}

interface ResolvedSpeakerTurn {
  turn: SpeakerTurn;
  speakerId: number;
  role: SpeakerRole;
  roleSource: SpeakerRoleSource;
}

function hasCandidateEnvelopeSignal(text: string): boolean {
  return (
    CANDIDATE_PLAN.test(text) ||
    (text.replace(/\s+/g, '').length <= 80 && CONTINUATION_PREFIX.test(text))
  );
}

function hasStrongCandidateAnswerSignal(text: string): boolean {
  return CANDIDATE_PLAN.test(text) || CANDIDATE_ANSWER_OPENING.test(text);
}

function areDirectNeighbours(left: ResolvedSpeakerTurn, right: ResolvedSpeakerTurn): boolean {
  return right.turn.seq === left.turn.seq + 1 && right.turn.source === left.turn.source;
}

/**
 * Repair only locally provable ASR drift. This never changes a cluster role:
 * callers apply each suggested role to one seq through manual-role precedence.
 */
function findLocalRoleOverrides(turns: readonly ResolvedSpeakerTurn[]): Map<number, SpeakerRole> {
  const overrides = new Map<number, SpeakerRole>();

  for (const entry of turns) {
    if (
      typeof entry.turn.speakerId === 'number' &&
      entry.role !== 'interviewer' &&
      SCORE_ANNOUNCEMENT.test(entry.turn.text)
    ) {
      overrides.set(entry.turn.seq, 'interviewer');
    }
  }

  const roleFor = (entry: ResolvedSpeakerTurn): SpeakerRole =>
    overrides.get(entry.turn.seq) ?? entry.role;
  for (let index = 1; index < turns.length; index += 1) {
    const previous = turns[index - 1];
    const current = turns[index];
    const text = current.turn.text.trim();
    if (
      typeof current.turn.speakerId === 'number' &&
      areDirectNeighbours(previous, current) &&
      roleFor(previous) === 'interviewer' &&
      roleFor(current) === 'candidate' &&
      text.replace(/\s+/g, '').length <= 60 &&
      !hasStrongCandidateAnswerSignal(text) &&
      INTERVIEWER_QUESTION_FRAGMENT.test(text)
    ) {
      overrides.set(current.turn.seq, 'interviewer');
    }
  }

  for (let index = 1; index < turns.length - 1; index += 1) {
    const previous = turns[index - 1];
    const current = turns[index];
    const next = turns[index + 1];
    const text = current.turn.text.trim();
    if (
      typeof current.turn.speakerId === 'number' &&
      areDirectNeighbours(previous, current) &&
      areDirectNeighbours(current, next) &&
      roleFor(previous) === 'candidate' &&
      roleFor(current) === 'interviewer' &&
      roleFor(next) === 'candidate' &&
      hasCandidateEnvelopeSignal(text) &&
      !INTERVIEWER_HANDOFF.test(text)
    ) {
      overrides.set(current.turn.seq, 'candidate');
    }
  }

  for (let index = 1; index < turns.length - 1; index += 1) {
    const previous = turns[index - 1];
    const current = turns[index];
    const next = turns[index + 1];
    const text = current.turn.text.trim();
    if (
      typeof current.turn.speakerId === 'number' &&
      areDirectNeighbours(previous, current) &&
      areDirectNeighbours(current, next) &&
      roleFor(previous) === 'interviewer' &&
      roleFor(current) === 'candidate' &&
      roleFor(next) === 'interviewer' &&
      text.replace(/\s+/g, '').length <= 120 &&
      !hasStrongCandidateAnswerSignal(text) &&
      INTERVIEWER_PROMPT_TAIL.test(next.turn.text.trim())
    ) {
      overrides.set(current.turn.seq, 'interviewer');
    }
  }

  return overrides;
}

function shouldDeferPossibleAnswerContinuation(
  turns: readonly ResolvedSpeakerTurn[],
  index: number,
  status: 'live' | 'final'
): boolean {
  if (status !== 'live' || index !== turns.length - 1) return false;
  const current = turns[index];
  const previous = turns[index - 1];
  if (!previous || !areDirectNeighbours(previous, current)) return false;
  const text = current.turn.text.trim();
  return (
    previous.role === 'candidate' &&
    current.role === 'interviewer' &&
    hasCandidateEnvelopeSignal(text) &&
    !INTERVIEWER_HANDOFF.test(text)
  );
}

function shouldDeferPossibleQuestionStem(
  turns: readonly ResolvedSpeakerTurn[],
  index: number,
  status: 'live' | 'final'
): boolean {
  if (status !== 'live' || index !== turns.length - 1) return false;
  const current = turns[index];
  const previous = turns[index - 1];
  if (!previous || !areDirectNeighbours(previous, current)) return false;
  const text = current.turn.text.trim();
  return (
    previous.role === 'interviewer' &&
    current.role === 'candidate' &&
    text.replace(/\s+/g, '').length <= 120 &&
    !hasStrongCandidateAnswerSignal(text)
  );
}

export function createSpeakerPartitioner(deps: SpeakerPartitionerDeps): SpeakerPartitioner {
  const classify = deps.classify ?? classifySpeakerTurns;
  // Supplying a test/custom turn classifier must not unexpectedly open a real
  // second model path. Production omits `classify` and receives the real cohort
  // harness; dependency-injected callers opt in with their own cohort harness.
  const cohortHarness: SpeakerCohortHarness = deps.cohortHarness ?? (deps.classify
    ? {
        async evaluate() {},
        getRole: () => ({
          state: 'observing',
          role: 'unknown',
          confidence: 0,
          evidenceSeqs: [],
          contradictionSeqs: [],
          evaluatedRevision: -1
        }),
        reset() {}
      }
    : createSpeakerCohortHarness());
  let enabled = false;
  let turns: SpeakerTurn[] = [];
  let fedCandidateSeqs = new Set<number>();
  let fedInterviewerSeqs = new Set<number>();
  let semanticLedger = new Map<number, InferredTurnRole>();
  let scheduledAt = 0;
  let epoch = 0;
  let queue: Promise<void> = Promise.resolve();

  interface ClassificationRun {
    request: SpeakerClassificationRequest;
    result: SpeakerClassification | null;
  }

  function liveReviewSeqs(snapshot: readonly SpeakerTurn[]): number[] {
    return snapshot.slice(-REVIEW_BATCH_SIZE).map((turn) => turn.seq);
  }

  function finalReviewBatches(snapshot: readonly SpeakerTurn[]): number[][] {
    const seqs = snapshot.map((turn) => turn.seq);
    const batches: number[][] = [];
    for (let index = 0; index < seqs.length; index += REVIEW_BATCH_SIZE) {
      batches.push(seqs.slice(index, index + REVIEW_BATCH_SIZE));
    }
    return batches;
  }

  function reviewRequests(
    snapshot: readonly SpeakerTurn[],
    status: 'live' | 'final'
  ): SpeakerClassificationRequest[] {
    const batches = status === 'final'
      ? finalReviewBatches(snapshot)
      : [liveReviewSeqs(snapshot)];
    return batches.flatMap((reviewSeqs) => [
      { final: status === 'final', reviewSeqs, auditPass: 'primary' as const },
      { final: status === 'final', reviewSeqs, auditPass: 'verification' as const }
    ]);
  }

  async function runClassifications(
    snapshot: readonly SpeakerTurn[],
    requests: readonly SpeakerClassificationRequest[]
  ): Promise<ClassificationRun[]> {
    const runs: ClassificationRun[] = [];
    for (let index = 0; index < requests.length; index += REVIEW_CONCURRENCY) {
      const wave = requests.slice(index, index + REVIEW_CONCURRENCY);
      const settled = await Promise.all(
        wave.map(async (request): Promise<ClassificationRun> => {
          try {
            return { request, result: await classify(snapshot, request) };
          } catch {
            return { request, result: null };
          }
        })
      );
      runs.push(...settled);
    }
    return runs;
  }

  function consensusForSeq(
    seq: number,
    runs: readonly ClassificationRun[],
    minimumConfidence: number
  ): InferredTurnRole | null {
    const relevant = runs.filter((run) => run.request.reviewSeqs?.includes(seq));
    const byPass = new Map<'primary' | 'verification', InferredTurnRole>();
    for (const run of relevant) {
      const pass = run.request.auditPass;
      if (!pass || !run.result) continue;
      const assignment = run.result.turnRoles
        .filter((candidate) => candidate.seq === seq)
        .sort((left, right) => right.confidence - left.confidence)[0];
      if (assignment) byPass.set(pass, assignment);
    }
    const primary = byPass.get('primary');
    const verification = byPass.get('verification');
    if (
      !primary ||
      !verification ||
      primary.role === 'unknown' ||
      verification.role === 'unknown' ||
      primary.role !== verification.role ||
      primary.confidence < minimumConfidence ||
      verification.confidence < minimumConfidence
    ) {
      return null;
    }
    return {
      seq,
      role: primary.role,
      confidence: Math.min(primary.confidence, verification.confidence)
    };
  }

  function schedule(status: 'live' | 'final'): Promise<void> {
    const scheduledEpoch = epoch;
    const snapshot = turns.map((turn) => ({ ...turn }));
    queue = queue.then(async () => {
      if (scheduledEpoch !== epoch || !enabled || snapshot.length === 0) return;
      const requests = reviewRequests(snapshot, status);
      const runs = await runClassifications(snapshot, requests);
      if (scheduledEpoch !== epoch) return;

      const reviewedSeqs = [...new Set(requests.flatMap((request) => request.reviewSeqs ?? []))];
      const minimumConfidence = status === 'final'
        ? MIN_FINAL_TURN_ROLE_CONFIDENCE
        : MIN_LIVE_TURN_ROLE_CONFIDENCE;
      const roleByTurn = status === 'final'
        ? new Map<number, InferredTurnRole>()
        : new Map(semanticLedger);
      // Every requested turn replaces its old observation. Missing, conflicting,
      // low-confidence, or explicit-unknown responses revoke stale live state.
      for (const seq of reviewedSeqs) {
        const consensus = consensusForSeq(seq, runs, minimumConfidence);
        if (consensus) roleByTurn.set(seq, consensus);
        else roleByTurn.delete(seq);
      }
      semanticLedger = new Map(roleByTurn);

      const confirmedSeqs = new Set(roleByTurn.keys());
      const manualSpeakerIds = new Set<number>();
      const confirmedForCohort: ConfirmedTurnRole[] = [];
      for (const turn of snapshot) {
        const semantic = roleByTurn.get(turn.seq);
        if (typeof turn.speakerId === 'number') {
          const manualRole = deps.resolveTurnRole?.(turn.speakerId, 'unknown') ?? 'unknown';
          if (manualRole !== 'unknown') {
            manualSpeakerIds.add(turn.speakerId);
            confirmedForCohort.push({ seq: turn.seq, role: manualRole, confidence: 1 });
            continue;
          }
        }
        if (semantic && semantic.role !== 'unknown') {
          confirmedForCohort.push({ ...semantic });
        }
      }
      const authorityPreliminary = snapshot.map((turn): ResolvedSpeakerTurn => {
        const semanticRole = roleByTurn.get(turn.seq)?.role ?? 'unknown';
        let role = semanticRole;
        let roleSource: SpeakerRoleSource = semanticRole === 'unknown' ? 'unknown' : 'semantic-turn';
        if (typeof turn.speakerId === 'number') {
          const manualRole = deps.resolveTurnRole?.(turn.speakerId, 'unknown') ?? 'unknown';
          if (manualRole !== 'unknown') {
            role = manualRole;
            roleSource = 'manual';
            confirmedSeqs.add(turn.seq);
          } else {
            role = semanticRole;
          }
        }
        const speakerId =
          typeof turn.speakerId === 'number'
            ? turn.speakerId
            : role === 'interviewer'
              ? 0
              : role === 'candidate'
                ? 1
                : 100_000 + turn.seq;
        return { turn, speakerId, role, roleSource };
      });
      // Local repairs must inspect authority-only roles. A display cohort prior
      // must never manufacture the evidence that then grants itself Auto access.
      const localOverrides = findLocalRoleOverrides(authorityPreliminary);
      const authorityResolved = authorityPreliminary.map((entry): ResolvedSpeakerTurn => {
        const suggested = localOverrides.get(entry.turn.seq);
        if (!suggested) return entry;
        confirmedSeqs.add(entry.turn.seq);
        if (entry.roleSource === 'manual') return entry;
        const role = typeof entry.turn.speakerId === 'number'
          ? deps.resolveTurnRole?.(entry.turn.speakerId, suggested) ?? suggested
          : suggested;
        const roleSource: SpeakerRoleSource = role === suggested ? 'local' : 'manual';
        return { ...entry, role, roleSource };
      });
      for (const [index, entry] of authorityResolved.entries()) {
        const { turn, role } = entry;
        if (
          confirmedSeqs.has(turn.seq) &&
          role === 'candidate' &&
          !fedCandidateSeqs.has(turn.seq) &&
          !shouldDeferPossibleQuestionStem(authorityResolved, index, status)
        ) {
          fedCandidateSeqs.add(turn.seq);
          deps.onCandidateTurn(turn);
        }
        if (
          confirmedSeqs.has(turn.seq) &&
          role === 'interviewer' &&
          !fedInterviewerSeqs.has(turn.seq) &&
          !shouldDeferPossibleAnswerContinuation(authorityResolved, index, status)
        ) {
          fedInterviewerSeqs.add(turn.seq);
          deps.onInterviewerTurn?.(turn);
        }
      }
      // Cohort assimilation is display refinement. Release role-confirmed Auto
      // evidence first so an 8s cohort timeout can never delay Expert cadence.
      await cohortHarness.evaluate({
        turns: snapshot,
        confirmed: confirmedForCohort,
        manualSpeakerIds,
        final: status === 'final'
      });
      if (scheduledEpoch !== epoch) return;
      const displayResolved = authorityResolved.map((entry): ResolvedSpeakerTurn => {
        if (entry.role !== 'unknown' || typeof entry.turn.speakerId !== 'number') return entry;
        const cohort = cohortHarness.getRole(entry.turn.speakerId);
        return cohort.state === 'delegated' && cohort.role !== 'unknown'
          ? { ...entry, role: cohort.role, roleSource: 'cohort' }
          : entry;
      });
      const segments = coalesce(
        displayResolved.map(({ turn, speakerId, role, roleSource }) => ({
          seq: turn.seq,
          speakerId,
          role,
          roleSource,
          text: turn.text
        }))
      );
      const model = runs.find((run) => run.result?.model)?.result?.model ?? SPEAKER_PARTITION_MODEL;
      deps.onPartition({ status, model, segments });
    });
    return queue;
  }

  return {
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
    },
    isEnabled: () => enabled,
    record(turn) {
      if (!enabled) return;
      const text = String(turn.text || '').trim();
      if (!text) return;
      turns.push({ ...turn, text });
      const latestChars = text.replace(/\s+/g, '').length;
      const correctionRefreshDue =
        scheduledAt > 0 &&
        turns.length > scheduledAt &&
        latestChars >= MIN_SEMANTIC_REFRESH_CHARS;
      if (
        enoughEvidence(turns) &&
        (scheduledAt === 0 ||
          turns.length - scheduledAt >= REFRESH_TURNS ||
          correctionRefreshDue)
      ) {
        scheduledAt = turns.length;
        void schedule('live');
      }
    },
    finalize() {
      if (!enabled || turns.filter(isContentBearing).length < 2) return queue;
      scheduledAt = turns.length;
      return schedule('final');
    },
    flush() {
      return queue;
    },
    reset() {
      epoch += 1;
      cohortHarness.reset();
      turns = [];
      fedCandidateSeqs = new Set<number>();
      fedInterviewerSeqs = new Set<number>();
      semanticLedger = new Map<number, InferredTurnRole>();
      scheduledAt = 0;
      queue = Promise.resolve();
    }
  };
}

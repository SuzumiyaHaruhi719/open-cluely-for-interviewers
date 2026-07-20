import type { AudioSource, SpeakerRole } from '@open-cluely/contract';
import { chat } from './dashscope';

export const SPEAKER_PARTITION_MODEL = 'deepseek-v4-flash';
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
const MIN_SPEAKER_ROLE_CONFIDENCE = 0.75;
const MIN_TURN_OVERRIDE_CONFIDENCE = 0.85;
const MIN_SEMANTIC_REFRESH_CHARS = 48;

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

export interface SpeakerPartitionSegment {
  seq: number;
  speakerId: number;
  role: SpeakerRole;
  text: string;
}

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
  classify?: (turns: readonly SpeakerTurn[]) => Promise<SpeakerClassification>;
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
  'A native speakerId role is only a baseline: inspect every recent-context turn and return a high-confidence turnRoles exception when its speech act clearly conflicts with that baseline.',
  'A substantive answer to an adjacent question is candidate even if its acoustic id is mapped interviewer; a genuine new question is interviewer even if its id is mapped candidate.',
  'A short fragment that grammatically continues an adjacent question or answer inherits that same speech act even when its acoustic id changes.',
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
  const turnRoles = (Array.isArray(obj.turnRoles) ? obj.turnRoles : [])
    .flatMap((entry): InferredTurnRole[] => {
      if (!entry || typeof entry !== 'object') return [];
      const rec = entry as Record<string, unknown>;
      const seq = Number(rec.seq);
      if (!Number.isInteger(seq) || !validSeqs.has(seq)) return [];
      return [{ seq, role: asRole(rec.role), confidence: clampConfidence(rec.confidence) }];
    });
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
export function buildSpeakerClassifierInput(turns: readonly SpeakerTurn[]): string {
  const nativeTurns = turns.filter((turn) => typeof turn.speakerId === 'number');
  const textOnlyTurns = turns.filter((turn) => typeof turn.speakerId !== 'number');
  if (nativeTurns.length > 0 && textOnlyTurns.length > 0) {
    // Provider changes are intentionally seamless, so one interview can contain
    // native iFlytek clusters followed by text-only Paraformer/Doubao turns (or
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
      '逐条检查最近上下文：明显在回答相邻问题的内容应为 candidate；真正提出新问题的内容应为 interviewer；被 ASR 切开的短片段如果在语法上延续相邻的提问或回答，必须继承同一个语义角色，即使 speakerId 改变。语义角色与 speakerId 的主角色冲突时，为该 seq 返回高置信度 turnRoles。turnRoles 只纠正单条 turn，不能重映射整个 cluster。',
      ...recent.map(formatClassifierTurn)
    ]
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
  }

  const recentTurns = turns.slice(-MAX_CLASSIFIER_TURNS);
  return [
    '[classification-mode=turns-without-clusters]',
    '请为每个列出的 seq 返回一条 turnRoles；speakerRoles 必须返回空数组。',
    ...recentTurns.map(formatClassifierTurn)
  ]
    .join('\n')
    .slice(0, MAX_INPUT_CHARS);
}

export async function classifySpeakerTurns(
  turns: readonly SpeakerTurn[]
): Promise<SpeakerClassification> {
  const transcript = buildSpeakerClassifierInput(turns);
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
    if (last && last.speakerId === segment.speakerId && last.role === segment.role) {
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      out.push({ ...segment });
    }
  }
  return out;
}

export function createSpeakerPartitioner(deps: SpeakerPartitionerDeps): SpeakerPartitioner {
  const classify = deps.classify ?? classifySpeakerTurns;
  let enabled = false;
  let turns: SpeakerTurn[] = [];
  let fedCandidateSeqs = new Set<number>();
  let fedInterviewerSeqs = new Set<number>();
  let cachedSpeakerRoles = new Map<number, SpeakerRole>();
  let cachedTurnRoles = new Map<number, SpeakerRole>();
  let scheduledAt = 0;
  let epoch = 0;
  let queue: Promise<void> = Promise.resolve();

  function schedule(status: 'live' | 'final'): Promise<void> {
    const scheduledEpoch = epoch;
    const snapshot = turns.map((turn) => ({ ...turn }));
    queue = queue.then(async () => {
      if (scheduledEpoch !== epoch || !enabled || snapshot.length === 0) return;
      let result: SpeakerClassification;
      try {
        result = await classify(snapshot);
      } catch {
        result = { speakerRoles: [], turnRoles: [], model: SPEAKER_PARTITION_MODEL };
      }
      if (scheduledEpoch !== epoch) return;

      // A timeout or truncated JSON near the end of a long interview must not
      // erase a role map that was already established live. Re-apply cached
      // roles through the external map so a sticky manual correction still wins.
      const roleBySpeaker = new Map<number, SpeakerRole>();
      for (const [speakerId, role] of cachedSpeakerRoles) {
        roleBySpeaker.set(speakerId, deps.applySpeakerRole(speakerId, role));
      }
      for (const assignment of result.speakerRoles) {
        if (
          assignment.role === 'unknown' ||
          assignment.confidence < MIN_SPEAKER_ROLE_CONFIDENCE
        ) {
          continue;
        }
        roleBySpeaker.set(
          assignment.speakerId,
          deps.applySpeakerRole(assignment.speakerId, assignment.role)
        );
      }
      cachedSpeakerRoles = new Map(roleBySpeaker);
      const roleByTurn = new Map(cachedTurnRoles);
      for (const assignment of result.turnRoles) {
        if (
          assignment.role !== 'unknown' &&
          assignment.confidence >= MIN_TURN_OVERRIDE_CONFIDENCE
        ) {
          roleByTurn.set(assignment.seq, assignment.role);
        }
      }
      cachedTurnRoles = new Map(roleByTurn);
      const segments = coalesce(
        snapshot.map((turn): SpeakerPartitionSegment => {
          const hasClusterRole =
            typeof turn.speakerId === 'number' && roleBySpeaker.has(turn.speakerId);
          const turnRole = roleByTurn.get(turn.seq);
          let role = hasClusterRole
            ? roleBySpeaker.get(turn.speakerId as number) ?? 'unknown'
            : turnRole ?? 'unknown';
          if (typeof turn.speakerId === 'number' && turnRole && turnRole !== 'unknown') {
            role = deps.resolveTurnRole?.(turn.speakerId, turnRole) ?? turnRole;
          }
          if (typeof turn.speakerId === 'number' && !hasClusterRole && role !== 'unknown') {
            role = deps.applySpeakerRole(turn.speakerId, role);
          }
          if (role === 'candidate' && !fedCandidateSeqs.has(turn.seq)) {
            fedCandidateSeqs.add(turn.seq);
            deps.onCandidateTurn(turn);
          }
          if (role === 'interviewer' && !fedInterviewerSeqs.has(turn.seq)) {
            fedInterviewerSeqs.add(turn.seq);
            deps.onInterviewerTurn?.(turn);
          }
          const speakerId =
            typeof turn.speakerId === 'number'
              ? turn.speakerId
              : role === 'interviewer'
                ? 0
                : role === 'candidate'
                  ? 1
                  : 100_000 + turn.seq;
          return { seq: turn.seq, speakerId, role, text: turn.text };
        })
      );
      deps.onPartition({ status, model: result.model || SPEAKER_PARTITION_MODEL, segments });
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
      turns = [];
      fedCandidateSeqs = new Set<number>();
      fedInterviewerSeqs = new Set<number>();
      cachedSpeakerRoles = new Map<number, SpeakerRole>();
      cachedTurnRoles = new Map<number, SpeakerRole>();
      scheduledAt = 0;
      queue = Promise.resolve();
    }
  };
}

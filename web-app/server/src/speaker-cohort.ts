import type { AudioSource, SpeakerRole } from '@open-cluely/contract';

export const MIN_COHORT_UTTERANCES = 2;
export const MIN_COHORT_TOTAL_CHARS = 48;
export const MIN_COHORT_UTTERANCE_CHARS = 12;
export const MIN_ROLE_ANCHORS = 2;
export const MIN_COHORT_CONFIDENCE = 0.88;
export const MIN_COHORT_FIT_MARGIN = 0.18;

const MAX_ROLE_ANCHORS = 4;
const MAX_TARGET_TURNS = 8;
const TURN_TERMINAL_PUNCTUATION = /[。！？!?][”’"'）)\]]*$/;
const CONTINUATION_PREFIX = /^(?:[，,、。；;：:\s]*)?(?:但是|但|并且|而且|所以|同时|以及|然后|接着|另外|另一方面|其次|最后|那么|其中|例如|比如|由于|因为|为了|并|也|再|还|或|与|及)/;

export type CohortRole = Exclude<SpeakerRole, 'unknown'>;

export interface CohortTurn {
  seq: number;
  source: AudioSource;
  speakerId?: number;
  text: string;
}

export interface ConfirmedTurnRole {
  seq: number;
  role: SpeakerRole;
  confidence: number;
}

export interface CohortEvidencePacket {
  targetSpeakerId: number;
  revision: number;
  targets: CohortTurn[];
  neighbours: CohortTurn[];
  interviewerAnchors: CohortTurn[];
  candidateAnchors: CohortTurn[];
  requiredSeqs: number[];
  confirmedTargetRoles: ConfirmedTurnRole[];
}

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

export interface CohortDecision {
  speakerId: number;
  role: CohortRole;
  confidence: number;
  evidenceSeqs: number[];
  contradictionSeqs: number[];
}

function contentChars(text: string): number {
  return String(text || '').replace(/\s+/g, '').length;
}

function isSubstantive(turn: CohortTurn): boolean {
  return contentChars(turn.text) >= MIN_COHORT_UTTERANCE_CHARS;
}

function isContinuation(previous: CohortTurn, current: CohortTurn): boolean {
  return (
    current.seq === previous.seq + 1 &&
    current.source === previous.source &&
    !TURN_TERMINAL_PUNCTUATION.test(previous.text.trim()) &&
    CONTINUATION_PREFIX.test(current.text.trim())
  );
}

function groupTargetWindows(targets: readonly CohortTurn[]): CohortTurn[][] {
  const windows: CohortTurn[][] = [];
  for (const target of targets) {
    const current = windows[windows.length - 1];
    const previous = current?.[current.length - 1];
    if (previous && isContinuation(previous, target)) {
      current.push(target);
    } else {
      windows.push([target]);
    }
  }
  return windows;
}

function chooseRoleAnchors(
  turns: readonly CohortTurn[],
  confirmed: readonly ConfirmedTurnRole[],
  targetSpeakerId: number,
  role: CohortRole
): CohortTurn[] {
  const bySeq = new Map(turns.map((entry) => [entry.seq, entry]));
  const bestBySeq = new Map<number, ConfirmedTurnRole>();
  for (const entry of confirmed) {
    if (entry.role !== role) continue;
    const previous = bestBySeq.get(entry.seq);
    if (!previous || entry.confidence > previous.confidence) bestBySeq.set(entry.seq, entry);
  }
  return [...bestBySeq.values()]
    .flatMap((entry) => {
      const candidate = bySeq.get(entry.seq);
      return candidate && candidate.speakerId !== targetSpeakerId && isSubstantive(candidate)
        ? [{ candidate, confidence: entry.confidence }]
        : [];
    })
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      const charDelta = contentChars(right.candidate.text) - contentChars(left.candidate.text);
      return charDelta || right.candidate.seq - left.candidate.seq;
    })
    .slice(0, MAX_ROLE_ANCHORS)
    .map(({ candidate }) => candidate)
    .sort((left, right) => left.seq - right.seq);
}

export function buildCohortEvidence(
  turns: readonly CohortTurn[],
  confirmed: readonly ConfirmedTurnRole[],
  targetSpeakerId: number
): CohortEvidencePacket | null {
  const ordered = [...turns].sort((left, right) => left.seq - right.seq);
  const targets = ordered
    .filter((entry) => entry.speakerId === targetSpeakerId && isSubstantive(entry))
    .slice(-MAX_TARGET_TURNS);
  const windows = groupTargetWindows(targets);
  if (windows.length < MIN_COHORT_UTTERANCES) return null;
  if (windows.some((window) => window.reduce((sum, entry) => sum + contentChars(entry.text), 0) < MIN_COHORT_UTTERANCE_CHARS)) {
    return null;
  }
  if (targets.reduce((sum, entry) => sum + contentChars(entry.text), 0) < MIN_COHORT_TOTAL_CHARS) {
    return null;
  }

  const interviewerAnchors = chooseRoleAnchors(turns, confirmed, targetSpeakerId, 'interviewer');
  const candidateAnchors = chooseRoleAnchors(turns, confirmed, targetSpeakerId, 'candidate');
  if (
    interviewerAnchors.length < MIN_ROLE_ANCHORS ||
    candidateAnchors.length < MIN_ROLE_ANCHORS
  ) {
    return null;
  }

  const targetSeqs = new Set(targets.map((entry) => entry.seq));
  const neighbours = ordered.filter(
    (entry) =>
      !targetSeqs.has(entry.seq) &&
      targets.some((target) => Math.abs(target.seq - entry.seq) === 1)
  );
  const confirmedTargetRoles = confirmed
    .filter((entry) => targetSeqs.has(entry.seq))
    .sort((left, right) => left.seq - right.seq);

  return {
    targetSpeakerId,
    revision: Math.max(...targets.map((entry) => entry.seq)),
    targets,
    neighbours,
    interviewerAnchors: interviewerAnchors.slice(0, MIN_ROLE_ANCHORS),
    candidateAnchors: candidateAnchors.slice(0, MIN_ROLE_ANCHORS),
    requiredSeqs: targets.map((entry) => entry.seq),
    confirmedTargetRoles
  };
}

function parseObject(text: string): Record<string, unknown> | null {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asRole(value: unknown): SpeakerRole {
  return value === 'interviewer' || value === 'candidate' ? value : 'unknown';
}

function confidence(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function parseSeqList(value: unknown, validSeqs: ReadonlySet<number>): number[] | null {
  if (!Array.isArray(value)) return null;
  const seqs: number[] = [];
  for (const raw of value) {
    const seq = Number(raw);
    if (!Number.isInteger(seq) || !validSeqs.has(seq)) return null;
    if (!seqs.includes(seq)) seqs.push(seq);
  }
  return seqs.sort((left, right) => left - right);
}

export function parseCohortAudit(
  text: string,
  packet: CohortEvidencePacket,
  model = 'deepseek-v4-flash'
): CohortAudit | null {
  const object = parseObject(text);
  if (!object) return null;
  const validSeqs = new Set([
    ...packet.targets,
    ...packet.neighbours,
    ...packet.interviewerAnchors,
    ...packet.candidateAnchors
  ].map((entry) => entry.seq));
  const evidenceSeqs = parseSeqList(object.evidenceSeqs, validSeqs);
  const contradictionSeqs = parseSeqList(object.contradictionSeqs, validSeqs);
  if (!evidenceSeqs || !contradictionSeqs || !Array.isArray(object.targetRoles)) return null;

  const targetSeqs = new Set(packet.requiredSeqs);
  const targetRoles = object.targetRoles.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const seq = Number(record.seq);
    if (!Number.isInteger(seq) || !targetSeqs.has(seq)) return [];
    return [{ seq, role: asRole(record.role), confidence: confidence(record.confidence) }];
  });

  return {
    role: asRole(object.role),
    confidence: confidence(object.confidence),
    interviewerFit: confidence(object.interviewerFit),
    candidateFit: confidence(object.candidateFit),
    targetRoles,
    evidenceSeqs,
    contradictionSeqs,
    model
  };
}

function hasCompleteTargetCoverage(packet: CohortEvidencePacket, audit: CohortAudit): boolean {
  const covered = new Set(audit.targetRoles.map((entry) => entry.seq));
  return packet.requiredSeqs.every((seq) => covered.has(seq));
}

function fitMargin(audit: CohortAudit): number {
  return audit.role === 'interviewer'
    ? audit.interviewerFit - audit.candidateFit
    : audit.role === 'candidate'
      ? audit.candidateFit - audit.interviewerFit
      : 0;
}

function supportingTargets(packet: CohortEvidencePacket, audit: CohortAudit): Set<number> {
  const targetSeqs = new Set(packet.requiredSeqs);
  return new Set(
    audit.targetRoles
      .filter(
        (entry) =>
          targetSeqs.has(entry.seq) &&
          entry.role === audit.role &&
          entry.confidence >= 0.75
      )
      .map((entry) => entry.seq)
  );
}

function hasOppositeConfirmedMajority(packet: CohortEvidencePacket, role: CohortRole): boolean {
  const opposite: CohortRole = role === 'candidate' ? 'interviewer' : 'candidate';
  const same = packet.confirmedTargetRoles.filter((entry) => entry.role === role).length;
  const conflicting = packet.confirmedTargetRoles.filter((entry) => entry.role === opposite).length;
  return conflicting > same;
}

export function consensusCohortAudits(
  packet: CohortEvidencePacket,
  primary: CohortAudit | null,
  verification: CohortAudit | null
): CohortDecision | null {
  if (!primary || !verification) return null;
  if (
    primary.role === 'unknown' ||
    verification.role === 'unknown' ||
    primary.role !== verification.role
  ) {
    return null;
  }
  const role = primary.role as CohortRole;
  if (
    primary.confidence < MIN_COHORT_CONFIDENCE ||
    verification.confidence < MIN_COHORT_CONFIDENCE ||
    fitMargin(primary) < MIN_COHORT_FIT_MARGIN ||
    fitMargin(verification) < MIN_COHORT_FIT_MARGIN ||
    !hasCompleteTargetCoverage(packet, primary) ||
    !hasCompleteTargetCoverage(packet, verification) ||
    primary.contradictionSeqs.length > 0 ||
    verification.contradictionSeqs.length > 0 ||
    hasOppositeConfirmedMajority(packet, role)
  ) {
    return null;
  }

  const primarySupport = supportingTargets(packet, primary);
  const verificationSupport = supportingTargets(packet, verification);
  const sharedSupport = [...primarySupport]
    .filter((seq) => verificationSupport.has(seq))
    .sort((left, right) => left - right);
  const sharedEvidence = primary.evidenceSeqs
    .filter((seq) => verification.evidenceSeqs.includes(seq) && packet.requiredSeqs.includes(seq))
    .sort((left, right) => left - right);
  if (sharedSupport.length < MIN_COHORT_UTTERANCES || sharedEvidence.length < MIN_COHORT_UTTERANCES) {
    return null;
  }

  return {
    speakerId: packet.targetSpeakerId,
    role,
    confidence: Math.min(primary.confidence, verification.confidence),
    evidenceSeqs: sharedEvidence,
    contradictionSeqs: []
  };
}

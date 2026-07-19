import type { AudioSource, SpeakerRole } from '@open-cluely/contract';
import { chat } from './dashscope';

export const SPEAKER_PARTITION_MODEL = 'deepseek-v4-flash';
const CLASSIFY_TIMEOUT_MS = 8_000;
const MAX_INPUT_CHARS = 6_000;
const MIN_CONTENT_CHARS = 4;
const MIN_TURNS_PER_NATIVE_SPEAKER = 2;
const MIN_TOTAL_TURNS = 6;
const REFRESH_TURNS = 3;

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
  setSingleMic(enabled: boolean): void;
  record(turn: SpeakerTurn): void;
  finalize(): Promise<void>;
  flush(): Promise<void>;
  reset(): void;
}

export interface SpeakerPartitionerDeps {
  classify?: (turns: readonly SpeakerTurn[]) => Promise<SpeakerClassification>;
  /** Applies an automatic cluster role and returns the effective role (manual corrections may win). */
  applySpeakerRole: (speakerId: number, role: SpeakerRole) => SpeakerRole;
  onCandidateTurn: (turn: SpeakerTurn) => void;
  onPartition: (partition: SpeakerPartition) => void;
}

const CLASSIFIER_SYSTEM = [
  'You assign speakers in a job interview after enough transcript evidence has accumulated.',
  'Use speech acts and cross-turn context, never numeric speaker order.',
  'An interviewer asks, frames, redirects, or evaluates; a candidate answers with experience, evidence, decisions, and results.',
  'Acoustic diarization may over-cluster one person into multiple speakerIds, so multiple ids may share a role.',
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

export async function classifySpeakerTurns(
  turns: readonly SpeakerTurn[]
): Promise<SpeakerClassification> {
  const transcript = turns
    .map((turn) =>
      `[seq=${turn.seq} source=${turn.source} speaker=${
        typeof turn.speakerId === 'number' ? turn.speakerId : 'none'
      }] ${turn.text}`
    )
    .join('\n')
    .slice(-MAX_INPUT_CHARS);
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
  return [...nativeIds].every(
    (speakerId) =>
      contentTurns.filter((turn) => turn.speakerId === speakerId).length >=
      MIN_TURNS_PER_NATIVE_SPEAKER
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
  let singleMic = false;
  let turns: SpeakerTurn[] = [];
  let fedCandidateSeqs = new Set<number>();
  let scheduledAt = 0;
  let epoch = 0;
  let queue: Promise<void> = Promise.resolve();

  function schedule(status: 'live' | 'final'): Promise<void> {
    const scheduledEpoch = epoch;
    const snapshot = turns.map((turn) => ({ ...turn }));
    queue = queue.then(async () => {
      if (scheduledEpoch !== epoch || !singleMic || snapshot.length === 0) return;
      let result: SpeakerClassification;
      try {
        result = await classify(snapshot);
      } catch {
        result = { speakerRoles: [], turnRoles: [], model: SPEAKER_PARTITION_MODEL };
      }
      if (scheduledEpoch !== epoch) return;

      const roleBySpeaker = new Map<number, SpeakerRole>();
      for (const assignment of result.speakerRoles) {
        if (assignment.role === 'unknown') continue;
        roleBySpeaker.set(
          assignment.speakerId,
          deps.applySpeakerRole(assignment.speakerId, assignment.role)
        );
      }
      const roleByTurn = new Map(result.turnRoles.map((assignment) => [assignment.seq, assignment.role]));
      const segments = coalesce(
        snapshot.map((turn): SpeakerPartitionSegment => {
          const hasClusterRole =
            typeof turn.speakerId === 'number' && roleBySpeaker.has(turn.speakerId);
          let role = hasClusterRole
            ? roleBySpeaker.get(turn.speakerId as number) ?? 'unknown'
            : roleByTurn.get(turn.seq) ?? 'unknown';
          if (typeof turn.speakerId === 'number' && !hasClusterRole && role !== 'unknown') {
            role = deps.applySpeakerRole(turn.speakerId, role);
          }
          if (role === 'candidate' && !fedCandidateSeqs.has(turn.seq)) {
            fedCandidateSeqs.add(turn.seq);
            deps.onCandidateTurn(turn);
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
    setSingleMic(enabled) {
      singleMic = enabled;
    },
    record(turn) {
      if (!singleMic) return;
      const text = String(turn.text || '').trim();
      if (!text) return;
      turns.push({ ...turn, text });
      if (
        enoughEvidence(turns) &&
        (scheduledAt === 0 || turns.length - scheduledAt >= REFRESH_TURNS)
      ) {
        scheduledAt = turns.length;
        void schedule('live');
      }
    },
    finalize() {
      if (!singleMic || turns.filter(isContentBearing).length < 2) return queue;
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
      scheduledAt = 0;
      queue = Promise.resolve();
    }
  };
}

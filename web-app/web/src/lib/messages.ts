import type {
  AsrProvider,
  AsrRuntimeState,
  CompetencyStatus,
  FollowUpOutput,
  GenerationTrigger,
  RankedQuestion,
  ServerMessage,
  SessionCompetency,
  SessionContextState,
  SummaryDebugEvent,
  SpeakerAssignment,
  SpeakerAssignmentRoleSource,
  SpeakerAssignmentState,
  SpeakerRole,
  SpeakerRoleSource
} from '@open-cluely/contract';

/**
 * Runtime narrowing for inbound WebSocket payloads. The wire is untrusted, so
 * we parse as `unknown` and validate the discriminant + required fields before
 * handing a typed `ServerMessage` to the hook.
 */

const S2C = {
  READY: 'ready',
  PROGRESS: 'progress',
  AUTO_MONITOR: 'auto-monitor',
  RESULT: 'result',
  TRANSCRIPT: 'transcript',
  ASR_STATUS: 'asr-status',
  SPEAKER_PARTITION: 'speaker-partition',
  SESSION_CONTEXT: 'session-context',
  SUMMARY_CHUNK: 'summary-chunk',
  SUMMARY_DONE: 'summary-done',
  SUMMARY_DEBUG: 'summary-debug',
  SUMMARY_ERROR: 'summary-error',
  ERROR: 'error'
} as const;

/** The contract's `result` message member (carries the optional `ranked`/`trigger`). */
type ResultMessage = Extract<ServerMessage, { type: 'result' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function parseSpeakerRole(value: unknown): SpeakerRole | null {
  return value === 'interviewer' || value === 'candidate' || value === 'unknown'
    ? value
    : null;
}

function parseSpeakerAssignment(value: unknown): SpeakerAssignment | null {
  if (!isRecord(value)) return null;
  const role = parseSpeakerRole(value.role);
  const state: SpeakerAssignmentState | null =
    value.state === 'observing' ||
    value.state === 'delegated' ||
    value.state === 'contested' ||
    value.state === 'manual'
      ? value.state
      : null;
  const roleSource: SpeakerAssignmentRoleSource | null =
    value.roleSource === 'manual' ||
    value.roleSource === 'cohort' ||
    value.roleSource === 'unknown'
      ? value.roleSource
      : null;
  if (
    !isNonNegativeInteger(value.speakerId) ||
    !role ||
    !state ||
    !roleSource ||
    !isNumber(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !isNonNegativeInteger(value.evidenceVersion) ||
    !isNumber(value.updatedAtMs) ||
    value.updatedAtMs < 0 ||
    !Array.isArray(value.reasonCodes) ||
    !value.reasonCodes.every(isString)
  ) {
    return null;
  }
  const isCoherent =
    (state === 'delegated' && role !== 'unknown' && roleSource === 'cohort') ||
    (state === 'manual' && role !== 'unknown' && roleSource === 'manual') ||
    ((state === 'observing' || state === 'contested') &&
      role === 'unknown' &&
      roleSource === 'unknown');
  if (!isCoherent) return null;
  return {
    speakerId: value.speakerId,
    role,
    state,
    roleSource,
    confidence: value.confidence,
    evidenceVersion: value.evidenceVersion,
    updatedAtMs: value.updatedAtMs,
    reasonCodes: [...value.reasonCodes]
  };
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isString(raw)) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(data) || !isString(data.type)) {
    return null;
  }

  switch (data.type) {
    case S2C.READY:
      return isString(data.sessionId)
        ? { type: 'ready', sessionId: data.sessionId }
        : null;

    case S2C.PROGRESS:
      if (
        isString(data.requestId) &&
        isString(data.phase) &&
        isNumber(data.index) &&
        isNumber(data.total) &&
        (data.status === 'start' || data.status === 'done')
      ) {
        return {
          type: 'progress',
          requestId: data.requestId,
          phase: data.phase,
          index: data.index,
          total: data.total,
          status: data.status,
          model: isString(data.model) ? data.model : undefined,
          tokens: parseTokens(data.tokens)
        };
      }
      return null;

    case S2C.AUTO_MONITOR:
      if (
        (data.status === 'idle' ||
          data.status === 'evaluating' ||
          data.status === 'waiting' ||
          data.status === 'delegating') &&
        isString(data.model)
      ) {
        return {
          type: 'auto-monitor',
          status: data.status,
          model: data.model,
          ...(isNumber(data.elapsedMs) && data.elapsedMs >= 0
            ? { elapsedMs: data.elapsedMs }
            : {})
        };
      }
      return null;

    case S2C.RESULT:
      if (isString(data.requestId) && isRecord(data.output)) {
        // `ranked`/`trigger` are additive auto-question-generation fields. They
        // are optional on the wire (absent in fast mode / older servers), so we
        // parse them defensively and only attach when present.
        const result: ResultMessage = {
          type: 'result',
          requestId: data.requestId,
          mode: isString(data.mode) ? data.mode : '',
          output: parseFollowUp(data.output),
          shouldShowFollowUps: data.shouldShowFollowUps === true,
          tokensUsed: parseTokenUsage(data.tokensUsed),
          elapsedMs: isNumber(data.elapsedMs) ? data.elapsedMs : 0,
          iterationVersion: isString(data.iterationVersion) ? data.iterationVersion : ''
        };
        const ranked = parseRanked(data.ranked);
        if (ranked) {
          result.ranked = ranked;
        }
        const trigger = parseTrigger(data.trigger);
        if (trigger) {
          result.trigger = trigger;
        }
        if (isNumber(data.anchorSeq) && Number.isInteger(data.anchorSeq) && data.anchorSeq >= 0) {
          result.anchorSeq = data.anchorSeq;
        }
        return result;
      }
      return null;

    case S2C.SESSION_CONTEXT:
      return { type: 'session-context', state: parseSessionContext(data.state) };

    case S2C.SUMMARY_CHUNK:
      return isString(data.requestId) && isString(data.text)
        ? { type: 'summary-chunk', requestId: data.requestId, text: data.text }
        : null;

    case S2C.SUMMARY_DONE:
      // `text`/`model`/`empty` are optional (the model id is best-effort; `empty`
      // flags the friendly no-transcript notice). Only `requestId` is required to
      // correlate the finish.
      return isString(data.requestId)
        ? {
            type: 'summary-done',
            requestId: data.requestId,
            ...(isString(data.text) ? { text: data.text } : {}),
            ...(isString(data.model) ? { model: data.model } : {}),
            ...(data.empty === true ? { empty: true } : {})
          }
        : null;

    case S2C.SUMMARY_DEBUG: {
      const event = parseSummaryDebugEvent(data.event);
      return isString(data.requestId) && event
        ? { type: 'summary-debug', requestId: data.requestId, event }
        : null;
    }

    case S2C.SUMMARY_ERROR:
      return isString(data.requestId)
        ? {
            type: 'summary-error',
            requestId: data.requestId,
            message: isString(data.message) ? data.message : '总结失败'
          }
        : null;

    case S2C.ERROR:
      return {
        type: 'error',
        requestId: isString(data.requestId) ? data.requestId : undefined,
        message: isString(data.message) ? data.message : '未知服务端错误'
      };

    case S2C.TRANSCRIPT:
      if (
        (data.source === 'mic' || data.source === 'display') &&
        isString(data.text) &&
        typeof data.isFinal === 'boolean'
      ) {
        const speakerRole: SpeakerRole | undefined =
          data.speaker === 'interviewer' || data.speaker === 'candidate' || data.speaker === 'unknown'
            ? (data.speaker as SpeakerRole)
            : undefined;
        return {
          type: 'transcript',
          source: data.source,
          text: data.text,
          isFinal: data.isFinal,
          ...(typeof data.speakerId === 'number' ? { speakerId: data.speakerId } : {}),
          ...(speakerRole !== undefined ? { speaker: speakerRole } : {})
        };
      }
      return null;

    case S2C.ASR_STATUS: {
      const provider: AsrProvider | null =
        data.provider === 'volc' ||
        data.provider === 'paraformer' ||
        data.provider === 'sim'
          ? data.provider
          : null;
      const state: AsrRuntimeState | null =
        data.state === 'connecting' ||
        data.state === 'live' ||
        data.state === 'finalizing' ||
        data.state === 'stopped' ||
        data.state === 'partial' ||
        data.state === 'failed'
          ? data.state
          : null;
      if ((data.source !== 'mic' && data.source !== 'display') || !provider || !state) {
        return null;
      }
      return {
        type: 'asr-status',
        source: data.source,
        provider,
        state,
        ...(isString(data.message) ? { message: data.message } : {})
      };
    }

    case S2C.SPEAKER_PARTITION: {
      if (
        (data.status !== 'live' && data.status !== 'final') ||
        !isString(data.model) ||
        !Array.isArray(data.segments)
      ) {
        return null;
      }
      const segments = data.segments.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const role = parseSpeakerRole(entry.role);
        const roleSource: SpeakerRoleSource | null =
          entry.roleSource === 'manual' ||
          entry.roleSource === 'local' ||
          entry.roleSource === 'semantic-turn' ||
          entry.roleSource === 'cohort' ||
          entry.roleSource === 'unknown'
            ? entry.roleSource
            : entry.roleSource === undefined
              ? role === 'unknown'
                ? 'unknown'
                : 'semantic-turn'
              : null;
        if (
          !isNumber(entry.seq) ||
          !Number.isInteger(entry.seq) ||
          !isNumber(entry.speakerId) ||
          !Number.isInteger(entry.speakerId) ||
          !role ||
          !roleSource ||
          !isString(entry.text)
        ) {
          return [];
        }
        return [{ seq: entry.seq, speakerId: entry.speakerId, role, roleSource, text: entry.text }];
      });
      if (segments.length !== data.segments.length) return null;
      const rawAssignments = data.speakerAssignments === undefined
        ? []
        : data.speakerAssignments;
      if (!Array.isArray(rawAssignments)) return null;
      const speakerAssignments = rawAssignments.map(parseSpeakerAssignment);
      if (speakerAssignments.some((assignment) => assignment === null)) return null;
      const assignments = speakerAssignments as SpeakerAssignment[];
      const assignmentIds = assignments.map((assignment) => assignment.speakerId);
      if (new Set(assignmentIds).size !== assignmentIds.length) return null;
      const assignmentBySpeaker = new Map(
        assignments.map((assignment) => [assignment.speakerId, assignment])
      );
      if (
        segments.some((segment) => {
          const assignment = assignmentBySpeaker.get(segment.speakerId);
          return assignment !== undefined && assignment.role !== segment.role;
        })
      ) {
        return null;
      }
      return {
        type: 'speaker-partition',
        status: data.status,
        model: data.model,
        segments,
        speakerAssignments: assignments
      };
    }

    default:
      return null;
  }
}

function parseTokens(value: unknown): { input: number; output: number } | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isNumber(value.input) && isNumber(value.output)) {
    return { input: value.input, output: value.output };
  }
  return null;
}

function parseSummaryDebugEvent(value: unknown): SummaryDebugEvent | null {
  if (!isRecord(value) || !isNumber(value.at) || !isString(value.stage)) {
    return null;
  }
  if (value.source !== 'client' && value.source !== 'server' && value.source !== 'dashscope') {
    return null;
  }

  const event: SummaryDebugEvent = {
    at: value.at,
    source: value.source,
    stage: value.stage
  };
  if (isString(value.model)) event.model = value.model;
  if (isNumber(value.status)) event.status = value.status;
  if (isString(value.eventType)) event.eventType = value.eventType;
  if (isNumber(value.inputChars)) event.inputChars = value.inputChars;
  if (isNumber(value.chunkChars)) event.chunkChars = value.chunkChars;
  if (isNumber(value.accumulatedChars)) event.accumulatedChars = value.accumulatedChars;
  if (isNumber(value.inputTokens)) event.inputTokens = value.inputTokens;
  if (isNumber(value.outputTokens)) event.outputTokens = value.outputTokens;
  if (isNumber(value.elapsedMs)) event.elapsedMs = value.elapsedMs;
  if (isString(value.reason)) event.reason = value.reason;
  if (isString(value.error)) event.error = value.error;
  return event;
}

function parseTokenUsage(value: unknown): { input: number; output: number; total?: number } {
  if (isRecord(value) && isNumber(value.input) && isNumber(value.output)) {
    return {
      input: value.input,
      output: value.output,
      total: isNumber(value.total) ? value.total : undefined
    };
  }
  return { input: 0, output: 0 };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isString)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isCompetencyStatus(value: unknown): value is CompetencyStatus {
  return value === 'covered' || value === 'partial' || value === 'gap';
}

function parseCompetencies(value: unknown, legacyValue: unknown): SessionCompetency[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!isRecord(entry) || !isString(entry.name)) {
        return [];
      }
      const name = entry.name.trim();
      if (!name) {
        return [];
      }
      return [
        {
          name,
          status: isCompetencyStatus(entry.status) ? entry.status : 'partial',
          ...(isString(entry.evidence) && entry.evidence.trim()
            ? { evidence: entry.evidence.trim() }
            : {})
        }
      ];
    });
  }

  // Legacy desktop Block-H state emits `competencies_covered: string[]`.
  return toStringArray(legacyValue).map((name) => ({ name, status: 'covered' }));
}

function parseSessionContext(value: unknown): SessionContextState {
  const rec = isRecord(value) ? value : {};
  const topics = toStringArray(rec.topics);
  const gaps = toStringArray(rec.gaps);
  return {
    competencies: parseCompetencies(rec.competencies, rec.competencies_covered),
    topics: topics.length ? topics : toStringArray(rec.drilled_topics),
    gaps: gaps.length ? gaps : toStringArray(rec.open_gaps)
  };
}

/**
 * Parse the optional ranked-candidate pool. Returns `undefined` when absent or
 * malformed (so the client falls back to the single primary question); filters
 * out any individual entry that isn't a well-formed `RankedQuestion`.
 */
function parseRanked(value: unknown): RankedQuestion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed: RankedQuestion[] = [];
  for (const entry of value) {
    if (
      isRecord(entry) &&
      isString(entry.question) &&
      isNumber(entry.score) &&
      isNumber(entry.maxScore) &&
      isNumber(entry.rank)
    ) {
      parsed.push({
        question: entry.question,
        score: entry.score,
        maxScore: entry.maxScore,
        rubricReason: isString(entry.rubricReason) ? entry.rubricReason : '',
        rank: entry.rank
      });
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

/** Parse the optional generation trigger; `undefined` for any other value. */
function parseTrigger(value: unknown): GenerationTrigger | undefined {
  return value === 'auto' || value === 'manual' ? value : undefined;
}

function parseFollowUp(value: Record<string, unknown>): FollowUpOutput {
  const anchors = Array.isArray(value.anchor_quotes)
    ? value.anchor_quotes.filter(isString)
    : [];
  return {
    primary_question: isString(value.primary_question) ? value.primary_question : '',
    alternative_question: isString(value.alternative_question)
      ? value.alternative_question
      : '',
    rationale_for_interviewer: isString(value.rationale_for_interviewer)
      ? value.rationale_for_interviewer
      : '',
    anchor_quotes: anchors,
    expected_evidence_yield: isString(value.expected_evidence_yield)
      ? value.expected_evidence_yield
      : '',
    iteration_version: isString(value.iteration_version) ? value.iteration_version : ''
  };
}

import type { FollowUpOutput, ServerMessage } from '@open-cluely/contract';
import { S2C } from '@open-cluely/contract';

/**
 * Runtime narrowing for inbound WebSocket payloads. The wire is untrusted, so
 * we parse as `unknown` and validate the discriminant + required fields before
 * handing a typed `ServerMessage` to the hook.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

    case S2C.RESULT:
      if (isString(data.requestId) && isRecord(data.output)) {
        return {
          type: 'result',
          requestId: data.requestId,
          mode: isString(data.mode) ? data.mode : '',
          output: parseFollowUp(data.output),
          shouldShowFollowUps: data.shouldShowFollowUps === true,
          tokensUsed: parseTokenUsage(data.tokensUsed),
          elapsedMs: isNumber(data.elapsedMs) ? data.elapsedMs : 0,
          iterationVersion: isString(data.iterationVersion) ? data.iterationVersion : ''
        };
      }
      return null;

    case S2C.SESSION_CONTEXT:
      return { type: 'session-context', state: data.state };

    case S2C.ERROR:
      return {
        type: 'error',
        requestId: isString(data.requestId) ? data.requestId : undefined,
        message: isString(data.message) ? data.message : 'Unknown server error'
      };

    case S2C.TRANSCRIPT:
      // Audio transcripts are out of scope for this phase; ignore safely.
      return null;

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

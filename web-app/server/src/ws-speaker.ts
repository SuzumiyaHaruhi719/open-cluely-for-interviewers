// ============================================================================
// Speaker-role stamping + candidate-final gating (pure helpers).
// ----------------------------------------------------------------------------
// FunASR emits per-segment speaker ids. The ws layer keeps a per-connection
// SpeakerRoleMap (see ./speaker-roles) that resolves an id to a role
// ('interviewer' | 'candidate' | 'unknown'). These two pure helpers let the ws
// emit callback (a) stamp the resolved role onto every transcript it sends to
// the browser, and (b) decide whether a finalized segment is a CANDIDATE answer
// that should feed the auto-analyze / trigger path.
//
// Online providers (paraformer/volc) carry no speakerId → resolve(null) is
// 'unknown' → isCandidateFinal is always false, so this gating is purely
// additive for offline FunASR and never changes online behavior.
// ============================================================================

import type { SpeakerRole } from '@open-cluely/contract';
import type { SpeakerRoleMap } from './speaker-roles';

interface Emit {
  source?: string;
  text?: string;
  isFinal: boolean;
  speakerId?: number | null;
}

/** Return a copy of `t` with the resolved speaker role stamped on. */
export function stampRole<T extends Emit>(roles: SpeakerRoleMap, t: T): T & { speaker: SpeakerRole } {
  return { ...t, speaker: roles.resolve(t.speakerId ?? null) };
}

/** True only for FINAL segments whose speaker resolves to the candidate. */
export function isCandidateFinal(roles: SpeakerRoleMap, t: Emit): boolean {
  return t.isFinal === true && roles.resolve(t.speakerId ?? null) === 'candidate';
}

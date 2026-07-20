import type { SpeakerRole } from '@open-cluely/contract';

export interface SpeakerRoleMap {
  resolve(speakerId: number | null): SpeakerRole;
  /** Resolve one model-inferred turn while preserving a sticky manual speaker correction. */
  resolveTurnRole(speakerId: number, inferredRole: SpeakerRole): SpeakerRole;
  /** Manual interviewer correction. It is sticky and always wins over later inference. */
  setRole(speakerId: number, role: SpeakerRole): void;
  /** Apply a model-inferred role unless that speaker was manually corrected. */
  setAutoRole(speakerId: number, role: SpeakerRole): boolean;
  /**
   * Clear per-interview speaker labels + first-seen order without changing the
   * provider's guess/no-guess mode. Used when the client starts a new interview
   * on the same WebSocket connection.
   */
  reset(): void;
  /**
   * Toggle legacy first-seen role guessing. false keeps native cluster ids
   * unknown until Flash has enough conversational evidence or the interviewer
   * labels one manually.
   */
  setGuess(enabled: boolean): void;
}

export function createSpeakerRoleMap(): SpeakerRoleMap {
  const roles = new Map<number, SpeakerRole>();
  const manual = new Set<number>();
  const order: number[] = [];
  let guess = true;
  function defaultFor(id: number): SpeakerRole {
    if (!order.includes(id)) order.push(id);
    if (!guess) return 'unknown';
    return order[0] === id ? 'interviewer' : 'candidate';
  }
  return {
    resolve(speakerId) {
      if (speakerId === null || speakerId === undefined) return 'unknown';
      return roles.get(speakerId) ?? defaultFor(speakerId);
    },
    resolveTurnRole(speakerId, inferredRole) {
      if (manual.has(speakerId)) return roles.get(speakerId) ?? defaultFor(speakerId);
      return inferredRole;
    },
    setRole(speakerId, role) {
      if (!order.includes(speakerId)) order.push(speakerId);
      manual.add(speakerId);
      roles.set(speakerId, role);
      // Legacy GUESS mode only: the OTHER speaker sits on a fragile first-seen
      // default, so a single correction must complement it (flip the swap) — one
      // tap fixes the whole session. In NO-GUESS mode (讯飞 roleids) every speaker
      // is labeled manually & independently; never auto-assign the others (iFlytek
      // may over-segment into >2 clusters during fast cross-talk).
      if (!guess) return;
      const opposite: SpeakerRole | null =
        role === 'interviewer' ? 'candidate' : role === 'candidate' ? 'interviewer' : null;
      if (opposite) {
        for (const other of order) {
          if (other !== speakerId) roles.set(other, opposite);
        }
      }
    },
    setAutoRole(speakerId, role) {
      if (manual.has(speakerId)) return false;
      if (!order.includes(speakerId)) order.push(speakerId);
      roles.set(speakerId, role);
      return true;
    },
    reset() {
      roles.clear();
      manual.clear();
      order.length = 0;
    },
    setGuess(enabled) {
      guess = enabled;
    }
  };
}

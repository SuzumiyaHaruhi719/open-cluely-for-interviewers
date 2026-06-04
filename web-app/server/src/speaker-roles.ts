import type { SpeakerRole } from '@open-cluely/contract';

export interface SpeakerRoleMap {
  resolve(speakerId: number | null): SpeakerRole;
  setRole(speakerId: number, role: SpeakerRole): void;
  /**
   * Toggle first-seen role GUESSING. true (default): the first speaker id seen
   * resolves to 'interviewer', every other to 'candidate' (CAM++ offline single-
   * mic). false: unassigned ids resolve to 'unknown' — used for iFlytek (讯飞),
   * whose own role_type=2 cluster ids the interviewer labels MANUALLY, so the
   * server never guesses who is interviewer vs candidate.
   */
  setGuess(enabled: boolean): void;
}

export function createSpeakerRoleMap(): SpeakerRoleMap {
  const roles = new Map<number, SpeakerRole>();
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
    setRole(speakerId, role) {
      if (!order.includes(speakerId)) order.push(speakerId);
      roles.set(speakerId, role);
      // GUESS mode (CAM++) only: the OTHER speaker sits on a fragile first-seen
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
    setGuess(enabled) {
      guess = enabled;
    }
  };
}

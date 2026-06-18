// ============================================================================
// Speaker-id CAP for diarizing providers that over-segment (pure helper).
// ----------------------------------------------------------------------------
// iFlytek (讯飞) 角色分离 (role_type=2) emits per-WORD `rl` cluster ids. Under fast
// turn-taking / cross-talk it OVER-segments a real 2-person interview into >2
// distinct `rl` values, so the UI would surface "4 speakers" for 2 people. The
// cloud call has no hard "max roles" cap we can rely on, so we collapse the
// stream to at most `XFYUN_MAX_SPEAKERS` distinct ids deterministically.
//
// HEURISTIC (mirrors the CAM++ "first voice = interviewer, second = candidate"
// idea, but applied as a pure post-filter on the cluster ids):
//   • Track distinct raw ids in ORDER OF FIRST APPEARANCE.
//   • The 1st distinct raw id → slot 0, the 2nd → slot 1 (… up to maxSpeakers).
//   • Any FURTHER distinct raw id (overflow) FOLDS onto the most-recently-active
//     in-cap slot at the moment it first appears, and is then PINNED to that slot
//     so repeats are stable (a flapping cluster id never re-splits the bubble).
//   • Re-seeing an already-mapped id re-activates its slot (so the NEXT overflow
//     folds onto whoever was most recently speaking).
//
// The cap only renumbers ids; the interviewer can still manually relabel either
// capped slot (set-speaker-role keys off the capped id, which is all the browser
// ever sees). Per-connection state; reset() on a new interview.
// ============================================================================

/** Maximum distinct speakers surfaced for an iFlytek (角色分离) interview. */
export const XFYUN_MAX_SPEAKERS = 2;

export interface SpeakerCap {
  /** Map a raw provider speaker id onto a capped slot id in [0, maxSpeakers). */
  map(rawId: number): number;
  /** Clear the mapping (new interview / session reset). */
  reset(): void;
}

export function createSpeakerCap(maxSpeakers: number = XFYUN_MAX_SPEAKERS): SpeakerCap {
  const cap = Math.max(1, Math.floor(maxSpeakers));
  // raw provider id → capped slot id.
  let rawToSlot = new Map<number, number>();
  // Slot most recently returned — the fold target for overflow ids.
  let activeSlot = 0;

  return {
    map(rawId: number): number {
      const existing = rawToSlot.get(rawId);
      if (existing !== undefined) {
        activeSlot = existing;
        return existing;
      }
      // A new distinct id: take the next free slot if one remains, else fold onto
      // the most-recently-active in-cap slot and PIN this id there for stability.
      const slot = rawToSlot.size < cap ? rawToSlot.size : activeSlot;
      rawToSlot.set(rawId, slot);
      activeSlot = slot;
      return slot;
    },
    reset(): void {
      rawToSlot = new Map();
      activeSlot = 0;
    }
  };
}

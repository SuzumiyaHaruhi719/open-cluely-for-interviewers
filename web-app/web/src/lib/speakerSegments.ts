import type { SpeakerRole, SpeakerRoleSource } from '@open-cluely/contract';

export interface SpeakerSegment {
  id: number;
  speakerId: number;
  role: SpeakerRole;
  roleSource: SpeakerRoleSource;
  text: string;
  /** Client arrival time for the first FINAL folded into this visible turn. */
  createdAtMs?: number;
  /** Raw ASR utterance start relative to its capture cycle (diagnostic only). */
  audioStartMs?: number;
}

/** Effective role = client override (from a one-tap toggle) if present, else the server's label. */
export function effectiveRole(
  speakerId: number,
  serverRole: SpeakerRole | undefined,
  overrides: Map<number, SpeakerRole>
): SpeakerRole {
  return overrides.get(speakerId) ?? serverRole ?? 'unknown';
}

/** Append a finalized, speaker-identified segment. Returns a NEW array.
 *  Only call for finals that carry a real numeric speakerId (online transcripts
 *  have none and must NOT create segments). */
export function appendSegment(
  segments: SpeakerSegment[],
  args: {
    id: number;
    speakerId: number;
    role: SpeakerRole;
    roleSource?: SpeakerRoleSource;
    text: string;
    createdAtMs?: number;
    audioStartMs?: number;
  }
): SpeakerSegment[] {
  // Coalesce consecutive finals from the SAME speaker into one growing bubble,
  // so a multi-sentence turn renders as one segment (not "一段一段"). A different
  // speaker id starts a new bubble. Keeps the original segment id (stable React key).
  const last = segments[segments.length - 1];
  if (last && last.speakerId === args.speakerId) {
    const text = last.text ? `${last.text} ${args.text}` : args.text;
    return [
      ...segments.slice(0, -1),
      {
        ...last,
        role: args.role,
        roleSource: args.roleSource ?? last.roleSource,
        text
      }
    ];
  }
  return [
    ...segments,
    {
      id: args.id,
      speakerId: args.speakerId,
      role: args.role,
      roleSource: args.roleSource ?? 'unknown',
      text: args.text,
      createdAtMs: args.createdAtMs ?? Date.now(),
      audioStartMs: args.audioStartMs
    }
  ];
}

/** Re-label every segment belonging to a speaker id (after a one-tap toggle). */
export function relabelSegments(
  segments: SpeakerSegment[],
  speakerId: number,
  role: SpeakerRole
): SpeakerSegment[] {
  return segments.map((s) =>
    s.speakerId === speakerId ? { ...s, role, roleSource: 'manual' } : s
  );
}

import type { SpeakerRole } from '@open-cluely/contract';

export interface SpeakerSegment {
  id: number;
  speakerId: number;
  role: SpeakerRole;
  text: string;
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
  args: { id: number; speakerId: number; role: SpeakerRole; text: string }
): SpeakerSegment[] {
  return [...segments, { id: args.id, speakerId: args.speakerId, role: args.role, text: args.text }];
}

/** Re-label every segment belonging to a speaker id (after a one-tap toggle). */
export function relabelSegments(
  segments: SpeakerSegment[],
  speakerId: number,
  role: SpeakerRole
): SpeakerSegment[] {
  return segments.map((s) => (s.speakerId === speakerId ? { ...s, role } : s));
}

import type { SpeakerRole } from '@open-cluely/contract';

export interface SpeakerRoleMap {
  resolve(speakerId: number | null): SpeakerRole;
  setRole(speakerId: number, role: SpeakerRole): void;
}

export function createSpeakerRoleMap(): SpeakerRoleMap {
  const roles = new Map<number, SpeakerRole>();
  const order: number[] = [];
  function defaultFor(id: number): SpeakerRole {
    if (!order.includes(id)) order.push(id);
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
    }
  };
}

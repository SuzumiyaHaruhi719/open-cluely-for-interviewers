import { describe, it, expect } from 'vitest';
import { effectiveRole, appendSegment, relabelSegments } from './speakerSegments';
import type { SpeakerRole } from '@open-cluely/contract';

describe('speakerSegments', () => {
  it('effectiveRole prefers override, then server role, then unknown', () => {
    const ov = new Map<number, SpeakerRole>();
    expect(effectiveRole(0, 'interviewer', ov)).toBe('interviewer');
    expect(effectiveRole(0, undefined, ov)).toBe('unknown');
    ov.set(0, 'candidate');
    expect(effectiveRole(0, 'interviewer', ov)).toBe('candidate');
  });

  it('appendSegment adds in order', () => {
    let s = appendSegment([], { id: 1, speakerId: 0, role: 'interviewer', text: '你好' });
    s = appendSegment(s, { id: 2, speakerId: 1, role: 'candidate', text: '我做过分布式' });
    expect(s.map((x) => [x.role, x.text])).toEqual([
      ['interviewer', '你好'],
      ['candidate', '我做过分布式']
    ]);
  });

  it('merges consecutive finals from the same speaker into one bubble', () => {
    let s = appendSegment([], { id: 1, speakerId: 0, role: 'interviewer', text: '你好' });
    s = appendSegment(s, { id: 2, speakerId: 0, role: 'interviewer', text: '请坐' });
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe('你好 请坐');
    expect(s[0].id).toBe(1); // keeps the original bubble's id
    // A different speaker id starts a fresh bubble.
    s = appendSegment(s, { id: 3, speakerId: 1, role: 'candidate', text: '我做过分布式' });
    expect(s.map((x) => [x.role, x.text])).toEqual([
      ['interviewer', '你好 请坐'],
      ['candidate', '我做过分布式']
    ]);
  });

  it('relabelSegments flips all segments of a speaker id', () => {
    const s = appendSegment([], { id: 1, speakerId: 0, role: 'interviewer', text: 'a' });
    expect(relabelSegments(s, 0, 'candidate')[0].role).toBe('candidate');
  });

  it('appendSegment returns a new array (immutable)', () => {
    const original: ReturnType<typeof appendSegment> = [];
    const next = appendSegment(original, { id: 1, speakerId: 0, role: 'unknown', text: 'x' });
    expect(next).not.toBe(original);
    expect(original).toHaveLength(0);
  });

  it('relabelSegments does not mutate original segments', () => {
    const s = appendSegment([], { id: 1, speakerId: 0, role: 'interviewer', text: 'a' });
    const relabeled = relabelSegments(s, 0, 'candidate');
    expect(s[0].role).toBe('interviewer');
    expect(relabeled[0].role).toBe('candidate');
  });

  it('relabelSegments only flips the matching speakerId, not others', () => {
    let s = appendSegment([], { id: 1, speakerId: 0, role: 'interviewer', text: 'a' });
    s = appendSegment(s, { id: 2, speakerId: 1, role: 'unknown', text: 'b' });
    const relabeled = relabelSegments(s, 0, 'candidate');
    expect(relabeled[0].role).toBe('candidate');
    expect(relabeled[1].role).toBe('unknown');
  });
});

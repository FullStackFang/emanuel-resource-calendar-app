// src/__tests__/unit/utils/agendaScrollSpy.test.js
//
// The whole scroll-spy decision lives here — the component only feeds it
// offsets and reports the answer upward.

import { describe, it, expect } from 'vitest';
import { dayAtScrollTop } from '../../../utils/agendaScrollSpy';

const SECTIONS = [
  { key: '2026-07-12', offsetTop: 0 },
  { key: '2026-07-13', offsetTop: 200 },
  { key: '2026-07-14', offsetTop: 460 },
  { key: '2026-07-15', offsetTop: 900 },
];

describe('dayAtScrollTop', () => {
  it('returns the first day when scrolled above the first section', () => {
    // Rubber-banding past the top yields a negative scrollTop on iOS.
    expect(dayAtScrollTop(SECTIONS, -40)).toBe('2026-07-12');
    expect(dayAtScrollTop(SECTIONS, 0)).toBe('2026-07-12');
  });

  it('returns the section a scroll position lands exactly on', () => {
    expect(dayAtScrollTop(SECTIONS, 200)).toBe('2026-07-13');
    expect(dayAtScrollTop(SECTIONS, 460)).toBe('2026-07-14');
  });

  it('returns the section above when the position falls between two', () => {
    expect(dayAtScrollTop(SECTIONS, 199)).toBe('2026-07-12');
    expect(dayAtScrollTop(SECTIONS, 201)).toBe('2026-07-13');
    expect(dayAtScrollTop(SECTIONS, 899)).toBe('2026-07-14');
  });

  it('returns the last section once scrolled past it', () => {
    expect(dayAtScrollTop(SECTIONS, 5000)).toBe('2026-07-15');
  });

  it('returns null for an empty or absent section list', () => {
    expect(dayAtScrollTop([], 300)).toBeNull();
    expect(dayAtScrollTop(undefined, 300)).toBeNull();
    expect(dayAtScrollTop(null, 0)).toBeNull();
  });

  it('sorts unordered input — DOM ref maps have no ordering guarantee', () => {
    const shuffled = [SECTIONS[2], SECTIONS[0], SECTIONS[3], SECTIONS[1]];

    expect(dayAtScrollTop(shuffled, 300)).toBe('2026-07-13');
    expect(dayAtScrollTop(shuffled, 0)).toBe('2026-07-12');
    expect(dayAtScrollTop(shuffled, 5000)).toBe('2026-07-15');
  });

  it('does not mutate the caller\'s array', () => {
    const shuffled = [SECTIONS[2], SECTIONS[0]];
    const snapshot = [...shuffled];

    dayAtScrollTop(shuffled, 300);

    expect(shuffled).toEqual(snapshot);
  });

  it('handles a single section', () => {
    const one = [{ key: '2026-07-12', offsetTop: 120 }];

    expect(dayAtScrollTop(one, 0)).toBe('2026-07-12');
    expect(dayAtScrollTop(one, 9999)).toBe('2026-07-12');
  });
});

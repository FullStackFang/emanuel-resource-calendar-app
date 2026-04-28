// src/__tests__/unit/utils/calculateAllSeriesDates.test.js
//
// Regression coverage for calculateAllSeriesDates — the math that drives the
// recurrence badge's absolute occurrence position (e.g., "5/12") on calendar
// event blocks. Calendar.jsx looks up each occurrence's date in the sorted
// array returned here, and uses (indexOf + 1) as the displayed occurrence
// number. Total occurrences is sortedDates.length.
import { describe, it, expect } from 'vitest';
import { calculateAllSeriesDates } from '../../../utils/recurrenceUtils';

const WEEKLY_MONDAY_12 = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
  range: { type: 'numbered', numberOfOccurrences: 12, startDate: '2026-04-06' },
};

describe('calculateAllSeriesDates', () => {
  it('SN-1: numbered range yields exactly numberOfOccurrences dates', () => {
    const dates = calculateAllSeriesDates(WEEKLY_MONDAY_12);
    expect(dates).toHaveLength(12);
  });

  it('SN-2: returned array is sorted chronologically', () => {
    const dates = calculateAllSeriesDates(WEEKLY_MONDAY_12);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it('SN-3: weekly Monday pattern produces only Mondays', () => {
    const dates = calculateAllSeriesDates(WEEKLY_MONDAY_12);
    dates.forEach((d) => {
      const day = new Date(d + 'T00:00:00').getDay();
      expect(day).toBe(1); // 1 = Monday
    });
  });

  it('SN-4: numbered range extends past original end to preserve count when one date is excluded', () => {
    // Outlook-style semantics: numberOfOccurrences = "give me N actual occurrences",
    // so the series extends past the original 12th Monday to backfill the excluded slot.
    const excluded = '2026-04-13'; // 2nd Monday
    const dates = calculateAllSeriesDates({
      ...WEEKLY_MONDAY_12,
      exclusions: [excluded],
    });
    expect(dates).toHaveLength(12);
    expect(dates).not.toContain(excluded);
    // The 12th date is now Jun 29 (one Monday past the original Jun 22 end)
    expect(dates[11]).toBe('2026-06-29');
  });

  it('SN-4b: endDate range reduces count when a date is excluded (cannot extend past end)', () => {
    const recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'endDate', startDate: '2026-04-06', endDate: '2026-06-22' },
      exclusions: ['2026-04-13'],
    };
    const dates = calculateAllSeriesDates(recurrence);
    expect(dates).toHaveLength(11);
    expect(dates).not.toContain('2026-04-13');
  });

  it('SN-5: additions on non-pattern dates increase count', () => {
    const addition = '2026-04-09'; // Thursday — not in weekly Monday pattern
    const dates = calculateAllSeriesDates({
      ...WEEKLY_MONDAY_12,
      additions: [addition],
    });
    expect(dates).toHaveLength(13);
    expect(dates).toContain(addition);
  });

  it('SN-6: addition on a pattern date is not double-counted', () => {
    const addition = '2026-04-06'; // identical to the first Monday (pattern date)
    const dates = calculateAllSeriesDates({
      ...WEEKLY_MONDAY_12,
      additions: [addition],
    });
    expect(dates).toHaveLength(12); // no increase
    expect(dates.filter((d) => d === addition)).toHaveLength(1);
  });

  it('SN-7: endDate range respects the start..end boundary inclusively', () => {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-04-10' },
    };
    const dates = calculateAllSeriesDates(recurrence);
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe('2026-04-01');
    expect(dates[9]).toBe('2026-04-10');
  });

  it('SN-8: noEnd series is capped at 500 and starts at range.startDate', () => {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'noEnd', startDate: '2026-04-01' },
    };
    const dates = calculateAllSeriesDates(recurrence);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(500);
    expect(dates[0]).toBe('2026-04-01');
  });

  it('SN-9: single-occurrence series (numberOfOccurrences=1) yields length 1', () => {
    const recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'numbered', numberOfOccurrences: 1, startDate: '2026-04-06' },
    };
    const dates = calculateAllSeriesDates(recurrence);
    expect(dates).toHaveLength(1);
  });

  it('SN-10: null or missing recurrence returns empty array', () => {
    expect(calculateAllSeriesDates(null)).toEqual([]);
    expect(calculateAllSeriesDates(undefined)).toEqual([]);
    expect(calculateAllSeriesDates({ pattern: null, range: {} })).toEqual([]);
    expect(calculateAllSeriesDates({ pattern: { type: 'weekly' }, range: null })).toEqual([]);
  });

  it('SN-11: numbered range with exclusion + addition: 12 (extended) + 1 addition = 13', () => {
    // Numbered range preserves N=12 by extending; the addition is independent and adds 1.
    const excluded = '2026-04-13';   // 2nd Monday in the pattern
    const addition = '2026-04-09';   // off-pattern Thursday
    const dates = calculateAllSeriesDates({
      ...WEEKLY_MONDAY_12,
      exclusions: [excluded],
      additions: [addition],
    });
    expect(dates).toHaveLength(13);
    expect(dates).not.toContain(excluded);
    expect(dates).toContain(addition);
    // Result is sorted, so the addition (Apr 9) appears after the first Monday (Apr 6)
    expect(dates.indexOf(addition)).toBe(1);
  });

  it('SN-12: indexOf(date) + 1 gives the expected 1-based occurrence number', () => {
    // This is exactly how Calendar.jsx maps a date to its absolute series number.
    const dates = calculateAllSeriesDates(WEEKLY_MONDAY_12);
    expect(dates.indexOf('2026-04-06') + 1).toBe(1);
    expect(dates.indexOf('2026-04-13') + 1).toBe(2);
    // Last Monday in a 12-week run starting Apr 6: Apr 6, 13, 20, 27, May 4, 11, 18, 25, Jun 1, 8, 15, 22
    expect(dates.indexOf('2026-06-22') + 1).toBe(12);
  });
});

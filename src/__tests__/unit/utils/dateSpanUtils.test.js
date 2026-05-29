import { describe, it, expect } from 'vitest';
import { computeEventSpanDays, formatDateSpanLabel } from '../../../utils/dateSpanUtils';

describe('computeEventSpanDays', () => {
  it('returns 0 for a same-day event', () => {
    expect(computeEventSpanDays('2027-06-18', '2027-06-18')).toBe(0);
  });

  it('returns 1 for consecutive days', () => {
    expect(computeEventSpanDays('2027-06-18', '2027-06-19')).toBe(1);
  });

  it('returns 10 for the bug-report span (Jun 18 -> Jun 28)', () => {
    expect(computeEventSpanDays('2027-06-18', '2027-06-28')).toBe(10);
  });

  it('handles long multi-month spans without drift', () => {
    // 2027-06-18 -> 2027-12-18 is 183 days
    expect(computeEventSpanDays('2027-06-18', '2027-12-18')).toBe(183);
  });

  it('is unaffected by a DST boundary (spring forward)', () => {
    // US DST 2027 starts Mar 14. Feb 28 -> Mar 28 must be exactly 28 days.
    expect(computeEventSpanDays('2027-02-28', '2027-03-28')).toBe(28);
  });

  it('handles the leap-year Feb boundary', () => {
    // 2028 is a leap year: Feb 28 -> Mar 1 spans Feb 29, so 2 days.
    expect(computeEventSpanDays('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('returns 0 for empty or null inputs', () => {
    expect(computeEventSpanDays('', '')).toBe(0);
    expect(computeEventSpanDays(null, null)).toBe(0);
    expect(computeEventSpanDays('2027-06-18', '')).toBe(0);
    expect(computeEventSpanDays('', '2027-06-28')).toBe(0);
  });

  it('returns 0 (not negative) when end is before start', () => {
    expect(computeEventSpanDays('2027-06-28', '2027-06-18')).toBe(0);
  });
});

describe('formatDateSpanLabel', () => {
  it('returns null for a same-day event', () => {
    expect(formatDateSpanLabel('2027-06-18', '2027-06-18')).toBeNull();
  });

  it('returns null for empty inputs', () => {
    expect(formatDateSpanLabel('', '')).toBeNull();
    expect(formatDateSpanLabel(null, null)).toBeNull();
  });

  it('formats a same-year multi-day span with a day count', () => {
    expect(formatDateSpanLabel('2027-06-18', '2027-06-28')).toBe('Jun 18 – Jun 28 · 10 days');
  });

  it('uses a singular "day" for a one-day span', () => {
    expect(formatDateSpanLabel('2027-06-18', '2027-06-19')).toBe('Jun 18 – Jun 19 · 1 day');
  });

  it('includes the year when the span crosses a year boundary', () => {
    expect(formatDateSpanLabel('2027-12-28', '2028-01-05')).toBe('Dec 28, 2027 – Jan 5, 2028 · 8 days');
  });

  it('appends a long-span note past 30 days', () => {
    const label = formatDateSpanLabel('2027-06-18', '2027-12-18'); // 183 days
    expect(label).toContain('183 days');
    expect(label).toContain('(long multi-day event)');
  });
});

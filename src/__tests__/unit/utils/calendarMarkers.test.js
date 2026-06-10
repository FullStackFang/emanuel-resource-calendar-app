import { describe, it, expect } from 'vitest';
import {
  buildMarkersByDate,
  getMarkersForDate,
  toLocalDateKey,
  getMarkerRibbonColors,
} from '../../../utils/calendarMarkers';

const holiday = (over = {}) => ({ _id: 'h1', type: 'holiday', name: 'Rosh Hashanah', startDate: '2026-09-12', endDate: '2026-09-12', ...over });
const closed = (over = {}) => ({ _id: 'c1', type: 'officeClosed', name: 'Office Closed', startDate: '2026-09-12', endDate: '2026-09-12', ...over });

describe('toLocalDateKey', () => {
  it('formats a local Date as YYYY-MM-DD (local, not UTC)', () => {
    // A morning local time — local Y/M/D must be used, not toISOString.
    expect(toLocalDateKey(new Date(2026, 8, 12, 9, 0, 0))).toBe('2026-09-12');
  });
  it('returns empty string for an invalid date', () => {
    expect(toLocalDateKey(null)).toBe('');
    expect(toLocalDateKey(new Date('nope'))).toBe('');
  });
});

describe('buildMarkersByDate', () => {
  it('keys a single-day marker on its date', () => {
    const map = buildMarkersByDate([holiday()]);
    expect(map.get('2026-09-12')).toHaveLength(1);
    expect(map.get('2026-09-12')[0].name).toBe('Rosh Hashanah');
  });

  it('repeats a multi-day marker on every day in its inclusive range', () => {
    const map = buildMarkersByDate([holiday({ startDate: '2026-09-12', endDate: '2026-09-15' })]);
    expect(map.get('2026-09-12')).toHaveLength(1);
    expect(map.get('2026-09-13')).toHaveLength(1);
    expect(map.get('2026-09-14')).toHaveLength(1);
    expect(map.get('2026-09-15')).toHaveLength(1);
    expect(map.get('2026-09-16')).toBeUndefined(); // endDate is inclusive; no spill
  });

  it('accumulates multiple markers on the same day', () => {
    const map = buildMarkersByDate([holiday(), closed()]);
    expect(map.get('2026-09-12')).toHaveLength(2);
  });

  it('crosses a month boundary correctly', () => {
    const map = buildMarkersByDate([holiday({ startDate: '2026-01-31', endDate: '2026-02-01' })]);
    expect(map.has('2026-01-31')).toBe(true);
    expect(map.has('2026-02-01')).toBe(true);
  });

  it('skips invalid / inverted ranges', () => {
    const map = buildMarkersByDate([holiday({ startDate: '2026-09-20', endDate: '2026-09-12' })]);
    expect(map.size).toBe(0);
  });

  it('tolerates non-array input', () => {
    expect(buildMarkersByDate(null).size).toBe(0);
    expect(buildMarkersByDate(undefined).size).toBe(0);
  });
});

describe('getMarkersForDate', () => {
  it('looks up by a local Date object', () => {
    const map = buildMarkersByDate([holiday()]);
    const found = getMarkersForDate(map, new Date(2026, 8, 12, 9, 0, 0));
    expect(found).toHaveLength(1);
  });
  it('looks up by a YYYY-MM-DD string', () => {
    const map = buildMarkersByDate([holiday()]);
    expect(getMarkersForDate(map, '2026-09-12')).toHaveLength(1);
  });
  it('returns [] for an unmarked day', () => {
    const map = buildMarkersByDate([holiday()]);
    expect(getMarkersForDate(map, '2026-09-13')).toEqual([]);
  });
});

describe('getMarkerRibbonColors', () => {
  // Option C (dot + adaptive label): the semantic color lives in a small dot;
  // the label text inherits a per-variant contrast color from CSS, so the helper
  // only needs to resolve the dot color (background-independent on any surface).
  it('holiday → gold dot', () => {
    expect(getMarkerRibbonColors(holiday()).dot).toBe('var(--color-accent-500)');
  });
  it('officeClosed → red dot', () => {
    expect(getMarkerRibbonColors(closed()).dot).toBe('var(--color-error-500)');
  });
  it('honors a per-marker color override for the dot', () => {
    expect(getMarkerRibbonColors(holiday({ color: '#123456' })).dot).toBe('#123456');
  });
  it('falls back to the holiday dot for an unknown type', () => {
    expect(getMarkerRibbonColors({ type: 'whatever' }).dot).toBe('var(--color-accent-500)');
  });
});

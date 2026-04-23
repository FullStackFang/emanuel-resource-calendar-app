// src/__tests__/unit/utils/calendarRangeUtils.test.js

import { describe, it, expect } from 'vitest';
import { isEventInDateRange } from '../../../utils/calendarRangeUtils';

const MONTH_START = new Date('2026-04-01T00:00:00');
const MONTH_END   = new Date('2026-05-01T00:00:00');
const RANGE = { start: MONTH_START, end: MONTH_END };

describe('isEventInDateRange', () => {
  it('returns true for an event strictly inside the range', () => {
    expect(isEventInDateRange('2026-04-15T10:00:00', RANGE)).toBe(true);
  });

  it('returns true at the inclusive start boundary', () => {
    expect(isEventInDateRange('2026-04-01T00:00:00', RANGE)).toBe(true);
  });

  it('returns false at the exclusive end boundary', () => {
    expect(isEventInDateRange('2026-05-01T00:00:00', RANGE)).toBe(false);
  });

  it('returns false for an event after the range (3 months ahead)', () => {
    expect(isEventInDateRange('2026-07-15T10:00:00', RANGE)).toBe(false);
  });

  it('returns false for an event before the range', () => {
    expect(isEventInDateRange('2026-03-15T10:00:00', RANGE)).toBe(false);
  });

  it('accepts a Date instance as startDateTime', () => {
    expect(isEventInDateRange(new Date('2026-04-15T10:00:00'), RANGE)).toBe(true);
    expect(isEventInDateRange(new Date('2026-07-15T10:00:00'), RANGE)).toBe(false);
  });

  it('returns true (include) when dateRange is missing — caller handles fallback', () => {
    expect(isEventInDateRange('2026-04-15T10:00:00', null)).toBe(true);
    expect(isEventInDateRange('2026-04-15T10:00:00', undefined)).toBe(true);
    expect(isEventInDateRange('2026-04-15T10:00:00', {})).toBe(true);
  });

  it('returns true (include) when startDateTime is missing', () => {
    expect(isEventInDateRange(null, RANGE)).toBe(true);
    expect(isEventInDateRange(undefined, RANGE)).toBe(true);
    expect(isEventInDateRange('', RANGE)).toBe(true);
  });

  it('returns true (include) for an unparseable startDateTime', () => {
    expect(isEventInDateRange('not-a-date', RANGE)).toBe(true);
  });

  it('returns false only when the date is definitively outside a well-formed range', () => {
    // Safety default: the guard exists to suppress transient ghost entries,
    // not to silently drop events when we're uncertain. Unclear inputs
    // should fall through to "include" and let downstream code handle.
    expect(isEventInDateRange('2026-04-15', RANGE)).toBe(true);
    expect(isEventInDateRange('2026-07-15', RANGE)).toBe(false);
  });
});

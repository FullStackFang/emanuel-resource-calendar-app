// src/__tests__/unit/utils/transformRecurrenceForGraphAPI.test.js
import { describe, it, expect } from 'vitest';
import { transformRecurrenceForGraphAPI } from '../../../utils/recurrenceUtils';

/**
 * The frontend Graph transform (used by Calendar.jsx handleSaveApiEvent) must
 * emit a dayOfMonth for absoluteMonthly/absoluteYearly patterns, or Graph
 * rejects the create with "DayOfMonth should be between 1 and 31." It must both
 * forward an explicit dayOfMonth and derive one from range.startDate when absent.
 */
describe('transformRecurrenceForGraphAPI - dayOfMonth handling', () => {
  it('returns null for missing pattern/range', () => {
    expect(transformRecurrenceForGraphAPI(null)).toBeNull();
    expect(transformRecurrenceForGraphAPI({ pattern: { type: 'monthly' } })).toBeNull();
  });

  it('maps monthly -> absoluteMonthly', () => {
    const out = transformRecurrenceForGraphAPI(
      { pattern: { type: 'monthly', interval: 1 }, range: { type: 'endDate', startDate: '2026-03-15', endDate: '2026-12-15' } }
    );
    expect(out.pattern.type).toBe('absoluteMonthly');
  });

  it('derives dayOfMonth from range.startDate when the pattern omits it', () => {
    const out = transformRecurrenceForGraphAPI(
      { pattern: { type: 'monthly', interval: 1, firstDayOfWeek: 'sunday' }, range: { type: 'endDate', startDate: '2026-09-30', endDate: '2026-09-30' } }
    );
    expect(out.pattern.type).toBe('absoluteMonthly');
    expect(out.pattern.dayOfMonth).toBe(30);
  });

  it('forwards an explicit dayOfMonth instead of dropping it', () => {
    const out = transformRecurrenceForGraphAPI(
      { pattern: { type: 'monthly', interval: 1, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-09-30' } }
    );
    expect(out.pattern.dayOfMonth).toBe(15);
  });

  it('derives month AND dayOfMonth for yearly patterns', () => {
    const out = transformRecurrenceForGraphAPI(
      { pattern: { type: 'yearly', interval: 1 }, range: { type: 'noEnd', startDate: '2026-03-15' } }
    );
    expect(out.pattern.type).toBe('absoluteYearly');
    expect(out.pattern.month).toBe(3);
    expect(out.pattern.dayOfMonth).toBe(15);
  });

  it('does not add dayOfMonth for weekly patterns', () => {
    const out = transformRecurrenceForGraphAPI(
      { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' }, range: { type: 'noEnd', startDate: '2026-03-10' } }
    );
    expect(out.pattern.type).toBe('weekly');
    expect(out.pattern.dayOfMonth).toBeUndefined();
    expect(out.pattern.firstDayOfWeek).toBe('sunday');
  });
});

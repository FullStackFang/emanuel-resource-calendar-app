/**
 * Tests for eventCreationDecision.js
 *
 * Regression guard for the "38 events a day" duplication bug: a recurring event
 * submitted WITH a multi-day date range must NOT fan out into one-event-per-day
 * batch creation (which created ~42 duplicate series masters). A recurrence
 * pattern IS the repeat mechanism; its range governs the span. The event itself
 * must be created as a single master collapsed to its start date.
 */

import { describe, it, expect } from 'vitest';
import { resolveCreationPlan, collapseRecurringEndDate } from '../../../utils/eventCreationDecision';

const WEEKLY_MON_FRI = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
  range: { type: 'endDate', startDate: '2026-06-01', endDate: '2026-09-01' },
};

describe('resolveCreationPlan', () => {
  describe('without recurrence', () => {
    it('single-day range is NOT a batch', () => {
      const plan = resolveCreationPlan({ startDate: '2026-06-01', endDate: '2026-06-01' });
      expect(plan.isBatch).toBe(false);
      expect(plan.hasRecurrence).toBe(false);
    });

    it('multi-day range IS a batch', () => {
      const plan = resolveCreationPlan({ startDate: '2026-06-01', endDate: '2026-06-05' });
      expect(plan.isBatch).toBe(true);
    });

    it('ad-hoc dates make it a batch even on a single-day range', () => {
      const plan = resolveCreationPlan({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        adHocDates: ['2026-06-10'],
      });
      expect(plan.isBatch).toBe(true);
    });

    it('preserves the end date for a non-recurring multi-day event', () => {
      const plan = resolveCreationPlan({ startDate: '2026-06-01', endDate: '2026-06-05' });
      expect(plan.startDate).toBe('2026-06-01');
      expect(plan.endDate).toBe('2026-06-05');
    });
  });

  describe('with recurrence (the bug scenario)', () => {
    it('multi-day range + recurrence is NOT a batch', () => {
      const plan = resolveCreationPlan({
        startDate: '2026-06-01',
        endDate: '2026-09-01',
        recurrence: WEEKLY_MON_FRI,
      });
      expect(plan.hasRecurrence).toBe(true);
      expect(plan.isBatch).toBe(false);
    });

    it('ad-hoc dates + recurrence is NOT a batch', () => {
      const plan = resolveCreationPlan({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        adHocDates: ['2026-06-10', '2026-06-12'],
        recurrence: WEEKLY_MON_FRI,
      });
      expect(plan.isBatch).toBe(false);
    });

    it('collapses the end date to the start date so the master is a single occurrence', () => {
      const plan = resolveCreationPlan({
        startDate: '2026-06-01',
        endDate: '2026-09-01',
        recurrence: WEEKLY_MON_FRI,
      });
      expect(plan.startDate).toBe('2026-06-01');
      expect(plan.endDate).toBe('2026-06-01');
    });

    it('treats an incomplete recurrence (pattern but no range) as no recurrence', () => {
      const plan = resolveCreationPlan({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        recurrence: { pattern: { type: 'weekly' } },
      });
      expect(plan.hasRecurrence).toBe(false);
      expect(plan.isBatch).toBe(true);
    });
  });
});

describe('collapseRecurringEndDate', () => {
  it('returns the start date when recurrence is active and a stale multi-day range lingers', () => {
    expect(collapseRecurringEndDate({ hasRecurrence: true, startDate: '2026-06-01', endDate: '2026-09-01' }))
      .toBe('2026-06-01');
  });

  it('returns null (no change) when recurrence is off', () => {
    expect(collapseRecurringEndDate({ hasRecurrence: false, startDate: '2026-06-01', endDate: '2026-09-01' }))
      .toBeNull();
  });

  it('returns null when the end date already equals the start date', () => {
    expect(collapseRecurringEndDate({ hasRecurrence: true, startDate: '2026-06-01', endDate: '2026-06-01' }))
      .toBeNull();
  });

  it('returns null when there is no start date to collapse to', () => {
    expect(collapseRecurringEndDate({ hasRecurrence: true, startDate: '', endDate: '2026-09-01' }))
      .toBeNull();
  });
});

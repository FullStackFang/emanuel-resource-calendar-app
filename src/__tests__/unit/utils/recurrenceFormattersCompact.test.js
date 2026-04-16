/**
 * Tests for formatRecurrenceSummaryCompact from recurrenceUtils.js
 *
 * Compact single-line format used by the read-only recurrence summary
 * on occurrence views. Coexists with the existing formatRecurrenceSummary
 * (which produces multi-line "Occurs every M, W\nUntil ..." text for the
 * editable tab and the pattern modal).
 *
 * Spec: openspec/changes/recurring-event-date-semantics/specs/recurring-event-dates/spec.md
 */

import { describe, it, expect } from 'vitest';
import { formatRecurrenceSummaryCompact } from '../../../utils/recurrenceUtils';

describe('formatRecurrenceSummaryCompact', () => {
  describe('pattern rendering', () => {
    it('renders daily (interval=1) as "Daily"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'daily', interval: 1 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-20' }
      );
      expect(result).toContain('Daily');
    });

    it('renders daily with interval > 1 as "Every N days"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'daily', interval: 3 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-05-15' }
      );
      expect(result).toContain('Every 3 days');
      expect(result).not.toContain('Daily');
    });

    it('renders weekly single day as "Weekly on Wednesdays"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
      );
      expect(result).toContain('Weekly on Wednesdays');
    });

    it('renders weekly multiple days joined with "and"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
        { type: 'numbered', startDate: '2026-04-15', numberOfOccurrences: 8 }
      );
      expect(result).toContain('Weekly');
      expect(result).toContain('Mondays');
      expect(result).toContain('Wednesdays');
      expect(result).toMatch(/Mondays\s+and\s+Wednesdays|Mondays,\s+Wednesdays/);
    });

    it('renders weekly with interval > 1 as "Every N weeks on Xs"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 2, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-06-10' }
      );
      expect(result).toContain('Every 2 weeks on Wednesdays');
      expect(result).not.toMatch(/^Weekly /);
    });

    it('renders monthly as "Monthly on day N"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'monthly', interval: 1, dayOfMonth: 15 },
        { type: 'noEnd', startDate: '2026-04-15' }
      );
      expect(result).toContain('Monthly');
      expect(result).toContain('day 15');
    });

    it('renders monthly with interval > 1 as "Every N months"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'monthly', interval: 3, dayOfMonth: 1 },
        { type: 'endDate', startDate: '2026-04-01', endDate: '2027-04-01' }
      );
      expect(result).toContain('Every 3 months');
    });

    it('renders yearly as "Yearly on <Month> <day>"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'yearly', interval: 1, month: 4, dayOfMonth: 15 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2030-04-15' }
      );
      expect(result).toContain('Yearly');
      expect(result).toContain('April 15');
    });

    it('treats absoluteMonthly as monthly', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'absoluteMonthly', interval: 1, dayOfMonth: 10 },
        { type: 'noEnd', startDate: '2026-04-10' }
      );
      expect(result).toContain('Monthly');
    });

    it('treats absoluteYearly as yearly', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'absoluteYearly', interval: 1, month: 6, dayOfMonth: 21 },
        { type: 'noEnd', startDate: '2026-06-21' }
      );
      expect(result).toContain('Yearly');
      expect(result).toContain('June 21');
    });
  });

  describe('range rendering', () => {
    it('endDate range produces full date pair with EN-DASH', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'daily', interval: 1 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-20' }
      );
      expect(result).toContain('4/15/2026');
      expect(result).toContain('4/20/2026');
      expect(result).toContain('\u2013'); // EN-DASH U+2013
    });

    it('numbered range appends start date and occurrence count', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        { type: 'numbered', startDate: '2026-04-15', numberOfOccurrences: 8 }
      );
      expect(result).toContain('4/15/2026');
      expect(result).toContain('8 occurrences');
    });

    it('numbered range with 1 occurrence uses singular "occurrence"', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        { type: 'numbered', startDate: '2026-04-15', numberOfOccurrences: 1 }
      );
      expect(result).toContain('1 occurrence');
      expect(result).not.toContain('1 occurrences');
    });

    it('noEnd range appends "starting <date>" with no end delimiter', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'monthly', interval: 1, dayOfMonth: 15 },
        { type: 'noEnd', startDate: '2026-04-15' }
      );
      expect(result).toContain('starting 4/15/2026');
      expect(result).not.toContain('\u2013'); // no EN-DASH between two dates
    });
  });

  describe('additions and exclusions tail', () => {
    it('appends "(+N added, M excluded)" when both arrays non-empty', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' },
        ['2026-05-04'],
        ['2026-04-22', '2026-04-29']
      );
      expect(result).toContain('(+1 added, 2 excluded)');
    });

    it('appends only "+N added" when only additions present', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' },
        ['2026-05-04', '2026-05-11'],
        []
      );
      expect(result).toContain('(+2 added)');
      expect(result).not.toContain('excluded');
    });

    it('appends only "N excluded" when only exclusions present', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' },
        [],
        ['2026-04-22']
      );
      expect(result).toContain('(1 excluded)');
      expect(result).not.toContain('added');
    });

    it('omits tail when both arrays are empty', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' },
        [],
        []
      );
      expect(result).not.toContain('(');
      expect(result).not.toContain(')');
    });

    it('omits tail when additions and exclusions arguments are undefined (default)', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
      );
      expect(result).not.toContain('added');
      expect(result).not.toContain('excluded');
    });
  });

  describe('full-string format guarantees', () => {
    it('daily + endDate produces canonical full string', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'daily', interval: 1 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-20' }
      );
      expect(result).toBe('Daily, 4/15/2026 \u2013 4/20/2026');
    });

    it('weekly single day + endDate produces canonical full string', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
      );
      expect(result).toBe('Weekly on Wednesdays, 4/15/2026 \u2013 4/30/2026');
    });

    it('yearly + endDate produces canonical full string', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'yearly', interval: 1, month: 4, dayOfMonth: 15 },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2030-04-15' }
      );
      expect(result).toBe('Yearly on April 15, 4/15/2026 \u2013 4/15/2030');
    });

    it('monthly + noEnd produces canonical full string', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'monthly', interval: 1, dayOfMonth: 15 },
        { type: 'noEnd', startDate: '2026-04-15' }
      );
      expect(result).toBe('Monthly on day 15, starting 4/15/2026');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for null pattern', () => {
      expect(formatRecurrenceSummaryCompact(null, null)).toBe('');
    });

    it('returns empty string for undefined pattern', () => {
      expect(formatRecurrenceSummaryCompact(undefined, undefined)).toBe('');
    });

    it('gracefully handles weekly pattern with empty daysOfWeek (falls back to generic "Weekly")', () => {
      const result = formatRecurrenceSummaryCompact(
        { type: 'weekly', interval: 1, daysOfWeek: [] },
        { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
      );
      expect(result).toContain('Weekly');
    });
  });
});

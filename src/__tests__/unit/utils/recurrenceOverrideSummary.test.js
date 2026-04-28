/**
 * Tests for recurrenceOverrideSummary helpers.
 *
 * These pure helpers feed the My Reservations recurring card: they merge
 * occurrenceOverrides + recurrence.exclusions + recurrence.additions into a
 * single sorted variants list, tally counts by kind, and produce chip text.
 */

import { describe, it, expect } from 'vitest';
import {
  describeOverrideChanges,
  buildOccurrenceVariants,
  getOverrideStats,
  formatOverrideChipText,
} from '../../../utils/recurrenceOverrideSummary';

const seriesMaster = (extra = {}) => ({
  eventType: 'seriesMaster',
  occurrenceOverrides: [],
  recurrence: { pattern: { type: 'weekly' }, range: { type: 'noEnd' }, additions: [], exclusions: [] },
  ...extra,
});

describe('describeOverrideChanges', () => {
  it('returns "No changes" for an empty override', () => {
    expect(describeOverrideChanges({ occurrenceDate: '2026-05-01' })).toBe('No changes');
  });

  it('describes a time-only change', () => {
    expect(describeOverrideChanges({ occurrenceDate: '2026-05-01', startTime: '10:00' })).toBe('Time changed');
  });

  it('collapses startTime+endTime into a single Time token', () => {
    expect(
      describeOverrideChanges({ occurrenceDate: '2026-05-01', startTime: '10:00', endTime: '11:00' })
    ).toBe('Time changed');
  });

  it('describes a title-only change', () => {
    expect(
      describeOverrideChanges({ occurrenceDate: '2026-05-01', eventTitle: 'New title' })
    ).toBe('Title changed');
  });

  it('joins exactly two distinct tokens with " + "', () => {
    expect(
      describeOverrideChanges({ occurrenceDate: '2026-05-01', eventTitle: 'X', locations: ['a'] })
    ).toBe('Title + Location changed');
  });

  it('truncates beyond two tokens with " and N more"', () => {
    const result = describeOverrideChanges({
      occurrenceDate: '2026-05-01',
      eventTitle: 'X',
      locations: ['a'],
      categories: ['Worship'],
      attendeeCount: 50,
    });
    expect(result).toMatch(/^Title \+ Location and 2 more$/);
  });

  it('passes status changes through with the Status token', () => {
    expect(
      describeOverrideChanges({ occurrenceDate: '2026-05-01', status: 'rejected' })
    ).toBe('Status changed');
  });

  it('returns "No changes" for null / undefined input', () => {
    expect(describeOverrideChanges(null)).toBe('No changes');
    expect(describeOverrideChanges(undefined)).toBe('No changes');
  });
});

describe('buildOccurrenceVariants', () => {
  it('returns [] for missing reservation', () => {
    expect(buildOccurrenceVariants(null)).toEqual([]);
  });

  it('returns [] for a master with no deviations', () => {
    expect(buildOccurrenceVariants(seriesMaster())).toEqual([]);
  });

  it('marks an override row outside additions[] as modified', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [{ occurrenceDate: '2026-05-04', startTime: '10:00' }],
    }));
    expect(variants).toEqual([
      expect.objectContaining({ occurrenceDate: '2026-05-04', kind: 'modified', label: 'Time changed' }),
    ]);
  });

  it('marks an override row whose date is in recurrence.additions as added', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [{ occurrenceDate: '2026-05-10', startTime: '09:00' }],
      recurrence: { pattern: { type: 'weekly' }, range: {}, additions: ['2026-05-10'], exclusions: [] },
    }));
    expect(variants).toEqual([
      expect.objectContaining({ occurrenceDate: '2026-05-10', kind: 'added', label: 'Added occurrence' }),
    ]);
  });

  it('treats status:deleted overrides as cancelled regardless of additions', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [{ occurrenceDate: '2026-05-04', status: 'deleted' }],
    }));
    expect(variants).toEqual([
      expect.objectContaining({ occurrenceDate: '2026-05-04', kind: 'cancelled' }),
    ]);
  });

  it('emits cancelled rows from recurrence.exclusions even when no override exists', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      recurrence: { pattern: {}, range: {}, additions: [], exclusions: ['2026-05-11'] },
    }));
    expect(variants).toEqual([
      expect.objectContaining({ occurrenceDate: '2026-05-11', kind: 'cancelled', label: 'Cancelled' }),
    ]);
  });

  it('does not double-count an exclusion that also has an override', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [{ occurrenceDate: '2026-05-04', status: 'deleted' }],
      recurrence: { pattern: {}, range: {}, additions: [], exclusions: ['2026-05-04'] },
    }));
    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual(expect.objectContaining({ kind: 'cancelled' }));
  });

  it('emits an added row from recurrence.additions when no override entry exists for it', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [],
      recurrence: { pattern: {}, range: {}, additions: ['2026-05-15'], exclusions: [] },
    }));
    expect(variants).toEqual([
      expect.objectContaining({ occurrenceDate: '2026-05-15', kind: 'added' }),
    ]);
  });

  it('sorts variants by occurrenceDate ascending', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [
        { occurrenceDate: '2026-06-01', startTime: '10:00' },
        { occurrenceDate: '2026-04-15', eventTitle: 'X' },
      ],
      recurrence: { pattern: {}, range: {}, additions: [], exclusions: ['2026-05-10'] },
    }));
    expect(variants.map(v => v.occurrenceDate)).toEqual([
      '2026-04-15', '2026-05-10', '2026-06-01',
    ]);
  });

  it('skips override entries without an occurrenceDate', () => {
    const variants = buildOccurrenceVariants(seriesMaster({
      occurrenceOverrides: [{ startTime: '10:00' }, { occurrenceDate: '2026-05-04', eventTitle: 'X' }],
    }));
    expect(variants).toHaveLength(1);
    expect(variants[0].occurrenceDate).toBe('2026-05-04');
  });
});

describe('getOverrideStats', () => {
  it('returns all-zero stats for empty input', () => {
    expect(getOverrideStats([])).toEqual({ total: 0, modified: 0, added: 0, cancelled: 0 });
  });

  it('handles non-array input gracefully', () => {
    expect(getOverrideStats(null)).toEqual({ total: 0, modified: 0, added: 0, cancelled: 0 });
  });

  it('counts a mixed list correctly', () => {
    const variants = [
      { occurrenceDate: '2026-05-04', kind: 'modified' },
      { occurrenceDate: '2026-05-11', kind: 'cancelled' },
      { occurrenceDate: '2026-05-18', kind: 'added' },
      { occurrenceDate: '2026-05-25', kind: 'modified' },
    ];
    expect(getOverrideStats(variants)).toEqual({ total: 4, modified: 2, added: 1, cancelled: 1 });
  });
});

describe('formatOverrideChipText', () => {
  it('returns empty string when total is zero', () => {
    expect(formatOverrideChipText({ total: 0, modified: 0, added: 0, cancelled: 0 })).toBe('');
  });

  it('renders single-kind text for a homogeneous batch', () => {
    expect(formatOverrideChipText({ total: 3, modified: 3, added: 0, cancelled: 0 })).toBe('3 modified');
    expect(formatOverrideChipText({ total: 2, modified: 0, added: 0, cancelled: 2 })).toBe('2 cancelled');
    expect(formatOverrideChipText({ total: 1, modified: 0, added: 1, cancelled: 0 })).toBe('1 added');
  });

  it('joins nonzero kinds with " · " when mixed', () => {
    expect(
      formatOverrideChipText({ total: 5, modified: 3, added: 1, cancelled: 1 })
    ).toBe('3 modified · 1 cancelled · 1 added');
  });

  it('omits zero-count kinds in mixed output', () => {
    expect(
      formatOverrideChipText({ total: 4, modified: 3, added: 0, cancelled: 1 })
    ).toBe('3 modified · 1 cancelled');
  });
});

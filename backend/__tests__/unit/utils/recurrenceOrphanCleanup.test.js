const { findOrphanedOverrides } = require('../../../utils/recurrenceOrphanCleanup');

// We test the pure helper, not the DB-touching cleanup function.
// findOrphanedOverrides(newRecurrence, overrideDocs) returns the subset of overrideDocs whose
// occurrenceDate is NOT in the new expansion (for exceptions) or IS in it (for additions).

describe('findOrphanedOverrides', () => {
  test('returns empty when override dates all fall within new pattern', () => {
    const newRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-27', eventType: 'exception' },
      { _id: '2', occurrenceDate: '2026-05-04', eventType: 'exception' },
    ];
    expect(findOrphanedOverrides(newRecurrence, overrides)).toEqual([]);
  });

  test('returns overrides whose date is not in new expansion', () => {
    const newRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-22', eventType: 'exception' },  // Wednesday -- orphaned
      { _id: '2', occurrenceDate: '2026-04-27', eventType: 'exception' },  // Monday -- kept
    ];
    const orphans = findOrphanedOverrides(newRecurrence, overrides);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]._id).toBe('1');
  });

  test('addition docs follow inverse rule -- orphaned when date IS now in pattern (becomes redundant)', () => {
    // An "addition" is a date NOT in the pattern. If the new pattern now includes it,
    // the addition is redundant and should be cleaned up.
    const newRecurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-22', eventType: 'addition' },
    ];
    const orphans = findOrphanedOverrides(newRecurrence, overrides);
    expect(orphans).toHaveLength(1);
  });

  test('handles empty override list', () => {
    const newRecurrence = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(findOrphanedOverrides(newRecurrence, [])).toEqual([]);
  });

  test('returns empty when newRecurrence is null', () => {
    expect(findOrphanedOverrides(null, [{ _id: '1', occurrenceDate: '2026-04-27', eventType: 'exception' }])).toEqual([]);
  });
});

const { recurrenceEquals, exclusionsRemoved } = require('../../../utils/recurrenceCompare');

describe('recurrenceEquals (backend)', () => {
  test('null vs null is equal', () => {
    expect(recurrenceEquals(null, null)).toBe(true);
  });

  test('null vs populated is not equal', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(null, r)).toBe(false);
  });

  test('daysOfWeek order does not matter', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  test('range.endDate change is not equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-30' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-30' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  test('exclusion list set-equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22', '2026-04-25'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-25', '2026-04-22'] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  test('additions order does not matter', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, additions: ['2026-04-23', '2026-04-26'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, additions: ['2026-04-26', '2026-04-23'] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  test('missing arrays equal empty arrays', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: [], additions: [] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });
});

// dayOfMonth/month for monthly/yearly patterns is derived from range.startDate
// when omitted (the app is migrating from implicit to explicit storage). The
// comparator must treat an explicit value as equal to the implicit one so that
// editing an older (no-dayOfMonth) series does not falsely flag a "recurrence
// changed" in the edit-request workflow.
describe('recurrenceEquals - dayOfMonth/month normalization', () => {
  test('monthly: implicit dayOfMonth (from startDate) equals explicit dayOfMonth', () => {
    const implicit = { pattern: { type: 'monthly', interval: 1 }, range: { type: 'endDate', startDate: '2026-09-30', endDate: '2026-09-30' } };
    const explicit = { pattern: { type: 'monthly', interval: 1, dayOfMonth: 30 }, range: { type: 'endDate', startDate: '2026-09-30', endDate: '2026-09-30' } };
    expect(recurrenceEquals(implicit, explicit)).toBe(true);
  });

  test('monthly: a genuinely different dayOfMonth is still not equal', () => {
    const implicit = { pattern: { type: 'monthly', interval: 1 }, range: { type: 'noEnd', startDate: '2026-09-30' } };
    const explicitDiff = { pattern: { type: 'monthly', interval: 1, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-09-30' } };
    expect(recurrenceEquals(implicit, explicitDiff)).toBe(false);
  });

  test('yearly: implicit month+dayOfMonth (from startDate) equals explicit', () => {
    const implicit = { pattern: { type: 'yearly', interval: 1 }, range: { type: 'noEnd', startDate: '2026-03-15' } };
    const explicit = { pattern: { type: 'yearly', interval: 1, month: 3, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-03-15' } };
    expect(recurrenceEquals(implicit, explicit)).toBe(true);
  });

  test('weekly: dayOfMonth is never derived (daysOfWeek still governs)', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] }, range: { type: 'noEnd', startDate: '2026-09-29' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] }, range: { type: 'noEnd', startDate: '2026-09-29' } };
    expect(recurrenceEquals(a, b)).toBe(true);
  });
});

describe('exclusionsRemoved', () => {
  test('returns dates that were in old but not in new', () => {
    const oldR = { exclusions: ['2026-04-22', '2026-04-25'] };
    const newR = { exclusions: ['2026-04-22'] };
    expect(exclusionsRemoved(oldR, newR)).toEqual(['2026-04-25']);
  });

  test('returns empty when new is a superset', () => {
    const oldR = { exclusions: ['2026-04-22'] };
    const newR = { exclusions: ['2026-04-22', '2026-04-29'] };
    expect(exclusionsRemoved(oldR, newR)).toEqual([]);
  });

  test('handles missing arrays as empty', () => {
    expect(exclusionsRemoved({}, {})).toEqual([]);
    expect(exclusionsRemoved({ exclusions: ['2026-04-22'] }, {})).toEqual(['2026-04-22']);
    expect(exclusionsRemoved({}, { exclusions: ['2026-04-22'] })).toEqual([]);
  });

  test('handles null inputs', () => {
    expect(exclusionsRemoved(null, null)).toEqual([]);
    expect(exclusionsRemoved(null, { exclusions: ['x'] })).toEqual([]);
    expect(exclusionsRemoved({ exclusions: ['x'] }, null)).toEqual(['x']);
  });
});

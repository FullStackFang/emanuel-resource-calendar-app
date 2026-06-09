const { buildGraphRecurrence } = require('../../../utils/recurrenceGraphMapping');

/**
 * Graph requires absoluteMonthly/absoluteYearly patterns to carry a dayOfMonth
 * (1-31), and absoluteYearly to also carry a month (1-12). The app's internal
 * recurrence format omits these (its own expander derives them from
 * range.startDate), so buildGraphRecurrence must fill them in or Graph rejects
 * the create with "DayOfMonth should be between 1 and 31."
 */
describe('buildGraphRecurrence - dayOfMonth/month derivation', () => {
  test('returns null when pattern or range is missing', () => {
    expect(buildGraphRecurrence(null, 'America/New_York')).toBeNull();
    expect(buildGraphRecurrence({ pattern: { type: 'monthly' } }, 'America/New_York')).toBeNull();
    expect(buildGraphRecurrence({ range: { startDate: '2026-10-06' } }, 'America/New_York')).toBeNull();
  });

  test('maps monthly -> absoluteMonthly (type mapping preserved)', () => {
    const result = buildGraphRecurrence(
      { pattern: { type: 'monthly', interval: 1 }, range: { type: 'endDate', startDate: '2026-03-15', endDate: '2026-12-15' } },
      'America/New_York'
    );
    expect(result.pattern.type).toBe('absoluteMonthly');
  });

  // The exact shape of the stuck "Men's Club Board of Directors Meeting" record:
  // monthly pattern with NO dayOfMonth, single-day range, plus ad-hoc additions.
  test('derives dayOfMonth from range.startDate for monthly pattern missing dayOfMonth', () => {
    const recurrence = {
      pattern: { type: 'monthly', interval: 1, firstDayOfWeek: 'sunday' },
      range: { type: 'endDate', startDate: '2026-10-06', endDate: '2026-10-06' },
      additions: ['2026-11-17', '2026-12-15'],
      exclusions: [],
    };
    const result = buildGraphRecurrence(recurrence, 'America/New_York');
    expect(result.pattern.type).toBe('absoluteMonthly');
    expect(result.pattern.dayOfMonth).toBe(6);
  });

  test('keeps explicit dayOfMonth (does not overwrite with derived value)', () => {
    const result = buildGraphRecurrence(
      { pattern: { type: 'monthly', interval: 1, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-10-06' } },
      'America/New_York'
    );
    expect(result.pattern.dayOfMonth).toBe(15);
  });

  test('derives month AND dayOfMonth from range.startDate for yearly pattern missing both', () => {
    const result = buildGraphRecurrence(
      { pattern: { type: 'yearly', interval: 1 }, range: { type: 'endDate', startDate: '2026-03-15', endDate: '2030-03-15' } },
      'America/New_York'
    );
    expect(result.pattern.type).toBe('absoluteYearly');
    expect(result.pattern.month).toBe(3);
    expect(result.pattern.dayOfMonth).toBe(15);
  });

  test('does NOT add dayOfMonth for weekly patterns', () => {
    const result = buildGraphRecurrence(
      { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' }, range: { type: 'noEnd', startDate: '2026-03-10' } },
      'America/New_York'
    );
    expect(result.pattern.type).toBe('weekly');
    expect(result.pattern.dayOfMonth).toBeUndefined();
    expect(result.pattern.firstDayOfWeek).toBe('sunday');
  });
});

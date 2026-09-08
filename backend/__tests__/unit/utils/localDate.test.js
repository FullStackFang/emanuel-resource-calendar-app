// backend/__tests__/unit/utils/localDate.test.js
//
// "Today" for wall-clock date strings. Sheet days are stored as YYYY-MM-DD in
// the temple's local calendar, so the bound they are compared against must be
// the local date too. `new Date().toISOString().slice(0, 10)` is the UTC
// date, which runs four to five hours AHEAD of New York every evening — an
// Erev service dated the 11th vanished from /api/my-assignments at 8 PM on
// the 11th, while people were on their way to it.
//
// Test IDs: LD-1 to LD-5

const { todayInZone, shiftDateString } = require('../../../utils/localDate');

describe('localDate', () => {
  test('LD-1: 8:30 PM EDT is still the same New York date although UTC has rolled over', () => {
    // 2026-09-12T00:30Z is 2026-09-11 20:30 in New York (UTC-4).
    expect(todayInZone('America/New_York', new Date('2026-09-12T00:30:00Z'))).toBe('2026-09-11');
  });

  test('LD-2: 11:30 PM EST in January (UTC-5) is still the previous UTC date', () => {
    expect(todayInZone('America/New_York', new Date('2027-01-15T04:30:00Z'))).toBe('2027-01-14');
  });

  test('LD-3: midday agrees with the UTC date', () => {
    expect(todayInZone('America/New_York', new Date('2026-09-11T16:00:00Z'))).toBe('2026-09-11');
  });

  test('LD-4: defaults to New York and to now, and yields a YYYY-MM-DD string', () => {
    expect(todayInZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('LD-5: shiftDateString moves by whole calendar days across month and year ends', () => {
    expect(shiftDateString('2026-03-02', -90)).toBe('2025-12-02');
    expect(shiftDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateString('2026-09-11', 0)).toBe('2026-09-11');
  });
});

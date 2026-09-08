/**
 * assignmentSchedule tests (AO-1 to AO-9)
 *
 * The per-recipient schedule used to sort by date and then COLUMN NAME, so a
 * 5:00 PM dinner under 'YP Dinner' printed after a 7:30 PM service under
 * 'Erev Service'. These pin the chronological comparator and the renderer it
 * feeds: date first, then the effective call time, with the same free-text
 * parsing and fallbacks the .ics attachment already uses.
 */

const {
  compareAssignments,
  sortAssignments,
  buildAssignmentsHtml,
  buildAssignmentSummary,
  displaySheetClock,
} = require('../../../utils/assignmentSchedule');

const entry = (over = {}) => ({
  date: '2027-09-11',
  rowLabel: 'Greeter',
  columnName: 'Erev Service',
  callTime: null,
  begins: null,
  ends: null,
  linkedSnapshot: null,
  ...over,
});

const names = (list) => list.map((e) => e.columnName);

describe('assignmentSchedule ordering (AO-1 to AO-8)', () => {
  test('AO-1 date sorts first, regardless of the times on each day', () => {
    const later = entry({ date: '2027-09-20', columnName: 'Morning', callTime: '8:00 AM' });
    const earlier = entry({ date: '2027-09-11', columnName: 'Night', callTime: '9:00 PM' });
    expect(names(sortAssignments([later, earlier]))).toEqual(['Night', 'Morning']);
  });

  test('AO-2 within a day, mixed free-text call times order by clock, not by column name', () => {
    // Alphabetical order would be Alef, Bet, Dalet, Gimel. Chronological is
    // 9:00 AM, 17:00, 5:30 (PM by the bare-time rule, so 17:30), 7:30 PM.
    const list = [
      entry({ columnName: 'Alef', callTime: '7:30 PM' }),
      entry({ columnName: 'Bet', callTime: '17:00' }),
      entry({ columnName: 'Gimel', callTime: '5:30' }),
      entry({ columnName: 'Dalet', callTime: '9:00 AM' }),
    ];
    expect(names(sortAssignments(list))).toEqual(['Dalet', 'Bet', 'Gimel', 'Alef']);
  });

  test('AO-3 a post with no call time is placed by its Begins time', () => {
    const list = [
      entry({ columnName: 'Service', callTime: '6:00 PM' }),
      entry({ columnName: 'Dinner', begins: '5:00 PM' }),
    ];
    expect(names(sortAssignments(list))).toEqual(['Dinner', 'Service']);
  });

  test('AO-4 a post whose time cells are prose falls back to the linked event start', () => {
    // 'after Mincha' cannot be parsed; the snapshot says 4:00 PM EDT (20:00Z).
    const list = [
      entry({ columnName: 'Service', callTime: '6:00 PM' }),
      entry({
        columnName: 'Study',
        callTime: 'after Mincha',
        linkedSnapshot: { startDateTime: '2027-09-11T20:00:00Z', endDateTime: '2027-09-11T21:00:00Z' },
      }),
    ];
    expect(names(sortAssignments(list))).toEqual(['Study', 'Service']);
  });

  test('AO-5 posts with no resolvable time sort after every timed post on that day', () => {
    const list = [
      entry({ columnName: 'Setup', callTime: 'TBD' }),
      entry({ columnName: 'Service', callTime: '9:00 PM' }),
      entry({ columnName: 'Doors' }),
    ];
    const sorted = names(sortAssignments(list));
    expect(sorted[0]).toBe('Service');
    expect(sorted.slice(1).sort()).toEqual(['Doors', 'Setup']);
  });

  test('AO-6 equal times fall back to column name, then row label', () => {
    const list = [
      entry({ columnName: 'Zeta', rowLabel: 'Usher', callTime: '5:00 PM' }),
      entry({ columnName: 'Alpha', rowLabel: 'Usher', callTime: '5:00 PM' }),
      entry({ columnName: 'Alpha', rowLabel: 'Greeter', callTime: '5:00 PM' }),
    ];
    expect(sortAssignments(list).map((e) => `${e.columnName}/${e.rowLabel}`)).toEqual([
      'Alpha/Greeter',
      'Alpha/Usher',
      'Zeta/Usher',
    ]);
  });

  test('AO-7 the comparator is antisymmetric and treats an identical pair as equal', () => {
    const a = entry({ columnName: 'A', callTime: '5:00 PM' });
    const b = entry({ columnName: 'B', callTime: '6:00 PM' });
    expect(compareAssignments(a, b)).toBeLessThan(0);
    expect(compareAssignments(b, a)).toBeGreaterThan(0);
    expect(compareAssignments(a, { ...a })).toBe(0);
  });

  test('AO-8 sortAssignments returns a new array and leaves the input untouched', () => {
    const list = [entry({ columnName: 'B', callTime: '6:00 PM' }), entry({ columnName: 'A', callTime: '5:00 PM' })];
    const sorted = sortAssignments(list);
    expect(sorted).not.toBe(list);
    expect(names(list)).toEqual(['B', 'A']);
    expect(names(sorted)).toEqual(['A', 'B']);
  });
});

describe('assignmentSchedule rendering (AO-9)', () => {
  test('AO-9 the renderer prints posts in the order it is given and the summary counts them', () => {
    const list = sortAssignments([
      entry({ columnName: 'Erev Service', callTime: '7:30 PM' }),
      entry({ columnName: 'YP Dinner', callTime: '5:00 PM' }),
      entry({ date: '2027-09-20', columnName: 'Kol Nidre', callTime: '17:30' }),
    ]);
    const html = buildAssignmentsHtml(list);
    expect(html.indexOf('YP Dinner')).toBeLessThan(html.indexOf('Erev Service'));
    expect(html.indexOf('Erev Service')).toBeLessThan(html.indexOf('Kol Nidre'));
    // A bare 24h override is shown on the 12h clock, alongside the free text.
    expect(html).toContain('5:30 PM');
    expect(displaySheetClock('17:30')).toBe('5:30 PM');
    expect(displaySheetClock('HD 4:30pm / Reg 4:45pm')).toBe('HD 4:30pm / Reg 4:45pm');
    expect(buildAssignmentSummary(list)).toBe('3 posts across 2 days, all in 2027');
  });
});

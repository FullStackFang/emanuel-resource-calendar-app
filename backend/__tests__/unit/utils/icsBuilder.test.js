/**
 * Unit tests for utils/icsBuilder.js
 *
 * The pure, deps-free RFC 5545 generator behind the schedule email's calendar
 * attachment. No database, no mail service, no server — format conformance,
 * free-text time resolution, the all-day fallback, DST-correct instants, and
 * UID/SEQUENCE identity. The endpoint wiring is covered by
 * integration/schedulingSheetEmail.test.js.
 *
 * Test IDs: ICS-1 through ICS-27
 */

const {
  parseCellTime,
  zonedWallClockToUtc,
  resolveEventWindow,
  escapeText,
  foldLine,
  buildUid,
  buildAssignmentsCalendar
} = require('../../../utils/icsBuilder');

// ---------------------------------------------------------------------------
// Helpers — entries shaped like extractDayAssignments() output.
// ---------------------------------------------------------------------------

function entry(overrides = {}) {
  return {
    email: 'sarah@x.org',
    name: 'Sarah',
    placeholder: false,
    dayId: 'day1',
    rowId: 'row1',
    colId: 'col1',
    sheetId: 'sheet1',
    date: '2026-09-11',
    dayTitle: 'Erev Rosh Hashanah',
    rowLabel: 'Ushers',
    columnName: 'Erev Service',
    callTime: null,
    begins: null,
    ends: null,
    location: null,
    locationLines: [],
    note: null,
    sequence: 3,
    linkedSnapshot: null,
    ...overrides
  };
}

/** Unfold a generated file back into logical lines, so assertions read plainly. */
function logicalLines(ics) {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

function valueOf(ics, name) {
  const line = logicalLines(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line == null ? null : line.slice(line.indexOf(':') + 1);
}

const DTSTAMP = new Date('2026-09-01T12:00:00Z');
const build = (entries, options = {}) => buildAssignmentsCalendar(entries, { dtstamp: DTSTAMP, ...options });

// ===========================================================================
// 1. Time parsing (design D4)
// ===========================================================================

describe('parseCellTime (ICS-1 to ICS-6)', () => {
  test('ICS-1 an explicit meridiem resolves on the 12-hour clock face', () => {
    expect(parseCellTime('6:00 PM')).toEqual({ hour: 18, minute: 0 });
    expect(parseCellTime('6:00pm')).toEqual({ hour: 18, minute: 0 });
    expect(parseCellTime('  6:00 p.m. ')).toEqual({ hour: 18, minute: 0 });
    expect(parseCellTime('7 AM')).toEqual({ hour: 7, minute: 0 });
    expect(parseCellTime('12:00 AM')).toEqual({ hour: 0, minute: 0 });
    expect(parseCellTime('12:30 PM')).toEqual({ hour: 12, minute: 30 });
  });

  test('ICS-2 a 24-hour HH:MM resolves as written', () => {
    expect(parseCellTime('17:30')).toEqual({ hour: 17, minute: 30 });
    expect(parseCellTime('00:15')).toEqual({ hour: 0, minute: 15 });
    expect(parseCellTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  // The documented ambiguity rule. Refusing bare times would push the common
  // case — what people actually type — into the all-day fallback.
  test('ICS-3 a bare evening time resolves PM', () => {
    expect(parseCellTime('5:30')).toEqual({ hour: 17, minute: 30 });
    expect(parseCellTime('1:00')).toEqual({ hour: 13, minute: 0 });
    expect(parseCellTime('6')).toEqual({ hour: 18, minute: 0 });
  });

  test('ICS-4 a bare morning time resolves AM, and bare noon stays noon', () => {
    expect(parseCellTime('9:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseCellTime('7:45')).toEqual({ hour: 7, minute: 45 });
    expect(parseCellTime('11:00')).toEqual({ hour: 11, minute: 0 });
    expect(parseCellTime('12:00')).toEqual({ hour: 12, minute: 0 });
  });

  test('ICS-5 prose, emptiness and nonsense are not times', () => {
    for (const value of ['after Mincha', 'TBD', '', '   ', null, undefined, 'HD 4:30pm / Reg 4:45pm', '5:30-8:00', '25:00', '13 PM', 'noon']) {
      expect(parseCellTime(value)).toBeNull();
    }
  });

  test('ICS-6 a minute outside 00-59 does not resolve', () => {
    expect(parseCellTime('5:60')).toBeNull();
    expect(parseCellTime('5:99')).toBeNull();
  });
});

// ===========================================================================
// 1.4 Wall clock to UTC (design D7)
// ===========================================================================

describe('zonedWallClockToUtc (ICS-7 to ICS-8)', () => {
  test('ICS-7 daylight time and standard time use the offset of their own date', () => {
    const edt = zonedWallClockToUtc('2026-09-11', 16, 30, 'America/New_York');
    const est = zonedWallClockToUtc('2026-12-11', 16, 30, 'America/New_York');
    expect(edt.toISOString()).toBe('2026-09-11T20:30:00.000Z');
    expect(est.toISOString()).toBe('2026-12-11T21:30:00.000Z');
    // The same wall-clock time, one hour apart in UTC: proof the offset is
    // looked up per-date rather than hard-coded.
    expect(est.getUTCHours() - edt.getUTCHours()).toBe(1);
  });

  test('ICS-8 an hour just after the spring-forward boundary resolves correctly', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT. 03:00 local is the first EDT hour.
    const after = zonedWallClockToUtc('2026-03-08', 3, 0, 'America/New_York');
    expect(after.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    const before = zonedWallClockToUtc('2026-03-08', 1, 0, 'America/New_York');
    expect(before.toISOString()).toBe('2026-03-08T06:00:00.000Z');
  });
});

// ===========================================================================
// 1.5 Window resolution (design D3)
// ===========================================================================

describe('resolveEventWindow (ICS-9 to ICS-14)', () => {
  test('ICS-9 the effective call time wins over the event start', () => {
    const w = resolveEventWindow(entry({ callTime: '16:30', begins: '6:00 PM', ends: '8:00 PM' }));
    expect(w.allDay).toBe(false);
    expect(w.start.toISOString()).toBe('2026-09-11T20:30:00.000Z'); // 4:30 PM EDT
    expect(w.end.toISOString()).toBe('2026-09-12T00:00:00.000Z'); // 8:00 PM EDT
  });

  test('ICS-10 with no call time the Begins cell starts the event', () => {
    const w = resolveEventWindow(entry({ begins: '7:00 PM', ends: '9:00 PM' }));
    expect(w.start.toISOString()).toBe('2026-09-11T23:00:00.000Z');
  });

  test('ICS-11 with neither, the linked snapshot start is used', () => {
    const w = resolveEventWindow(
      entry({
        begins: 'after Mincha',
        linkedSnapshot: { startDateTime: '2026-09-11T22:00:00Z', endDateTime: '2026-09-12T00:30:00Z' }
      })
    );
    expect(w.allDay).toBe(false);
    expect(w.start.toISOString()).toBe('2026-09-11T22:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-12T00:30:00.000Z');
  });

  test('ICS-12 an unresolvable end defaults to two hours after the start', () => {
    const w = resolveEventWindow(entry({ callTime: '4:30 PM', ends: 'TBD' }));
    expect(w.start.toISOString()).toBe('2026-09-11T20:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-11T22:30:00.000Z');
  });

  test('ICS-13 an end before the start crosses midnight and stays positive', () => {
    const w = resolveEventWindow(entry({ callTime: '10:00 PM', ends: '1:00 AM' }));
    expect(w.start.toISOString()).toBe('2026-09-12T02:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-12T05:00:00.000Z');
    expect(w.end.getTime() - w.start.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  // Found by running a generated file through Mozilla's ICAL.js: rolling the
  // end by a flat 24h of ABSOLUTE time is an hour wrong on the night the
  // clocks go back, because that night is 25 hours long. The end has to be
  // re-resolved as wall clock on the following calendar day.
  test('ICS-13b a midnight crossing on the DST fall-back night keeps its wall clock', () => {
    // 2026-11-01: EDT ends at 02:00, so 10:00 PM is EST (-5) and 1:00 AM on
    // Nov 2 is EST (-5) too. Three hours, not two.
    const w = resolveEventWindow(entry({ date: '2026-11-01', callTime: '10:00 PM', ends: '1:00 AM' }));
    expect(w.start.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect(w.end.getTime() - w.start.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  test('ICS-14 nothing resolvable anywhere means all-day', () => {
    expect(resolveEventWindow(entry({ callTime: 'TBD', begins: 'after Mincha', ends: '' })).allDay).toBe(true);
    expect(resolveEventWindow(entry()).allDay).toBe(true);
  });
});

// ===========================================================================
// 2.1 / 2.2 Format mechanics (design D9) and identity (design D6)
// ===========================================================================

describe('escapeText and foldLine (ICS-15 to ICS-17)', () => {
  test('ICS-15 backslash, semicolon, comma and newline are escaped', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(escapeText('line one\r\nline two')).toBe('line one\\nline two');
  });

  // The assertion that fails if folding counts characters instead of octets.
  test('ICS-16 folding measures UTF-8 octets, not string length', () => {
    // 70 accented characters = 140 octets, well under 75 characters.
    const value = `SUMMARY:${'é'.repeat(70)}`;
    expect(value.length).toBeLessThan(80);
    const folded = foldLine(value);
    expect(folded).toContain('\r\n ');
    for (const line of folded.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original exactly — no character was split.
    expect(folded.replace(/\r\n /g, '')).toBe(value);
  });

  test('ICS-17 a short line is not folded', () => {
    expect(foldLine('VERSION:2.0')).toBe('VERSION:2.0');
  });
});

describe('buildUid (ICS-18 to ICS-19)', () => {
  test('ICS-18 the same assignment yields the same UID on every call', () => {
    const e = entry();
    expect(buildUid(e, 'sarah@x.org')).toBe(buildUid(e, 'sarah@x.org'));
    expect(buildUid(e, 'sarah@x.org')).toBe('day1-row1-col1-sarah-x-org@emanuelnyc.org');
    // Case in the address does not re-identify the entry.
    expect(buildUid(e, 'Sarah@X.ORG')).toBe(buildUid(e, 'sarah@x.org'));
  });

  test('ICS-19 two people in one cell get distinct UIDs', () => {
    const e = entry();
    expect(buildUid(e, 'a@x.org')).not.toBe(buildUid(e, 'b@x.org'));
  });
});

// ===========================================================================
// 2.3 to 2.6 Calendar emission
// ===========================================================================

describe('buildAssignmentsCalendar (ICS-20 to ICS-27)', () => {
  test('ICS-20 a timed event carries identity, instants, summary, description and location', () => {
    const ics = build([
      entry({
        callTime: '4:30 PM',
        begins: '5:30',
        ends: '8:00 PM',
        note: 'Bring the large key ring',
        locationLines: ['Main Sanctuary', 'Beth-El Chapel']
      })
    ]);

    expect(valueOf(ics, 'UID')).toBe('day1-row1-col1-sarah-x-org@emanuelnyc.org');
    expect(valueOf(ics, 'SEQUENCE')).toBe('3');
    expect(valueOf(ics, 'DTSTAMP')).toBe('20260901T120000Z');
    expect(valueOf(ics, 'DTSTART')).toBe('20260911T203000Z');
    expect(valueOf(ics, 'DTEND')).toBe('20260912T000000Z');
    expect(valueOf(ics, 'SUMMARY')).toBe('Ushers — Erev Service');
    // The literal cell text rides along, so a guessed time stays visible.
    expect(valueOf(ics, 'DESCRIPTION')).toContain('Call time: 4:30 PM');
    expect(valueOf(ics, 'DESCRIPTION')).toContain('Begins: 5:30');
    expect(valueOf(ics, 'DESCRIPTION')).toContain('Note: Bring the large key ring');
    expect(valueOf(ics, 'LOCATION')).toBe('Main Sanctuary\\, Beth-El Chapel');
  });

  // The classic all-day off-by-one: an INCLUSIVE end paints two days.
  test('ICS-21 an unresolvable assignment becomes an all-day event with an exclusive end', () => {
    const ics = build([entry({ date: '2026-09-21', begins: 'TBD' })]);
    const lines = logicalLines(ics);
    expect(lines).toContain('DTSTART;VALUE=DATE:20260921');
    expect(lines).toContain('DTEND;VALUE=DATE:20260922');
    expect(ics).not.toContain('DTSTART:2026');
  });

  test('ICS-22 an all-day event at a month boundary rolls into the next month', () => {
    const ics = build([entry({ date: '2026-09-30' })]);
    expect(logicalLines(ics)).toContain('DTEND;VALUE=DATE:20261001');
  });

  test('ICS-23 the calendar declares PUBLISH and never invites anybody', () => {
    const ics = build([entry({ callTime: '5:00 PM' })]);
    const lines = logicalLines(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(ics).not.toContain('METHOD:REQUEST');
    expect(ics).not.toContain('ATTENDEE');
    expect(ics).not.toContain('ORGANIZER');
  });

  test('ICS-24 every line ends CRLF, including the last', () => {
    const ics = build([entry({ callTime: '5:00 PM' })]);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // No bare LF anywhere: every LF is preceded by a CR.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  test('ICS-25 a mixed file keeps every assignment, timed or not', () => {
    const ics = build([
      entry({ rowId: 'r1', colId: 'c1', callTime: '4:30 PM', ends: '7:00 PM' }),
      entry({ rowId: 'r2', colId: 'c1', begins: '17:30', ends: '19:00' }),
      entry({ rowId: 'r3', colId: 'c2', begins: 'after Mincha' }),
      entry({ rowId: 'r4', colId: 'c2', date: '2026-09-12', ends: 'TBD' })
    ]);
    const lines = logicalLines(ics);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith('DTSTART:')).length).toBe(2);
    expect(lines.filter((l) => l.startsWith('DTSTART;VALUE=DATE:')).length).toBe(2);
    // Four assignments, four distinct UIDs — nothing merged or dropped.
    expect(new Set(lines.filter((l) => l.startsWith('UID:'))).size).toBe(4);
  });

  test('ICS-26 placeholders contribute nothing and an empty scope yields no file', () => {
    expect(build([])).toBeNull();
    expect(build([entry({ placeholder: true, email: null })])).toBeNull();
    const ics = build([entry(), entry({ rowId: 'r2', placeholder: true, email: null })]);
    expect(logicalLines(ics).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  test('ICS-27 free-text prose in the Location row passes through intact', () => {
    const ics = build([
      entry({ callTime: '5:00 PM', locationLines: ['Riverside Park; south lawn, by the pier'] })
    ]);
    // Escaped on the wire, identical once a client unescapes it.
    expect(valueOf(ics, 'LOCATION')).toBe('Riverside Park\\; south lawn\\, by the pier');
  });
});

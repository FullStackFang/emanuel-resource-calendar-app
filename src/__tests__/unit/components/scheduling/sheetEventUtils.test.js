// sheetEventUtils.test.js
//
// Pure reorder-helper behavior (tasks 1.1-1.2 of scheduling-sheet-drag-reorder):
// column reorder preserves object identity/order, and custom-row reorder keeps
// starter rows locked as a fixed prefix.
//
// Test IDs: SRU-* (sheet reorder utils)

import { describe, it, expect } from 'vitest';
import {
  moveArrayItem,
  moveArrayItemBy,
  reorderArrayItem,
  customRowsOf,
  reorderCustomRows,
  moveCustomRowBy,
  moveCustomRowTo,
  parseTimeToken,
  computeDoubleBookedEmails,
  applyCellToSheet,
  cellPlainText,
} from '../../../../components/scheduling/sheetEventUtils';

const cols = () => [
  { id: 'c1', name: 'Erev Service' },
  { id: 'c2', name: 'YP Dinner' },
  { id: 'c3', name: 'Overflow' },
];

describe('column reorder helpers', () => {
  it('SRU-1: moveArrayItemBy(+1) moves a column one position right, preserving ids and object shape', () => {
    const next = moveArrayItemBy(cols(), 'c1', 1);
    expect(next.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(next.find((c) => c.id === 'c1')).toEqual({ id: 'c1', name: 'Erev Service' });
  });

  it('SRU-2: moveArrayItemBy(-1) moves a column one position left', () => {
    const next = moveArrayItemBy(cols(), 'c3', -1);
    expect(next.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
  });

  it('SRU-3: moveArrayItem moves a column across multiple positions in one call', () => {
    const next = moveArrayItem(cols(), 'c3', 0);
    expect(next.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('SRU-4: reorderArrayItem drops a column onto another column position', () => {
    const next = reorderArrayItem(cols(), 'c1', 'c3');
    expect(next.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('SRU-5: moves are clamped at the boundaries instead of throwing or dropping items', () => {
    const original = cols();
    expect(moveArrayItemBy(original, 'c1', -5).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(moveArrayItemBy(original, 'c3', 5).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('SRU-6: an unknown id is a no-op that returns the same array reference', () => {
    const original = cols();
    expect(moveArrayItemBy(original, 'nope', 1)).toBe(original);
    expect(reorderArrayItem(original, 'nope', 'c2')).toBe(original);
  });

  it('SRU-7: dragging a column onto itself is a no-op', () => {
    const original = cols();
    expect(reorderArrayItem(original, 'c2', 'c2')).toBe(original);
  });
});

const rows = () => [
  { id: 'rLoc', label: 'Location', kind: 'starter' },
  { id: 'rCall', label: 'Call Time', kind: 'starter' },
  { id: 'rBegins', label: 'Begins', kind: 'starter' },
  { id: 'rUshers', label: 'Ushers', kind: 'custom' },
  { id: 'rGreeters', label: 'Greeters', kind: 'custom' },
  { id: 'rSecurity', label: 'Security', kind: 'custom' },
];

describe('custom row reorder helpers', () => {
  it('SRU-8: customRowsOf splits out only non-starter rows', () => {
    expect(customRowsOf(rows()).map((r) => r.id)).toEqual(['rUshers', 'rGreeters', 'rSecurity']);
  });

  it('SRU-9: reorderCustomRows keeps starter rows first in their original order', () => {
    const next = reorderCustomRows(rows(), 'rSecurity', 'rUshers');
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rSecurity', 'rUshers', 'rGreeters']);
  });

  it('SRU-10: moveCustomRowBy moves within the custom group only, starters untouched', () => {
    const next = moveCustomRowBy(rows(), 'rUshers', 1);
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rGreeters', 'rUshers', 'rSecurity']);
  });

  it('SRU-11: moveCustomRowTo(0) moves a custom row to the top of the custom group, not above starters', () => {
    const next = moveCustomRowTo(rows(), 'rSecurity', 0);
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rSecurity', 'rUshers', 'rGreeters']);
  });

  it('SRU-12: a starter row id passed to a custom-row mover is a no-op (starter rows never move)', () => {
    const original = rows();
    expect(moveCustomRowBy(original, 'rCall', 1)).toBe(original);
    expect(reorderCustomRows(original, 'rCall', 'rUshers')).toBe(original);
  });

  it('SRU-13: custom row moves are clamped at the group boundary', () => {
    const original = rows();
    expect(moveCustomRowBy(original, 'rUshers', -5).map((r) => r.id)).toEqual(
      ['rLoc', 'rCall', 'rBegins', 'rUshers', 'rGreeters', 'rSecurity']
    );
    expect(moveCustomRowBy(original, 'rSecurity', 5).map((r) => r.id)).toEqual(
      ['rLoc', 'rCall', 'rBegins', 'rUshers', 'rGreeters', 'rSecurity']
    );
  });
});

// ── Time parsing (STU-*) ────────────────────────────────────────────────────
//
// One definition of "what is a time" for this feature, consumed by the cell
// commit path, the '@event' prefill, and the double-booking overlap check.

describe('parseTimeToken', () => {
  const cases = [
    // [input, canonical HH:MM, display]
    ['6pm', '18:00', '6:00 PM'],
    ['6PM', '18:00', '6:00 PM'],
    ['6 pm', '18:00', '6:00 PM'],
    ['6p', '18:00', '6:00 PM'],
    ['6:00pm', '18:00', '6:00 PM'],
    ['6:00 PM', '18:00', '6:00 PM'],
    ['630pm', '18:30', '6:30 PM'],
    ['6:30 p.m.', '18:30', '6:30 PM'],
    ['18:00', '18:00', '6:00 PM'],
    ['1800', '18:00', '6:00 PM'],
    ['9am', '09:00', '9:00 AM'],
    ['9:05am', '09:05', '9:05 AM'],
    ['12pm', '12:00', '12:00 PM'],   // noon
    ['12am', '00:00', '12:00 AM'],   // midnight
    ['12:30am', '00:30', '12:30 AM'],
    ['00:30', '00:30', '12:30 AM'],
    ['23:45', '23:45', '11:45 PM'],
  ];

  it.each(cases)('STU-1: parses %s -> %s', (input, value, display) => {
    expect(parseTimeToken(input)).toEqual({ value, display });
  });

  it('STU-2: a bare hour uses the 7-12 AM / 1-6 PM convention', () => {
    expect(parseTimeToken('7').display).toBe('7:00 AM');
    expect(parseTimeToken('11').display).toBe('11:00 AM');
    expect(parseTimeToken('12').display).toBe('12:00 PM');
    expect(parseTimeToken('1').display).toBe('1:00 PM');
    expect(parseTimeToken('6').display).toBe('6:00 PM');
    expect(parseTimeToken('6:30').display).toBe('6:30 PM');
    expect(parseTimeToken('7:30').display).toBe('7:30 AM');
  });

  it('STU-3: an explicit meridiem always beats the bare-hour convention', () => {
    expect(parseTimeToken('7pm').display).toBe('7:00 PM');
    expect(parseTimeToken('6am').display).toBe('6:00 AM');
  });

  it('STU-4: non-times return null so they commit as ordinary free text', () => {
    for (const input of ['after kiddush', 'TBD', '', '   ', 'Wise Hall', '25:00', '6:75', '13pm', '0pm', 'usher']) {
      expect(parseTimeToken(input)).toBeNull();
    }
  });

  it('STU-5: surrounding whitespace is tolerated', () => {
    expect(parseTimeToken('  6:00 pm  ').value).toBe('18:00');
  });

  it('STU-6: an already-normalized display value round-trips unchanged', () => {
    const once = parseTimeToken('6pm');
    expect(parseTimeToken(once.display)).toEqual(once);
  });
});

describe('computeDoubleBookedEmails with mixed time formats', () => {
  const day = (beginsA, endsA, beginsB, endsB) => ({
    rows: [
      { id: 'rBegins', kind: 'starter', label: 'Begins' },
      { id: 'rEnds', kind: 'starter', label: 'Ends' },
      { id: 'rUshers', kind: 'custom', label: 'Ushers' },
    ],
    columns: [{ id: 'c1', name: 'Sanctuary' }, { id: 'c2', name: 'Chapel' }],
    cells: {
      'rBegins:c1': { segments: [{ type: 'text', text: beginsA }] },
      'rEnds:c1': { segments: [{ type: 'text', text: endsA }] },
      'rBegins:c2': { segments: [{ type: 'text', text: beginsB }] },
      'rEnds:c2': { segments: [{ type: 'text', text: endsB }] },
      'rUshers:c1': { segments: [{ type: 'person', name: 'Sarah', email: 'sarah@x.org' }] },
      'rUshers:c2': { segments: [{ type: 'person', name: 'Sarah', email: 'sarah@x.org' }] },
    },
  });

  it('STU-7: flags an overlap written in two different formats', () => {
    // 6:00 PM-9:00 PM overlaps 18:30-20:00. String comparison misses this.
    expect(computeDoubleBookedEmails(day('6:00 PM', '9:00 PM', '18:30', '20:00'))).toEqual(
      new Set(['sarah@x.org'])
    );
  });

  it('STU-8: does not flag non-overlapping windows across formats', () => {
    expect(computeDoubleBookedEmails(day('9:00 AM', '11:00 AM', '18:00', '20:00')).size).toBe(0);
  });

  it('STU-9: unparseable times are skipped rather than guessed at', () => {
    expect(computeDoubleBookedEmails(day('after kiddush', 'late', '18:30', '20:00')).size).toBe(0);
  });
});

describe('applyCellToSheet — the optimistic cell patch', () => {
  const sheet = () => ({
    _id: 'sheet1',
    name: '2026 High Holy Days',
    days: [
      { _id: 'd1', date: '2026-09-11', cells: { 'rBegins:c1': { segments: [{ type: 'text', text: '16:30' }], note: null } } },
      { _id: 'd2', date: '2026-09-12', cells: {} },
    ],
  });
  const cell = { segments: [{ type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' }], note: null };

  it('SRU-14: writes the cell into the named day without mutating the loaded document', () => {
    const original = sheet();
    const next = applyCellToSheet(original, 'd1', 'rUshers', 'c2', cell);

    expect(next.days[0].cells['rUshers:c2']).toBe(cell);
    // The cached document the UI is still rendering must not change under it.
    expect(original.days[0].cells['rUshers:c2']).toBeUndefined();
    expect(next).not.toBe(original);
    expect(next.days[1]).toBe(original.days[1]);
  });

  it('SRU-15: an existing cell is replaced and its neighbours are left alone', () => {
    const next = applyCellToSheet(sheet(), 'd1', 'rBegins', 'c1', cell);
    expect(next.days[0].cells['rBegins:c1']).toBe(cell);
    expect(Object.keys(next.days[0].cells)).toEqual(['rBegins:c1']);
  });

  it('SRU-16: a day (or document) that is not there returns the SAME reference, so no pointless cache write happens', () => {
    const original = sheet();
    expect(applyCellToSheet(original, 'nope', 'r', 'c', cell)).toBe(original);
    expect(applyCellToSheet(undefined, 'd1', 'r', 'c', cell)).toBeUndefined();
    expect(applyCellToSheet({ days: null }, 'd1', 'r', 'c', cell)).toEqual({ days: null });
  });

  it('SRU-17: cellPlainText renders a cell as one readable line for the system clipboard', () => {
    expect(cellPlainText({ segments: [
      { type: 'text', text: '6:30 PM' },
      { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' },
      { type: 'location', locationId: 'l1', name: 'Wise Hall' },
    ] })).toBe('6:30 PM, Sarah Levine, Wise Hall');
    expect(cellPlainText(null)).toBe('');
    expect(cellPlainText({ segments: [] })).toBe('');
  });
});

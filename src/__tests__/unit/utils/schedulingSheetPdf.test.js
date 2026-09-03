// schedulingSheetPdf.test.js
//
// The scheduling-sheet PDF export. Two layers are tested separately:
//   * the pure planners (chunkColumns / collectDayNotes) with no jsPDF at all
//   * the generator, against a recording fake doc (same approach as
//     calendarPdfGenerator.test.js)
//
// Test IDs: SSP-1 to SSP-18

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture what got drawn so we can assert content and page boundaries.
const textCalls = [];
let pageCount = 1;

vi.mock('jspdf', () => {
  class FakeDoc {
    constructor() {
      // Landscape Letter, matching the real orientation/format options.
      this.internal = {
        pageSize: { getWidth: () => 279.4, getHeight: () => 215.9 },
        getNumberOfPages: () => pageCount,
      };
    }
    setProperties() {}
    setDrawColor() {}
    setFillColor() {}
    setTextColor() {}
    setLineWidth() {}
    setLineDashPattern() {}
    setFont() {}
    setFontSize() {}
    line() {}
    rect() {}
    roundedRect() {}
    circle() {}
    triangle() {}
    addPage() { pageCount += 1; }
    setPage() {}
    getTextWidth(s) { return String(s).length * 1.4; }
    splitTextToSize(s) { return [String(s)]; }
    text(str) { textCalls.push(Array.isArray(str) ? str.join(' ') : String(str)); }
    output() { return new Blob(['pdf']); }
  }
  return { jsPDF: FakeDoc };
});

beforeEach(() => {
  textCalls.length = 0;
  pageCount = 1;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
});

const {
  generateSchedulingSheetPdf,
  chunkColumns,
  collectDayNotes,
  MAX_COLS_PER_PAGE,
} = await import('../../../utils/schedulingSheetPdf');

const drew = (substr) => textCalls.some((t) => t.includes(substr));
const drewCount = (substr) => textCalls.filter((t) => t.includes(substr)).length;

const ROWS = [
  { id: 'r1', kind: 'starter', label: 'Location' },
  { id: 'r2', kind: 'starter', label: 'Call Time' },
  { id: 'r3', kind: 'starter', label: 'Begins' },
  { id: 'r4', kind: 'starter', label: 'Ends' },
  { id: 'r5', kind: 'custom', label: 'Ushers' },
];

const cols = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Post ${i + 1}` }));

const day = (over = {}) => ({
  _id: 'd1',
  date: '2026-09-11',
  title: 'Erev Rosh Hashanah',
  rows: ROWS,
  columns: cols(3),
  cells: {},
  emailStatus: [],
  ...over,
});

const sheet = (over = {}) => ({ _id: 's1', name: '2026 High Holy Days', days: [day()], ...over });

// ---------------------------------------------------------------- planners

describe('chunkColumns', () => {
  it('SSP-1: keeps a day that fits on one page as a single chunk', () => {
    expect(chunkColumns(cols(MAX_COLS_PER_PAGE)).map((c) => c.length)).toEqual([MAX_COLS_PER_PAGE]);
    expect(chunkColumns(cols(1)).map((c) => c.length)).toEqual([1]);
  });

  // A greedy fill would give 6 + 3; a lone straggler column on page 2 reads as
  // a bug. Balancing is the whole point of the helper.
  it('SSP-2: balances across pages rather than filling greedily', () => {
    expect(chunkColumns(cols(9)).map((c) => c.length)).toEqual([5, 4]);
    expect(chunkColumns(cols(7)).map((c) => c.length)).toEqual([4, 3]);
    expect(chunkColumns(cols(13)).map((c) => c.length)).toEqual([5, 5, 3]);
  });

  it('SSP-3: never exceeds the per-page cap', () => {
    for (let n = 1; n <= 40; n += 1) {
      for (const chunk of chunkColumns(cols(n))) {
        expect(chunk.length).toBeLessThanOrEqual(MAX_COLS_PER_PAGE);
      }
    }
  });

  it('SSP-4: a day with no columns still yields one (empty) page', () => {
    expect(chunkColumns([])).toEqual([[]]);
  });
});

describe('collectDayNotes', () => {
  const noted = day({
    columns: cols(9),
    cells: {
      'r1:c1': { segments: [], note: { text: 'first', authorName: 'A' } },
      'r5:c9': { segments: [], note: { text: 'last', authorName: 'B' } },
    },
  });

  // Continuous numbering means no two notes on a day share a number; the `cp`
  // tag is what lets each note print on the page carrying its own marker.
  it('SSP-5: numbers continuously through the day and tags each note with its column-page', () => {
    const pages = chunkColumns(noted.columns);
    const { notes, indexByCell } = collectDayNotes(noted, pages);

    expect(notes.map((n) => n.n)).toEqual([1, 2]);
    expect(notes[0].cp).toBe(0);
    expect(notes[1].cp).toBe(1);
    expect(indexByCell.get('r1:c1')).toBe(1);
    expect(indexByCell.get('r5:c9')).toBe(2);
  });

  it('SSP-6: carries the post and row names so an endnote is self-describing', () => {
    const { notes } = collectDayNotes(noted, chunkColumns(noted.columns));
    expect(notes[0].col).toBe('Post 1');
    expect(notes[0].row).toBe('Location');
    expect(notes[0].text).toBe('first');
    expect(notes[0].authorName).toBe('A');
  });

  it('SSP-7: a day with no notes produces nothing', () => {
    const { notes, indexByCell } = collectDayNotes(day(), chunkColumns(cols(3)));
    expect(notes).toEqual([]);
    expect(indexByCell.size).toBe(0);
  });
});

// ---------------------------------------------------------------- generator

describe('generateSchedulingSheetPdf', () => {
  it('SSP-8: returns a blob, url, filename and day count', () => {
    const result = generateSchedulingSheetPdf({ sheet: sheet() });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blobUrl).toBe('blob:mock');
    expect(result.dayCount).toBe(1);
    expect(result.fileName).toBe('emanu-el-scheduling-2026-high-holy-days-2026-09-11.pdf');
  });

  it('SSP-9: draws the masthead and the sheet name on the document', () => {
    generateSchedulingSheetPdf({ sheet: sheet() });
    expect(drew('CONGREGATION EMANU-EL')).toBe(true);
    expect(drew('2026 High Holy Days')).toBe(true);
  });

  it('SSP-10: lists every day of the workbook, each starting a new page', () => {
    const days = [
      day({ _id: 'd1', date: '2026-09-11', title: 'Erev Rosh Hashanah' }),
      day({ _id: 'd2', date: '2026-09-12', title: 'Rosh Hashanah' }),
      day({ _id: 'd3', date: '2026-09-20', title: 'Kol Nidre' }),
    ];
    const result = generateSchedulingSheetPdf({ sheet: sheet({ days }) });

    expect(result.dayCount).toBe(3);
    expect(drew('Erev Rosh Hashanah')).toBe(true);
    expect(drew('Rosh Hashanah')).toBe(true);
    expect(drew('Kol Nidre')).toBe(true);
    expect(pageCount).toBe(3);
  });

  // The row-label column is repeated on the continuation page; the posts-range
  // is what tells the reader the day is not finished.
  it('SSP-11: paginates a wide day and labels the posts range on each page', () => {
    generateSchedulingSheetPdf({ sheet: sheet({ days: [day({ columns: cols(9) })] }) });

    expect(pageCount).toBe(2);
    expect(drew('POSTS 1-5 OF 9')).toBe(true);
    expect(drew('POSTS 6-9 OF 9')).toBe(true);
    // Row labels repeat so a torn-off page still reads.
    expect(drewCount('Location')).toBeGreaterThanOrEqual(2);
  });

  it('SSP-12: omits the posts range when the day fits on one page', () => {
    generateSchedulingSheetPdf({ sheet: sheet() });
    expect(drew('POSTS 1-')).toBe(false);
  });

  // A marker whose text sits on a different sheet of paper is worse than no
  // marker: each page prints only the notes its own cells reference.
  it('SSP-13: prints each note on the page that carries its marker', () => {
    const wide = day({
      columns: cols(9),
      cells: {
        'r1:c1': { segments: [], note: { text: 'flowers arrive at three', authorName: 'S. Fang' } },
        'r1:c9': { segments: [], note: { text: 'ramp must stay clear', authorName: 'Facilities' } },
      },
    });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [wide] }) });

    expect(drew('flowers arrive at three')).toBe(true);
    expect(drew('ramp must stay clear')).toBe(true);
    expect(drewCount('NOTES')).toBe(2); // one block per column-page, not one per day
  });

  it('SSP-14: caps the number of days and says so instead of silently dropping them', () => {
    const days = Array.from({ length: 5 }, (_, i) =>
      day({ _id: `d${i}`, date: `2026-09-1${i}`, title: `Day ${i}` }));
    const result = generateSchedulingSheetPdf({ sheet: sheet({ days }), maxDays: 3 });

    expect(result.dayCount).toBe(3);
    expect(result.omittedDays).toBe(2);
    expect(drew('first 3 days of 5')).toBe(true);
    expect(drew('Day 4')).toBe(false);
  });

  it('SSP-15: flags a linked column whose event drifted, and one that vanished', () => {
    const linkedCols = [
      {
        id: 'c1', name: 'Main Sanctuary',
        linkedEvent: { eventId: 'e1', snapshot: { title: 'Main Sanctuary', startDateTime: '2026-09-11T22:00:00Z', endDateTime: '2026-09-12T01:00:00Z' } },
      },
      {
        id: 'c2', name: 'Chapel',
        linkedEvent: { eventId: 'e2', snapshot: { title: 'Chapel', startDateTime: '2026-09-11T22:30:00Z', endDateTime: '2026-09-12T00:30:00Z' } },
      },
    ];
    const live = new Map([
      // e1 moved by half an hour -> drift. e2 is absent entirely -> missing.
      ['e1', { id: 'e1', title: 'Main Sanctuary', startDateTime: '2026-09-11T22:30:00Z', endDateTime: '2026-09-12T01:00:00Z' }],
    ]);

    generateSchedulingSheetPdf({ sheet: sheet({ days: [day({ columns: linkedCols })] }), liveEventsById: live });

    expect(drew('event changed since linked')).toBe(true);
    expect(drew('linked event no longer exists')).toBe(true);
  });

  it('SSP-16: reports the email state of each day honestly', () => {
    const sent = day({ _id: 'd1', date: '2026-09-11', emailStatus: [{ email: 'a@x.org', sentAt: '2026-09-02T18:30:00Z', stale: true }] });
    const unsent = day({ _id: 'd2', date: '2026-09-12', emailStatus: [] });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [sent, unsent] }) });

    expect(drew('EDITED SINCE')).toBe(true);
    expect(drew('NOT YET EMAILED')).toBe(true);
  });

  it('SSP-17: renders every chip kind, including the placeholder and the overlap warning', () => {
    const staffed = day({
      columns: cols(2),
      cells: {
        'r3:c1': { segments: [{ type: 'text', text: '6:00 PM' }] },
        'r4:c1': { segments: [{ type: 'text', text: '9:00 PM' }] },
        'r3:c2': { segments: [{ type: 'text', text: '6:30 PM' }] },
        'r4:c2': { segments: [{ type: 'text', text: '8:30 PM' }] },
        'r1:c1': { segments: [{ type: 'location', locationId: 'l1', name: 'Main Sanctuary' }] },
        'r5:c1': {
          segments: [
            { type: 'person', userId: 'u1', name: 'Dan Rosen', email: 'd@x.org', callTimeOverride: '3:45 PM' },
            { type: 'person', userId: null, name: 'T. Whitfield', email: 't@vendor.com' },
            { type: 'person', userId: null, name: '@third usher', email: null, placeholder: true },
          ],
        },
        'r5:c2': { segments: [{ type: 'person', userId: 'u1', name: 'Dan Rosen', email: 'd@x.org' }] },
      },
    });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [staffed] }) });

    expect(drew('Main Sanctuary')).toBe(true);
    expect(drew('Dan Rosen')).toBe(true);
    expect(drew('3:45 PM')).toBe(true);      // call-time override
    expect(drew('T. Whitfield')).toBe(true);
    expect(drew('ext')).toBe(true);           // outside vendor tag
    expect(drew('@third usher')).toBe(true);
    expect(drew('unassigned')).toBe(true);
    expect(drew('!')).toBe(true);             // Dan Rosen covers two overlapping posts
  });

  // jsPDF's built-in fonts are WinAnsi only; an unsanitized codepoint above
  // 0xFF is byte-split into mojibake rather than failing loudly.
  it('SSP-18: sanitizes user-entered text before it reaches the page', () => {
    const emoji = day({
      title: 'Erev 🎉 Rosh Hashanah',
      columns: [{ id: 'c1', name: 'Post 🔥 One' }],
      cells: { 'r1:c1': { segments: [{ type: 'text', text: 'bring 🎈 balloons' }] } },
    });
    generateSchedulingSheetPdf({ sheet: sheet({ name: 'High 🎊 Holy Days', days: [emoji] }) });

    expect(textCalls.some((t) => /[\u{1F300}-\u{1FAFF}]/u.test(t))).toBe(false);
    expect(drew('Rosh Hashanah')).toBe(true);
  });
});

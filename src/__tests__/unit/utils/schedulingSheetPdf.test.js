// schedulingSheetPdf.test.js
//
// The scheduling-sheet PDF export. Two layers are tested separately:
//   * the pure planners (chunkColumns / planColumnWidths / collectDayNotes)
//     with no jsPDF at all
//   * the generator, against a recording fake doc (same approach as
//     calendarPdfGenerator.test.js)
//
// Test IDs: SSP-1 to SSP-22

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture what got drawn so we can assert content, chrome and page boundaries.
const textCalls = [];
const shapes = { roundedRect: 0, circleFilled: 0, circleStroked: 0, rect: 0, dashOn: 0 };
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
    setLineDashPattern(pattern) { if (pattern && pattern.length) shapes.dashOn += 1; }
    setCharSpace() {}
    setFont() {}
    setFontSize() {}
    addFileToVFS() {}
    addFont() {}
    line() {}
    rect() { shapes.rect += 1; }
    roundedRect() { shapes.roundedRect += 1; }
    circle(x, y, r, style) { if (style === 'F') shapes.circleFilled += 1; else shapes.circleStroked += 1; }
    addPage() { pageCount += 1; }
    setPage() {}
    getTextWidth(s) { return String(s).length * 1.4; }
    splitTextToSize(s) { return [String(s)]; }
    text(str) { textCalls.push(Array.isArray(str) ? str.join(' ') : String(str)); }
    output() { return new Blob(['pdf']); }
  }
  return { jsPDF: FakeDoc };
});

// The embedded font is ~257KB of base64 and nothing here depends on its bytes,
// only on the fact that registration happens before any measurement.
const registerDmSans = vi.fn();
vi.mock('../../../utils/dmSansFont', () => ({ registerDmSans, default: registerDmSans }));

beforeEach(() => {
  textCalls.length = 0;
  pageCount = 1;
  Object.keys(shapes).forEach((k) => { shapes[k] = 0; });
  registerDmSans.mockClear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
});

const {
  generateSchedulingSheetPdf,
  chunkColumns,
  collectDayNotes,
  planColumnWidths,
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

  // A greedy fill would give 9 + 4; a lone straggler column reads as a bug.
  it('SSP-2: balances across pages rather than filling greedily', () => {
    expect(chunkColumns(cols(13)).map((c) => c.length)).toEqual([7, 6]);
    expect(chunkColumns(cols(10)).map((c) => c.length)).toEqual([5, 5]);
    expect(chunkColumns(cols(19)).map((c) => c.length)).toEqual([7, 7, 5]);
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

describe('planColumnWidths', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // The point of content-aware widths: a column of clock times stops claiming
  // as much of the page as a column of full names.
  it('SSP-5: gives the surplus to the columns that actually want it', () => {
    const out = planColumnWidths([30, 30], [40, 100], 200, 30);
    expect(sum(out)).toBeCloseTo(200, 1);
    expect(out[1]).toBeGreaterThan(out[0]);
  });

  // No column may fall below its widest unbreakable unit — for a location that
  // includes the chip padding and the pin gutter, or the chip would clip.
  it('SSP-6: never drops a column below its floor when there is room', () => {
    const out = planColumnWidths([50, 28], [50, 28], 200, 21);
    expect(out[0]).toBeGreaterThanOrEqual(50);
    expect(out[1]).toBeGreaterThanOrEqual(28);
  });

  it('SSP-7: always fills the width exactly, even with nothing to want', () => {
    const out = planColumnWidths([30, 30, 30], [30, 30, 30], 210, 30);
    expect(sum(out)).toBeCloseTo(210, 1);
    out.forEach((w) => expect(w).toBeCloseTo(70, 1));
  });

  it('SSP-8: scales back proportionally when the floors cannot all fit', () => {
    const out = planColumnWidths([60, 60, 60], [60, 60, 60], 90, 21);
    expect(sum(out)).toBeCloseTo(90, 1);
    out.forEach((w) => expect(w).toBeCloseTo(30, 1));
  });

  it('SSP-9: handles a page with no columns', () => {
    expect(planColumnWidths([], [], 200)).toEqual([]);
  });
});

describe('collectDayNotes', () => {
  const noted = day({
    columns: cols(13),
    cells: {
      'r1:c1': { segments: [], note: { text: 'first', authorName: 'A' } },
      'r5:c13': { segments: [], note: { text: 'last', authorName: 'B' } },
    },
  });

  // Continuous numbering means no two notes on a day share a number; the `cp`
  // tag is what lets each note print on the page carrying its own marker.
  it('SSP-10: numbers continuously through the day and tags each with its column-page', () => {
    const pages = chunkColumns(noted.columns);
    const { notes, indexByCell } = collectDayNotes(noted, pages);

    expect(notes.map((n) => n.n)).toEqual([1, 2]);
    expect(notes[0].cp).toBe(0);
    expect(notes[1].cp).toBe(1);
    expect(indexByCell.get('r1:c1')).toBe(1);
    expect(indexByCell.get('r5:c13')).toBe(2);
  });

  it('SSP-11: carries the post and row names so an endnote is self-describing', () => {
    const { notes } = collectDayNotes(noted, chunkColumns(noted.columns));
    expect(notes[0].col).toBe('Post 1');
    expect(notes[0].row).toBe('Location');
    expect(notes[0].text).toBe('first');
    expect(notes[0].authorName).toBe('A');
  });

  it('SSP-12: a day with no notes produces nothing', () => {
    const { notes, indexByCell } = collectDayNotes(day(), chunkColumns(cols(3)));
    expect(notes).toEqual([]);
    expect(indexByCell.size).toBe(0);
  });
});

// ---------------------------------------------------------------- generator

describe('generateSchedulingSheetPdf', () => {
  it('SSP-13: returns a blob, url, filename and day count', () => {
    const result = generateSchedulingSheetPdf({ sheet: sheet() });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blobUrl).toBe('blob:mock');
    expect(result.dayCount).toBe(1);
    expect(result.fileName).toBe('emanu-el-scheduling-2026-high-holy-days-2026-09-11.pdf');
  });

  // An unregistered font name silently falls back to Helvetica, which measures
  // differently — every column width in the document would be computed against
  // the wrong metrics. Registration must happen before anything is measured.
  it('SSP-14: registers the embedded typeface before drawing', () => {
    generateSchedulingSheetPdf({ sheet: sheet() });
    expect(registerDmSans).toHaveBeenCalledTimes(1);
  });

  it('SSP-15: draws the house line and the sheet name', () => {
    generateSchedulingSheetPdf({ sheet: sheet() });
    expect(drew('CONGREGATION EMANU-EL')).toBe(true);
    expect(drew('2026 High Holy Days')).toBe(true);
  });

  it('SSP-16: renders every day of the workbook, each starting a new page', () => {
    const days = [
      day({ _id: 'd1', date: '2026-09-11', title: 'Erev Rosh Hashanah' }),
      day({ _id: 'd2', date: '2026-09-12', title: 'Rosh Hashanah' }),
      day({ _id: 'd3', date: '2026-09-20', title: 'Kol Nidre' }),
    ];
    const result = generateSchedulingSheetPdf({ sheet: sheet({ days }) });

    expect(result.dayCount).toBe(3);
    expect(drew('Kol Nidre')).toBe(true);
    expect(pageCount).toBe(3);
  });

  // The whole reason the chip treatment had to stay cheap: a nine-post day is
  // the real-world shape (High Holy Days), and it must not split.
  it('SSP-17: keeps a nine-post day on a single page', () => {
    generateSchedulingSheetPdf({ sheet: sheet({ days: [day({ columns: cols(9) })] }) });
    expect(pageCount).toBe(1);
  });

  it('SSP-18: paginates a day too wide for one page and labels the posts range', () => {
    generateSchedulingSheetPdf({ sheet: sheet({ days: [day({ columns: cols(14) })] }) });

    expect(pageCount).toBe(2);
    expect(drew('Posts 1–7 of 14')).toBe(true);
    expect(drew('Posts 8–14 of 14')).toBe(true);
    // Row labels repeat so a torn-off page still reads.
    expect(drewCount('LOCATION')).toBeGreaterThanOrEqual(2);
  });

  it('SSP-19: omits the posts range when the day fits on one page', () => {
    generateSchedulingSheetPdf({ sheet: sheet() });
    expect(drew('Posts 1–')).toBe(false);
  });

  // A marker whose text sits on a different sheet of paper is worse than no
  // marker: each page prints only the notes its own cells reference.
  it('SSP-20: prints each note on the page that carries its marker', () => {
    const wide = day({
      columns: cols(14),
      cells: {
        'r1:c1': { segments: [], note: { text: 'flowers arrive at three', authorName: 'S. Fang' } },
        'r1:c14': { segments: [], note: { text: 'ramp must stay clear', authorName: 'Facilities' } },
      },
    });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [wide] }) });

    expect(drew('flowers arrive at three')).toBe(true);
    expect(drew('ramp must stay clear')).toBe(true);
    expect(drewCount('NOTES')).toBe(2); // one block per column-page, not one per day
  });

  it('SSP-21: caps the number of days and says so instead of silently dropping them', () => {
    const days = Array.from({ length: 5 }, (_, i) =>
      day({ _id: `d${i}`, date: `2026-09-1${i}`, title: `Day ${i}` }));
    const result = generateSchedulingSheetPdf({ sheet: sheet({ days }), maxDays: 3 });

    expect(result.dayCount).toBe(3);
    expect(result.omittedDays).toBe(2);
    expect(drew('First 3 days shown; 2 more')).toBe(true);
    expect(drew('Day 4')).toBe(false);
  });

  it('SSP-22: flags a linked column whose event drifted, and one that vanished', () => {
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

    expect(drew('changed since linked')).toBe(true);
    expect(drew('linked event removed')).toBe(true);
  });

  it('SSP-23: reports the email state of each day honestly', () => {
    const sent = day({ _id: 'd1', date: '2026-09-11', emailStatus: [{ email: 'a@x.org', sentAt: '2026-09-02T18:30:00Z', stale: true }] });
    const unsent = day({ _id: 'd2', date: '2026-09-12', emailStatus: [] });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [sent, unsent] }) });

    expect(drew('edited since')).toBe(true);
    expect(drew('Not yet emailed')).toBe(true);
  });

  it('SSP-24: renders every entity kind, including the overlap dagger', () => {
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

    // Asserted per WORD: text is drawn one wrapped token at a time, so a
    // two-word name is two draw calls whenever the column is narrow.
    expect(drew('Sanctuary')).toBe(true);
    expect(drew('3:45p')).toBe(true);      // call-time override, compacted
    expect(drew('Whitfield')).toBe(true);
    expect(drew('EXT')).toBe(true);        // outside vendor
    expect(drew('usher')).toBe(true);
    expect(drew('TBA')).toBe(true);
    // Dan Rosen covers two overlapping posts. The dagger is bound INTO the name
    // token, so it travels with the surname and can never wrap onto a line of
    // its own — which is exactly what this assertion pins.
    expect(drew('Rosen†')).toBe(true);
    expect(textCalls).not.toContain('†');
    expect(drew('also assigned to another post')).toBe(true);
  });

  // A location, a staff member, a vendor and an unfilled post must be
  // distinguishable without reading the words.
  it('SSP-25: marks each entity kind with its own non-textual treatment', () => {
    const marked = day({
      columns: cols(1),
      cells: {
        'r1:c1': { segments: [{ type: 'location', locationId: 'l1', name: 'Greenwald Hall' }] },
        'r5:c1': {
          segments: [
            { type: 'person', userId: 'u1', name: 'Leah Fine', email: 'l@x.org' },
            { type: 'person', userId: null, name: 'R. Iyer', email: 'r@vendor.com' },
            { type: 'person', userId: null, name: '@usher', email: null, placeholder: true },
          ],
        },
      },
    });
    generateSchedulingSheetPdf({ sheet: sheet({ days: [marked] }) });

    expect(shapes.roundedRect).toBeGreaterThanOrEqual(1);   // the location chip
    expect(shapes.circleFilled).toBeGreaterThanOrEqual(2);  // pin head + staff dot
    expect(shapes.circleStroked).toBeGreaterThanOrEqual(1); // vendor ring
    expect(shapes.dashOn).toBeGreaterThanOrEqual(1);        // placeholder underline
  });

  it('SSP-26: tints the seeded rows and leaves the sheet\'s own rows clear', () => {
    generateSchedulingSheetPdf({ sheet: sheet({ days: [day({ columns: cols(1) })] }) });
    // Four starter rows in the fixture get the wash; the custom row does not.
    expect(shapes.rect).toBe(4);
  });

  // DM Sans has no emoji glyphs, so unsanitised input would print as tofu even
  // though an embedded TTF lifts the WinAnsi restriction.
  it('SSP-27: sanitizes user-entered text before it reaches the page', () => {
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

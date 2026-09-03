// src/utils/schedulingSheetPdf.js
//
// Landscape PDF export for a Scheduling Sheet workbook — the printed artifact
// that replaced the Excel sheet. Every day is rendered, one day per page (more
// when a day has more posts than fit across the sheet).
//
// DESIGN — editorial-institutional, per PRODUCT.md: closer to a museum
// publication than a dashboard. Concretely:
//   * Typeface is DM Sans, embedded (see dmSansFont.js), so the printed sheet
//     and the screen are the same document. Four faces give a real hierarchy.
//   * Colour is the app's own design-tokens palette. Posts carry primary-600
//     because they are the primary entity; row labels carry primary-700; the
//     five seeded rows carry a primary-50 wash quoted from `.ss-row-starter`.
//     Gold is limited to note numerals and call-time overrides.
//   * Hierarchy is a rule hierarchy — 0.9 / 0.6 / 0.3 / 0.1mm — plus
//     letterspaced small capitals. There is no dark header band.
//   * Rows sit at their natural height on a 3.6mm baseline grid and are NEVER
//     stretched to fill the page; trailing whitespace at the foot is correct.
//     (An earlier revision stretched them and the result read sparse and
//     cluttered at once. Density comes from fitting more per page.)
//   * People, rooms and unfilled posts are distinguishable without reading the
//     words — see the chip notes on drawBlock.
//
// Every user string goes through sanitizeForPdfText. With an embedded TTF the
// WinAnsi limitation no longer strictly applies, but DM Sans has no emoji
// glyphs, so unsanitised input would still print as tofu.
//
// This is a pure read of data already in the React Query cache: no network
// call, no write, nothing touches Graph or templeEvents__Events.

import { jsPDF } from 'jspdf';
import { sanitizeForPdfText } from './calendarPdfGenerator';
import { registerDmSans } from './dmSansFont';
import { computeDoubleBookedEmails } from '../components/scheduling/sheetEventUtils';

const S = sanitizeForPdfText;

// ---------------------------------------------------------------- tokens
// From src/styles/design-tokens.css. Never pure black, never pure white.
const N900 = [28, 25, 23];
const N800 = [41, 37, 36];
const N700 = [68, 64, 60];
const N600 = [87, 83, 78];
const N500 = [120, 113, 108];
const N400 = [168, 162, 158];
const N300 = [214, 211, 209];
const N200 = [231, 229, 228];
const SAPPHIRE700 = [30, 71, 133];
const SAPPHIRE600 = [45, 90, 158];
const SAPPHIRE200 = [194, 215, 239];
const SAPPHIRE50 = [238, 244, 255];
const GOLD600 = [202, 138, 4];   // gold TEXT — 500 is too light on paper
const GOLD500 = [234, 179, 8];
const GOLD50 = [254, 252, 232];

const RULE = { masthead: 0.9, colHead: 0.6, section: 0.3, close: 0.6, hair: 0.1 };
const RHYTHM = 3.6;              // every baseline on the page sits on this grid

// Type scale. Steps are ≥1.25 apart so the hierarchy is legible rather than
// five things all at 8pt: day 16 / post 10 / data 8 / caption 6.4.
const F = {
  house: 6.8, meta: 7.0, dayTitle: 16, dayDate: 10,
  colName: 10, colTime: 6.6, rowLabel: 7.2,
  data: 8.0, tag: 5.8, note: 7.0, tiny: 6.4,
};

const M = 13;                    // page margin
const LABEL_W = 26;
const MIN_COL_W = 21;
const ROW_MIN_H = RHYTHM * 2;
const PAD_X = 1.9, PAD_Y = 1.7, LINE_H = RHYTHM, HANG = 1.8;
// CHIP_PAD_Y is generous enough that a two- or three-line chip breathes as much
// as a one-line one; wrapped lines are set on LINE_H, not on the raw font size.
const CHIP_PAD_X = 1.9, CHIP_PAD_Y = 1.5, CHIP_R = 1.1;
const BLOCK_GAP = 0.8;           // between wrapped lines of entries in a cell
const BLOCK_GAP_X = 2.4;         // between entries sitting side by side
const WARN_W = 3.0;              // gutter for the double-booking caution mark
const WARN = [150, 52, 52];
const MARK_W = 2.4;              // leading dot / pin gutter
// Row-label metrics. Measuring and drawing MUST share these, or a wrapped
// label is sized against one number and painted against another.
const LABEL_LEAD = 4.4;          // first baseline below the row top
const LABEL_LINE = 3.4;          // leading between wrapped label lines
const LABEL_TAIL = 2.0;          // descender clearance under the last line

export const MAX_COLS_PER_PAGE = 9;
export const DEFAULT_MAX_DAYS = 31;

// ---------------------------------------------------------------- styles
const ST = {
  house:     { f: 'DMSans', w: 'medium', s: F.house, c: N500, cs: 0.52 },
  meta:      { f: 'DMSans', w: 'normal', s: F.meta, c: N500 },
  dayTitle:  { f: 'DMSans', w: 'bold', s: F.dayTitle, c: N900 },
  dayDate:   { f: 'DMSans', w: 'normal', s: F.dayDate, c: N600 },
  contentsLabel: { f: 'DMSans', w: 'medium', s: 6.0, c: N400, cs: 0.4 },
  contentsBody:  { f: 'DMSans', w: 'normal', s: 6.8, c: N600 },
  contentsCap:   { f: 'DMSans', w: 'bold', s: 6.8, c: N700 },

  // The post name IS the event title — the emphasis target. Bold, a full step
  // above the data, and in the primary.
  colName:   { f: 'DMSans', w: 'bold', s: F.colName, c: SAPPHIRE600 },
  colTime:   { f: 'DMSans', w: 'normal', s: F.colTime, c: N500 },
  colStatus: { f: 'DMSans', w: 'italic', s: F.colTime, c: N500 },

  rowLabel:  { f: 'DMSans', w: 'medium', s: F.rowLabel, c: SAPPHIRE700, cs: 0.3 },

  person:      { f: 'DMSans', w: 'normal', s: F.data, c: N800 },
  personTag:   { f: 'DMSans', w: 'normal', s: F.tag, c: N400, cs: 0.24 },
  callTime:    { f: 'DMSans', w: 'normal', s: F.colTime, c: GOLD600 },
  placeholder: { f: 'DMSans', w: 'italic', s: F.data, c: N500 },
  location:    { f: 'DMSans', w: 'medium', s: 7.4, c: N800 },
  text:        { f: 'DMSans', w: 'normal', s: F.data, c: N800 },
  empty:       { f: 'DMSans', w: 'normal', s: 7.6, c: N300 },

  noteMark:  { f: 'DMSans', w: 'bold', s: 5.6, c: GOLD600, raise: 1.6 },
  noteNum:   { f: 'DMSans', w: 'medium', s: 6.8, c: GOLD600 },
  noteHead:  { f: 'DMSans', w: 'medium', s: F.tiny, c: N800, cs: 0.26 },
  noteBody:  { f: 'DMSans', w: 'normal', s: F.note, c: N700 },
  notesTitle:{ f: 'DMSans', w: 'medium', s: 6.2, c: N600, cs: 0.44 },
  footer:    { f: 'DMSans', w: 'normal', s: 6.3, c: N400 },
  legend:    { f: 'DMSans', w: 'italic', s: F.tiny, c: N500 },
};

const HOUSE = 'CONGREGATION EMANU-EL OF THE CITY OF NEW YORK';

// ---------------------------------------------------------------- pure planners

/**
 * Split a day's columns across pages, BALANCED rather than greedily filled:
 * 9 posts become 5 + 4, not 8 + 1. A lone straggler column on the second page
 * reads as a bug rather than as a continuation.
 */
export function chunkColumns(columns, maxPerPage = MAX_COLS_PER_PAGE) {
  const list = columns || [];
  if (list.length === 0) return [[]];
  const pages = Math.ceil(list.length / maxPerPage);
  const per = Math.ceil(list.length / pages);
  const out = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}

/**
 * Width per column, sized to content and summing to exactly `gridW`.
 *
 * Two tiers, because the numbers mean different things:
 *   `minNeed` — the widest unbreakable unit in the column (longest word, plus
 *     any chip padding around it). Below this, content would be clipped.
 *   `want`    — everything on one line. Aspirational; decides who gets surplus.
 *
 * Every column is guaranteed its floor, the leftover is offered in proportion
 * to what each still wants, and any remainder is split evenly — so the row
 * always fills the width and a column of clock times stops claiming as much of
 * it as a column of full names.
 */
export function planColumnWidths(minNeed, want, gridW, minW = MIN_COL_W) {
  const n = minNeed.length;
  if (!n) return [];
  const widths = minNeed.map((w) => Math.max(w, minW));
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > gridW) { const k = gridW / total; return widths.map((w) => w * k); }
  let room = gridW - total;
  const deficit = widths.map((w, i) => Math.max(0, (want[i] || 0) - w));
  const totalDeficit = deficit.reduce((a, b) => a + b, 0);
  if (totalDeficit > 0) {
    const give = Math.min(room, totalDeficit);
    for (let i = 0; i < n; i += 1) widths[i] += (deficit[i] / totalDeficit) * give;
    room -= give;
  }
  if (room > 0) for (let i = 0; i < n; i += 1) widths[i] += room / n;
  return widths;
}

/**
 * Number a day's cell notes in reading order (column-page, then row, then
 * column) and tag each with the column-page it appears on.
 *
 * Numbering runs continuously through the DAY so no two notes share a number,
 * but the `cp` tag is what lets each note print on the page carrying its own
 * marker — a marker whose text sits on another sheet of paper is worse than no
 * marker at all.
 */
export function collectDayNotes(day, colPages) {
  const indexByCell = new Map();
  const notes = [];
  (colPages || []).forEach((cols, cp) => {
    (day.rows || []).forEach((row) => {
      (cols || []).forEach((col) => {
        const key = `${row.id}:${col.id}`;
        const cell = (day.cells || {})[key];
        if (!cell || !cell.note || !cell.note.text) return;
        const n = notes.length + 1;
        indexByCell.set(key, n);
        notes.push({ n, cp, col: col.name || '', row: row.label || '', text: cell.note.text, authorName: cell.note.authorName || null });
      });
    });
  });
  return { notes, indexByCell };
}

/** Mirrors SchedulingSheetGrid's linkStatus: 'linked' | 'drift' | 'missing'. */
function linkStateOf(col, liveEventsById) {
  if (!col.linkedEvent) return null;
  const live = liveEventsById && liveEventsById.get(String(col.linkedEvent.eventId));
  if (!live) return { state: 'missing' };
  const snap = col.linkedEvent.snapshot || {};
  const drifted =
    (snap.title && live.title && snap.title !== live.title) ||
    (snap.startDateTime && live.startDateTime && snap.startDateTime !== live.startDateTime) ||
    (snap.endDateTime && live.endDateTime && snap.endDateTime !== live.endDateTime);
  return { state: drifted ? 'drift' : 'linked' };
}

// Date-only keys format in LOCAL time with no explicit locale, exactly as
// SchedulingSheets.jsx formats its tabs — the print must not disagree with the
// screen it was printed from.
const fullDate = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const shortDate = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const clockTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
        .replace(' ', '').toLowerCase();
};
/** '3:45 PM' -> '3:45p': one token, so the meridiem cannot wrap alone. */
const compactTime = (t) => String(t).replace(/\s*([AP])M$/i, (m, p) => p.toLowerCase());

const slug = (s) => String(s || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sheet';

/** Latest send across the day's recipients, and whether any is stale. */
function emailSummary(day) {
  const statuses = day.emailStatus || [];
  let lastSent = null;
  let stale = false;
  for (const s of statuses) {
    if (s.sentAt && (!lastSent || s.sentAt > lastSent)) lastSent = s.sentAt;
    if (s.stale) stale = true;
  }
  return { lastSent, stale };
}

// ---------------------------------------------------------------- generator

/**
 * @param {Object}  options
 * @param {Object}  options.sheet            workbook from GET /api/scheduling-sheets/:id
 * @param {Map}     [options.liveEventsById] published events by id, for the drift flag
 * @param {number}  [options.maxDays]        runaway guard on workbook size
 * @returns {{ blob, blobUrl, fileName, dayCount, omittedDays }}
 */
export function generateSchedulingSheetPdf({ sheet, liveEventsById = null, maxDays = DEFAULT_MAX_DAYS }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  // Before ANY measurement: an unregistered font name silently falls back to
  // Helvetica, which measures differently and would break every column width.
  registerDmSans(doc);

  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const CW = PW - M * 2;
  const GRID_W = CW - LABEL_W;
  const BOTTOM = PH - M + 4;

  const allDays = (sheet && sheet.days) || [];
  const days = allDays.slice(0, maxDays);
  const omittedDays = Math.max(0, allDays.length - days.length);

  doc.setProperties({
    title: `${sheet && sheet.name ? sheet.name : 'Scheduling Sheet'} - Scheduling Sheet`,
    subject: 'Scheduling Sheet',
    author: 'Congregation Emanu-El of the City of New York',
  });

  let pageStarted = false;
  const newPage = () => { if (pageStarted) doc.addPage(); pageStarted = true; };
  let pageHasWarn = false;

  // -------------------------------------------------------------- text
  const applyStyle = (st) => {
    doc.setFont(st.f || 'DMSans', st.w || 'normal');
    doc.setFontSize(st.s);
    if (doc.setCharSpace) doc.setCharSpace(st.cs || 0);
  };
  // jsPDF's getTextWidth ignores setCharSpace, so letterspaced strings measure
  // short and overflow. Compensate so measure and draw agree.
  const measure = (t, st) => {
    applyStyle(st);
    return doc.getTextWidth(String(t)) + (st.cs || 0) * String(t).length;
  };
  const draw = (t, st, x, y) => {
    applyStyle(st);
    doc.setTextColor(...(st.c || N900));
    doc.text(String(t), x, y - (st.raise || 0));
    if (doc.setCharSpace) doc.setCharSpace(0);
  };
  const drawRight = (t, st, xRight, y) => draw(t, st, xRight - measure(t, st), y);
  /** Greedy wrap on the corrected measure; replaces splitTextToSize. */
  const wrapText = (t, st, maxW) => {
    const words = String(t).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const trial = `${cur} ${words[i]}`;
      if (measure(trial, st) <= maxW) cur = trial;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
  };

  // -------------------------------------------------------------- cell model
  // A cell is a stack of BLOCKS, one per segment — one entity per line, the way
  // a call sheet lists a crew, rather than a wrapped soup of inline boxes.
  //
  // Chip treatment mirrors the on-screen grid so print and screen agree, but at
  // a fraction of the width: only LOCATIONS get a full pill (there is normally
  // one per cell, so the padding is paid once). People are marked instead —
  // a filled sapphire dot for staff, a hollow one for an outside vendor — which
  // costs a 2.4mm gutter rather than ~6mm of pill. Placeholders take a dashed
  // underline, which costs nothing horizontally and still reads as "not filled".
  function cellBlocks(cell, noteNum, warned) {
    const blocks = [];
    for (const seg of (cell && cell.segments) || []) {
      if (seg.type === 'text') {
        blocks.push({ kind: 'text', runs: [{ t: S(seg.text), st: ST.text }], mark: null, box: null });
      } else if (seg.type === 'location') {
        blocks.push({ kind: 'location', runs: [{ t: S(seg.name), st: ST.location }], mark: 'pin', box: 'gold' });
      } else if (seg.type === 'person') {
        const isPlaceholder = !!seg.placeholder;
        const isStaff = !isPlaceholder && !!seg.userId;
        const runs = [];
        if (isPlaceholder) {
          runs.push({ t: S(String(seg.name).replace(/^@/, '')), st: ST.placeholder });
          runs.push({ t: '  TBA', st: ST.personTag });
        } else {
          runs.push({ t: S(seg.name), st: ST.person });
          if (!isStaff) runs.push({ t: '  EXT', st: ST.personTag });
          if (seg.callTimeOverride) runs.push({ t: ` ${S(compactTime(seg.callTimeOverride))}`, st: ST.callTime });
        }
        blocks.push({
          kind: 'person',
          runs,
          mark: isPlaceholder ? null : (isStaff ? 'dot' : 'ring'),
          box: null,
          underline: isPlaceholder,
          // Drawn as a vector caution mark after the name, not typed as a
          // dagger. A '†' is a typographer's convention nobody on a loading
          // dock reads as 'double-booked', and it depends on a font glyph.
          warn: !isPlaceholder && !!(seg.email && warned.has(seg.email)),
        });
      }
    }
    if (noteNum) {
      const marker = { t: String(noteNum), st: ST.noteMark };
      const last = blocks[blocks.length - 1];
      // A marker inside a chip lands on or across its border. Boxed blocks
      // carry it as a TRAILING mark, drawn clear of the frame; unboxed blocks
      // can take it inline as an ordinary superscript.
      if (last && last.box) last.trailingMark = marker;
      else if (last) last.runs = last.runs.concat(marker);
      else blocks.push({ kind: 'text', runs: [marker], mark: null, box: null });
    }
    if (!blocks.length) blocks.push({ kind: 'empty', runs: [{ t: '–', st: ST.empty }], mark: null, box: null });
    return blocks;
  }

  const blockLead = (b) => (b.mark ? MARK_W : 0) + (b.box ? CHIP_PAD_X * 2 : 0);
  const widestWord = (b) => b.runs.reduce((m, run) => String(run.t).split(/\s+/).filter(Boolean)
    .reduce((mm, w) => Math.max(mm, measure(w, run.st)), m), 0);
  const oneLine = (b) => b.runs.reduce((sum, run) => sum + measure(String(run.t), run.st), 0);

  const blockMinNeed = (b) => widestWord(b) + blockLead(b);

  /**
   * Wrap one block's runs and return its lines plus the width it is drawn at.
   *
   * A chip SHRINK-WRAPS to its text, the way the on-screen grid's chips do —
   * it is a pill, not a band. Wrapping happens at the cell's inner width, then
   * the box is sized to the text that actually resulted.
   *
   * The overflow this used to show was never caused by shrink-wrapping: the box
   * was sized from `textW`, which ignored the HANG indent added to continuation
   * lines, so a wrapped chip was drawn up to HANG too narrow for the text inside
   * it. That is corrected below, and only *second* lines ever breached the
   * frame, which is the tell.
   */
  function flowBlock(b, avail) {
    const markW = b.trailingMark ? measure(b.trailingMark.t, b.trailingMark.st) + 1.2 : 0;
    // True inner width: strip the chip's own padding, the leading mark gutter,
    // and any reserved trailing note marker. No glyph may cross the border.
    const inner = avail - blockLead(b) - markW;
    const lines = [];
    let cur = [], curW = 0;
    for (const run of b.runs) {
      const tokens = String(run.t).split(/(\s+)/).filter((s) => s.length);
      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) {
          if (cur.length) { const w = measure(' ', run.st); cur.push({ t: ' ', st: run.st, w }); curW += w; }
          continue;
        }
        const w = measure(tok, run.st);
        const indent = lines.length ? HANG : 0;
        if (cur.length && curW + w > inner - indent) { lines.push(cur); cur = [{ t: tok, st: run.st, w }]; curW = w; }
        else { cur.push({ t: tok, st: run.st, w }); curW += w; }
      }
    }
    if (cur.length) lines.push(cur);
    // Continuation lines are indented by HANG, so the width they occupy is
    // HANG wider than the text they hold — the miss that let text escape.
    const textW = lines.reduce((m, ln, i) =>
      Math.max(m, (i ? HANG : 0) + ln.reduce((s, r) => s + r.w, 0)), 0);
    const height = lines.length * LINE_H + (b.box ? CHIP_PAD_Y * 2 : 0);
    return {
      ...b, lines, textW, markW, height,
      width: Math.min(textW + blockLead(b), avail - markW),
    };
  }

  /** Width this block needs to sit on a line by itself, all on one line. */
  const blockSoloW = (b) => {
    const markW = b.trailingMark ? measure(b.trailingMark.t, b.trailingMark.st) + 1.2 : 0;
    return oneLine(b) + blockLead(b) + markW + (b.warn ? WARN_W : 0);
  };

  /**
   * Entries FLOW INLINE and wrap, rather than each taking its own line. Eight
   * ushers in a wide column belong on two or three lines, not eight — stacking
   * them wasted most of the cell and made every row taller than it needed to be.
   *
   * A block that cannot share a line (longer than the cell is wide) takes a row
   * of its own and wraps internally; everything else is laid on one line and
   * packed left to right.
   */
  function layoutCell(blocks, width) {
    const avail = width - PAD_X * 2;
    const rows = [];
    let cur = [], curW = 0;
    const flush = () => { if (cur.length) { rows.push(cur); cur = []; curW = 0; } };

    for (const b of blocks) {
      if (blockSoloW(b) > avail) {          // needs the full width, and to wrap
        flush();
        rows.push([flowBlock(b, avail)]);
        continue;
      }
      const laid = flowBlock(b, avail);      // fits, so this yields one line
      const total = laid.width + laid.markW + (laid.warn ? WARN_W : 0);
      const gap = cur.length ? BLOCK_GAP_X : 0;
      if (cur.length && curW + gap + total > avail) flush();
      cur.push(laid);
      curW += (cur.length > 1 ? BLOCK_GAP_X : 0) + total;
    }
    flush();

    const rowHeights = rows.map((r) => Math.max(...r.map((b) => b.height)));
    const height = rowHeights.reduce((a, h) => a + h, 0)
      + Math.max(0, rows.length - 1) * BLOCK_GAP
      + PAD_Y * 2;
    return { rows, rowHeights, blocks: rows.flat(), height };
  }

  function drawCell(layout, x, y) {
    let by = y + PAD_Y;
    layout.rows.forEach((row, ri) => {
      let bx = x + PAD_X;
      for (const b of row) {
        drawBlock(b, bx, by);
        bx += b.width + b.markW + (b.warn ? WARN_W : 0) + BLOCK_GAP_X;
      }
      by += layout.rowHeights[ri] + BLOCK_GAP;
    });
  }

  function drawBlock(b, bx, by) {
    if (b.box === 'gold') {
      doc.setFillColor(...GOLD50);
      doc.setDrawColor(...GOLD500);
      doc.setLineWidth(0.15);
      doc.roundedRect(bx, by, b.width, b.height, CHIP_R, CHIP_R, 'FD');
    }
    const textLeft = bx + (b.box ? CHIP_PAD_X : 0) + (b.mark ? MARK_W : 0);
    const markX = bx + (b.box ? CHIP_PAD_X : 0);
    let ly = by + (b.box ? CHIP_PAD_Y : 0) + 2.6;

    // Outside the frame, never on it.
    if (b.trailingMark) draw(b.trailingMark.t, b.trailingMark.st, bx + b.width + 1.2, ly);

    b.lines.forEach((line, li) => {
      if (li === 0 && b.mark) drawMark(b.mark, markX, ly);
      let lx = textLeft + (li ? HANG : 0);
      for (const run of line) { draw(run.t, run.st, lx, ly); lx += run.w; }
      if (li === 0 && b.warn) drawWarn(bx + b.width + 0.9, ly);
      if (b.underline) {
        const w = line.reduce((s, r) => s + r.w, 0);
        doc.setDrawColor(...N400); doc.setLineWidth(0.12);
        doc.setLineDashPattern([0.6, 0.6], 0);
        doc.line(textLeft + (li ? HANG : 0), ly + 1.1, textLeft + (li ? HANG : 0) + w, ly + 1.1);
        doc.setLineDashPattern([], 0);
      }
      ly += LINE_H;
    });
  }

  /** Caution triangle for a double-booked person. Vector, so no font glyph. */
  function drawWarn(x, baseline) {
    const cy = baseline - 1.05, r = 1.15;
    doc.setDrawColor(...WARN); doc.setLineWidth(0.28);
    doc.triangle(x + r, cy - r, x, cy + r * 0.85, x + r * 2, cy + r * 0.85, 'S');
    doc.setFillColor(...WARN);
    doc.rect(x + r - 0.11, cy - r * 0.35, 0.22, 0.85, 'F');
    doc.rect(x + r - 0.11, cy + r * 0.62, 0.22, 0.2, 'F');
  }

  /** Leading marks, drawn as vectors — no glyph in any font is relied on. */
  function drawMark(kind, x, baseline) {
    const cy = baseline - 1.1;
    if (kind === 'dot') {                       // staff
      doc.setFillColor(...SAPPHIRE600);
      doc.circle(x + 0.85, cy, 0.85, 'F');
    } else if (kind === 'ring') {               // outside vendor
      doc.setDrawColor(...N500); doc.setLineWidth(0.25);
      doc.circle(x + 0.85, cy, 0.8, 'S');
    } else if (kind === 'pin') {                // room
      doc.setFillColor(...GOLD600);
      doc.circle(x + 0.85, cy - 0.35, 0.62, 'F');
      doc.setDrawColor(...GOLD600); doc.setLineWidth(0.32);
      doc.line(x + 0.85, cy + 0.1, x + 0.85, cy + 1.35);
    }
  }

  // -------------------------------------------------------------- chrome
  function drawMasthead(day, part, partCount) {
    const y = M - 1;
    draw(HOUSE, ST.house, M, y + 2.4);
    const { lastSent, stale } = emailSummary(day);
    const meta = [S((sheet && sheet.name) || '')];
    if (partCount > 1) meta.push(`Posts ${part.from}–${part.to} of ${part.total}`);
    meta.push(lastSent
      ? `Emailed ${new Date(lastSent).toLocaleDateString(undefined)}${stale ? ', edited since' : ''}`
      : 'Not yet emailed');
    drawRight(S(meta.filter(Boolean).join('   ·   ')), ST.meta, PW - M, y + 2.4);

    const title = S(day.title || fullDate(day.date));
    draw(title, ST.dayTitle, M, y + 10.8);
    if (day.title) draw(S(fullDate(day.date)), ST.dayDate, M + measure(title, ST.dayTitle) + 3.8, y + 10.8);

    doc.setDrawColor(...SAPPHIRE700); doc.setLineWidth(RULE.masthead);
    doc.line(M, y + 13.6, PW - M, y + 13.6);
    return y + 17.5;
  }

  const contentsLines = () => wrapText(
    S(days.map((d) => `${shortDate(d.date)}${d.title ? `, ${d.title}` : ''}`).join('   ·   ')),
    ST.contentsBody, CW - 30
  );
  const contentsHeight = (lines) => lines.length * 3.2 + (omittedDays > 0 ? 3.4 : 0) + 4.4;

  function drawContents(startY, lines) {
    let y = startY;
    draw('IN THIS SHEET', ST.contentsLabel, M, y);
    lines.forEach((ln, i) => draw(ln, ST.contentsBody, M + 28, y + i * 3.2));
    y += lines.length * 3.2;
    // A silently truncated workbook would misstate its own coverage.
    if (omittedDays > 0) {
      draw(S(`First ${days.length} days shown; ${omittedDays} more — print those from their own day tabs.`),
        ST.contentsCap, M + 28, y);
      y += 3.4;
    }
    return y + 4.4;
  }

  function planTableHeader(cols, widths) {
    let nameLines = 1, capLines = 0;
    const wrapped = [], caps = [];
    cols.forEach((c, i) => {
      const w = wrapText(S(c.name || ''), ST.colName, widths[i] - PAD_X * 2);
      nameLines = Math.max(nameLines, w.length);
      wrapped.push(w);
      const status = linkStateOf(c, liveEventsById);
      const lines = [];
      if (status) {
        const snap = (c.linkedEvent && c.linkedEvent.snapshot) || {};
        if (status.state === 'missing') lines.push({ t: 'linked event removed', st: ST.colStatus });
        else {
          if (snap.startDateTime) lines.push({ t: S(`${clockTime(snap.startDateTime)}–${clockTime(snap.endDateTime)}`), st: ST.colTime });
          if (status.state === 'drift') lines.push({ t: 'changed since linked', st: ST.colStatus });
        }
      }
      capLines = Math.max(capLines, lines.length);
      caps.push(lines);
    });
    return { wrapped, caps, nameLines, h: 4.2 + nameLines * 4.2 + capLines * 3.1 + 2.6 };
  }

  function drawTableHeader(cols, xs, y, plan) {
    cols.forEach((c, i) => {
      plan.wrapped[i].forEach((ln, li) => draw(ln, ST.colName, xs[i] + PAD_X, y + 4.2 + li * 4.2));
      plan.caps[i].forEach((cl, li) =>
        draw(cl.t, cl.st, xs[i] + PAD_X, y + 4.2 + plan.nameLines * 4.2 + li * 3.1));
    });
    doc.setDrawColor(...SAPPHIRE700); doc.setLineWidth(RULE.colHead);
    doc.line(M, y + plan.h, xs.gridRight, y + plan.h);
    return y + plan.h;
  }

  /**
   * Notes run in TWO COLUMNS once there are three or more. The page is 265mm
   * wide; a single stacked column of four notes is both ugly and expensive —
   * it was costing ~11mm of height, which is precisely what pushed a day's
   * notes onto a page of their own.
   */
  const NOTE_COLS = (count) => (count >= 3 ? 2 : 1);
  const NOTE_GUTTER = 8;

  function planNotes(pageNotes) {
    if (!pageNotes.length) return { rows: [], h: 0, cols: 1, colW: 0 };
    const cols = NOTE_COLS(pageNotes.length);
    const colW = (CW - NOTE_GUTTER * (cols - 1)) / cols;
    const rows = pageNotes.map((n) => {
      const head = S(`${n.col} — ${n.row}`);
      const headW = measure(head, ST.noteHead);
      const indent = 5.5 + headW + 2.5;
      const body = wrapText(
        S(`${n.text}${n.authorName ? `  (${n.authorName})` : ''}`),
        ST.noteBody,
        Math.max(30, colW - indent),
      );
      return { n: n.n, head, indent, body, h: body.length * 3.5 + 0.9 };
    });
    // Balance by height, not by count, so a long note does not leave one
    // column short and the other running past the page.
    const perCol = Math.ceil(rows.length / cols);
    let h = 0;
    for (let c = 0; c < cols; c += 1) {
      const slice = rows.slice(c * perCol, (c + 1) * perCol);
      h = Math.max(h, slice.reduce((a, r) => a + r.h, 0));
    }
    return { rows, cols, colW, perCol, h: 4.6 + h };
  }

  function drawNotes(plan, startY) {
    draw('NOTES', ST.notesTitle, M, startY);
    doc.setDrawColor(...N200); doc.setLineWidth(RULE.hair);
    doc.line(M + 16, startY - 1.0, PW - M, startY - 1.0);
    const top = startY + 4.6;

    plan.rows.forEach((r, i) => {
      const c = Math.floor(i / plan.perCol);
      const x = M + c * (plan.colW + NOTE_GUTTER);
      let y = top + plan.rows.slice(c * plan.perCol, i).reduce((a, p) => a + p.h, 0);
      draw(String(r.n), ST.noteNum, x + 0.5, y);
      draw(r.head, ST.noteHead, x + 5.5, y);
      draw(r.body[0], ST.noteBody, x + r.indent, y);
      y += 3.3;
      for (let k = 1; k < r.body.length; k += 1) { draw(r.body[k], ST.noteBody, x + 5.5, y); y += 3.3; }
    });
  }

  function drawFooter(pageNum, totalPages) {
    const y = PH - M + 5.5;
    doc.setDrawColor(...N200); doc.setLineWidth(RULE.hair);
    doc.line(M, y - 3.2, PW - M, y - 3.2);
    draw(S(`Generated ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`), ST.footer, M, y);
    applyStyle(ST.footer); doc.setTextColor(...ST.footer.c);
    doc.text('Congregation Emanu-El of the City of New York', PW / 2, y, { align: 'center' });
    drawRight(`${pageNum} / ${totalPages}`, ST.footer, PW - M, y);
  }

  // -------------------------------------------------------------- document
  days.forEach((day, dayIdx) => {
    const warned = computeDoubleBookedEmails(day);
    const colPages = chunkColumns(day.columns);
    const { notes, indexByCell } = collectDayNotes(day, colPages);
    const rows = day.rows || [];

    colPages.forEach((cols, pageIdx) => {
      const from = colPages.slice(0, pageIdx).reduce((a, c) => a + c.length, 0) + 1;
      const part = { from, to: from + cols.length - 1, total: (day.columns || []).length };

      // PASS 1 — measure content, then size the columns to it.
      const blocksByCell = rows.map((row) => cols.map((c) => {
        const key = `${row.id}:${c.id}`;
        return cellBlocks((day.cells || {})[key], indexByCell.get(key), warned);
      }));
      const minNeed = cols.map((c, ci) => {
        let w = 0;
        for (let ri = 0; ri < rows.length; ri += 1)
          for (const b of blocksByCell[ri][ci]) w = Math.max(w, blockMinNeed(b));
        for (const word of S(c.name || '').split(/\s+/)) w = Math.max(w, measure(word, ST.colName));
        return w + PAD_X * 2;
      });
      // `want` stays the widest SINGLE entry, not the whole cell on one line.
      // Summing every entry was tried and made a column of eight ushers demand
      // ~100mm, which starved its neighbours, narrowed them into extra wrapping
      // and cost a whole page. Entries flow inline regardless; the allocator
      // just should not bid for a width no page can give.
      const want = cols.map((c, ci) => {
        let w = 0;
        for (let ri = 0; ri < rows.length; ri += 1)
          for (const b of blocksByCell[ri][ci]) w = Math.max(w, blockSoloW(b));
        return w + PAD_X * 2;
      });
      const widths = planColumnWidths(minNeed, want, GRID_W);
      const xs = [];
      let cursor = M + LABEL_W;
      for (const w of widths) { xs.push(cursor); cursor += w; }
      xs.gridRight = M + LABEL_W + widths.reduce((a, b) => a + b, 0);

      const headerPlan = planTableHeader(cols, widths);
      const notesPlan = planNotes(notes.filter((n) => n.cp === pageIdx));
      const showContents = dayIdx === 0 && pageIdx === 0;
      const contents = showContents ? contentsLines() : null;
      const contentsH = showContents ? contentsHeight(contents) : 0;

      // PASS 2 — lay every cell out at its final width; snap to the rhythm so
      // every baseline on the page sits on one grid.
      const layouts = blocksByCell.map((rowBlocks) => {
        const cells = rowBlocks.map((b, ci) => layoutCell(b, widths[ci]));
        // Level the chips across the row: a band of boxes at three different
        // heights reads as broken, so every boxed block on a row takes the
        // tallest one's height. Cell heights are recomputed from the result.
        const tallestChip = cells.reduce((m, cell) =>
          cell.blocks.reduce((mm, b) => (b.box ? Math.max(mm, b.height) : mm), m), 0);
        if (tallestChip > 0) {
          for (const cell of cells) {
            for (const b of cell.blocks) if (b.box) b.height = tallestChip;
            cell.height = cell.blocks.reduce((a, b) => a + b.height, 0) + PAD_Y * 2;
          }
        }
        return cells;
      });
      // The row LABEL has to be measured too, not just the cells. A label like
      // '65TH ST HELP DESK/LOBBY' wraps to three lines and needs ~13mm, while a
      // row whose cells are all short would otherwise be ROW_MIN_H (7.2mm) —
      // and the label then overran into the row beneath it.
      const labelH = (row) =>
        LABEL_LEAD + (wrapText(S(row.label || '').toUpperCase(), ST.rowLabel, LABEL_W - PAD_X * 2).length - 1) * LABEL_LINE
        + LABEL_TAIL;
      const natural = layouts.map((ls, ri) => {
        const raw = Math.max(ROW_MIN_H, labelH(rows[ri]), ...ls.map((l) => l.height));
        return Math.ceil(raw / RHYTHM) * RHYTHM;
      });

      // PASS 3 — pack rows into physical pages. Heights are NEVER stretched.
      const availOn = (physIdx) =>
        BOTTOM - ((M - 1) + 17.5 + (physIdx === 0 ? contentsH : 0) + headerPlan.h);
      const groups = [];
      let current = [], used = 0, avail = availOn(0);
      natural.forEach((h, i) => {
        if (current.length && used + h > avail) {
          groups.push({ rows: current, avail });
          current = []; used = 0; avail = availOn(groups.length);
        }
        current.push(i); used += h;
      });
      groups.push({ rows: current, avail });

      const last = groups[groups.length - 1];
      const lastUsed = last.rows.reduce((a, i) => a + natural[i], 0);
      const notesInline = notesPlan.h > 0 && lastUsed + notesPlan.h + 4 <= last.avail;

      groups.forEach((group, physIdx) => {
        newPage();
        pageHasWarn = false;
        let y = drawMasthead(day, part, colPages.length);
        if (showContents && physIdx === 0) y = drawContents(y, contents);
        y = drawTableHeader(cols, xs, y, headerPlan);

        group.rows.forEach((rowIdx, k) => {
          const row = rows[rowIdx];
          const h = natural[rowIdx];
          const isLast = k === group.rows.length - 1;
          const nextRow = rows[group.rows[k + 1]];
          const sectionBreak = !!nextRow && row.kind === 'starter' && nextRow.kind !== 'starter';

          // The seeded rows carry a primary-50 wash — a direct quote of the
          // app's `.ss-row-starter` band. It also does real work: the wash
          // simply stopping is what marks the hand-off to the sheet's own rows.
          if (row.kind === 'starter') {
            doc.setFillColor(...SAPPHIRE50);
            doc.rect(M, y, xs.gridRight - M, h, 'F');
          }

          wrapText(S(row.label || '').toUpperCase(), ST.rowLabel, LABEL_W - PAD_X * 2)
            .forEach((ln, i) => draw(ln, ST.rowLabel, M + PAD_X, y + LABEL_LEAD + i * LABEL_LINE));

          cols.forEach((c, i) => {
            const cellLayout = layouts[rowIdx][i];
            if (cellLayout.blocks.some((b) => b.warn)) pageHasWarn = true;
            drawCell(cellLayout, xs[i], y);
          });

          doc.setDrawColor(...N200); doc.setLineWidth(RULE.hair);
          doc.line(M + LABEL_W, y, M + LABEL_W, y + h);
          for (let i = 1; i < cols.length; i += 1) doc.line(xs[i], y, xs[i], y + h);
          if (isLast) {
            doc.setDrawColor(...SAPPHIRE700); doc.setLineWidth(RULE.close);
            doc.line(M, y + h, xs.gridRight, y + h);
          } else if (sectionBreak) {
            doc.setDrawColor(...N300); doc.setLineWidth(RULE.section);
            doc.line(M, y + h, xs.gridRight, y + h);
          } else {
            doc.setDrawColor(...N200); doc.setLineWidth(RULE.hair);
            doc.line(M, y + h, xs.gridRight, y + h);
          }
          y += h;
        });

        if (physIdx === groups.length - 1 && notesPlan.h > 0) {
          if (notesInline) drawNotes(notesPlan, y + 5);
          else { newPage(); const ny = drawMasthead(day, part, colPages.length); drawNotes(notesPlan, ny + 4); }
        }
        if (pageHasWarn) {
          drawWarn(M + 0.6, PH - M + 1.5);
          draw(S('also assigned to another post whose times overlap'), ST.legend, M + WARN_W + 1.2, PH - M + 1.5);
        }
      });
    });
  });

  if (!pageStarted) {
    // An empty workbook still gets an honest page rather than a blank one.
    draw('This scheduling sheet has no days yet.', ST.dayDate, PW / 2 - 30, 60);
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) { doc.setPage(i); drawFooter(i, totalPages); }

  const firstDate = days.length ? days[0].date : new Date().toISOString().slice(0, 10);
  const fileName = `emanu-el-scheduling-${slug(sheet && sheet.name)}-${firstDate}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blob, blobUrl, fileName, dayCount: days.length, omittedDays };
}

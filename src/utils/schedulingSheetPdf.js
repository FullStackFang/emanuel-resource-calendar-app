// src/utils/schedulingSheetPdf.js
//
// Landscape PDF export for a Scheduling Sheet workbook — the printed artifact
// that replaced the Excel sheet. Every day in the workbook is rendered, one
// day per page (more when a day has more posts than fit across the sheet).
//
// LAYOUT GOAL: the grid IS the document. Chrome is held to a single 10mm band
// at the top and a 5mm footer; everything left over is given back to the rows,
// so a sheet with nine rows prints nine TALL rows rather than a small table
// floating in half a page of white. Taller rows also double as handwriting
// space on a clipboard, which is how these sheets are actually used.
//
// It borrows the gold rule and muted palette from calendarPdfGenerator.js and
// reuses that module's sanitizeForPdfText — jsPDF's built-in fonts are
// WinAnsi-only, so any user-entered codepoint above 0xFF is byte-split into
// mojibake rather than failing loudly. EVERY user string here goes through it.
//
// This is a pure read of data already in the React Query cache: no network
// call, no write, nothing touches Graph or templeEvents__Events.

import { jsPDF } from 'jspdf';
import { sanitizeForPdfText } from './calendarPdfGenerator';
import { computeDoubleBookedEmails } from '../components/scheduling/sheetEventUtils';

const S = sanitizeForPdfText;

// ---------------------------------------------------------------- design system
const colors = {
  primary: [45, 52, 64],
  secondary: [107, 114, 128],
  bodyText: [51, 51, 51],
  accent: [180, 142, 73],
  border: [229, 231, 235],
  muted: [156, 163, 175],
  warn: [150, 52, 52],
  // Echoes of the on-screen grid, so the print and the screen read as one thing.
  starterTint: [239, 244, 250],
  starterLabel: [230, 238, 248],
  customLabel: [245, 245, 244],
  zebra: [252, 252, 251],
  chipUserBg: [238, 244, 251], chipUserBorder: [194, 215, 239], chipUserText: [42, 77, 128],
  chipExtBg: [245, 245, 244], chipExtBorder: [214, 211, 209], chipExtText: [68, 64, 60],
  chipPhBorder: [168, 162, 158], chipPhText: [120, 113, 108],
  chipLocBg: [248, 243, 233], chipLocBorder: [214, 196, 158], chipLocText: [120, 90, 60],
};

// Sized to be read at arm's length on a clipboard, not on a screen.
const F = {
  ident: 7, dayTitle: 14, dayDate: 9.5,
  colHeader: 9, colTime: 7, rowLabel: 8.8, cell: 8.8, chip: 7.8, tiny: 6.6, note: 7.8,
};

const M = 8;                       // page margin — narrow, the grid is the page
const LABEL_W = 30;                // frozen row-label column, repeated per page
const MIN_COL_W = 32;              // narrower than this and a name chip cannot fit
const ROW_MIN_H = 9;
const MAX_ROW_H = 30;              // stops a two-row day stretching into absurdity
const DAY_HEADER_H = 10.4;
const NOTES_GAP = 5;
const PAD_X = 1.8, PAD_Y = 1.8, LINE_H = 4.6;
const CHIP_H = 4.6, CHIP_R = 1.4, CHIP_PAD = 1.6, CHIP_GAP = 1.3;

export const MAX_COLS_PER_PAGE = 6;
export const DEFAULT_MAX_DAYS = 31;

// ---------------------------------------------------------------- pure planners

/**
 * Split a day's columns across pages, BALANCED rather than greedily filled:
 * 9 posts become 5 + 4, not 6 + 3. A lone straggler column on the second page
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
 * Number a day's cell notes in reading order (column-page, then row, then
 * column) and tag each with the column-page it appears on.
 *
 * Numbering runs continuously through the DAY so no two notes on a day share a
 * number, but the `cp` tag is what lets the renderer print each note on the
 * page carrying its own marker — a marker whose text sits on a different sheet
 * of paper is worse than no marker at all.
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

/**
 * Give a page's leftover vertical space back to its rows, in EQUAL amounts.
 *
 * Equal addition (not proportional scaling) is deliberate: scaling would
 * exaggerate an already-tall row, while a uniform bump keeps the grid regular
 * and reads as a form. Rows stop growing at MAX_ROW_H, and the height they
 * refuse is re-offered to the rows still under the cap — otherwise one capped
 * row would strand space the others could have used.
 *
 * @param {number[]} natural  measured row heights, in order
 * @param {number}   avail    vertical space this page can give them
 * @returns {number[]} final heights (never shorter than `natural`)
 */
export function distributeRowHeights(natural, avail) {
  const heights = [...natural];
  if (!heights.length) return heights;
  let room = avail - heights.reduce((a, b) => a + b, 0);
  // Bounded: each pass either fills every growable row or exhausts `room`.
  for (let pass = 0; pass < 6 && room > 0.5; pass += 1) {
    const growable = heights.reduce((acc, h, i) => (h < MAX_ROW_H - 0.01 ? acc.concat(i) : acc), []);
    if (!growable.length) break;
    const share = room / growable.length;
    let consumed = 0;
    for (const i of growable) {
      const grow = Math.min(share, MAX_ROW_H - heights[i]);
      heights[i] += grow;
      consumed += grow;
    }
    room -= consumed;
    if (consumed < 0.01) break;
  }
  return heights;
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
  return { state: drifted ? 'drift' : 'linked', live };
}

// Date-only keys are formatted in LOCAL time with no explicit locale, exactly
// as SchedulingSheets.jsx formats its tabs and title — the print must not
// disagree with the screen it was printed from.
const fullDate = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key
    : d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};
const shortDate = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const clockTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '');
};

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
 * @param {Object}  options.sheet            workbook as returned by GET /api/scheduling-sheets/:id
 * @param {Map}     [options.liveEventsById] published events by id, for the drift flag
 * @param {number}  [options.maxDays]        runaway guard on workbook size
 * @returns {{ blob, blobUrl, fileName, dayCount, omittedDays }}
 */
export function generateSchedulingSheetPdf({ sheet, liveEventsById = null, maxDays = DEFAULT_MAX_DAYS }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const CW = PW - M * 2;
  const BOTTOM = PH - 9;           // just above the one-line footer

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

  // -------------------------------------------------------------- cell layout
  // A cell mixes wrappable free text with atomic chips, so this is a small flow
  // engine: words carry their own space width and can break; chips are
  // unbreakable boxes. Everything is measured at the exact font and size it
  // will be drawn at — that measure/draw symmetry is what keeps pills apart.
  function layoutCell(cell, width, noteNum, warned) {
    const avail = width - PAD_X * 2;
    const items = [];
    for (const seg of (cell && cell.segments) || []) {
      if (seg.type === 'text') {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(F.cell);
        for (const word of S(seg.text).split(/\s+/).filter(Boolean)) {
          items.push({ kind: 'word', text: word, w: doc.getTextWidth(word), space: doc.getTextWidth(' ') });
        }
      } else if (seg.type === 'location') {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(F.chip);
        const label = S(seg.name);
        items.push({ kind: 'chip', variant: 'location', label, tag: '', call: '', w: Math.min(doc.getTextWidth(label) + CHIP_PAD * 2 + 2.8, avail) });
      } else if (seg.type === 'person') {
        const variant = seg.placeholder ? 'placeholder' : seg.userId ? 'user' : 'external';
        doc.setFont('helvetica', seg.placeholder ? 'italic' : 'normal'); doc.setFontSize(F.chip);
        const label = S(seg.name);
        const tag = seg.placeholder ? 'unassigned' : variant === 'external' ? 'ext' : '';
        const call = seg.callTimeOverride ? S(seg.callTimeOverride) : '';
        let w = doc.getTextWidth(label) + CHIP_PAD * 2 + (variant === 'user' ? 2.6 : 0);
        doc.setFontSize(F.tiny);
        if (tag) w += doc.getTextWidth(tag) + 1.5;
        if (call) w += doc.getTextWidth(call) + 1.7;
        items.push({ kind: 'chip', variant, label, tag, call, w: Math.min(w, avail), warn: !!(seg.email && warned.has(seg.email)) });
      }
    }
    if (noteNum) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny);
      items.push({ kind: 'note', text: String(noteNum), w: doc.getTextWidth(String(noteNum)) + 0.8 });
    }

    const lines = [];
    let line = [], used = 0;
    for (const it of items) {
      const gap = line.length ? (it.kind === 'word' && line[line.length - 1].kind === 'word' ? it.space : CHIP_GAP) : 0;
      if (line.length && used + gap + it.w > avail) { lines.push(line); line = [it]; used = it.w; }
      else { if (line.length) used += gap; line.push(it); used += it.w; }
    }
    if (line.length) lines.push(line);
    return { lines, height: Math.max(lines.length, 1) * LINE_H + PAD_Y * 2 };
  }

  function drawCell(layout, x, y) {
    let ly = y + PAD_Y + 3.4;
    for (const line of layout.lines) {
      let lx = x + PAD_X;
      for (let i = 0; i < line.length; i += 1) {
        const it = line[i];
        if (i > 0) lx += (it.kind === 'word' && line[i - 1].kind === 'word') ? it.space : CHIP_GAP;
        if (it.kind === 'word') {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(F.cell); doc.setTextColor(...colors.bodyText);
          doc.text(it.text, lx, ly);
        } else if (it.kind === 'note') {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.accent);
          doc.text(it.text, lx, ly - 1.6);
        } else {
          drawChip(it, lx, ly - 3.4);
        }
        lx += it.w;
      }
      ly += LINE_H;
    }
  }

  function drawChip(it, lx, top) {
    const v = it.variant;
    const bg = v === 'location' ? colors.chipLocBg : v === 'user' ? colors.chipUserBg : v === 'external' ? colors.chipExtBg : null;
    const bd = v === 'location' ? colors.chipLocBorder : v === 'user' ? colors.chipUserBorder : v === 'external' ? colors.chipExtBorder : colors.chipPhBorder;
    const tx = v === 'location' ? colors.chipLocText : v === 'user' ? colors.chipUserText : v === 'external' ? colors.chipExtText : colors.chipPhText;

    doc.setDrawColor(...bd); doc.setLineWidth(0.25);
    if (v === 'placeholder') doc.setLineDashPattern([0.7, 0.7], 0);
    if (bg) { doc.setFillColor(...bg); doc.roundedRect(lx, top, it.w, CHIP_H, CHIP_R, CHIP_R, 'FD'); }
    else doc.roundedRect(lx, top, it.w, CHIP_H, CHIP_R, CHIP_R, 'S');
    doc.setLineDashPattern([], 0);

    // Glyphs are drawn as vectors, never as text: a bullet or a map pin from
    // the emoji planes cannot survive WinAnsi encoding.
    let cx = lx + CHIP_PAD;
    if (v === 'user') { doc.setFillColor(...tx); doc.circle(cx + 0.8, top + CHIP_H / 2, 0.8, 'F'); cx += 2.6; }
    if (v === 'location') {
      doc.setFillColor(...tx); doc.circle(cx + 0.9, top + CHIP_H / 2 - 0.4, 0.6, 'F');
      doc.setDrawColor(...tx); doc.setLineWidth(0.3);
      doc.line(cx + 0.9, top + CHIP_H / 2 + 0.1, cx + 0.9, top + CHIP_H / 2 + 1.4);
      cx += 2.8;
    }

    doc.setFont('helvetica', v === 'placeholder' ? 'italic' : 'normal'); doc.setFontSize(F.chip); doc.setTextColor(...tx);
    doc.text(it.label, cx, top + CHIP_H / 2 + 1.1);
    cx += doc.getTextWidth(it.label);
    if (it.call) {
      doc.setFontSize(F.tiny); doc.setTextColor(...colors.accent);
      doc.text(it.call, cx + 1.3, top + CHIP_H / 2 + 1.1);
      cx += 1.3 + doc.getTextWidth(it.call);
    }
    if (it.tag) {
      doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
      doc.text(it.tag, cx + 1.3, top + CHIP_H / 2 + 1.1);
    }
    if (it.warn) {
      const wx = lx + it.w + 1.1;
      doc.setFillColor(...colors.warn); doc.circle(wx, top + CHIP_H / 2, 1.4, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(255, 255, 255);
      doc.text('!', wx, top + CHIP_H / 2 + 0.95, { align: 'center' });
    }
  }

  // -------------------------------------------------------------- page chrome

  /**
   * One 10mm band replaces what used to be a centred masthead, a subtitle and a
   * boxed day card (37mm). The day and its date lead at full size; the identity,
   * workbook, posts-range and email state are demoted to a single muted line on
   * the right, where they are available but never compete with the grid.
   */
  function drawDayHeader(day, part, partCount) {
    const top = M - 2;
    let x = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.dayTitle); doc.setTextColor(...colors.primary);
    const title = S(day.title || fullDate(day.date));
    doc.text(title, x, top + 5.2);
    x += doc.getTextWidth(title) + 3;
    if (day.title) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(F.dayDate); doc.setTextColor(...colors.secondary);
      doc.text(S(fullDate(day.date)), x, top + 5.2);
    }

    const { lastSent, stale } = emailSummary(day);
    const right = ['CONGREGATION EMANU-EL', S((sheet && sheet.name) || '')];
    if (partCount > 1) right.push(`POSTS ${part.from}-${part.to} OF ${part.total}`);
    right.push(lastSent
      ? `EMAILED ${new Date(lastSent).toLocaleDateString(undefined)}${stale ? ' (EDITED SINCE)' : ''}`
      : 'NOT YET EMAILED');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.ident); doc.setTextColor(...colors.muted);
    doc.text(S(right.filter(Boolean).join('  ·  ')), PW - M, top + 5.0, { align: 'right' });

    doc.setDrawColor(...colors.accent); doc.setLineWidth(1);
    doc.line(M, top + 7.6, PW - M, top + 7.6);
    return top + DAY_HEADER_H;
  }

  /** One muted line on page 1 listing the whole workbook. */
  function contentsLines() {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.tiny);
    const label = days.map((d) => `${shortDate(d.date)}${d.title ? ` · ${d.title}` : ''}`).join('   |   ');
    return doc.splitTextToSize(S(label), CW - 20);
  }
  const contentsHeight = (lines) => lines.length * 3.0 + (omittedDays > 0 ? 3.4 : 0) + 2.4;

  function drawContents(startY, lines) {
    let y = startY + 2.4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text('IN THIS SHEET', M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.secondary);
    doc.text(lines, M + 19, y);
    y += lines.length * 3.0;
    // A silently truncated workbook would misstate its own coverage.
    if (omittedDays > 0) {
      doc.setTextColor(...colors.warn);
      doc.text(S(`Showing the first ${days.length} days of ${allDays.length} - print the remaining days from their own day tabs.`), M + 19, y);
      y += 3.4;
    }
    return y;
  }

  /** Measured separately from drawing so row packing can budget for it. */
  function planTableHeader(cols, colW) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.colHeader);
    let maxLines = 1;
    const wrapped = cols.map((c) => {
      const w = doc.splitTextToSize(S(c.name || ''), colW - 3);
      maxLines = Math.max(maxLines, w.length);
      return w;
    });
    const anyCaption = cols.some((c) => linkStateOf(c, liveEventsById));
    // Derive the band height FROM the caption's baseline rather than computing
    // the two separately — two formulas for one number is how the caption ended
    // up sitting exactly on the band's edge, with its descenders clipped off.
    const lastNameY = 4.6 + (maxLines - 1) * 3.5;
    const captionY = anyCaption ? lastNameY + 3.4 : null;
    const h = Math.max(7.6, (captionY || lastNameY) + 2.4);
    return { wrapped, maxLines, captionY, h };
  }

  function drawTableHeader(cols, colW, startY, plan) {
    doc.setFillColor(...colors.primary); doc.rect(M, startY, CW, plan.h, 'F');
    cols.forEach((c, i) => {
      const x = M + LABEL_W + i * colW;
      doc.setDrawColor(90, 96, 108); doc.setLineWidth(0.2);
      doc.line(x, startY + 1.2, x, startY + plan.h - 1.2);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.colHeader); doc.setTextColor(255, 255, 255);
      plan.wrapped[i].forEach((ln, li) => doc.text(ln, x + 2.2, startY + 4.6 + li * 3.5));

      // The snapshot time is what the sheet was built against. Drift is
      // reported, never silently re-synced — the same stance as the grid.
      const status = linkStateOf(c, liveEventsById);
      if (!status) return;
      const snap = (c.linkedEvent && c.linkedEvent.snapshot) || {};
      let caption = '';
      if (status.state === 'missing') caption = '(linked event no longer exists)';
      else {
        if (snap.startDateTime) caption = `${clockTime(snap.startDateTime)}${snap.endDateTime ? `-${clockTime(snap.endDateTime)}` : ''}`;
        if (status.state === 'drift') caption += `${caption ? '  ' : ''}(event changed since linked)`;
      }
      if (!caption || plan.captionY == null) return;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(F.colTime);
      doc.setTextColor(...(status.state === 'linked' ? colors.accent : [222, 178, 120]));
      doc.text(S(caption), x + 2.2, startY + plan.captionY);
    });
    return startY + plan.h;
  }

  /** Wrapped note bodies, measured once and reused for both budget and draw. */
  function planNotes(pageNotes) {
    if (!pageNotes.length) return { rows: [], h: 0 };
    const rows = pageNotes.map((n) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.note);
      const head = S(`${n.col} · ${n.row}`);
      // Measure while BOLD is still active. getTextWidth reads the CURRENT
      // font, so measuring after the switch to normal under-reads and runs the
      // body text back over the heading.
      const headW = doc.getTextWidth(head);
      doc.setFont('helvetica', 'normal');
      const bodyX = M + 6.5 + headW;
      const body = doc.splitTextToSize(S(`${n.text}${n.authorName ? `  — ${n.authorName}` : ''}`), Math.max(20, PW - M - bodyX));
      return { n: n.n, head, bodyX, body };
    });
    const h = 4.6 + rows.reduce((a, r) => a + r.body.length * 3.6 + 0.8, 0);
    return { rows, h };
  }

  function drawNotes(plan, startY) {
    let y = startY;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny);
    const pw = doc.getTextWidth('NOTES') + 6;
    doc.setFillColor(...colors.accent); doc.roundedRect(M, y - 3.2, pw, 5, 1, 1, 'F');
    doc.setTextColor(255, 255, 255); doc.text('NOTES', M + 3, y);
    doc.setDrawColor(...colors.border); doc.setLineWidth(0.3);
    doc.line(M + pw + 2, y - 0.7, PW - M, y - 0.7);
    y += 4.6;

    for (const r of plan.rows) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.note); doc.setTextColor(...colors.accent);
      doc.text(String(r.n), M + 1, y);
      doc.setTextColor(...colors.primary);
      doc.text(r.head, M + 5, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.bodyText);
      doc.text(r.body[0], r.bodyX, y);
      y += 3.6;
      for (let i = 1; i < r.body.length; i += 1) { doc.text(r.body[i], M + 5, y); y += 3.6; }
      y += 0.8;
    }
  }

  function drawFooter(pageNum, totalPages) {
    const y = PH - 4.6;
    doc.setDrawColor(...colors.border); doc.setLineWidth(0.3);
    doc.line(M, y - 3.2, PW - M, y - 3.2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text(S(`Generated ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`), M, y);
    doc.text('Congregation Emanu-El of the City of New York', PW / 2, y, { align: 'center' });
    doc.text(`Page ${pageNum} of ${totalPages}`, PW - M, y, { align: 'right' });
  }

  // -------------------------------------------------------------- document
  days.forEach((day, dayIdx) => {
    const warned = computeDoubleBookedEmails(day);
    const colPages = chunkColumns(day.columns);
    const { notes, indexByCell } = collectDayNotes(day, colPages);
    const rows = day.rows || [];

    colPages.forEach((cols, pageIdx) => {
      const colW = Math.max(MIN_COL_W, (CW - LABEL_W) / Math.max(cols.length, 1));
      const from = colPages.slice(0, pageIdx).reduce((a, c) => a + c.length, 0) + 1;
      const part = { from, to: from + cols.length - 1, total: (day.columns || []).length };

      const headerPlan = planTableHeader(cols, colW);
      const notesPlan = planNotes(notes.filter((n) => n.cp === pageIdx));
      const showContents = dayIdx === 0 && pageIdx === 0;
      const contents = showContents ? contentsLines() : null;
      const contentsH = showContents ? contentsHeight(contents) : 0;

      // PASS 1 — measure every row at its natural height.
      const rowLayouts = rows.map((row) => cols.map((c) => {
        const key = `${row.id}:${c.id}`;
        return layoutCell((day.cells || {})[key], colW, indexByCell.get(key), warned);
      }));
      const natural = rowLayouts.map((ls) => Math.max(ROW_MIN_H, ...ls.map((l) => l.height)));

      // PASS 2 — pack rows into physical pages.
      const availOn = (physIdx) =>
        BOTTOM - ((M - 2) + DAY_HEADER_H + (physIdx === 0 ? contentsH : 0) + headerPlan.h);

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

      // The day's notes ride on its last physical page when they fit; when they
      // do not, they take a page of their own rather than shrinking the grid.
      const last = groups[groups.length - 1];
      const lastNatural = last.rows.reduce((a, i) => a + natural[i], 0);
      const notesInline = notesPlan.h > 0 && lastNatural + notesPlan.h + NOTES_GAP <= last.avail;
      if (notesInline) last.avail -= notesPlan.h + NOTES_GAP;

      // PASS 3 — hand each page's leftover height back to its rows, then draw.
      groups.forEach((group, physIdx) => {
        const heights = distributeRowHeights(group.rows.map((i) => natural[i]), group.avail);

        newPage();
        let y = drawDayHeader(day, part, colPages.length);
        if (showContents && physIdx === 0) y = drawContents(y, contents);
        y = drawTableHeader(cols, colW, y, headerPlan);

        const gridRight = M + LABEL_W + cols.length * colW;
        group.rows.forEach((rowIdx, k) => {
          const row = rows[rowIdx];
          const h = heights[k];
          const isStarter = row.kind === 'starter';

          if (isStarter) { doc.setFillColor(...colors.starterTint); doc.rect(M, y, CW, h, 'F'); }
          else if (k % 2 === 1) { doc.setFillColor(...colors.zebra); doc.rect(M, y, CW, h, 'F'); }

          doc.setFillColor(...(isStarter ? colors.starterLabel : colors.customLabel));
          doc.rect(M, y, LABEL_W, h, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(F.rowLabel); doc.setTextColor(...colors.primary);
          doc.splitTextToSize(S(row.label || ''), LABEL_W - 4)
            .forEach((ln, i) => doc.text(ln, M + 2.5, y + 5.2 + i * 3.6));

          cols.forEach((c, i) => drawCell(rowLayouts[rowIdx][i], M + LABEL_W + i * colW, y));

          doc.setDrawColor(...colors.border); doc.setLineWidth(0.2);
          doc.line(M, y + h, gridRight, y + h);
          doc.line(M, y, M, y + h);
          for (let i = 0; i <= cols.length; i += 1) {
            const x = M + LABEL_W + i * colW;
            doc.line(x, y, x, y + h);
          }
          y += h;
        });

        doc.setDrawColor(...colors.primary); doc.setLineWidth(0.5);
        doc.line(M, y, gridRight, y);

        if (physIdx === groups.length - 1 && notesPlan.h > 0) {
          if (notesInline) {
            drawNotes(notesPlan, y + NOTES_GAP + 1);
          } else {
            newPage();
            const ny = drawDayHeader(day, part, colPages.length);
            drawNotes(notesPlan, ny + 4);
          }
        }
      });
    });
  });

  if (!pageStarted) {
    // An empty workbook still gets an honest page rather than a blank one.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.dayDate); doc.setTextColor(...colors.secondary);
    doc.text('This scheduling sheet has no days yet.', PW / 2, 60, { align: 'center' });
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) { doc.setPage(i); drawFooter(i, totalPages); }

  const firstDate = days.length ? days[0].date : new Date().toISOString().slice(0, 10);
  const fileName = `emanu-el-scheduling-${slug(sheet && sheet.name)}-${firstDate}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blob, blobUrl, fileName, dayCount: days.length, omittedDays };
}

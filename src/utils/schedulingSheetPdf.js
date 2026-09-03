// src/utils/schedulingSheetPdf.js
//
// Landscape PDF export for a Scheduling Sheet workbook — the printed artifact
// that replaced the Excel sheet. Every day in the workbook is rendered, one
// day per page (more when a day has more posts than fit across the sheet).
//
// It reuses the 'Institutional Elegance' system from calendarPdfGenerator.js
// (gold rule, centred wordmark, dark-slate table band, gold pills, three-part
// footer) and that module's sanitizeForPdfText — jsPDF's built-in fonts are
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
  light: [249, 250, 251],
  border: [229, 231, 235],
  muted: [156, 163, 175],
  warn: [150, 52, 52],
  // Echoes of the on-screen grid, so the print and the screen read as one thing.
  starterTint: [239, 244, 250],
  starterLabel: [232, 239, 248],
  customLabel: [245, 245, 244],
  zebra: [252, 252, 251],
  chipUserBg: [238, 244, 251], chipUserBorder: [194, 215, 239], chipUserText: [42, 77, 128],
  chipExtBg: [245, 245, 244], chipExtBorder: [214, 211, 209], chipExtText: [68, 64, 60],
  chipPhBorder: [168, 162, 158], chipPhText: [120, 113, 108],
  chipLocBg: [248, 243, 233], chipLocBorder: [214, 196, 158], chipLocText: [120, 90, 60],
};

const F = {
  wordmark: 15, sheetName: 10.5, dayTitle: 13, dayDate: 9,
  colHeader: 7.6, colTime: 6.4, rowLabel: 7.6, cell: 7.6, chip: 6.8, tiny: 6.2, note: 7.4,
};

const M = 10;                      // page margin
const LABEL_W = 32;                // frozen row-label column, repeated per page
const MIN_COL_W = 34;              // narrower than this and a name chip cannot fit
const ROW_MIN_H = 7.5;
const PAD_X = 1.6, PAD_Y = 1.6, LINE_H = 4.0;
const CHIP_H = 4.0, CHIP_R = 1.3, CHIP_PAD = 1.4, CHIP_GAP = 1.2;

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
  const BOTTOM = PH - 16;

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
        items.push({ kind: 'chip', variant: 'location', label, tag: '', call: '', w: Math.min(doc.getTextWidth(label) + CHIP_PAD * 2 + 2.6, avail) });
      } else if (seg.type === 'person') {
        const variant = seg.placeholder ? 'placeholder' : seg.userId ? 'user' : 'external';
        doc.setFont('helvetica', seg.placeholder ? 'italic' : 'normal'); doc.setFontSize(F.chip);
        const label = S(seg.name);
        const tag = seg.placeholder ? 'unassigned' : variant === 'external' ? 'ext' : '';
        const call = seg.callTimeOverride ? S(seg.callTimeOverride) : '';
        let w = doc.getTextWidth(label) + CHIP_PAD * 2 + (variant === 'user' ? 2.4 : 0);
        doc.setFontSize(F.tiny);
        if (tag) w += doc.getTextWidth(tag) + 1.4;
        if (call) w += doc.getTextWidth(call) + 1.6;
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
    let ly = y + PAD_Y + 3.0;
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
          doc.text(it.text, lx, ly - 1.4);
        } else {
          drawChip(it, lx, ly - 3.0);
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
    if (v === 'user') { doc.setFillColor(...tx); doc.circle(cx + 0.7, top + CHIP_H / 2, 0.7, 'F'); cx += 2.4; }
    if (v === 'location') {
      doc.setFillColor(...tx); doc.circle(cx + 0.8, top + CHIP_H / 2 - 0.3, 0.55, 'F');
      doc.setDrawColor(...tx); doc.setLineWidth(0.3);
      doc.line(cx + 0.8, top + CHIP_H / 2 + 0.1, cx + 0.8, top + CHIP_H / 2 + 1.2);
      cx += 2.6;
    }

    doc.setFont('helvetica', v === 'placeholder' ? 'italic' : 'normal'); doc.setFontSize(F.chip); doc.setTextColor(...tx);
    doc.text(it.label, cx, top + CHIP_H / 2 + 1.0);
    cx += doc.getTextWidth(it.label);
    if (it.call) {
      doc.setFontSize(F.tiny); doc.setTextColor(...colors.accent);
      doc.text(it.call, cx + 1.2, top + CHIP_H / 2 + 1.0);
      cx += 1.2 + doc.getTextWidth(it.call);
    }
    if (it.tag) {
      doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
      doc.text(it.tag, cx + 1.2, top + CHIP_H / 2 + 1.0);
    }
    if (it.warn) {
      const wx = lx + it.w + 1.0;
      doc.setFillColor(...colors.warn); doc.circle(wx, top + CHIP_H / 2, 1.35, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.4); doc.setTextColor(255, 255, 255);
      doc.text('!', wx, top + CHIP_H / 2 + 0.9, { align: 'center' });
    }
  }

  // -------------------------------------------------------------- page chrome
  function drawHeader() {
    let y = M - 1;
    doc.setDrawColor(...colors.accent); doc.setLineWidth(1.3);
    doc.line(M, y, PW - M, y);
    y += 6.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.wordmark); doc.setTextColor(...colors.primary);
    doc.text('CONGREGATION EMANU-EL', PW / 2, y, { align: 'center' });
    y += 5.2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.sheetName); doc.setTextColor(...colors.secondary);
    doc.text(S((sheet && sheet.name) || ''), PW / 2, y, { align: 'center' });
    return y + 5;
  }

  function drawContents(startY) {
    let y = startY;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text('IN THIS SHEET', M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.secondary);
    const label = days.map((d) => `${shortDate(d.date)}${d.title ? ` · ${d.title}` : ''}`).join('   |   ');
    const lines = doc.splitTextToSize(S(label), CW - 24);
    doc.text(lines, M + 22, y);
    y += lines.length * 3.2 + 1.5;
    // A silently truncated workbook would misstate its own coverage.
    if (omittedDays > 0) {
      doc.setTextColor(...colors.warn);
      doc.text(S(`Showing the first ${days.length} days of ${allDays.length} - print the remaining days from their own day tabs.`), M + 22, y);
      y += 3.6;
    }
    doc.setDrawColor(...colors.border); doc.setLineWidth(0.3);
    doc.line(M, y, PW - M, y);
    return y + 4;
  }

  function drawDayBand(day, startY, part, partCount) {
    const h = 11;
    doc.setFillColor(...colors.light); doc.setDrawColor(...colors.border); doc.setLineWidth(0.3);
    doc.roundedRect(M, startY, CW, h, 1.6, 1.6, 'FD');
    doc.setFillColor(...colors.accent); doc.rect(M, startY, 1.6, h, 'F');

    let x = M + 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.dayTitle); doc.setTextColor(...colors.primary);
    const title = S(day.title || fullDate(day.date));
    doc.text(title, x, startY + 7.4);
    x += doc.getTextWidth(title) + 3;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.dayDate); doc.setTextColor(...colors.secondary);
    doc.text(S(day.title ? `· ${fullDate(day.date)}` : ''), x, startY + 7.4);

    const { lastSent, stale } = emailSummary(day);
    const right = [];
    if (partCount > 1) right.push(`POSTS ${part.from}-${part.to} OF ${part.total}`);
    right.push(lastSent
      ? `EMAILED ${new Date(lastSent).toLocaleDateString(undefined)}${stale ? ' (EDITED SINCE)' : ''}`
      : 'NOT YET EMAILED');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text(S(right.join('   ·   ')), PW - M - 4, startY + 7.2, { align: 'right' });

    return startY + h + 3;
  }

  function drawTableHeader(cols, colW, startY) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.colHeader);
    let maxLines = 1;
    const wrapped = cols.map((c) => {
      const w = doc.splitTextToSize(S(c.name || ''), colW - 3);
      maxLines = Math.max(maxLines, w.length);
      return w;
    });
    const anyCaption = cols.some((c) => linkStateOf(c, liveEventsById));
    const h = Math.max(9.8, maxLines * 3.1 + (anyCaption ? 3.0 : 0) + 3.4);

    doc.setFillColor(...colors.primary); doc.rect(M, startY, CW, h, 'F');

    // Orientation hint. The arrows are vectors: the built-in fonts cannot
    // encode them, and sanitizing them would only yield '?'.
    doc.setTextColor(255, 255, 255); doc.setFontSize(F.tiny); doc.setFont('helvetica', 'bold');
    doc.text('POSTS', M + 2, startY + 4.0);
    doc.text('ROWS', M + 2, startY + 7.6);
    doc.setDrawColor(255, 255, 255); doc.setFillColor(255, 255, 255); doc.setLineWidth(0.25);
    const ax = M + 2 + doc.getTextWidth('POSTS') + 1.4, ay = startY + 3.5;
    doc.line(ax, ay, ax + 2.6, ay); doc.triangle(ax + 3.4, ay, ax + 2.3, ay - 0.62, ax + 2.3, ay + 0.62, 'F');
    const bx = M + 2 + doc.getTextWidth('ROWS') + 2.2, by = startY + 5.9;
    doc.line(bx, by, bx, by + 2.0); doc.triangle(bx, by + 2.8, bx - 0.62, by + 1.7, bx + 0.62, by + 1.7, 'F');

    cols.forEach((c, i) => {
      const x = M + LABEL_W + i * colW;
      doc.setDrawColor(90, 96, 108); doc.setLineWidth(0.2);
      doc.line(x, startY + 1.5, x, startY + h - 1.5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.colHeader); doc.setTextColor(255, 255, 255);
      wrapped[i].forEach((ln, li) => doc.text(ln, x + 2, startY + 4.2 + li * 3.1));

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
      if (!caption) return;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(F.colTime);
      doc.setTextColor(...(status.state === 'linked' ? colors.accent : [222, 178, 120]));
      doc.text(S(caption), x + 2, startY + 4.2 + maxLines * 3.1 + 1.6);
    });
    return startY + h;
  }

  function drawNotes(pageNotes, startY) {
    let y = startY;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny);
    const pw = doc.getTextWidth('NOTES') + 6;
    doc.setFillColor(...colors.accent); doc.roundedRect(M, y - 3.2, pw, 5, 1, 1, 'F');
    doc.setTextColor(255, 255, 255); doc.text('NOTES', M + 3, y);
    doc.setDrawColor(...colors.border); doc.setLineWidth(0.3);
    doc.line(M + pw + 2, y - 0.7, PW - M, y - 0.7);
    y += 5;

    for (const n of pageNotes) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F.note); doc.setTextColor(...colors.accent);
      doc.text(String(n.n), M + 1, y);
      doc.setTextColor(...colors.primary);
      const head = S(`${n.col} · ${n.row}`);
      // Measure while BOLD is still active. getTextWidth reads the CURRENT
      // font, so measuring after the switch to normal under-reads and runs the
      // body text back over the heading.
      const headW = doc.getTextWidth(head);
      doc.text(head, M + 5, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.bodyText);
      const bodyX = M + 6.5 + headW;
      const body = doc.splitTextToSize(S(`${n.text}${n.authorName ? `  — ${n.authorName}` : ''}`), Math.max(20, PW - M - bodyX));
      doc.text(body[0], bodyX, y);
      y += 3.6;
      for (let i = 1; i < body.length; i += 1) { doc.text(body[i], M + 5, y); y += 3.6; }
      y += 0.8;
    }
    return y + 1;
  }

  function drawKey(startY) {
    const y = startY;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text('KEY', M, y + 2.8);
    const samples = [
      { variant: 'user', label: 'Staff member', tag: '' },
      { variant: 'external', label: 'Outside vendor', tag: 'ext' },
      { variant: 'placeholder', label: 'Not yet assigned', tag: 'unassigned' },
      { variant: 'location', label: 'Room', tag: '' },
    ];
    let x = M + 12;
    for (const s of samples) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(F.chip);
      let w = doc.getTextWidth(s.label) + CHIP_PAD * 2 + (s.variant === 'user' ? 2.4 : s.variant === 'location' ? 2.6 : 0);
      doc.setFontSize(F.tiny);
      if (s.tag) w += doc.getTextWidth(s.tag) + 1.4;
      drawChip({ ...s, call: '', w }, x, y);
      x += w + 5;
    }
    doc.setFillColor(...colors.warn); doc.circle(x + 1.4, y + CHIP_H / 2, 1.35, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.4); doc.setTextColor(255, 255, 255);
    doc.text('!', x + 1.4, y + CHIP_H / 2 + 0.9, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(F.tiny); doc.setTextColor(...colors.muted);
    doc.text('also assigned to an overlapping post', x + 4.2, y + CHIP_H / 2 + 0.9);
  }

  function drawFooter(pageNum, totalPages) {
    const y = PH - 8;
    doc.setDrawColor(...colors.accent); doc.setLineWidth(0.4);
    doc.line(M, y - 4, PW - M, y - 4);
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

    colPages.forEach((cols, pageIdx) => {
      const colW = Math.max(MIN_COL_W, (CW - LABEL_W) / Math.max(cols.length, 1));
      const from = colPages.slice(0, pageIdx).reduce((a, c) => a + c.length, 0) + 1;
      const part = { from, to: from + cols.length - 1, total: (day.columns || []).length };

      newPage();
      let y = drawHeader();
      if (dayIdx === 0 && pageIdx === 0) y = drawContents(y);
      y = drawDayBand(day, y, part, colPages.length);
      y = drawTableHeader(cols, colW, y);

      let zebra = 0;
      for (const row of day.rows || []) {
        const layouts = cols.map((c) => {
          const key = `${row.id}:${c.id}`;
          return layoutCell((day.cells || {})[key], colW, indexByCell.get(key), warned);
        });
        const h = Math.max(ROW_MIN_H, ...layouts.map((l) => l.height));

        if (y + h > BOTTOM) {
          newPage();
          y = drawHeader();
          y = drawDayBand(day, y, part, colPages.length);
          y = drawTableHeader(cols, colW, y);
          zebra = 0;
        }

        const isStarter = row.kind === 'starter';
        if (isStarter) { doc.setFillColor(...colors.starterTint); doc.rect(M, y, CW, h, 'F'); }
        else if (zebra % 2 === 1) { doc.setFillColor(...colors.zebra); doc.rect(M, y, CW, h, 'F'); }
        zebra += 1;

        doc.setFillColor(...(isStarter ? colors.starterLabel : colors.customLabel));
        doc.rect(M, y, LABEL_W, h, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(F.rowLabel); doc.setTextColor(...colors.primary);
        doc.splitTextToSize(S(row.label || ''), LABEL_W - 4)
          .forEach((ln, i) => doc.text(ln, M + 2.5, y + 4.6 + i * 3.2));

        cols.forEach((c, i) => drawCell(layouts[i], M + LABEL_W + i * colW, y));

        doc.setDrawColor(...colors.border); doc.setLineWidth(0.2);
        doc.line(M, y + h, M + LABEL_W + cols.length * colW, y + h);
        doc.line(M, y, M, y + h);
        for (let i = 0; i <= cols.length; i += 1) {
          const x = M + LABEL_W + i * colW;
          doc.line(x, y, x, y + h);
        }
        y += h;
      }

      doc.setDrawColor(...colors.primary); doc.setLineWidth(0.5);
      doc.line(M, y, M + LABEL_W + cols.length * colW, y);

      // Notes for THIS page's cells, then the key — printed on every
      // column-page so a page torn off on its own is still fully readable.
      y += 6;
      const pageNotes = notes.filter((n) => n.cp === pageIdx);
      if (pageNotes.length) {
        if (y + 12 > BOTTOM) {
          newPage();
          y = drawHeader();
          y = drawDayBand(day, y, part, colPages.length);
        }
        y = drawNotes(pageNotes, y);
      }
      drawKey(y);
    });
  });

  if (!pageStarted) {
    // An empty workbook still gets an honest page rather than a blank one.
    drawHeader();
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

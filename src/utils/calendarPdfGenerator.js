// src/utils/calendarPdfGenerator.js
// Extracted PDF generation for calendar exports
// Used by EventSearchExport.jsx and AIChat.jsx
import { jsPDF } from 'jspdf';
import { buildMarkersByDate, getMarkersForDate } from './calendarMarkers';

// jsPDF's built-in fonts (helvetica/times/courier) only support WinAnsi
// (Windows-1252) encoding. Codepoints >0xFF render as mojibake — e.g.
// '○' (U+25CB) becomes '%Ë' because jsPDF splits 0x25CB into 0x25 ('%')
// and 0xCB ('Ë'). sanitizeForPdfText() maps known offenders to WinAnsi-safe
// glyphs and replaces any remaining out-of-range codepoint with '?'.
const PDF_TEXT_SUBSTITUTIONS = {
  '​': '', '‌': '', '‍': '', '‎': '', '‏': '',
  '‪': '', '‫': '', '‬': '', '‭': '', '‮': '',
  '﻿': '', '­': '',
  ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '○': 'o', '□': 'o', '▫': 'o',
  '●': '•', '■': '•', '▪': '•',
  '▶': '>', '►': '>',
  '◀': '<', '◄': '<',
  '★': '*', '☆': '*',
  '←': '<-', '→': '->', '↔': '<->',
  '⇐': '<=', '⇒': '=>', '⇔': '<=>',
  '≤': '<=', '≥': '>=', '≠': '!=', '×': 'x',
  '✓': '[x]', '✔': '[x]', '✅': '[x]',
  '✗': '[ ]', '✘': '[ ]', '❌': '[X]',
};
// WinAnsi-renderable codepoints: printable ASCII + tab/LF/CR, Latin-1 supplement
// (0xA0-0xFF), plus the 27 Win1252-extension glyphs (curly quotes, em/en dash,
// •, …, €, ™, etc.) that map to bytes 0x80-0x9F. Anything else is replaced
// with '?' rather than risking jsPDF's byte-split mojibake.
const WIN_ANSI_DISALLOWED = /[^\t\n\r\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g;
export const sanitizeForPdfText = (input) => {
  if (input == null) return '';
  let out = String(input);
  for (const from in PDF_TEXT_SUBSTITUTIONS) {
    if (out.indexOf(from) !== -1) {
      out = out.split(from).join(PDF_TEXT_SUBSTITUTIONS[from]);
    }
  }
  return out.replace(WIN_ANSI_DISALLOWED, '?');
};

/**
 * Generate a styled PDF calendar report
 * @param {Object} options
 * @param {Array} options.events - Array of transformed event objects
 * @param {string} options.sortBy - 'date' | 'category' | 'location' (default: 'date')
 * @param {boolean} options.showMaintenanceTimes - Include setup/teardown times (default: false)
 * @param {boolean} options.showSecurityTimes - Include door open/close times (default: false)
 * @param {string} options.timezone - IANA timezone string (default: 'America/New_York')
 * @param {Object} options.searchCriteria - { searchTerm, categories, locations, dateRange }
 */
export function generateCalendarPdf({
  events,
  sortBy = 'date',
  showMaintenanceTimes = false,
  showSecurityTimes = false,
  timezone = 'America/New_York',
  searchCriteria = {},
  markers = []
}) {
  const doc = new jsPDF();

  // ========================================
  // DESIGN SYSTEM: Institutional Elegance
  // ========================================
  const colors = {
    primary: [45, 52, 64],
    secondary: [107, 114, 128],
    bodyText: [51, 51, 51],
    accent: [180, 142, 73],
    light: [249, 250, 251],
    border: [229, 231, 235],
    muted: [156, 163, 175],
    success: [34, 87, 75],
    warning: [120, 90, 60],
    closed: [150, 52, 52],
  };

  const fontSize = {
    title: 20,
    subtitle: 12.5,
    sectionHeader: 11,
    body: 9.5,
    small: 8.5,
    tiny: 7.5,
  };

  const spacing = {
    margin: 10,
    gutter: 8,
    lineHeight: 4.5,
  };

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - (spacing.margin * 2);

  doc.setProperties({
    title: 'Calendar Search Results - Congregation Emanu-El',
    subject: 'Calendar Search Export',
    author: 'Congregation Emanu-El of the City of New York'
  });

  // Format date for display using selected timezone
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateCompact = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(' ', '');
  };

  // Day key (YYYY-MM-DD) for an ISO datetime, computed in the EXPORT timezone so a
  // marker lands on the same calendar day its events are grouped under.
  const dayKeyInTz = (dateString) => {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(dateString));
  };

  // "Wed, May 20, 2026" from a YYYY-MM-DD key, derived in UTC so event days and
  // marker-only days label identically (no tz drift across the date boundary).
  const labelFromDayKey = (key) => {
    const d = new Date(`${key}T00:00:00Z`);
    const weekday = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    const full = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    return `${weekday}, ${full}`;
  };

  // "May 20" from a YYYY-MM-DD key (date-only → format in UTC).
  const formatMarkerDate = (key) => {
    if (!key) return '';
    return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric',
    });
  };

  // Holiday = gold accent; office-closed = muted red. (Per-marker color override
  // is intentionally deferred — see spec.)
  const markerColors = (marker) => {
    if (marker && marker.type === 'officeClosed') {
      return { accent: colors.closed, tint: [247, 237, 237], tag: 'OFFICE CLOSED' };
    }
    return { accent: colors.accent, tint: [248, 243, 233], tag: 'HOLIDAY' };
  };

  const currentDate = new Date();

  // ========================================
  // HEADER DESIGN
  // ========================================
  const drawHeader = () => {
    let y = spacing.margin;

    doc.setDrawColor(...colors.accent);
    doc.setLineWidth(2);
    doc.line(spacing.margin, y, pageWidth - spacing.margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.title);
    doc.setTextColor(...colors.primary);
    doc.text('CONGREGATION EMANU-EL', pageWidth / 2, y, { align: 'center' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize.subtitle);
    doc.setTextColor(...colors.secondary);
    doc.text('Calendar Events Report', pageWidth / 2, y, { align: 'center' });
    y += 10;

    return y;
  };

  // ========================================
  // SEARCH CRITERIA BOX (First page only)
  // ========================================
  const drawSearchCriteria = (startY) => {
    let y = startY;

    const criteria = [];
    if (searchCriteria.searchTerm) criteria.push({ label: 'Search', value: searchCriteria.searchTerm });
    if (searchCriteria.categories?.length > 0) criteria.push({ label: 'Categories', value: searchCriteria.categories.join(', ') });
    if (searchCriteria.locations?.length > 0) criteria.push({ label: 'Locations', value: searchCriteria.locations.join(', ') });
    criteria.push({ label: 'Sort', value: sortBy.charAt(0).toUpperCase() + sortBy.slice(1) });
    if (showMaintenanceTimes) criteria.push({ label: 'Options', value: 'Maintenance Times' });
    if (showSecurityTimes) criteria.push({ label: 'Options', value: 'Security Times' });

    if (criteria.length > 0) {
      const boxHeight = Math.ceil(criteria.length / 2) * 5 + 12;
      doc.setFillColor(...colors.light);
      doc.setDrawColor(...colors.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(spacing.margin, y, contentWidth, boxHeight, 2, 2, 'FD');
      y += 6;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize.small);
      doc.setTextColor(...colors.primary);
      doc.text('SEARCH CRITERIA', spacing.margin + 4, y);
      y += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize.tiny);
      const colWidth = contentWidth / 2 - 8;
      let col = 0;
      let rowY = y;

      criteria.forEach((item) => {
        const x = spacing.margin + 4 + (col * (colWidth + 8));
        doc.setTextColor(...colors.muted);
        doc.text(`${item.label}:`, x, rowY);
        doc.setTextColor(...colors.primary);
        const valueText = doc.splitTextToSize(sanitizeForPdfText(item.value), colWidth - 25);
        doc.text(valueText[0], x + 22, rowY);

        col++;
        if (col > 1) {
          col = 0;
          rowY += 4;
        }
      });

      y = startY + boxHeight + 6;
    }

    return y;
  };

  // ========================================
  // TABLE DESIGN
  // ========================================
  const hasExtraTimes = showMaintenanceTimes || showSecurityTimes;
  const hasNotes = showMaintenanceTimes || showSecurityTimes;

  const colConfig = [
    { name: 'DATE', width: 0.06 },
    { name: 'TIME', width: hasExtraTimes ? 0.16 : 0.14 },
    { name: 'LOCATION', width: 0.20 },
    { name: 'CATEGORY', width: 0.10 },
    { name: hasNotes ? 'EVENT & INTERNAL NOTES' : 'EVENT', width: hasNotes ? 0.48 : 0.50 },
  ];

  const colPositions = [];
  const colWidths = [];
  let currentX = spacing.margin;
  colConfig.forEach(col => {
    colPositions.push(currentX);
    const width = col.width * contentWidth;
    colWidths.push(width);
    currentX += width;
  });

  const drawTableHeader = (y) => {
    doc.setFillColor(...colors.primary);
    doc.rect(spacing.margin, y - 4, contentWidth, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.tiny);
    doc.setTextColor(255, 255, 255);

    colConfig.forEach((col, idx) => {
      if (col.name) {
        doc.text(col.name, colPositions[idx] + 2, y);
      }
    });

    return y + 6;
  };

  const drawGroupSeparator = (y, label) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.tiny);
    const textWidth = doc.getTextWidth(label);
    const pillWidth = Math.min(textWidth + 6, contentWidth);

    doc.setFillColor(...colors.accent);
    doc.roundedRect(spacing.margin, y - 3, pillWidth, 5, 1, 1, 'F');

    doc.setTextColor(255, 255, 255);
    doc.text(label, spacing.margin + 2, y);

    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.3);
    doc.line(spacing.margin + pillWidth + 2, y - 0.5, pageWidth - spacing.margin, y - 0.5);

    return y + 5;
  };

  // ========================================
  // MARKER BANNER (Holidays & Office Closures)
  // ========================================
  const MARKER_BANNER_H = 7;

  // One holiday/closure banner (Style A: tinted bar + colored left rule), drawn
  // under the day's date pill. Page-break aware. Returns the new y.
  const drawMarkerBanner = (marker, startY) => {
    let y = startY;
    if (y + MARKER_BANNER_H > pageHeight - 20) {
      doc.addPage();
      y = drawHeader(false);
      y = drawTableHeader(y);
    }
    const { accent, tint, tag } = markerColors(marker);
    const top = y - 2.5;
    doc.setFillColor(...tint);
    doc.rect(spacing.margin, top, contentWidth, 6, 'F');
    doc.setFillColor(...accent);
    doc.rect(spacing.margin, top, 1.2, 6, 'F');

    const name = sanitizeForPdfText(
      marker.name || (marker.type === 'officeClosed' ? 'Office Closed' : 'Holiday')
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.primary);
    doc.text(name, spacing.margin + 4, y + 1.5);
    const nameWidth = doc.getTextWidth(name);

    if (marker.startDate && marker.endDate && marker.startDate !== marker.endDate) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.muted);
      doc.text(`${formatMarkerDate(marker.startDate)} – ${formatMarkerDate(marker.endDate)}`, spacing.margin + 6 + nameWidth, y + 1.5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.tiny);
    doc.setTextColor(...accent);
    doc.text(tag, pageWidth - spacing.margin - 2, y + 1.5, { align: 'right' });

    return y + MARKER_BANNER_H + 1;
  };

  // Summary block of all in-range markers, used by category/location sorts (which
  // have no per-day section to host banners). Returns the new y.
  const drawMarkersSummary = (summaryMarkers, startY) => {
    let y = startY;
    if (!summaryMarkers || summaryMarkers.length === 0) return y;

    const lineH = 4.5;
    const boxHeight = summaryMarkers.length * lineH + 11;
    if (y + boxHeight > pageHeight - 20) {
      doc.addPage();
      y = drawHeader(false);
    }
    doc.setFillColor(...colors.light);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(spacing.margin, y, contentWidth, boxHeight, 2, 2, 'FD');

    let rowY = y + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.primary);
    doc.text('HOLIDAYS & CLOSURES IN THIS RANGE', spacing.margin + 4, rowY);
    rowY += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize.tiny);
    for (const m of summaryMarkers) {
      const { accent } = markerColors(m);
      doc.setFillColor(...accent);
      doc.rect(spacing.margin + 4, rowY - 1.5, 1.6, 1.6, 'F');
      doc.setTextColor(...colors.primary);
      doc.text(sanitizeForPdfText(m.name || ''), spacing.margin + 8, rowY);
      const span = m.startDate === m.endDate
        ? formatMarkerDate(m.startDate)
        : `${formatMarkerDate(m.startDate)} – ${formatMarkerDate(m.endDate)}`;
      doc.setTextColor(...colors.muted);
      doc.text(span, pageWidth - spacing.margin - 4, rowY, { align: 'right' });
      rowY += lineH;
    }
    return y + boxHeight + 6;
  };

  // ========================================
  // FOOTER DESIGN
  // ========================================
  const drawFooter = (pageNum, totalPages) => {
    const y = pageHeight - 10;

    doc.setDrawColor(...colors.accent);
    doc.setLineWidth(0.5);
    doc.line(spacing.margin, y - 4, pageWidth - spacing.margin, y - 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize.tiny);
    doc.setTextColor(...colors.muted);
    doc.text(`Generated ${formatDate(currentDate.toISOString())}`, spacing.margin, y);
    doc.text('Congregation Emanu-El of the City of New York', pageWidth / 2, y, { align: 'center' });
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - spacing.margin, y, { align: 'right' });
  };

  // ========================================
  // BUILD DOCUMENT
  // ========================================

  let y = drawHeader(true);
  y = drawSearchCriteria(y);

  // Holiday / office-closed markers (date-bounded). buildMarkersByDate expands a
  // multi-day marker onto every day it covers — the same expansion the on-screen
  // ribbons use — so a span repeats across its days here too.
  const markersByDate = buildMarkersByDate(markers);
  const rangeStart = searchCriteria?.dateRange?.start || null;
  const rangeEnd = searchCriteria?.dateRange?.end || null;
  const markerInRange = (m) => {
    if (!m || !m.startDate || !m.endDate) return false;
    if (rangeStart && m.endDate < rangeStart) return false;
    if (rangeEnd && m.startDate > rangeEnd) return false;
    return true;
  };
  const rangeMarkers = (Array.isArray(markers) ? markers : []).filter(markerInRange);

  // Date sort hosts markers per-day; category/location sort has no per-day anchor,
  // so those modes get a single summary block instead.
  if (sortBy !== 'date' && rangeMarkers.length > 0) {
    y = drawMarkersSummary(rangeMarkers, y);
  }

  y = drawTableHeader(y);

  // Sort events
  const sortedEvents = [...events].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(a.start.dateTime) - new Date(b.start.dateTime);
    } else if (sortBy === 'category') {
      const catA = a.categories?.[0]?.toLowerCase() || 'zzz';
      const catB = b.categories?.[0]?.toLowerCase() || 'zzz';
      if (catA === catB) return new Date(a.start.dateTime) - new Date(b.start.dateTime);
      return catA.localeCompare(catB);
    } else if (sortBy === 'location') {
      const locA = a.location?.displayName?.toLowerCase() || 'zzz';
      const locB = b.location?.displayName?.toLowerCase() || 'zzz';
      if (locA === locB) return new Date(a.start.dateTime) - new Date(b.start.dateTime);
      return locA.localeCompare(locB);
    }
    return 0;
  });

  const formatTimeString = (timeStr) => {
    if (!timeStr) return null;
    try {
      if (timeStr.includes(':') && !timeStr.includes('T')) {
        const [hours, minutes] = timeStr.split(':');
        const h = parseInt(hours);
        const ampm = h >= 12 ? 'p' : 'a';
        const h12 = h % 12 || 12;
        return `${h12}:${minutes}${ampm}`;
      }
      return timeStr;
    } catch {
      return null;
    }
  };

  // Wrap every text cell of an event row exactly once. Both the measure pass
  // (measureRowHeight) and the draw pass (drawEventRowContent) consume this single
  // result, so their geometry can never drift and each cell is wrapped only once.
  const wrapEventRow = (event) => {
    const evtContentWidth = colWidths[4] - 4;
    const bodyText = sanitizeForPdfText(event.bodyPreview || event.body?.content || '').trim();
    let locationRaw = event.location?.displayName || '—';
    if (Array.isArray(locationRaw)) locationRaw = locationRaw.join('\n');
    else if (typeof locationRaw === 'string' && locationRaw.includes(';')) locationRaw = locationRaw.split(';').map(s => s.trim()).filter(Boolean).join('\n');
    const attendeeNum = Number(event.attendeeCount);
    const showAttendees = Number.isFinite(attendeeNum) && attendeeNum > 0;
    return {
      wrappedTitle: doc.splitTextToSize(sanitizeForPdfText(event.subject || 'Untitled Event'), evtContentWidth),
      wrappedBody: bodyText ? doc.splitTextToSize(bodyText, evtContentWidth) : [],
      wrappedSetupNotes: (showMaintenanceTimes && event.setupNotes)
        ? doc.splitTextToSize(sanitizeForPdfText(`Setup: ${event.setupNotes}`), evtContentWidth) : [],
      wrappedDoorNotes: (showSecurityTimes && event.doorNotes)
        ? doc.splitTextToSize(sanitizeForPdfText(`Door/Access: ${event.doorNotes}`), evtContentWidth) : [],
      wrappedLocation: doc.splitTextToSize(sanitizeForPdfText(locationRaw), colWidths[2] - 4),
      wrappedCategory: doc.splitTextToSize(sanitizeForPdfText(event.categories?.[0] || '—'), colWidths[3] - 4),
      showAttendees,
      attendeeLabel: showAttendees ? `${attendeeNum} ${attendeeNum === 1 ? 'attendee' : 'attendees'}` : '',
    };
  };

  // Measure the rendered height of one event row from its pre-wrapped cells so the
  // page-break decision can be made before drawing.
  const measureRowHeight = (event, wrapped) => {
    const { wrappedTitle, wrappedBody, wrappedSetupNotes, wrappedDoorNotes, wrappedLocation, wrappedCategory, showAttendees } = wrapped;
    let rowHeight = 8;
    const attendeeHeight = showAttendees ? 4 : 0;
    const locationHeight = wrappedLocation.length * 3.5;
    const categoryHeight = wrappedCategory.length * 3.5;

    const titleHeight = wrappedTitle.length * 3.5;
    const bodyHeight = wrappedBody.length > 0 ? (wrappedBody.length * 3) + 2 : 0;
    const setupNotesHeight = wrappedSetupNotes.length > 0 ? (wrappedSetupNotes.length * 3) + 2 : 0;
    const doorNotesHeight = wrappedDoorNotes.length * 3;
    rowHeight = Math.max(
      rowHeight,
      titleHeight + attendeeHeight + bodyHeight + setupNotesHeight + doorNotesHeight + 4,
      locationHeight + 4,
      categoryHeight + 4
    );
    if (showMaintenanceTimes || showSecurityTimes) {
      let extraLines = 0;
      if (showMaintenanceTimes && (event.reservationStartTime || event.reservationEndTime || event.setupTime || event.teardownTime)) extraLines++;
      if (showMaintenanceTimes && (event.reservationStartTime || event.reservationEndTime) && (event.setupTime || event.teardownTime)) extraLines++;
      if (showSecurityTimes && (event.doorOpenTime || event.doorCloseTime)) extraLines++;
      rowHeight = Math.max(rowHeight, 8 + extraLines * 3.5);
    }
    return rowHeight;
  };

  // Draw one event row: zebra band + DATE/TIME/LOCATION/CATEGORY columns + the
  // event-cell stack (title, attendees, body, notes), using the cells pre-wrapped
  // by wrapEventRow. Returns the new y. Shared by the date day-walk and the
  // category/location path. `i` drives zebra striping — callers pass a single
  // running event index so striping stays continuous.
  const drawEventRowContent = (event, wrapped, i, y, rowHeight) => {
    const { wrappedTitle, wrappedBody, wrappedSetupNotes, wrappedDoorNotes, wrappedLocation, wrappedCategory, showAttendees, attendeeLabel } = wrapped;
    const eventColIdx = 4;

    if (i % 2 === 0) {
      doc.setFillColor(252, 252, 253);
      doc.rect(spacing.margin, y - 3, contentWidth, rowHeight, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.primary);
    if (sortBy !== 'date') {
      doc.text(formatDateCompact(event.start.dateTime), colPositions[0] + 2, y);
    }

    doc.setTextColor(...colors.primary);
    doc.text(`${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}`, colPositions[1] + 2, y);

    let timeY = y + 3.5;
    if (showMaintenanceTimes) {
      const resStartStr = formatTimeString(event.reservationStartTime);
      const resEndStr = formatTimeString(event.reservationEndTime);
      if (resStartStr || resEndStr) {
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(...colors.warning);
        const resStr = resStartStr && resEndStr
          ? `Res ${resStartStr} - ${resEndStr}`
          : resStartStr ? `Res Start ${resStartStr}` : `Res End ${resEndStr}`;
        doc.text(resStr, colPositions[1] + 2, timeY);
        timeY += 3;
      }
      const setupStr = formatTimeString(event.setupTime);
      const teardownStr = formatTimeString(event.teardownTime);
      if (setupStr || teardownStr) {
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(...colors.warning);
        const maintStr = setupStr && teardownStr
          ? `Setup ${setupStr} / TD ${teardownStr}`
          : setupStr ? `Setup ${setupStr}` : `TD ${teardownStr}`;
        doc.text(maintStr, colPositions[1] + 2, timeY);
        timeY += 3;
      }
    }
    if (showSecurityTimes) {
      const doorOpenStr = formatTimeString(event.doorOpenTime);
      const doorCloseStr = formatTimeString(event.doorCloseTime);
      if (doorOpenStr || doorCloseStr) {
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(...colors.success);
        const secStr = doorOpenStr && doorCloseStr
          ? `Doors ${doorOpenStr} - ${doorCloseStr}`
          : doorOpenStr ? `Open ${doorOpenStr}` : `Close ${doorCloseStr}`;
        doc.text(secStr, colPositions[1] + 2, timeY);
      }
    }

    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.secondary);
    doc.text(wrappedLocation, colPositions[2] + 2, y);
    doc.text(wrappedCategory, colPositions[3] + 2, y);

    const eventColX = colPositions[eventColIdx];
    let contentY = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.primary);
    doc.text(wrappedTitle, eventColX + 2, contentY);
    contentY += wrappedTitle.length * 3.5;

    if (showAttendees) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.accent);
      doc.text(attendeeLabel, eventColX + 2, contentY);
      contentY += 4;
    }
    if (wrappedBody.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.bodyText);
      doc.text(wrappedBody, eventColX + 2, contentY);
      contentY += (wrappedBody.length * 3) + 2;
    }
    if (showMaintenanceTimes && event.setupNotes) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.warning);
      doc.text(wrappedSetupNotes, eventColX + 2, contentY);
      contentY += (wrappedSetupNotes.length * 3) + 2;
    }
    if (showSecurityTimes && event.doorNotes) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.success);
      doc.text(wrappedDoorNotes, eventColX + 2, contentY);
    }

    return y + rowHeight;
  };

  if (sortBy === 'date') {
    // Day-walk: render every day that has events OR is covered by a marker (within
    // range), so a holiday/closure prints at the top of its day even when nothing
    // is booked. Reuses the on-screen markersByDate expansion for multi-day spans.
    const eventsByDay = new Map();
    for (const event of sortedEvents) {
      const key = dayKeyInTz(event.start.dateTime);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key).push(event);
    }

    let lo = rangeStart;
    let hi = rangeEnd;
    if (!lo || !hi) {
      const eventKeys = [...eventsByDay.keys()].sort();
      lo = lo || eventKeys[0];
      hi = hi || eventKeys[eventKeys.length - 1];
    }
    const markerDayKeys = [...markersByDate.keys()].filter(k => (!lo || k >= lo) && (!hi || k <= hi));
    const allDayKeys = [...new Set([...eventsByDay.keys(), ...markerDayKeys])].sort();

    let evtIndex = 0; // continuous across days so zebra striping matches today's
    for (let d = 0; d < allDayKeys.length; d++) {
      const dayKey = allDayKeys[d];
      const dayEvents = eventsByDay.get(dayKey) || [];
      const dayMarkers = getMarkersForDate(markersByDate, dayKey);
      const dayLabel = labelFromDayKey(dayKey);

      const firstItemH = dayMarkers.length > 0 ? (MARKER_BANNER_H + 1)
        : (dayEvents.length > 0 ? measureRowHeight(dayEvents[0], wrapEventRow(dayEvents[0])) : 6);
      if (d > 0) y += 3;
      if (y + 8 + firstItemH > pageHeight - 20) {
        doc.addPage();
        y = drawHeader(false);
        y = drawTableHeader(y);
      }

      y = drawGroupSeparator(y, dayLabel);

      for (const m of dayMarkers) {
        y = drawMarkerBanner(m, y);
      }

      if (dayEvents.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(...colors.muted);
        doc.text('No events scheduled.', spacing.margin + 4, y + 1);
        y += 6;
      } else {
        for (const event of dayEvents) {
          const wrapped = wrapEventRow(event);
          const rowHeight = measureRowHeight(event, wrapped);
          if (y + rowHeight > pageHeight - 20) {
            doc.addPage();
            y = drawHeader(false);
            y = drawTableHeader(y);
            y = drawGroupSeparator(y, `${dayLabel} (cont'd)`);
          }
          y = drawEventRowContent(event, wrapped, evtIndex, y, rowHeight);
          evtIndex++;
        }
      }
    }
  } else {
    // Category / location sort: flat list with group separators. Markers are
    // day-level, so they appear in the summary block above, not inline here.
    let currentGroup = '';
    let currentGroupLabel = '';
    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i];
      const wrapped = wrapEventRow(event);
      const rowHeight = measureRowHeight(event, wrapped);

      let needsGroupHeader = false;
      if (sortBy === 'category') {
        if ((event.categories?.[0] || 'Uncategorized') !== currentGroup) needsGroupHeader = true;
      } else if (sortBy === 'location') {
        if ((event.location?.displayName || 'Unspecified') !== currentGroup) needsGroupHeader = true;
      }

      const totalNeeded = rowHeight + (needsGroupHeader ? 8 : 0);
      if (y + totalNeeded > pageHeight - 20) {
        doc.addPage();
        y = drawHeader(false);
        y = drawTableHeader(y);
        if (currentGroupLabel && !needsGroupHeader) {
          y = drawGroupSeparator(y, `${currentGroupLabel} (cont'd)`);
        }
      }

      if (sortBy === 'category') {
        const category = event.categories?.[0] || 'Uncategorized';
        if (category !== currentGroup) {
          currentGroup = category;
          if (i > 0) y += 3;
          currentGroupLabel = sanitizeForPdfText(category.toUpperCase());
          y = drawGroupSeparator(y, currentGroupLabel);
        }
      } else if (sortBy === 'location') {
        const location = event.location?.displayName || 'Unspecified';
        if (location !== currentGroup) {
          currentGroup = location;
          if (i > 0) y += 3;
          currentGroupLabel = sanitizeForPdfText(location);
          y = drawGroupSeparator(y, currentGroupLabel);
        }
      }

      y = drawEventRowContent(event, wrapped, i, y, rowHeight);
    }
  }

  // Total results
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize.body);
  doc.setTextColor(...colors.primary);
  doc.text(`Total: ${sortedEvents.length} events`, pageWidth / 2, y, { align: 'center' });

  // Add footers to all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  // Return blob and filename (caller decides whether to auto-download or render a button)
  const fileName = `emanu-el-calendar-${new Date().toISOString().split('T')[0]}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blob, blobUrl, fileName, eventCount: sortedEvents.length };
}

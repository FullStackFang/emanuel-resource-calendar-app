// src/utils/calendarPdfGenerator.js
// Extracted PDF generation for calendar exports
// Used by EventSearchExport.jsx and AIChat.jsx
import { jsPDF } from 'jspdf';

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
  searchCriteria = {}
}) {
  const doc = new jsPDF();

  // ========================================
  // DESIGN SYSTEM: Institutional Elegance
  // ========================================
  const colors = {
    primary: [45, 52, 64],
    secondary: [107, 114, 128],
    accent: [180, 142, 73],
    light: [249, 250, 251],
    border: [229, 231, 235],
    muted: [156, 163, 175],
    success: [34, 87, 75],
    warning: [120, 90, 60],
  };

  const fontSize = {
    title: 18,
    subtitle: 11,
    sectionHeader: 10,
    body: 8.5,
    small: 7.5,
    tiny: 6.5,
  };

  const spacing = {
    margin: 15,
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
    y += 8;

    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.3);
    doc.line(spacing.margin + 40, y, pageWidth - spacing.margin - 40, y);
    y += 6;

    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.muted);
    const metaLeft = `Generated ${formatDate(currentDate.toISOString())}`;
    const metaRight = `Timezone: ${timezone.replace('_', ' ')}`;
    doc.text(metaLeft, spacing.margin, y);
    doc.text(metaRight, pageWidth - spacing.margin, y, { align: 'right' });
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
        const valueText = doc.splitTextToSize(item.value, colWidth - 25);
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
    doc.text('Congregation Emanu-El of the City of New York', spacing.margin, y);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - spacing.margin, y, { align: 'right' });
  };

  // ========================================
  // BUILD DOCUMENT
  // ========================================

  let y = drawHeader(true);
  y = drawSearchCriteria(y);
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

  let currentGroup = '';
  let previousDateStr = '';
  let currentGroupLabel = '';

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

  // Draw events
  for (let i = 0; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const startDate = new Date(event.start.dateTime);
    const dateStr = formatDateCompact(event.start.dateTime);
    const fullDateStr = formatDate(event.start.dateTime);
    const dayOfWeek = startDate.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'short'
    });

    const eventColIdx = 4;
    const eventColWidth = colWidths[eventColIdx];
    const evtContentWidth = eventColWidth - 4;

    let rowHeight = 8;
    const eventTitle = event.subject || 'Untitled Event';
    const wrappedTitle = doc.splitTextToSize(eventTitle, evtContentWidth);

    const bodyText = (event.bodyPreview || event.body?.content || '').trim();
    const wrappedBody = bodyText ? doc.splitTextToSize(bodyText, evtContentWidth) : [];

    const wrappedSetupNotes = (showMaintenanceTimes && event.setupNotes)
      ? doc.splitTextToSize(`Setup: ${event.setupNotes}`, evtContentWidth)
      : [];
    const wrappedDoorNotes = (showSecurityTimes && event.doorNotes)
      ? doc.splitTextToSize(`Door/Access: ${event.doorNotes}`, evtContentWidth)
      : [];

    // Normalize multi-location strings: semicolons → newlines, arrays → newlines
    let locationRaw = event.location?.displayName || '\u2014';
    if (Array.isArray(locationRaw)) {
      locationRaw = locationRaw.join('\n');
    } else if (typeof locationRaw === 'string' && locationRaw.includes(';')) {
      locationRaw = locationRaw.split(';').map(s => s.trim()).filter(Boolean).join('\n');
    }
    const wrappedLocation = doc.splitTextToSize(locationRaw, colWidths[2] - 4);
    const locationHeight = wrappedLocation.length * 3.5;

    const categoryText = event.categories?.[0] || '\u2014';
    const wrappedCategory = doc.splitTextToSize(categoryText, colWidths[3] - 4);
    const categoryHeight = wrappedCategory.length * 3.5;

    const titleHeight = wrappedTitle.length * 3.5;
    const bodyHeight = wrappedBody.length > 0 ? (wrappedBody.length * 3) + 2 : 0;
    const setupNotesHeight = wrappedSetupNotes.length > 0 ? (wrappedSetupNotes.length * 3) + 2 : 0;
    const doorNotesHeight = wrappedDoorNotes.length * 3;
    rowHeight = Math.max(
      rowHeight,
      titleHeight + bodyHeight + setupNotesHeight + doorNotesHeight + 4,
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

    let needsGroupHeader = false;
    if (sortBy === 'date' && dateStr !== previousDateStr) {
      needsGroupHeader = true;
    } else if (sortBy === 'category') {
      const category = event.categories?.[0] || 'Uncategorized';
      if (category !== currentGroup) needsGroupHeader = true;
    } else if (sortBy === 'location') {
      const location = event.location?.displayName || 'Unspecified';
      if (location !== currentGroup) needsGroupHeader = true;
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

    if (sortBy === 'date' && dateStr !== previousDateStr) {
      if (previousDateStr !== '') {
        y += 3;
      }
      currentGroupLabel = `${dayOfWeek}, ${fullDateStr}`;
      y = drawGroupSeparator(y, currentGroupLabel);
    }
    previousDateStr = dateStr;

    if (sortBy === 'category') {
      const category = event.categories?.[0] || 'Uncategorized';
      if (category !== currentGroup) {
        currentGroup = category;
        if (previousDateStr !== '' || i > 0) y += 3;
        currentGroupLabel = category.toUpperCase();
        y = drawGroupSeparator(y, currentGroupLabel);
      }
    } else if (sortBy === 'location') {
      const location = event.location?.displayName || 'Unspecified';
      if (location !== currentGroup) {
        currentGroup = location;
        if (previousDateStr !== '' || i > 0) y += 3;
        currentGroupLabel = location;
        y = drawGroupSeparator(y, currentGroupLabel);
      }
    }

    if (i % 2 === 0) {
      doc.setFillColor(252, 252, 253);
      doc.rect(spacing.margin, y - 3, contentWidth, rowHeight, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize.small);
    doc.setTextColor(...colors.primary);

    if (sortBy !== 'date') {
      doc.text(dateStr, colPositions[0] + 2, y);
    }

    doc.setTextColor(...colors.primary);
    const timeStr = `${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}`;
    doc.text(timeStr, colPositions[1] + 2, y);

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

    if (wrappedBody.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize.tiny);
      doc.setTextColor(...colors.muted);
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

    y += rowHeight;

    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.1);
    doc.line(spacing.margin, y - 1, pageWidth - spacing.margin, y - 1);
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

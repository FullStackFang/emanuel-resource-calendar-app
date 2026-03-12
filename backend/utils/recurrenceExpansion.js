/**
 * Backend recurrence expansion utilities
 *
 * Port of frontend recurrence math for server-side conflict detection.
 * Uses CommonJS. Mirrors logic from src/utils/recurrenceUtils.js.
 */

const MAX_OCCURRENCES = 500;

/**
 * Check if a date matches the recurrence pattern
 * @param {Date} date - Date to check
 * @param {Object} pattern - { type, interval, daysOfWeek }
 * @param {Date} startDate - Pattern start date
 * @returns {boolean}
 */
function isDateInPattern(date, pattern, startDate) {
  if (!pattern || !startDate) return false;

  const checkDate = new Date(date);
  const start = new Date(startDate);

  if (checkDate < start) return false;

  const { type, interval = 1, daysOfWeek } = pattern;

  switch (type) {
    case 'daily': {
      const startNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const checkNorm = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
      const daysDiff = Math.round((checkNorm - startNorm) / (1000 * 60 * 60 * 24));
      return daysDiff >= 0 && daysDiff % interval === 0;
    }

    case 'weekly': {
      if (!daysOfWeek || daysOfWeek.length === 0) return false;

      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const checkDayName = dayNames[checkDate.getDay()];
      const normalizedDays = daysOfWeek.map(d => d.toLowerCase());
      if (!normalizedDays.includes(checkDayName)) return false;

      const checkMidnight = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
      const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const daysDiff = Math.floor((checkMidnight - startMidnight) / (1000 * 60 * 60 * 24));
      const weeksDiff = Math.floor(daysDiff / 7);
      return weeksDiff % interval === 0;
    }

    case 'monthly': {
      const monthsDiff = (checkDate.getFullYear() - start.getFullYear()) * 12 +
                         (checkDate.getMonth() - start.getMonth());
      return checkDate.getDate() === start.getDate() && monthsDiff % interval === 0;
    }

    case 'yearly': {
      const yearsDiff = checkDate.getFullYear() - start.getFullYear();
      return checkDate.getMonth() === start.getMonth() &&
             checkDate.getDate() === start.getDate() &&
             yearsDiff % interval === 0;
    }

    default:
      return false;
  }
}

/**
 * Expand a recurring series master into occurrence time windows
 * @param {Object} masterEvent - Event document from MongoDB
 * @param {Date} windowStart - Query window start
 * @param {Date} windowEnd - Query window end
 * @returns {Array<{startDateTime: string, endDateTime: string}>} Array of occurrence time windows
 */
function expandRecurringOccurrencesInWindow(masterEvent, windowStart, windowEnd) {
  const recurrence = masterEvent.recurrence || masterEvent.calendarData?.recurrence;
  if (!recurrence?.pattern || !recurrence?.range) return [];

  const { pattern, range, exclusions = [] } = recurrence;
  const occurrences = [];

  // Build override lookup from top-level occurrenceOverrides array
  const overrides = masterEvent.occurrenceOverrides || [];
  const overrideMap = {};
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (o.occurrenceDate) overrideMap[o.occurrenceDate] = o;
    }
  }

  const patternStart = new Date(range.startDate + 'T00:00:00');
  const rangeStart = windowStart > patternStart ? windowStart : patternStart;
  const rangeEnd = new Date(windowEnd);

  // Cap by pattern end date
  if (range.type === 'endDate' && range.endDate) {
    const patternEnd = new Date(range.endDate + 'T23:59:59');
    if (patternEnd < rangeEnd) {
      rangeEnd.setTime(patternEnd.getTime());
    }
  }

  // Get master event's time-of-day from stored datetimes
  // Handle both Date objects and ISO strings
  let masterStartDT = masterEvent.calendarData?.startDateTime || masterEvent.startDateTime || '';
  let masterEndDT = masterEvent.calendarData?.endDateTime || masterEvent.endDateTime || '';
  if (masterStartDT instanceof Date) masterStartDT = masterStartDT.toISOString();
  if (masterEndDT instanceof Date) masterEndDT = masterEndDT.toISOString();
  const startTimePart = (typeof masterStartDT === 'string' && masterStartDT.includes('T'))
    ? masterStartDT.split('T')[1].replace(/Z$/, '') : '00:00:00';
  const endTimePart = (typeof masterEndDT === 'string' && masterEndDT.includes('T'))
    ? masterEndDT.split('T')[1].replace(/Z$/, '') : '23:59:00';

  const current = new Date(rangeStart);
  let count = 0;
  const maxOcc = range.type === 'numbered' ? (range.numberOfOccurrences || MAX_OCCURRENCES) : MAX_OCCURRENCES;

  while (current <= rangeEnd && count < maxOcc) {
    if (isDateInPattern(current, pattern, patternStart)) {
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`;

      // Skip excluded dates
      if (!exclusions.includes(dateStr)) {
        // Apply per-occurrence override times if present
        const override = overrideMap[dateStr];
        occurrences.push({
          occurrenceDate: dateStr,
          startDateTime: (override?.startDateTime) || `${dateStr}T${startTimePart}`,
          endDateTime: (override?.endDateTime) || `${dateStr}T${endTimePart}`,
        });
      }
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return occurrences;
}

/**
 * Expand ALL occurrences of a recurrence pattern (full range, not windowed).
 * Includes additions as extra dates, honors exclusions.
 * @param {Object} recurrence - { pattern, range, additions, exclusions }
 * @param {string} masterStartDateTime - Master event start ISO string (e.g. '2026-03-01T14:00:00')
 * @param {string} masterEndDateTime - Master event end ISO string (e.g. '2026-03-01T15:00:00')
 * @returns {Array<{occurrenceDate: string, startDateTime: string, endDateTime: string}>}
 */
function expandAllOccurrences(recurrence, masterStartDateTime, masterEndDateTime) {
  if (!recurrence?.pattern || !recurrence?.range) return [];

  const { pattern, range, exclusions = [], additions = [] } = recurrence;

  // Extract time-of-day from master datetimes
  const startTimePart = (typeof masterStartDateTime === 'string' && masterStartDateTime.includes('T'))
    ? masterStartDateTime.split('T')[1].replace(/Z$/, '') : '00:00:00';
  const endTimePart = (typeof masterEndDateTime === 'string' && masterEndDateTime.includes('T'))
    ? masterEndDateTime.split('T')[1].replace(/Z$/, '') : '23:59:00';

  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const patternStart = new Date(range.startDate + 'T00:00:00');
  const patternEnd = range.type === 'endDate' && range.endDate
    ? new Date(range.endDate + 'T23:59:59')
    : new Date(patternStart.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year default

  const maxOcc = range.type === 'numbered' ? (range.numberOfOccurrences || MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const occurrenceDates = new Set();
  const occurrences = [];

  // Iterate through pattern range to find matching dates
  const current = new Date(patternStart);
  let count = 0;

  while (current <= patternEnd && count < maxOcc) {
    if (isDateInPattern(current, pattern, patternStart)) {
      const dateStr = toDateStr(current);
      if (!exclusions.includes(dateStr)) {
        occurrenceDates.add(dateStr);
        occurrences.push({
          occurrenceDate: dateStr,
          startDateTime: `${dateStr}T${startTimePart}`,
          endDateTime: `${dateStr}T${endTimePart}`,
        });
      }
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  // Add ad-hoc addition dates that aren't already in the set
  for (const addDate of additions) {
    if (!occurrenceDates.has(addDate) && !exclusions.includes(addDate)) {
      occurrenceDates.add(addDate);
      occurrences.push({
        occurrenceDate: addDate,
        startDateTime: `${addDate}T${startTimePart}`,
        endDateTime: `${addDate}T${endTimePart}`,
      });
    }
  }

  // Sort chronologically
  occurrences.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));

  return occurrences;
}

module.exports = {
  isDateInPattern,
  expandRecurringOccurrencesInWindow,
  expandAllOccurrences,
};

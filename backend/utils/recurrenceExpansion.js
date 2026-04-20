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

      // Anchor to the Sunday of each week so multi-day patterns (e.g., Tue+Thu)
      // are grouped into the same week before checking the interval
      const checkMidnight = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
      const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());

      const startSunday = new Date(startMidnight);
      startSunday.setDate(startSunday.getDate() - startMidnight.getDay());
      const checkSunday = new Date(checkMidnight);
      checkSunday.setDate(checkSunday.getDate() - checkMidnight.getDay());

      const weeksDiff = Math.round((checkSunday - startSunday) / (7 * 24 * 60 * 60 * 1000));
      return weeksDiff >= 0 && weeksDiff % interval === 0;
    }

    case 'absoluteMonthly':
    case 'monthly': {
      const monthsDiff = (checkDate.getFullYear() - start.getFullYear()) * 12 +
                         (checkDate.getMonth() - start.getMonth());
      return checkDate.getDate() === start.getDate() && monthsDiff % interval === 0;
    }

    case 'absoluteYearly':
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
  const recurrence = masterEvent.recurrence;
  if (!recurrence?.pattern || !recurrence?.range) return [];

  const { pattern, range, exclusions = [] } = recurrence;
  const occurrences = [];

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

  // For numbered ranges, count occurrences before the window to track how many were consumed
  if (range.type === 'numbered' && windowStart > patternStart) {
    const preCount = new Date(patternStart);
    while (preCount < rangeStart && count < maxOcc) {
      if (isDateInPattern(preCount, pattern, patternStart)) {
        const pad2 = (n) => String(n).padStart(2, '0');
        const dateStr2 = `${preCount.getFullYear()}-${pad2(preCount.getMonth() + 1)}-${pad2(preCount.getDate())}`;
        if (!exclusions.includes(dateStr2)) {
          count++;
        }
      }
      preCount.setDate(preCount.getDate() + 1);
    }
  }

  while (current <= rangeEnd && count < maxOcc) {
    if (isDateInPattern(current, pattern, patternStart)) {
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`;

      // Skip excluded dates — don't count them toward numbered limit
      if (!exclusions.includes(dateStr)) {
        // Per-occurrence overrides are now stored as exception documents (separate DB records).
        // Dates with exception docs are excluded from expansion by the caller (exceptionDatesByMaster).
        // Only un-overridden occurrences reach here — use master times directly.
        occurrences.push({
          occurrenceDate: dateStr,
          startDateTime: `${dateStr}T${startTimePart}`,
          endDateTime: `${dateStr}T${endTimePart}`,
        });
        count++;
      }
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
  // For noEnd/numbered ranges, cap at 2 years from now (not from startDate)
  // so that old series still produce future occurrences for conflict detection
  const now = new Date();
  const twoYearsFromNow = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
  const patternEnd = range.type === 'endDate' && range.endDate
    ? new Date(range.endDate + 'T23:59:59')
    : twoYearsFromNow;

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
        count++;
      }
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

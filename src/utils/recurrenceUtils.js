// src/utils/recurrenceUtils.js
/**
 * Utilities for calculating and managing recurring event patterns
 * Compatible with Microsoft Graph API recurrence format
 */

/**
 * Check if a date matches the recurrence pattern
 * @param {Date} date - Date to check
 * @param {Object} pattern - Recurrence pattern { type, interval, daysOfWeek }
 * @param {Date} startDate - Pattern start date
 * @returns {boolean}
 */
export function isDateInPattern(date, pattern, startDate) {
  if (!pattern || !startDate) return false;

  const checkDate = new Date(date);
  const start = new Date(startDate);

  // Date must be on or after start date
  if (checkDate < start) return false;

  const { type, interval = 1, daysOfWeek } = pattern;

  switch (type) {
    case 'daily': {
      const daysDiff = Math.floor((checkDate - start) / (1000 * 60 * 60 * 24));
      return daysDiff % interval === 0;
    }

    case 'weekly': {
      // Check if day of week matches
      if (!daysOfWeek || daysOfWeek.length === 0) return false;

      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const checkDayName = dayNames[checkDate.getDay()];

      if (!daysOfWeek.includes(checkDayName)) return false;

      // Check if it's the right week interval
      const weeksDiff = Math.floor((checkDate - start) / (1000 * 60 * 60 * 24 * 7));
      return weeksDiff % interval === 0;
    }

    case 'monthly': {
      const monthsDiff = (checkDate.getFullYear() - start.getFullYear()) * 12 +
                         (checkDate.getMonth() - start.getMonth());

      // Same day of month
      return checkDate.getDate() === start.getDate() && monthsDiff % interval === 0;
    }

    case 'yearly': {
      const yearsDiff = checkDate.getFullYear() - start.getFullYear();

      // Same month and day
      return checkDate.getMonth() === start.getMonth() &&
             checkDate.getDate() === start.getDate() &&
             yearsDiff % interval === 0;
    }

    default:
      return false;
  }
}

/**
 * Calculate all recurrence dates for a given month
 * @param {Object} pattern - Recurrence pattern
 * @param {Object} range - Recurrence range { startDate, endDate, type }
 * @param {Date} viewMonth - Month to calculate for
 * @returns {string[]} Array of YYYY-MM-DD date strings
 */
export function calculateRecurrenceDates(pattern, range, viewMonth) {
  if (!pattern || !range) return [];

  const dates = [];
  const month = new Date(viewMonth);

  // Start from beginning of view month or pattern start, whichever is later
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const patternStart = new Date(range.startDate);
  const start = monthStart > patternStart ? monthStart : patternStart;

  // End at end of view month or pattern end, whichever is earlier
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  let end = monthEnd;

  if (range.type === 'endDate' && range.endDate) {
    const patternEnd = new Date(range.endDate);
    end = patternEnd < monthEnd ? patternEnd : monthEnd;
  }

  // Generate dates
  const current = new Date(start);
  while (current <= end) {
    if (isDateInPattern(current, pattern, patternStart)) {
      dates.push(current.toISOString().split('T')[0]);
    }

    // Advance by one day
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Expand a recurring event series into individual occurrences
 * @param {Object} masterEvent - Master event with recurrence
 * @param {string} startDate - Range start (YYYY-MM-DD)
 * @param {string} endDate - Range end (YYYY-MM-DD)
 * @param {Array} exceptions - Array of exception events
 * @returns {Array} Array of occurrence events
 */
export function expandRecurringSeries(masterEvent, startDate, endDate, exceptions = []) {
  if (!masterEvent.recurrence) return [];

  const occurrences = [];
  const { pattern, range } = masterEvent.recurrence;

  // Calculate pattern dates
  const rangeStart = new Date(Math.max(new Date(startDate), new Date(range.startDate)));
  const rangeEnd = new Date(endDate);

  // Apply end date if specified
  if (range.type === 'endDate' && range.endDate) {
    const patternEnd = new Date(range.endDate);
    if (patternEnd < rangeEnd) {
      rangeEnd.setTime(patternEnd.getTime());
    }
  }

  // Generate all pattern dates in range
  const current = new Date(rangeStart);
  let count = 0;
  const maxOccurrences = range.type === 'numbered' ? range.numberOfOccurrences : Infinity;

  while (current <= rangeEnd && count < maxOccurrences) {
    if (isDateInPattern(current, pattern, new Date(range.startDate))) {
      const occurrenceDate = current.toISOString().split('T')[0];

      // Check if this occurrence has an exception
      const exception = exceptions.find(ex =>
        ex.originalStartDateTime?.split('T')[0] === occurrenceDate
      );

      if (exception) {
        if (!exception.isCancelled) {
          // Use exception data
          occurrences.push({
            ...exception,
            isRecurring: true,
            isException: true
          });
        }
        // If cancelled, skip this occurrence
      } else {
        // Create occurrence from master
        const startTime = masterEvent.start.dateTime.split('T')[1];
        const endTime = masterEvent.end.dateTime.split('T')[1];

        occurrences.push({
          eventId: `${masterEvent.eventId}-${occurrenceDate}`,
          seriesMasterId: masterEvent.eventId,
          subject: masterEvent.subject,
          start: {
            dateTime: `${occurrenceDate}T${startTime}`,
            timeZone: masterEvent.start.timeZone
          },
          end: {
            dateTime: `${occurrenceDate}T${endTime}`,
            timeZone: masterEvent.end.timeZone
          },
          location: masterEvent.location,
          isRecurring: true,
          isException: false,
          // Include any other fields from master
          ...masterEvent
        });
      }

      count++;
    }

    // Advance by one day
    current.setDate(current.getDate() + 1);
  }

  return occurrences;
}

/**
 * Format recurrence pattern as human-readable text
 * @param {Object} pattern - Recurrence pattern
 * @param {Object} range - Recurrence range
 * @returns {string}
 */
export function formatRecurrenceSummary(pattern, range) {
  if (!pattern) return '';

  let summary = 'Occurs ';
  const { type, interval = 1, daysOfWeek } = pattern;

  switch (type) {
    case 'daily':
      summary += interval === 1 ? 'daily' : `every ${interval} days`;
      break;

    case 'weekly': {
      if (daysOfWeek && daysOfWeek.length > 0) {
        const dayNames = daysOfWeek.map(d => d.charAt(0).toUpperCase() + d.slice(1));
        summary += `every ${dayNames.join(', ')}`;
      } else {
        summary += interval === 1 ? 'weekly' : `every ${interval} weeks`;
      }
      break;
    }

    case 'monthly':
      summary += interval === 1 ? 'monthly' : `every ${interval} months`;
      break;

    case 'yearly':
      summary += interval === 1 ? 'yearly' : `every ${interval} years`;
      break;

    default:
      return '';
  }

  // Add end information
  if (range) {
    if (range.type === 'endDate' && range.endDate) {
      const date = new Date(range.endDate);
      summary += ` until ${date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
      })}`;
    } else if (range.type === 'numbered' && range.numberOfOccurrences) {
      summary += ` for ${range.numberOfOccurrences} occurrence${range.numberOfOccurrences > 1 ? 's' : ''}`;
    }
  }

  return summary;
}

/**
 * Convert Date objects to YYYY-MM-DD strings
 * @param {Date[]} dates - Array of Date objects
 * @returns {string[]} Array of YYYY-MM-DD strings
 */
export function datesToStrings(dates) {
  return dates.map(date => date.toISOString().split('T')[0]);
}

/**
 * Convert YYYY-MM-DD strings to Date objects
 * @param {string[]} dateStrings - Array of YYYY-MM-DD strings
 * @returns {Date[]} Array of Date objects
 */
export function stringsToDates(dateStrings) {
  return dateStrings.map(str => new Date(str + 'T00:00:00'));
}

/**
 * Format recurrence pattern with additions and exclusions
 * @param {Object} pattern - Recurrence pattern
 * @param {Object} range - Recurrence range
 * @param {string[]} additions - Ad-hoc addition dates (YYYY-MM-DD)
 * @param {string[]} exclusions - Excluded dates (YYYY-MM-DD)
 * @returns {string} Enhanced summary text (may include newlines)
 */
export function formatRecurrenceSummaryEnhanced(pattern, range, additions = [], exclusions = []) {
  if (!pattern) return '';

  let summary = formatRecurrenceSummary(pattern, range);

  // Add exclusions on new line
  if (exclusions.length > 0) {
    const excludeDates = exclusions.map(dateStr => {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    }).join(', ');

    summary += `\nExcl Dates: ${excludeDates}`;
  }

  // Add additions on new line
  if (additions.length > 0) {
    const addDates = additions.map(dateStr => {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    }).join(', ');

    summary += `\nAdded Dates: ${addDates}`;
  }

  return summary;
}

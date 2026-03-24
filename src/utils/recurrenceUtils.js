// src/utils/recurrenceUtils.js
/**
 * Utilities for calculating and managing recurring event patterns
 * Compatible with Microsoft Graph API recurrence format
 */

/**
 * Transform internal recurrence format to Microsoft Graph API format
 * @param {Object} recurrence - Internal recurrence object { pattern, range, additions, exclusions }
 * @param {string} timeZone - Timezone for the recurrence (e.g., 'Eastern Standard Time')
 * @returns {Object} Graph API compatible recurrence object
 */
export function transformRecurrenceForGraphAPI(recurrence, timeZone = 'Eastern Standard Time') {
  if (!recurrence || !recurrence.pattern || !recurrence.range) {
    return null;
  }

  const { pattern, range } = recurrence;

  // Map internal type names to Graph API enum values
  const graphTypeMap = {
    'monthly': 'absoluteMonthly',
    'yearly': 'absoluteYearly',
  };
  const graphType = graphTypeMap[pattern.type] || pattern.type;

  // Build Graph API recurrence object
  const graphRecurrence = {
    pattern: {
      type: graphType,
      interval: pattern.interval || 1,
      ...(pattern.daysOfWeek && pattern.daysOfWeek.length > 0 && { daysOfWeek: pattern.daysOfWeek }),
      // Graph API only uses firstDayOfWeek for weekly patterns
      ...(pattern.firstDayOfWeek && pattern.type === 'weekly' && { firstDayOfWeek: pattern.firstDayOfWeek })
    },
    range: {
      type: range.type,
      startDate: range.startDate,
      recurrenceTimeZone: timeZone,
      ...(range.type === 'endDate' && range.endDate && { endDate: range.endDate }),
      ...(range.type === 'numbered' && range.numberOfOccurrences && { numberOfOccurrences: range.numberOfOccurrences })
    }
  };

  return graphRecurrence;
}

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
      // Use local date normalization to avoid DST off-by-one (23h or 25h days)
      const startNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const checkNorm = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
      const daysDiff = Math.round((checkNorm - startNorm) / (1000 * 60 * 60 * 24));
      return daysDiff >= 0 && daysDiff % interval === 0;
    }

    case 'weekly': {
      // Check if day of week matches
      if (!daysOfWeek || daysOfWeek.length === 0) return false;

      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const checkDayName = dayNames[checkDate.getDay()];

      // Normalize day names to lowercase for case-insensitive comparison
      const normalizedDaysOfWeek = daysOfWeek.map(d => d.toLowerCase());
      if (!normalizedDaysOfWeek.includes(checkDayName)) return false;

      // Check if it's the right week interval
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

      // Same day of month
      return checkDate.getDate() === start.getDate() && monthsDiff % interval === 0;
    }

    case 'absoluteYearly':
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
  const patternStart = new Date(range.startDate + 'T00:00:00');
  const start = monthStart > patternStart ? monthStart : patternStart;

  // End at end of view month or pattern end, whichever is earlier
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  let end = monthEnd;

  if (range.type === 'endDate' && range.endDate) {
    const patternEnd = new Date(range.endDate + 'T00:00:00');
    end = patternEnd < monthEnd ? patternEnd : monthEnd;
  }

  // For numbered ranges, count occurrences from pattern start to enforce the cap.
  // We must count from patternStart (not monthStart) to know which occurrences
  // in this month are within the limit.
  const maxOcc = range.type === 'numbered' ? (range.numberOfOccurrences || Infinity) : Infinity;
  let priorCount = 0;
  if (range.type === 'numbered' && monthStart > patternStart) {
    const counter = new Date(patternStart);
    while (counter < monthStart && priorCount < maxOcc) {
      if (isDateInPattern(counter, pattern, patternStart)) {
        priorCount++;
      }
      counter.setDate(counter.getDate() + 1);
    }
  }

  // Generate dates
  let count = priorCount;
  const current = new Date(start);
  while (current <= end && count < maxOcc) {
    if (isDateInPattern(current, pattern, patternStart)) {
      count++;
      dates.push(`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`);
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
export function expandRecurringSeries(masterEvent, startDate, endDate, exceptions = [], occurrenceOverrides = []) {
  if (!masterEvent.recurrence) return [];

  const occurrences = [];
  const { pattern, range, exclusions = [], additions = [] } = masterEvent.recurrence;

  // Build a lookup map for occurrence overrides (array → keyed by date)
  const overrideMap = {};
  if (Array.isArray(occurrenceOverrides)) {
    for (const o of occurrenceOverrides) {
      if (o.occurrenceDate) overrideMap[o.occurrenceDate] = o;
    }
  }

  const exclusionSet = new Set(exclusions);

  // Calculate pattern dates — append T00:00:00 to parse as local midnight, not UTC
  const rangeStart = new Date(Math.max(new Date(startDate + 'T00:00:00'), new Date(range.startDate + 'T00:00:00')));
  const rangeEnd = new Date(endDate + 'T23:59:59');

  // Apply end date if specified
  if (range.type === 'endDate' && range.endDate) {
    const patternEnd = new Date(range.endDate + 'T23:59:59');
    if (patternEnd < rangeEnd) {
      rangeEnd.setTime(patternEnd.getTime());
    }
  }

  // Track generated dates to avoid duplicates with additions
  const generatedDates = new Set();

  // Generate all pattern dates in range
  const current = new Date(rangeStart);
  let count = 0;
  const maxOccurrences = range.type === 'numbered' ? range.numberOfOccurrences : Infinity;

  while (current <= rangeEnd && count < maxOccurrences) {
    if (isDateInPattern(current, pattern, new Date(range.startDate))) {
      // Use local date components to avoid UTC conversion/timezone shifts
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const occurrenceDate = `${year}-${month}-${day}`;

      // Skip excluded dates — don't count them toward numbered limit
      if (exclusionSet.has(occurrenceDate)) {
        current.setDate(current.getDate() + 1);
        continue;
      }

      count++;
      generatedDates.add(occurrenceDate);

      // Check if this occurrence has a Graph API exception
      const exception = exceptions.find(ex =>
        ex.originalStartDateTime?.split('T')[0] === occurrenceDate
      );

      if (exception) {
        if (!exception.isCancelled) {
          occurrences.push({
            ...exception,
            isRecurring: true,
            isException: true
          });
        }
      } else {
        // Extract time portion, keeping Graph API format (HH:MM:SS.0000000, no Z)
        const startTime = masterEvent.start.dateTime.split('T')[1].replace(/Z$/, '').substring(0, 17);
        const endTime = masterEvent.end.dateTime.split('T')[1].replace(/Z$/, '').substring(0, 17);

        // Check for per-occurrence override
        const override = overrideMap[occurrenceDate] || {};
        const hasOverride = Object.keys(override).length > 0;
        const effectiveStartTime = override.startTime
          ? `${occurrenceDate}T${override.startTime}:00.0000000`
          : `${occurrenceDate}T${startTime}`;
        const effectiveEndTime = override.endTime
          ? `${occurrenceDate}T${override.endTime}:00.0000000`
          : `${occurrenceDate}T${endTime}`;

        occurrences.push({
          ...masterEvent,
          ...override,
          eventId: `${masterEvent.eventId}-${occurrenceDate}`,
          seriesMasterId: masterEvent.eventId,
          subject: override.eventTitle || masterEvent.subject,
          start: {
            dateTime: effectiveStartTime,
            timeZone: masterEvent.start.timeZone
          },
          end: {
            dateTime: effectiveEndTime,
            timeZone: masterEvent.end.timeZone
          },
          location: masterEvent.location,
          isRecurring: true,
          isException: hasOverride,
          hasOccurrenceOverride: hasOverride,
        });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  // Add ad-hoc additions that fall within the view window
  const viewStart = new Date(startDate + 'T00:00:00');
  const viewEnd = new Date(endDate + 'T23:59:59');
  for (const addDate of additions) {
    if (generatedDates.has(addDate) || exclusionSet.has(addDate)) continue;
    const addDateObj = new Date(addDate + 'T00:00:00');
    if (addDateObj < viewStart || addDateObj > viewEnd) continue;

    const startTime = masterEvent.start.dateTime.split('T')[1].replace(/Z$/, '').substring(0, 17);
    const endTime = masterEvent.end.dateTime.split('T')[1].replace(/Z$/, '').substring(0, 17);
    const override = overrideMap[addDate] || {};
    const hasOverride = Object.keys(override).length > 0;
    const effectiveStartTime = override.startTime
      ? `${addDate}T${override.startTime}:00.0000000`
      : `${addDate}T${startTime}`;
    const effectiveEndTime = override.endTime
      ? `${addDate}T${override.endTime}:00.0000000`
      : `${addDate}T${endTime}`;

    occurrences.push({
      ...masterEvent,
      ...override,
      eventId: `${masterEvent.eventId}-${addDate}`,
      seriesMasterId: masterEvent.eventId,
      subject: override.eventTitle || masterEvent.subject,
      start: {
        dateTime: effectiveStartTime,
        timeZone: masterEvent.start.timeZone
      },
      end: {
        dateTime: effectiveEndTime,
        timeZone: masterEvent.end.timeZone
      },
      location: masterEvent.location,
      isRecurring: true,
      isException: hasOverride,
      hasOccurrenceOverride: hasOverride,
      isAdHocAddition: true,
    });
  }

  return occurrences;
}

/**
 * Format recurrence pattern as human-readable text
 * @param {Object} pattern - Recurrence pattern
 * @param {Object} range - Recurrence range
 * @returns {string}
 */
/**
 * Calculate all occurrence dates for the full series range (not windowed).
 * Returns a sorted array of YYYY-MM-DD strings, honoring exclusions and additions.
 * Used for computing occurrence position (e.g., "2/5") in calendar display.
 * @param {Object} recurrence - { pattern, range, exclusions, additions }
 * @returns {string[]} Sorted array of YYYY-MM-DD date strings
 */
export function calculateAllSeriesDates(recurrence) {
  if (!recurrence?.pattern || !recurrence?.range) return [];

  const { pattern, range, exclusions = [], additions = [] } = recurrence;
  const exclusionSet = new Set(exclusions);
  const dates = new Set();

  const patternStart = new Date(range.startDate + 'T00:00:00');
  let patternEnd;
  if (range.type === 'endDate' && range.endDate) {
    patternEnd = new Date(range.endDate + 'T00:00:00');
  } else {
    // For noEnd/numbered, cap at 2 years
    patternEnd = new Date(patternStart);
    patternEnd.setFullYear(patternEnd.getFullYear() + 2);
  }

  const maxOcc = range.type === 'numbered' ? (range.numberOfOccurrences || 500) : 500;
  const current = new Date(patternStart);
  let count = 0;

  while (current <= patternEnd && count < maxOcc) {
    if (isDateInPattern(current, pattern, patternStart)) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      if (!exclusionSet.has(dateStr)) {
        dates.add(dateStr);
        count++;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  // Add ad-hoc additions
  for (const addDate of additions) {
    if (!exclusionSet.has(addDate)) {
      dates.add(addDate);
    }
  }

  return Array.from(dates).sort();
}

export function formatRecurrenceSummary(pattern, range) {
  if (!pattern) return '';

  const dayAbbreviations = {
    sunday: 'Su',
    monday: 'M',
    tuesday: 'Tu',
    wednesday: 'W',
    thursday: 'Th',
    friday: 'F',
    saturday: 'S'
  };

  let summary = 'Occurs every ';
  const { type, interval = 1, daysOfWeek } = pattern;

  switch (type) {
    case 'daily':
      summary += interval === 1 ? 'day' : `${interval} days`;
      break;

    case 'weekly': {
      if (daysOfWeek && daysOfWeek.length > 0) {
        const dayAbbrevs = daysOfWeek.map(d => dayAbbreviations[d.toLowerCase()] || d);
        summary += dayAbbrevs.join(', ');
      } else {
        summary += interval === 1 ? 'week' : `${interval} weeks`;
      }
      break;
    }

    case 'absoluteMonthly':
    case 'monthly':
      summary += interval === 1 ? 'month' : `${interval} months`;
      break;

    case 'absoluteYearly':
    case 'yearly':
      summary += interval === 1 ? 'year' : `${interval} years`;
      break;

    default:
      return '';
  }

  // Add end information on new line
  if (range) {
    if (range.type === 'endDate' && range.endDate) {
      // Add T00:00:00 to parse as local midnight, not UTC midnight
      // Otherwise dates display 1 day earlier in timezones west of UTC
      const date = new Date(range.endDate + 'T00:00:00');
      summary += `\nUntil ${date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`;
    } else if (range.type === 'numbered' && range.numberOfOccurrences) {
      summary += `\nFor ${range.numberOfOccurrences} occurrence${range.numberOfOccurrences > 1 ? 's' : ''}`;
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
  return dates.map(date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
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

  const baseSummary = formatRecurrenceSummary(pattern, range);

  // Build arrays of formatted dates with color metadata
  const formattedExclusions = exclusions.map(dateStr => {
    const date = new Date(dateStr + 'T00:00:00');
    return {
      text: date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      color: 'red'
    };
  });

  const formattedAdditions = additions.map(dateStr => {
    const date = new Date(dateStr + 'T00:00:00');
    return {
      text: date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      color: 'green'
    };
  });

  // Calculate occurrence count and series date range
  let occurrenceCount = null;
  let seriesRange = null;
  let nextOccurrences = [];

  if (range) {
    const dateFormat = { month: 'short', day: 'numeric', year: 'numeric' };
    const startDate = range.startDate ? new Date(range.startDate + 'T00:00:00') : null;

    seriesRange = {
      start: startDate ? startDate.toLocaleDateString('en-US', dateFormat) : null,
      end: null
    };

    if (range.type === 'numbered' && range.numberOfOccurrences) {
      occurrenceCount = range.numberOfOccurrences;
    } else if (range.type === 'endDate' && range.endDate) {
      const endDate = new Date(range.endDate + 'T00:00:00');
      seriesRange.end = endDate.toLocaleDateString('en-US', dateFormat);

      // Count occurrences by iterating month-by-month from start to end
      let count = 0;
      const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const limit = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0);
      while (cursor <= limit && count < 500) {
        const monthDates = calculateRecurrenceDates(pattern, range, cursor);
        count += monthDates.length;
        cursor.setMonth(cursor.getMonth() + 1);
      }
      // Adjust for exclusions/additions
      count = count - exclusions.length + additions.length;
      occurrenceCount = Math.max(0, count);
    }

    // Find next 3 upcoming occurrences from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shortDateFormat = { weekday: 'short', month: 'short', day: 'numeric' };
    const maxLookahead = new Date(today);
    maxLookahead.setMonth(maxLookahead.getMonth() + 6);
    const exclusionSet = new Set(exclusions);
    const cursor2 = new Date(today.getFullYear(), today.getMonth(), 1);

    while (nextOccurrences.length < 3 && cursor2 <= maxLookahead) {
      const monthDates = calculateRecurrenceDates(pattern, range, cursor2);
      for (const dateStr of monthDates) {
        if (exclusionSet.has(dateStr)) continue;
        const d = new Date(dateStr + 'T00:00:00');
        if (d >= today && nextOccurrences.length < 3) {
          nextOccurrences.push(d.toLocaleDateString('en-US', shortDateFormat));
        }
      }
      cursor2.setMonth(cursor2.getMonth() + 1);
    }

    // Also include ad-hoc additions that are upcoming
    for (const dateStr of additions) {
      const d = new Date(dateStr + 'T00:00:00');
      if (d >= today && nextOccurrences.length < 3) {
        nextOccurrences.push(d.toLocaleDateString('en-US', shortDateFormat));
      }
    }
    // Sort and limit
    nextOccurrences.sort((a, b) => new Date(a) - new Date(b));
    nextOccurrences = nextOccurrences.slice(0, 3);
  }

  // Return object with base summary and enriched data for React rendering
  return {
    base: baseSummary,
    exclusions: formattedExclusions,
    additions: formattedAdditions,
    occurrenceCount,
    nextOccurrences,
    seriesRange
  };
}

/**
 * Extract override fields for a specific occurrence date from the overrides array.
 * Used by save paths to merge occurrence-specific values into the request body
 * as top-level fields (backend reads override values from top-level updates.*).
 *
 * @param {string} occurrenceDate - The occurrence date (YYYY-MM-DD or datetime string)
 * @param {Array} occurrenceOverrides - Array of override objects with occurrenceDate keys
 * @returns {Object} Flat object of override fields (excludes occurrenceDate itself)
 */
export function extractOccurrenceOverrideFields(occurrenceDate, occurrenceOverrides) {
  if (!occurrenceDate || !Array.isArray(occurrenceOverrides)) return {};
  const dateKey = occurrenceDate.split('T')[0];
  const match = occurrenceOverrides.find(o => o.occurrenceDate === dateKey);
  if (!match) return {};

  const fields = {};
  for (const [key, value] of Object.entries(match)) {
    if (key === 'occurrenceDate') continue;
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

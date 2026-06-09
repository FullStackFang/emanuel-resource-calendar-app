'use strict';

/**
 * Recurrence Graph API mapping utilities.
 *
 * Translates the internal recurrence shape (used throughout the app) into
 * Microsoft Graph API's Recurrence object. Extracted from api-server.js so
 * that both the admin publish path and the rsched-import publish path can
 * share a single implementation.
 *
 * Internal recurrence shape:
 *   {
 *     pattern: { type: 'daily'|'weekly'|'monthly'|'yearly'|'absoluteMonthly'|'absoluteYearly',
 *                interval, daysOfWeek?, dayOfMonth?, month?, index?, firstDayOfWeek? },
 *     range:   { type: 'noEnd'|'endDate'|'numbered', startDate, endDate?,
 *                numberOfOccurrences?, recurrenceTimeZone? },
 *     exclusions?: ['YYYY-MM-DD', ...],
 *     additions?: ['YYYY-MM-DD', ...],
 *   }
 *
 * Graph API expects 'absoluteMonthly' / 'absoluteYearly' (not bare 'monthly' /
 * 'yearly') and a Windows timezone name (not IANA). This function handles both
 * conversions.
 */

/**
 * Build Graph API recurrence object from internal recurrence format.
 *
 * @param {Object} recurrence - Internal recurrence { pattern, range, additions, exclusions }
 * @param {string} timeZone - IANA timezone (e.g., 'America/New_York')
 * @returns {Object|null} Graph API compatible { pattern, range } or null
 */
function buildGraphRecurrence(recurrence, timeZone) {
  if (!recurrence?.pattern || !recurrence?.range) return null;

  // Map internal type names to Graph API enum values
  const graphTypeMap = {
    'monthly': 'absoluteMonthly',
    'yearly': 'absoluteYearly',
  };

  const rawType = recurrence.pattern.type || 'weekly';
  const pattern = {
    type: graphTypeMap[rawType] || rawType,
    interval: recurrence.pattern.interval || 1,
  };

  if (recurrence.pattern.daysOfWeek) {
    pattern.daysOfWeek = recurrence.pattern.daysOfWeek;
  }
  if (recurrence.pattern.dayOfMonth) {
    pattern.dayOfMonth = recurrence.pattern.dayOfMonth;
  }
  if (recurrence.pattern.month) {
    pattern.month = recurrence.pattern.month;
  }
  if (recurrence.pattern.index) {
    pattern.index = recurrence.pattern.index;
  }

  // Graph's absoluteMonthly/absoluteYearly patterns REQUIRE dayOfMonth (1-31),
  // and absoluteYearly also requires month (1-12). The app's internal recurrence
  // format may omit these (its own date expander derives them from
  // range.startDate), so derive them here from the range start date when absent.
  // Without this, Graph rejects the create with "DayOfMonth should be between 1
  // and 31." Explicit pattern values (copied above) always win over derivation.
  if (pattern.type === 'absoluteMonthly' || pattern.type === 'absoluteYearly') {
    const startDate = recurrence.range.startDate; // 'YYYY-MM-DD'
    if (pattern.dayOfMonth == null && typeof startDate === 'string') {
      const day = parseInt(startDate.slice(8, 10), 10);
      if (day >= 1 && day <= 31) pattern.dayOfMonth = day;
    }
    if (pattern.type === 'absoluteYearly' && pattern.month == null && typeof startDate === 'string') {
      const month = parseInt(startDate.slice(5, 7), 10);
      if (month >= 1 && month <= 12) pattern.month = month;
    }
  }
  // Graph API only uses firstDayOfWeek for weekly patterns
  if (recurrence.pattern.firstDayOfWeek && rawType === 'weekly') {
    pattern.firstDayOfWeek = recurrence.pattern.firstDayOfWeek;
  }

  const range = {
    type: recurrence.range.type || 'noEnd',
    startDate: recurrence.range.startDate,
  };

  if (recurrence.range.type === 'endDate' && recurrence.range.endDate) {
    range.endDate = recurrence.range.endDate;
  }
  if (recurrence.range.type === 'numbered' && recurrence.range.numberOfOccurrences) {
    range.numberOfOccurrences = recurrence.range.numberOfOccurrences;
  }

  // Map IANA timezone to Windows timezone name for Graph API
  const tzMap = {
    'America/New_York': 'Eastern Standard Time',
    'America/Chicago': 'Central Standard Time',
    'America/Denver': 'Mountain Standard Time',
    'America/Los_Angeles': 'Pacific Standard Time',
  };
  range.recurrenceTimeZone = recurrence.range.recurrenceTimeZone || tzMap[timeZone] || timeZone;

  return { pattern, range };
}

module.exports = {
  buildGraphRecurrence,
};

// src/utils/calendarRangeUtils.js

/**
 * Return true if `startDateTime` falls within `[dateRange.start, dateRange.end)`.
 * Returns true (fail-open) when the range or the input is missing/invalid —
 * the caller decides whether to include or drop in those cases.
 *
 * @param {string|number|Date|null|undefined} startDateTime
 * @param {{ start?: Date, end?: Date } | null | undefined} dateRange
 * @returns {boolean}
 */
export function isEventInDateRange(startDateTime, dateRange) {
  if (!startDateTime) return true;
  if (!dateRange || !(dateRange.start instanceof Date) || !(dateRange.end instanceof Date)) {
    return true;
  }
  const d = startDateTime instanceof Date ? startDateTime : new Date(startDateTime);
  if (isNaN(d.getTime())) return true;
  return d >= dateRange.start && d < dateRange.end;
}

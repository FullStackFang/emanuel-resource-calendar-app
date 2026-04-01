/**
 * Timezone-safe time parsing utilities.
 *
 * The app stores times as naive local-time strings (e.g., "2026-03-25T16:30:00")
 * representing America/New_York time. These utilities extract hours, minutes, and
 * dates directly from the string WITHOUT using `new Date()`, which would interpret
 * them in the browser's local timezone — causing incorrect rendering when the
 * user's browser timezone differs from America/New_York.
 *
 * Used by: SchedulingAssistant (block positioning, conflict detection, labels)
 */

export const APP_TIMEZONE = 'America/New_York';

/**
 * Extract hours and minutes from a datetime string like "2026-03-25T16:30:00".
 * @param {string} dateTimeStr - ISO-like datetime string (with or without seconds)
 * @returns {{ hours: number, minutes: number } | null}
 */
export function parseTimeFromString(dateTimeStr) {
  if (!dateTimeStr) return null;
  const timePart = dateTimeStr.split('T')[1];
  if (!timePart) return null;
  const [h, m] = timePart.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

/**
 * Extract date portion "YYYY-MM-DD" from a datetime string.
 * @param {string} dateTimeStr
 * @returns {string | null}
 */
export function parseDateFromString(dateTimeStr) {
  if (!dateTimeStr) return null;
  return dateTimeStr.split('T')[0] || null;
}

/**
 * Convert { hours, minutes } to decimal hours (e.g., 16:30 → 16.5).
 * @param {{ hours: number, minutes: number }} time
 * @returns {number}
 */
export function toDecimalHours(time) {
  if (!time) return 0;
  return time.hours + (time.minutes / 60);
}

/**
 * Convert a datetime string directly to decimal hours.
 * Shorthand for toDecimalHours(parseTimeFromString(str)).
 * @param {string} dateTimeStr
 * @returns {number}
 */
export function dateTimeToDecimalHours(dateTimeStr) {
  return toDecimalHours(parseTimeFromString(dateTimeStr));
}

/**
 * Format a datetime string to "H:MM AM/PM" display format.
 * Does NOT use Date objects — timezone-safe.
 * @param {string} dateTimeStr - e.g., "2026-03-25T16:30:00"
 * @returns {string} - e.g., "4:30 PM"
 */
export function formatTimeFromDateTimeString(dateTimeStr) {
  const t = parseTimeFromString(dateTimeStr);
  if (!t) return '';
  return formatHoursMinutes(t.hours, t.minutes);
}

/**
 * Format hours and minutes to "H:MM AM/PM".
 * @param {number} hours - 0-23
 * @param {number} minutes - 0-59
 * @returns {string}
 */
export function formatHoursMinutes(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Format an "HH:MM" time string to "H:MM AM/PM".
 * Timezone-safe (pure string parsing, no Date objects).
 * @param {string} timeStr - e.g., "14:30" or "09:00"
 * @returns {string} - e.g., "2:30 PM" or "9:00 AM", or '' if invalid
 */
export function formatTimeString(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  return formatHoursMinutes(h, m);
}

/**
 * Normalize a datetime string to always include seconds.
 * "2026-03-25T16:00" → "2026-03-25T16:00:00"
 * "2026-03-25T16:00:00" → "2026-03-25T16:00:00" (unchanged)
 * @param {string} dateTimeStr
 * @returns {string}
 */
export function normalizeDateTimeSeconds(dateTimeStr) {
  if (!dateTimeStr) return dateTimeStr;
  // If string is exactly "YYYY-MM-DDTHH:MM" (16 chars), append ":00"
  if (dateTimeStr.length === 16 && dateTimeStr.includes('T')) {
    return dateTimeStr + ':00';
  }
  return dateTimeStr;
}

// backend/utils/localDate.js
//
// Wall-clock date strings (YYYY-MM-DD) in the temple's local calendar. Pure,
// dependency-free, no server imports (same stance as sheetCells.js and
// icsBuilder.js).
//
// WHY THIS EXISTS: scheduling-sheet days are stored as local date strings, so
// any bound they are compared against must be a LOCAL date too.
// `new Date().toISOString().slice(0, 10)` is the UTC date, which runs four to
// five hours ahead of New York every evening — a day dated the 11th dropped
// out of "upcoming" at 8 PM on the 11th, while its evening service was still
// hours away.

const DEFAULT_TIME_ZONE = 'America/New_York';

/**
 * Today's date in `timeZone` as YYYY-MM-DD.
 * @param {string} [timeZone]
 * @param {Date} [now] injectable for tests
 */
function todayInZone(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * `dateStr` moved by `days` whole calendar days (negative moves backwards).
 * Date arithmetic is done in UTC on purpose: the input has no time-of-day,
 * so there is no DST boundary to cross.
 */
function shiftDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

module.exports = { DEFAULT_TIME_ZONE, todayInZone, shiftDateString };

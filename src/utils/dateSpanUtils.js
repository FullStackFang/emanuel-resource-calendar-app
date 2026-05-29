/**
 * Date-span helpers shared by the event form and the event transforms.
 *
 * A "span" is the number of whole days between an event's start and end DATE
 * (time of day ignored). Same-day events have a span of 0. Dates are parsed
 * with the local-midnight pattern (`T00:00:00`) so day math is never shifted by
 * UTC or DST — this matches the existing convention in eventTransformers.js.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const LONG_SPAN_THRESHOLD_DAYS = 30;

/**
 * Whole days between two YYYY-MM-DD date strings.
 * Same-day = 0. Empty/invalid/reversed inputs return 0 (safe same-day default).
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {number} non-negative whole-day count
 */
export function computeEventSpanDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const days = Math.round((end - start) / MS_PER_DAY);
  return days > 0 ? days : 0;
}

/**
 * Human-readable label for a multi-day span, or null for a same-day/invalid
 * span. e.g. 'Jun 18 – Jun 28 · 10 days'. Cross-year spans include the year;
 * spans longer than 30 days append a '(long multi-day event)' note so the user
 * understands the Scheduling Assistant still shows only the start day.
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {string|null}
 */
export function formatDateSpanLabel(startDate, endDate) {
  const days = computeEventSpanDays(startDate, endDate);
  if (days === 0) return null;

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const opts = start.getFullYear() === end.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', opts);

  let label = `${startStr} – ${endStr} · ${days} day${days === 1 ? '' : 's'}`;
  if (days > LONG_SPAN_THRESHOLD_DAYS) {
    label += ' (long multi-day event)';
  }
  return label;
}

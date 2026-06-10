// src/utils/calendarMarkers.js
//
// Shared helpers for turning the flat list of active calendar markers
// (holiday / office-closed annotations) into a per-day lookup the calendar
// views and booking forms can index by date. Markers carry date-only
// YYYY-MM-DD strings; the calendar cells carry local JS Date objects.

/**
 * Format a local JS Date as a YYYY-MM-DD key, in LOCAL time.
 *
 * Calendar cells represent local days, and markers are date-only strings, so
 * the key must come from the cell's local Y/M/D — NOT from toISOString()
 * (which would shift across the UTC boundary for evening local times).
 *
 * @param {Date} date
 * @returns {string} YYYY-MM-DD
 */
export function toLocalDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add one day to a YYYY-MM-DD string via UTC arithmetic (no DST drift).
 * @param {string} dateStr
 * @returns {string} next-day YYYY-MM-DD
 */
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a Map keyed by YYYY-MM-DD → array of markers covering that day.
 * A multi-day marker is expanded onto every day in its inclusive range, so the
 * same ribbon repeats across the span. Multiple markers on one day accumulate
 * into the day's array (both ribbons render).
 *
 * @param {Array} markers - active marker documents (each has startDate/endDate)
 * @returns {Map<string, Array>}
 */
export function buildMarkersByDate(markers) {
  const map = new Map();
  if (!Array.isArray(markers)) return map;

  for (const marker of markers) {
    if (!marker || !marker.startDate || !marker.endDate) continue;
    if (marker.endDate < marker.startDate) continue; // defensive: skip invalid ranges

    let cursor = marker.startDate;
    // Guard against a pathological range (~10 years) so a bad record can't spin.
    let guard = 0;
    while (cursor <= marker.endDate && guard < 3660) {
      if (!map.has(cursor)) map.set(cursor, []);
      map.get(cursor).push(marker);
      cursor = nextDay(cursor);
      guard += 1;
    }
  }
  return map;
}

/**
 * Look up the markers covering a given calendar day.
 * @param {Map<string, Array>} markersByDate
 * @param {Date|string} date - a local Date (calendar cell) or YYYY-MM-DD string
 * @returns {Array} markers for that day (empty array if none)
 */
export function getMarkersForDate(markersByDate, date) {
  if (!markersByDate || typeof markersByDate.get !== 'function') return [];
  const key = typeof date === 'string' ? date : toLocalDateKey(date);
  return markersByDate.get(key) || [];
}

/**
 * Resolve the dot color for a marker's ribbon (Option C: dot + adaptive label).
 *
 * The marker name is rendered in a per-variant contrast color supplied by CSS
 * (dark on the white month cell, white on the sapphire Week/Day header), so the
 * label is legible on any surface without an inline color. The only color this
 * helper resolves is the small semantic dot, which carries the holiday vs.
 * closure distinction. Honors an optional per-marker `color` override; otherwise
 * falls back to the type's canonical -500 token.
 *
 * @param {Object} marker - { type, color }
 * @returns {{ dot: string }} CSS value for the dot's inline background color
 */
export function getMarkerRibbonColors(marker) {
  if (marker && marker.color) {
    return { dot: marker.color };
  }
  if (marker && marker.type === 'officeClosed') {
    return { dot: 'var(--color-error-500)' };
  }
  // holiday (default)
  return { dot: 'var(--color-accent-500)' };
}

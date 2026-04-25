'use strict';

const { expandAllOccurrences } = require('./recurrenceExpansion');

/**
 * Determine which override documents (exception/addition) no longer fit the new recurrence.
 *
 * Q1=B reconciliation rules:
 *   - exception: orphaned when its occurrenceDate is NOT in the new expansion
 *     (the "weekday it overrode" no longer occurs in the series).
 *   - addition:  orphaned when its occurrenceDate IS in the new expansion
 *     (the addition is now redundant -- the date is already a regular occurrence).
 *
 * Pure function. No DB access. The caller is responsible for soft-deleting and auditing.
 *
 * @param {Object} newRecurrence - The new pattern { pattern, range, ... }
 * @param {Array<Object>} overrideDocs - exception/addition docs with at least { _id, occurrenceDate, eventType }
 * @returns {Array<Object>} The subset of overrideDocs that are orphaned.
 */
function findOrphanedOverrides(newRecurrence, overrideDocs) {
  if (!newRecurrence || !newRecurrence.pattern || !overrideDocs || overrideDocs.length === 0) {
    return [];
  }

  // Build the set of dates that fall in the new pattern. Use expandAllOccurrences over the
  // recurrence's own range so we don't accidentally truncate.
  // expandAllOccurrences expects (recurrence, startDateTime, endDateTime) as ISO strings.
  const rangeStart = newRecurrence.range && newRecurrence.range.startDate
    ? `${newRecurrence.range.startDate}T00:00:00`
    : null;
  // For noEnd ranges, expandAllOccurrences handles its own bounding via a hard cap;
  // pass the range.endDate when available, otherwise let expansion default.
  const rangeEnd = newRecurrence.range && newRecurrence.range.endDate
    ? `${newRecurrence.range.endDate}T23:59:59`
    : null;

  const occurrences = expandAllOccurrences(newRecurrence, rangeStart, rangeEnd);
  const occurrenceDateSet = new Set(
    (occurrences || []).map(o => {
      if (o.occurrenceDate) return o.occurrenceDate;
      if (o.startDateTime) return o.startDateTime.split('T')[0];
      return null;
    }).filter(Boolean)
  );

  return overrideDocs.filter(doc => {
    const date = doc.occurrenceDate;
    if (!date) return false;
    if (doc.eventType === 'exception') {
      // Orphaned when the date is no longer in the pattern.
      return !occurrenceDateSet.has(date);
    }
    if (doc.eventType === 'addition') {
      // Redundant when the date is now a regular occurrence.
      return occurrenceDateSet.has(date);
    }
    return false;
  });
}

module.exports = { findOrphanedOverrides };

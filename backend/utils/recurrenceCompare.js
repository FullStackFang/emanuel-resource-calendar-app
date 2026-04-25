'use strict';

/**
 * Backend mirror of src/utils/recurrenceCompare.js.
 * See FE file for shape documentation.
 */

const setEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
};

function patternEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.interval || 1) !== (b.interval || 1)) return false;
  if (!setEqual(a.daysOfWeek || [], b.daysOfWeek || [])) return false;
  if ((a.dayOfMonth ?? null) !== (b.dayOfMonth ?? null)) return false;
  if ((a.month ?? null) !== (b.month ?? null)) return false;
  if ((a.index ?? null) !== (b.index ?? null)) return false;
  if ((a.firstDayOfWeek ?? null) !== (b.firstDayOfWeek ?? null)) return false;
  return true;
}

function rangeEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.startDate || null) !== (b.startDate || null)) return false;
  if ((a.endDate || null) !== (b.endDate || null)) return false;
  if ((a.numberOfOccurrences ?? null) !== (b.numberOfOccurrences ?? null)) return false;
  return true;
}

function recurrenceEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!patternEquals(a.pattern || {}, b.pattern || {})) return false;
  if (!rangeEquals(a.range || {}, b.range || {})) return false;
  if (!setEqual(a.exclusions || [], b.exclusions || [])) return false;
  if (!setEqual(a.additions || [], b.additions || [])) return false;
  return true;
}

/**
 * Returns dates present in old.exclusions but not in new.exclusions.
 * Used by the request-edit guard for Q5=A (exclusion-removal block).
 */
function exclusionsRemoved(oldR, newR) {
  const oldEx = (oldR && Array.isArray(oldR.exclusions)) ? oldR.exclusions : [];
  const newEx = (newR && Array.isArray(newR.exclusions)) ? newR.exclusions : [];
  const newSet = new Set(newEx.map(String));
  return oldEx.map(String).filter(d => !newSet.has(d));
}

module.exports = { recurrenceEquals, exclusionsRemoved };

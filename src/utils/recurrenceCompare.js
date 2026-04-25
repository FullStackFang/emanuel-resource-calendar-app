/**
 * Compare two recurrence objects for semantic equality.
 *
 * Used by the edit-request workflow to decide whether the requester actually
 * changed the recurrence (so detection flags it) and whether the approver
 * tweaked it during review (so it lands in approverChanges).
 *
 * Recurrence shape:
 *   { pattern: {type, interval, daysOfWeek?, dayOfMonth?, month?, index?},
 *     range:   {type, startDate, endDate?, numberOfOccurrences?, recurrenceTimeZone?},
 *     exclusions?: string[],   // YYYY-MM-DD
 *     additions?:  string[] }  // YYYY-MM-DD
 *
 * - daysOfWeek and exclusions/additions are compared as sets (order-insensitive).
 * - Missing arrays are treated as empty.
 * - null on both sides is equal; null vs populated is not.
 */
import { formatRecurrenceSummaryCompact } from './recurrenceUtils';

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
  // recurrenceTimeZone is auto-populated server-side on create; do not gate equality on it.
  return true;
}

export function recurrenceEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!patternEquals(a.pattern || {}, b.pattern || {})) return false;
  if (!rangeEquals(a.range || {}, b.range || {})) return false;
  if (!setEqual(a.exclusions || [], b.exclusions || [])) return false;
  if (!setEqual(a.additions || [], b.additions || [])) return false;
  return true;
}

/**
 * Short, user-readable summary of a recurrence object — used for diff rows in
 * the detected-changes UI and for audit/email change descriptions. Returns ''
 * for null input.
 */
export function summarizeRecurrenceShort(r) {
  if (!r || !r.pattern) return '';
  return formatRecurrenceSummaryCompact(r.pattern, r.range || {}, r.additions || [], r.exclusions || []);
}

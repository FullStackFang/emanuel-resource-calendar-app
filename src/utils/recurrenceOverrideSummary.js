/**
 * Recurrence Override Summary
 *
 * Pure helpers that turn a series-master reservation's per-occurrence deviations
 * into a flat, sorted list suitable for inline display on a card. Three data
 * streams describe deviations:
 *
 *   1. `reservation.occurrenceOverrides[]`  — modifications + additions
 *      (synthesized server-side by enrichSeriesMastersWithOverrides; each entry
 *      is shaped { occurrenceDate, ...changedFields }).
 *   2. `reservation.recurrence.additions[]` — YYYY-MM-DD dates that are
 *      ad-hoc additions outside the recurrence pattern.
 *   3. `reservation.recurrence.exclusions[]` — YYYY-MM-DD dates that have
 *      been cancelled. Cancellations leave NO row in occurrenceOverrides
 *      (the exception doc is marked isDeleted and filtered out at enrichment).
 *
 * The helpers here merge those three streams into a single sorted array of
 * variants, each tagged with `kind: 'modified' | 'added' | 'cancelled'` and a
 * short human label. No React.
 */

const SHORT_TOKENS = {
  startTime: 'Time',
  endTime: 'Time',
  reservationStartTime: 'Reservation time',
  reservationEndTime: 'Reservation time',
  eventTitle: 'Title',
  eventDescription: 'Description',
  locations: 'Location',
  locationDisplayNames: 'Location',
  categories: 'Categories',
  attendeeCount: 'Attendees',
  setupTime: 'Setup time',
  teardownTime: 'Teardown time',
  doorOpenTime: 'Door open',
  doorCloseTime: 'Door close',
  isOffsite: 'Offsite',
  offsiteName: 'Offsite location',
  offsiteAddress: 'Offsite location',
  status: 'Status',
};

// Keys ignored when computing what changed (already represented elsewhere or noise).
const IGNORED_KEYS = new Set(['occurrenceDate']);

/**
 * Build a short human label describing what changed in a single override entry.
 *
 * Rules:
 *   - Drop ignored keys.
 *   - Map known keys to friendly tokens; collapse start+end pairs (e.g. startTime+endTime → 'Time').
 *   - Up to two tokens shown; anything beyond becomes '… and N more'.
 *   - Empty override → 'No changes'.
 *
 * @param {Object} override - { occurrenceDate, ...changedFields }
 * @returns {string}
 */
export function describeOverrideChanges(override) {
  if (!override || typeof override !== 'object') return 'No changes';

  const tokens = new Set();
  for (const key of Object.keys(override)) {
    if (IGNORED_KEYS.has(key)) continue;
    const token = SHORT_TOKENS[key];
    if (token) tokens.add(token);
    else tokens.add(key);
  }

  if (tokens.size === 0) return 'No changes';

  const list = Array.from(tokens);
  if (list.length === 1) return `${list[0]} changed`;
  if (list.length === 2) return `${list[0]} + ${list[1]} changed`;
  return `${list[0]} + ${list[1]} and ${list.length - 2} more`;
}

/**
 * Detect whether an override row is logically a cancellation.
 *
 * Most cancellations appear only in recurrence.exclusions and never reach this
 * function — but if a child document was marked status='deleted' or 'cancelled'
 * via the override path, surface that as a cancellation here too so the chip
 * counts stay correct in mixed states.
 *
 * @param {Object} override
 * @returns {boolean}
 */
function isCancelledOverride(override) {
  return override?.status === 'deleted' || override?.status === 'cancelled';
}

/**
 * Build the unified list of occurrence variants for a reservation.
 *
 * @param {Object} reservation - Flat reservation produced by transformEventToFlatStructure
 * @returns {Array<{ occurrenceDate: string, kind: 'modified'|'added'|'cancelled', label: string, override?: Object }>}
 */
export function buildOccurrenceVariants(reservation) {
  if (!reservation) return [];

  const overrides = Array.isArray(reservation.occurrenceOverrides)
    ? reservation.occurrenceOverrides
    : [];
  const additions = Array.isArray(reservation.recurrence?.additions)
    ? reservation.recurrence.additions
    : [];
  const exclusions = Array.isArray(reservation.recurrence?.exclusions)
    ? reservation.recurrence.exclusions
    : [];

  const additionSet = new Set(additions);
  const overrideDateSet = new Set();
  const variants = [];

  for (const override of overrides) {
    if (!override || !override.occurrenceDate) continue;
    overrideDateSet.add(override.occurrenceDate);

    if (isCancelledOverride(override)) {
      variants.push({
        occurrenceDate: override.occurrenceDate,
        kind: 'cancelled',
        label: 'Cancelled',
        override,
      });
      continue;
    }

    const isAddition = additionSet.has(override.occurrenceDate);
    variants.push({
      occurrenceDate: override.occurrenceDate,
      kind: isAddition ? 'added' : 'modified',
      label: isAddition ? 'Added occurrence' : describeOverrideChanges(override),
      override,
    });
  }

  // Cancellations from exclusions (no override row exists for these).
  for (const date of exclusions) {
    if (!date || overrideDateSet.has(date)) continue;
    variants.push({
      occurrenceDate: date,
      kind: 'cancelled',
      label: 'Cancelled',
    });
  }

  // Additions not yet seen as override entries (rare — pattern data ahead of
  // override enrichment; defensive so the chip count never under-reports).
  for (const date of additions) {
    if (!date || overrideDateSet.has(date)) continue;
    variants.push({
      occurrenceDate: date,
      kind: 'added',
      label: 'Added occurrence',
    });
  }

  variants.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
  return variants;
}

/**
 * Tally a variants array by kind.
 *
 * @param {Array} variants - Output of buildOccurrenceVariants
 * @returns {{ total: number, modified: number, added: number, cancelled: number }}
 */
export function getOverrideStats(variants) {
  const stats = { total: 0, modified: 0, added: 0, cancelled: 0 };
  if (!Array.isArray(variants)) return stats;
  for (const v of variants) {
    stats.total += 1;
    if (v.kind === 'modified') stats.modified += 1;
    else if (v.kind === 'added') stats.added += 1;
    else if (v.kind === 'cancelled') stats.cancelled += 1;
  }
  return stats;
}

/**
 * Render the chip text for the override count summary.
 * Prefers the most specific tone:
 *   - All same kind  → '3 modified' / '2 cancelled' / '1 added'
 *   - Mixed          → '3 modified · 1 cancelled · 1 added' (only nonzero kinds)
 *
 * @param {{ total: number, modified: number, added: number, cancelled: number }} stats
 * @returns {string}
 */
export function formatOverrideChipText(stats) {
  if (!stats || stats.total === 0) return '';
  const parts = [];
  if (stats.modified > 0) parts.push(`${stats.modified} modified`);
  if (stats.cancelled > 0) parts.push(`${stats.cancelled} cancelled`);
  if (stats.added > 0) parts.push(`${stats.added} added`);
  return parts.join(' · ');
}

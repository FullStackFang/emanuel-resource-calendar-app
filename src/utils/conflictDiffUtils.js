/**
 * Conflict Diff Utilities
 *
 * Compares the user's stale form data with the server snapshot
 * to produce a list of fields that changed, for display in ConflictDialog.
 */

const FIELD_LABELS = {
  eventTitle: 'Event Title',
  eventDescription: 'Description',
  startDate: 'Start Date',
  startTime: 'Start Time',
  endDate: 'End Date',
  endTime: 'End Time',
  setupTime: 'Setup Time',
  teardownTime: 'Teardown Time',
  doorOpenTime: 'Door Open',
  doorCloseTime: 'Door Close',
  locationDisplayNames: 'Location',
  attendeeCount: 'Attendees',
  categories: 'Categories',
  specialRequirements: 'Special Requirements',
  status: 'Status',
};

/**
 * Format a value for display.
 * @param {*} val - The value to format
 * @returns {string}
 */
function formatValue(val) {
  if (val == null || val === '') return '(empty)';
  if (Array.isArray(val)) return val.length === 0 ? '(empty)' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Normalize a value for comparison purposes.
 * @param {*} val - The value to normalize
 * @returns {string}
 */
function normalizeForComparison(val) {
  if (val == null || val === '') return '';
  if (Array.isArray(val)) return [...val].sort().join(',');
  return String(val).trim();
}

/**
 * Compare stale form data with server snapshot and return changed fields.
 *
 * @param {Object} staleData - The user's form data at the time of the failed save
 * @param {Object} snapshot - The current server values from the 409 response
 * @returns {Array<{field: string, label: string, staleValue: string, currentValue: string}>}
 */
export function computeConflictDiff(staleData, snapshot) {
  if (!staleData || !snapshot) return [];

  const changes = [];

  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const staleVal = staleData[field];
    const currentVal = snapshot[field];

    if (normalizeForComparison(staleVal) !== normalizeForComparison(currentVal)) {
      changes.push({
        field,
        label,
        staleValue: formatValue(staleVal),
        currentValue: formatValue(currentVal),
      });
    }
  }

  return changes;
}

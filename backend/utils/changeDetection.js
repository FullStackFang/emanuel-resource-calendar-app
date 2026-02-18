/**
 * Change Detection Utility
 * Detects and formats changes between original event data and modified fields.
 * Used to track approver modifications during the publish workflow and
 * include change summaries in notification emails.
 */

const { formatDateTime, formatTime } = require('../services/emailTemplates');

/**
 * Fields that should be tracked and reported to requestors when changed
 */
const NOTIFIABLE_FIELDS = [
  'eventTitle',
  'eventDescription',
  'startDateTime',
  'endDateTime',
  'locationDisplayNames',
  'locations',
  'attendeeCount',
  'categories',
  'setupTime',
  'teardownTime',
  'doorOpenTime',
  'doorCloseTime',
  'isOffsite',
  'offsiteName',
  'offsiteAddress',
  'services',
  'assignedTo'
];

/**
 * Map internal field names to human-readable display names
 */
const FIELD_DISPLAY_NAMES = {
  eventTitle: 'Event Title',
  eventDescription: 'Description',
  startDateTime: 'Start Date/Time',
  endDateTime: 'End Date/Time',
  locationDisplayNames: 'Location(s)',
  locations: 'Room(s)',
  attendeeCount: 'Expected Attendees',
  categories: 'Categories',
  setupTime: 'Setup Time',
  teardownTime: 'Teardown Time',
  doorOpenTime: 'Door Open Time',
  doorCloseTime: 'Door Close Time',
  isOffsite: 'Offsite Event',
  offsiteName: 'Offsite Venue',
  offsiteAddress: 'Offsite Address',
  services: 'Services',
  assignedTo: 'Assigned To'
};

/**
 * Get display name for a field
 * @param {string} fieldName - Internal field name
 * @returns {string} Human-readable name
 */
function getFieldDisplayName(fieldName) {
  return FIELD_DISPLAY_NAMES[fieldName] || fieldName;
}

/**
 * Format a field value for display in change summaries
 * @param {string} fieldName - The field name
 * @param {*} value - The value to format
 * @param {Object} [options] - Optional formatting context
 * @param {Object} [options.locationMap] - Map of location ID strings to display names
 * @returns {string} Formatted display value
 */
function formatChangeValue(fieldName, value, options = {}) {
  if (value === null || value === undefined || value === '') {
    return '(not set)';
  }

  // DateTime fields
  if (fieldName === 'startDateTime' || fieldName === 'endDateTime') {
    return formatDateTime(value) || String(value);
  }

  // Time-only fields
  if (['startTime', 'endTime', 'setupTime', 'teardownTime', 'doorOpenTime', 'doorCloseTime'].includes(fieldName)) {
    return value;
  }

  // Boolean fields
  if (fieldName === 'isOffsite') {
    return value ? 'Yes' : 'No';
  }

  // Location IDs → resolve to display names
  if (fieldName === 'locations' && options.locationMap && Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value.map(id => options.locationMap[String(id)] || String(id)).join(', ');
  }

  // Array fields
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value.map(v => {
      if (typeof v === 'object' && v !== null) return v.displayName || v.name || String(v);
      return String(v);
    }).join(', ');
  }

  // Numeric
  if (typeof value === 'number') {
    return String(value);
  }

  return String(value);
}

/**
 * Compare two values for equality, handling arrays and objects
 * @param {*} oldVal - Original value
 * @param {*} newVal - New value
 * @returns {boolean} True if values are different
 */
function valuesAreDifferent(oldVal, newVal) {
  // Normalize undefined/null to comparable forms
  const normalizeEmpty = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    if (Array.isArray(v) && v.length === 0) return null;
    return v;
  };

  const a = normalizeEmpty(oldVal);
  const b = normalizeEmpty(newVal);

  // Both empty
  if (a === null && b === null) return false;
  // One empty, one not
  if (a === null || b === null) return true;

  // Array comparison (order-independent for categories/locations, order-sensitive for display names)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return true;
    const sortedA = [...a].map(String).sort();
    const sortedB = [...b].map(String).sort();
    return JSON.stringify(sortedA) !== JSON.stringify(sortedB);
  }

  // Numeric comparison (handle string "50" vs number 50)
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) !== Number(b);
  }

  // DateTime normalization: "2026-02-18T10:00" and "2026-02-18T10:00:00" should be equal
  const dateTimeNoSec = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const dateTimeWithSec = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  if (typeof a === 'string' && typeof b === 'string') {
    const aIsDateTime = dateTimeNoSec.test(a) || dateTimeWithSec.test(a);
    const bIsDateTime = dateTimeNoSec.test(b) || dateTimeWithSec.test(b);
    if (aIsDateTime && bIsDateTime) {
      const pad = (s) => dateTimeNoSec.test(s) ? s + ':00' : s;
      return pad(a) !== pad(b);
    }
  }

  return String(a) !== String(b);
}

/**
 * Detect changes between original event and modified fields.
 * Compares the original event's calendarData with the incoming request body
 * to identify fields that were modified by an approver during review.
 *
 * @param {Object} originalEvent - The event document from the database before modification
 * @param {Object} modifiedFields - The request body containing new values
 * @param {Object} options - Optional configuration
 * @param {string[]} options.includeFields - Only check these fields (default: NOTIFIABLE_FIELDS)
 * @returns {Array<{field: string, oldValue: *, newValue: *, displayName: string}>}
 */
function detectEventChanges(originalEvent, modifiedFields, options = {}) {
  const fieldsToCheck = options.includeFields || NOTIFIABLE_FIELDS;
  const cd = originalEvent.calendarData || {};
  const changes = [];

  for (const field of fieldsToCheck) {
    const newValue = modifiedFields[field];

    // Skip fields not present in the request body (not modified)
    if (newValue === undefined) continue;

    // Get original value from calendarData first, then top-level
    const oldValue = cd[field] !== undefined ? cd[field] : originalEvent[field];

    if (valuesAreDifferent(oldValue, newValue)) {
      changes.push({
        field,
        oldValue: oldValue !== undefined && oldValue !== null ? oldValue : null,
        newValue,
        displayName: getFieldDisplayName(field)
      });
    }
  }

  return changes;
}

/**
 * Format an array of changes for email display
 * @param {Array} changes - Array from detectEventChanges()
 * @param {Object} [options] - Optional formatting context
 * @param {Object} [options.locationMap] - Map of location ID strings to display names
 * @returns {Array<{displayName: string, oldValue: string, newValue: string}>}
 */
function formatChangesForEmail(changes, options = {}) {
  return changes.map(change => ({
    displayName: change.displayName,
    oldValue: formatChangeValue(change.field, change.oldValue, options),
    newValue: formatChangeValue(change.field, change.newValue, options)
  }));
}

module.exports = {
  detectEventChanges,
  formatChangesForEmail,
  formatChangeValue,
  getFieldDisplayName,
  valuesAreDifferent,
  NOTIFIABLE_FIELDS,
  FIELD_DISPLAY_NAMES
};

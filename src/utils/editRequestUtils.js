/**
 * Edit Request Utilities
 *
 * Functions for computing approver changes when reviewing edit requests.
 * When an approver/admin modifies fields on a pending edit request,
 * we compute a delta of what they changed relative to the original
 * published event data.
 */

/**
 * Fields tracked in edit requests that can be compared.
 * These match the fields in fetchExistingEditRequest (MyReservations.jsx)
 * and the CALENDAR_DATA_FIELDS in the publish-edit endpoint.
 */
const COMPARABLE_FIELDS = [
  'eventTitle',
  'eventDescription',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'attendeeCount',
  'setupTime',
  'teardownTime',
  'setupTimeMinutes',
  'teardownTimeMinutes',
  'doorOpenTime',
  'doorCloseTime',
  'setupNotes',
  'doorNotes',
  'eventNotes',
  'specialRequirements',
  'isOffsite',
  'offsiteName',
  'offsiteAddress',
  'isAllDayEvent',
  'locationDisplayNames',
  'reviewNotes',
  'contactName',
  'contactEmail',
  'isOnBehalfOf',
  'priority',
  'virtualMeetingUrl',
  'virtualPlatform',
];

const ARRAY_FIELDS = ['locations', 'requestedRooms', 'categories'];
const OBJECT_FIELDS = ['services'];

/**
 * Normalize a value for comparison.
 * Treats undefined, null, and empty string as equivalent.
 */
function normalizeValue(val) {
  if (val === undefined || val === null || val === '') return '';
  return val;
}

/**
 * Compare two arrays (order-insensitive for IDs, order-sensitive for others).
 * Stringifies elements for comparison to handle ObjectId vs string mismatches.
 */
function arraysEqual(a, b) {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  if (arrA.length !== arrB.length) return false;
  const sortedA = arrA.map(String).sort();
  const sortedB = arrB.map(String).sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

/**
 * Compare two objects (shallow key comparison with stringified values).
 */
function objectsEqual(a, b) {
  const objA = a || {};
  const objB = b || {};
  const keysA = Object.keys(objA).sort();
  const keysB = Object.keys(objB).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i] && String(objA[key]) === String(objB[key]));
}

/**
 * Compose startDateTime from startDate + startTime.
 */
function composeDateTimeField(data, dateField, timeField) {
  const date = data[dateField];
  const time = data[timeField];
  if (!date) return null;
  if (!time) return `${date}T00:00`;
  return `${date}T${time}`;
}

/**
 * Compute the changes an approver made relative to the original published event.
 *
 * Compares the current form data (which may include both requester's proposed
 * changes and approver's additional modifications) against the original published
 * event data. Returns only the fields that differ, formatted for the backend.
 *
 * @param {Object} currentFormData - Current form state (reviewModal.editableData)
 * @param {Object} originalEventData - The original published event data (before edit request overlay)
 * @returns {Object|null} Object of changed fields, or null if no changes from original
 */
export function computeApproverChanges(currentFormData, originalEventData) {
  if (!currentFormData || !originalEventData) return null;

  const changes = {};

  // Compare simple fields
  for (const field of COMPARABLE_FIELDS) {
    const current = normalizeValue(currentFormData[field]);
    const original = normalizeValue(originalEventData[field]);
    if (String(current) !== String(original)) {
      changes[field] = currentFormData[field];
    }
  }

  // Compare array fields
  for (const field of ARRAY_FIELDS) {
    if (!arraysEqual(currentFormData[field], originalEventData[field])) {
      changes[field] = currentFormData[field] || [];
    }
  }

  // Compare object fields
  for (const field of OBJECT_FIELDS) {
    if (!objectsEqual(currentFormData[field], originalEventData[field])) {
      changes[field] = currentFormData[field] || {};
    }
  }

  // Compose dateTime fields from date+time components
  const currentStart = composeDateTimeField(currentFormData, 'startDate', 'startTime');
  const originalStart = composeDateTimeField(originalEventData, 'startDate', 'startTime');
  if (currentStart && originalStart && currentStart !== originalStart) {
    changes.startDateTime = currentStart;
  }

  const currentEnd = composeDateTimeField(currentFormData, 'endDate', 'endTime');
  const originalEnd = composeDateTimeField(originalEventData, 'endDate', 'endTime');
  if (currentEnd && originalEnd && currentEnd !== originalEnd) {
    changes.endDateTime = currentEnd;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

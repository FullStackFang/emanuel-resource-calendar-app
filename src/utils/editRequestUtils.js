/**
 * Edit Request Utilities
 *
 * Functions for computing approver changes when reviewing edit requests.
 * When an approver/admin modifies fields on a pending edit request,
 * we compute a delta of what they changed relative to the original
 * published event data.
 */
import { recurrenceEquals, summarizeRecurrenceShort } from './recurrenceCompare';

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
  'reservationStartTime',
  'reservationEndTime',
  'setupTimeMinutes',
  'teardownTimeMinutes',
  'reservationStartMinutes',
  'reservationEndMinutes',
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
  'isOnBehalfOf',
  'priority',
  'virtualMeetingUrl',
  'virtualPlatform',
  'organizerName',
  'organizerPhone',
  'organizerEmail',
];

const ARRAY_FIELDS = ['locations', 'requestedRooms', 'categories'];
const OBJECT_FIELDS = ['services'];

/**
 * Resolve start date from an event across all possible field locations.
 * Events arrive in different shapes depending on source (calendar expansion,
 * API response, list view), so we check multiple paths.
 */
export function resolveEventDate(evt) {
  return evt.startDate || evt.calendarData?.startDate
    || evt.startDateTime?.split('T')[0] || evt.start?.dateTime?.split('T')[0];
}

/**
 * Check whether an edit request targets a different occurrence than the current event.
 * Returns true when the edit should be hidden from this view.
 *
 * Only meaningful for Calendar-expanded virtual occurrences, where pendingEditRequest
 * is inherited from the master and needs date-matching. Raw documents (from list views
 * or API) own their edit requests and should never be filtered — callers should skip
 * this check for non-expanded events.
 */
export function isEditForDifferentOccurrence(editReq, evt) {
  return editReq?.editScope === 'thisEvent'
    && !!editReq.occurrenceDate
    && resolveEventDate(evt) !== editReq.occurrenceDate;
}

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
 * Decompose proposedChanges so that combined datetime fields
 * (startDateTime / endDateTime) are split into their date/time parts.
 *
 * The backend stores only startDateTime/endDateTime in proposedChanges,
 * but the form needs startDate, startTime, endDate, endTime separately.
 * Without decomposition, calendarData retains the original date/time
 * parts and the form shows unchanged times.
 *
 * Used by Calendar.jsx and ReservationRequests.jsx when overlaying
 * proposed changes into calendarData for the ReviewModal form.
 *
 * @param {Object} proposedChanges - Delta object from pendingEditRequest.proposedChanges
 * @returns {Object} Copy with startDate/startTime/endDate/endTime added when applicable
 */
export function decomposeProposedChanges(proposedChanges) {
  if (!proposedChanges) return {};
  const decomposed = { ...proposedChanges };
  if (proposedChanges.startDateTime) {
    const [date, timeWithSec] = proposedChanges.startDateTime.split('T');
    if (date) decomposed.startDate = date;
    if (timeWithSec) decomposed.startTime = timeWithSec.substring(0, 5);
  }
  if (proposedChanges.endDateTime) {
    const [date, timeWithSec] = proposedChanges.endDateTime.split('T');
    if (date) decomposed.endDate = date;
    if (timeWithSec) decomposed.endTime = timeWithSec.substring(0, 5);
  }
  return decomposed;
}

/**
 * Build the editableData object for viewing an edit request in the ReviewModal form.
 *
 * Replaces the 3x fetchExistingEditRequest manual field-by-field mappings in
 * MyReservations, Calendar, and ReservationRequests. Those copies used || which
 * silently dropped falsy proposed values (e.g., cleared fields reverted to originals).
 *
 * This function:
 * - Preserves ALL original event metadata (roomReservationData, graphData, _version, status)
 * - Overlays proposedChanges onto calendarData (so transformEventToFlatStructure picks them up)
 * - Spreads decomposed flat fields at top level (so computeDetectedChanges reads them)
 *
 * @param {Object} event - The original event (from reviewModal.currentItem)
 * @param {Object} currentData - Current editableData from reviewModal
 * @returns {Object} Ready to pass to reviewModal.replaceEditableData()
 */
export function buildEditRequestViewData(event, currentData) {
  if (!event?.pendingEditRequest) return currentData;

  const proposed = event.pendingEditRequest.proposedChanges || {};
  const decomposed = decomposeProposedChanges(proposed);

  return {
    // 1. Preserve ALL original event fields (roomReservationData, graphData, _version, status, etc.)
    ...currentData,

    // 2. Overlay flat proposed changes at top level for computeDetectedChanges / computeApproverChanges
    ...decomposed,

    // 3. Attach edit request metadata (does NOT clobber event status because decomposed
    //    only contains calendar data fields — never 'status', '_version', etc.)
    pendingEditRequest: event.pendingEditRequest,

    // 4. Explicit recurrence handling: ensure it lands at top-level even if decomposeProposedChanges
    //    ever drops object-typed values in the future.
    ...(proposed.recurrence !== undefined ? { recurrence: proposed.recurrence } : {}),

    // 5. Merge proposed changes into calendarData for transformEventToFlatStructure on remount
    calendarData: {
      ...(currentData?.calendarData || {}),
      ...decomposed,
      ...(proposed.recurrence !== undefined ? { recurrence: proposed.recurrence } : {}),
    },
  };
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

  // Recurrence: top-level field, deep object compare via recurrenceEquals.
  if (!recurrenceEquals(currentFormData.recurrence || null, originalEventData.recurrence || null)) {
    changes.recurrence = currentFormData.recurrence || null;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Compute detected changes between original and current form data for edit request mode.
 * Used for the zero-change guard in handleSubmitEditRequest and for inline diff display.
 *
 * Extracted from Calendar.jsx and MyReservations.jsx where identical implementations
 * were duplicated. The isEditRequestMode guard is NOT included here — callers should
 * only invoke this function when in edit request mode.
 *
 * @param {Object} originalData - The original event data (before edit request)
 * @param {Object} currentData - Current form state
 * @returns {Array<{field: string, label: string, oldValue: string, newValue: string}>}
 */
export function computeDetectedChanges(originalData, currentData) {
  if (!originalData || !currentData) return [];

  const changes = [];
  const fieldConfig = [
    { key: 'eventTitle', label: 'Event Title' },
    { key: 'eventDescription', label: 'Description' },
    { key: 'startDate', label: 'Start Date' },
    { key: 'startTime', label: 'Start Time' },
    { key: 'endDate', label: 'End Date' },
    { key: 'endTime', label: 'End Time' },
    { key: 'attendeeCount', label: 'Attendee Count' },
    { key: 'specialRequirements', label: 'Special Requirements' },
    { key: 'setupTime', label: 'Setup Time' },
    { key: 'teardownTime', label: 'Teardown Time' },
    { key: 'reservationStartTime', label: 'Reservation Start Time' },
    { key: 'reservationEndTime', label: 'Reservation End Time' },
    { key: 'doorOpenTime', label: 'Door Open Time' },
    { key: 'doorCloseTime', label: 'Door Close Time' },
  ];

  for (const { key, label } of fieldConfig) {
    const oldVal = originalData[key] || '';
    const newVal = currentData[key] || '';
    if (String(oldVal) !== String(newVal)) {
      changes.push({ field: key, label, oldValue: String(oldVal), newValue: String(newVal) });
    }
  }

  // Handle arrays (locations, categories)
  const originalLocations = (originalData.requestedRooms || originalData.locations || []).join(', ');
  const currentLocations = (currentData.requestedRooms || currentData.locations || []).join(', ');
  if (originalLocations !== currentLocations) {
    changes.push({ field: 'locations', label: 'Locations', oldValue: originalLocations || '(none)', newValue: currentLocations || '(none)' });
  }

  const originalCategories = (originalData.categories || originalData.mecCategories || []).join(', ');
  const currentCategories = (currentData.categories || currentData.mecCategories || []).join(', ');
  if (originalCategories !== currentCategories) {
    changes.push({ field: 'categories', label: 'Categories', oldValue: originalCategories || '(none)', newValue: currentCategories || '(none)' });
  }

  // Recurrence diff (single pseudo-field row with summary text on each side).
  const recurrenceBanner = getRecurrenceChangeBanner(originalData.recurrence, currentData.recurrence);
  if (recurrenceBanner) {
    changes.push({
      field: 'recurrence',
      label: 'Recurrence',
      oldValue: recurrenceBanner.oldText,
      newValue: recurrenceBanner.newText,
    });
  }

  return changes;
}

/**
 * Diff two recurrence objects for the Details-tab change banner.
 *
 * Returns null when nothing changed (banner should not render). Returns
 * { oldText, newText } when the recurrence shape differs — both strings
 * are pre-formatted via summarizeRecurrenceShort, with '(none)' as the
 * fallback for null/missing recurrence on either side.
 */
export function getRecurrenceChangeBanner(originalRecurrence, currentRecurrence) {
  const before = originalRecurrence || null;
  const after = currentRecurrence || null;
  if (recurrenceEquals(before, after)) return null;
  return {
    oldText: summarizeRecurrenceShort(before) || '(none)',
    newText: summarizeRecurrenceShort(after) || '(none)',
  };
}

/**
 * Build an explanatory tooltip describing why an event has a pending edit
 * request and the one-active-per-scope rule. Used on the "View Edit Request"
 * affordance so a user who can't request their own edit understands why.
 */
export function buildEditRequestTooltip(editRequest) {
  if (!editRequest) return '';
  const requesterName = editRequest.requestedBy?.name
    || editRequest.requestedBy?.email
    || 'Another user';
  const submittedAt = editRequest.requestedAt
    || editRequest.requestedBy?.requestedAt
    || editRequest.createdAt;
  const submittedLabel = submittedAt
    ? new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const isOccurrence = editRequest.editScope === 'thisEvent' && editRequest.occurrenceDate;
  const scopeLabel = isOccurrence
    ? `the ${editRequest.occurrenceDate} occurrence`
    : 'this event';
  const scopeUnit = isOccurrence ? 'occurrence' : 'event';
  return `${requesterName} has a pending edit request for ${scopeLabel}${submittedLabel ? ` (submitted ${submittedLabel})` : ''}. Only one active edit request per ${scopeUnit} is allowed at a time. Click to review.`;
}

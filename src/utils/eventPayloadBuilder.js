/**
 * Shared payload builders for the audit-update endpoint.
 *
 * Single source of truth for mapping form data → API payloads.
 * Used by Calendar page and NewReservationModal for event creation/update.
 * Adding a new field here automatically propagates to all consumers.
 */

/**
 * Build the graphFields portion of the audit-update payload.
 * These fields are sent to the Microsoft Graph API to create/update the Outlook event.
 *
 * @param {Object} data - Form data (from getProcessedFormData or reservationData)
 * @param {Object} options
 * @param {string} options.timezone - Outlook timezone string (default: 'Eastern Standard Time')
 * @returns {Object} graphFields object
 */
export function buildGraphFields(data, { timezone = 'Eastern Standard Time' } = {}) {
  const effectiveStartTime = data.startTime || data.reservationStartTime;
  const effectiveEndTime = data.endTime || data.reservationEndTime;
  const startDateTime = data.startDate && effectiveStartTime
    ? `${data.startDate}T${effectiveStartTime}:00` : '';
  const endDateTime = data.endDate && effectiveEndTime
    ? `${data.endDate}T${effectiveEndTime}:00` : '';

  const isHold = !data.startTime && !data.endTime &&
    (data.reservationStartTime || data.reservationEndTime);

  return {
    subject: isHold
      ? `[Hold] ${data.eventTitle || 'Untitled Event'}`
      : (data.eventTitle || 'Untitled Event'),
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
    body: { contentType: 'text', content: data.eventDescription || '' },
    categories: data.categories || [],
    isAllDay: data.isAllDayEvent || false,
  };
}

/**
 * Build the internalFields portion of the audit-update payload.
 * These fields are stored in calendarData (not sent to Graph API).
 *
 * @param {Object} data - Form data (from getProcessedFormData or reservationData)
 * @returns {Object} internalFields object
 */
export function buildInternalFields(data) {
  return {
    locations: data.requestedRooms || data.locations || [],
    setupMinutes: data.setupTimeMinutes || data.reservationStartMinutes || 0,
    teardownMinutes: data.teardownTimeMinutes || data.reservationEndMinutes || 0,
    reservationStartMinutes: data.reservationStartMinutes || 0,
    reservationEndMinutes: data.reservationEndMinutes || 0,
    setupTime: data.setupTime || '',
    teardownTime: data.teardownTime || '',
    reservationStartTime: data.reservationStartTime || '',
    reservationEndTime: data.reservationEndTime || '',
    doorOpenTime: data.doorOpenTime || '',
    doorCloseTime: data.doorCloseTime || '',
    setupNotes: data.setupNotes || '',
    doorNotes: data.doorNotes || '',
    eventNotes: data.eventNotes || '',
    registrationNotes: data.registrationNotes || '',
    assignedTo: data.assignedTo || '',
    isOffsite: data.isOffsite || false,
    offsiteName: data.offsiteName || '',
    offsiteAddress: data.offsiteAddress || '',
    offsiteLat: data.offsiteLat || null,
    offsiteLon: data.offsiteLon || null,
    services: data.services || {},
    recurrence: data.recurrence || null,
    occurrenceOverrides: data.occurrenceOverrides || null,
    eventStartTime: data.startTime || '',
    eventEndTime: data.endTime || '',
  };
}

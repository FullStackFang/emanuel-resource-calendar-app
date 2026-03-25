import APP_CONFIG from '../config/config';

/**
 * Shared payload builders for event creation/update endpoints.
 *
 * Single source of truth for mapping form data → API payloads.
 * Used by useEventCreation, useReviewModal, Calendar, MyReservations, and NewReservationModal.
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

/**
 * Convert time difference to minutes (e.g., event start vs setup start).
 * @param {string} eventTime - HH:MM time string
 * @param {string} bufferTime - HH:MM time string
 * @returns {number} absolute difference in minutes
 */
function calculateTimeBufferMinutes(eventTime, bufferTime) {
  if (!eventTime || !bufferTime) return 0;
  const eventDate = new Date(`1970-01-01T${eventTime}:00`);
  const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);
  const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
  return Math.floor(diffMs / (1000 * 60));
}

/**
 * Build payload for the draft save endpoint (POST/PUT /api/room-reservations/draft).
 *
 * Consolidated from 3 prior copies in Calendar.jsx, NewReservationModal.jsx,
 * and useReviewModal.jsx. This is the single source of truth.
 *
 * @param {Object} data - Form data (from getProcessedFormData or merged form state)
 * @returns {Object} draft API payload
 */
export function buildDraftPayload(data) {
  // Event times fall back to reservation times
  const effectiveStartTime = data.startTime || data.reservationStartTime;
  const effectiveEndTime = data.endTime || data.reservationEndTime;
  const startDateTime = data.startDate && effectiveStartTime
    ? `${data.startDate}T${effectiveStartTime}`
    : null;
  const endDateTime = data.endDate && effectiveEndTime
    ? `${data.endDate}T${effectiveEndTime}`
    : null;

  // Calculate reservation buffer minutes from times when available
  let reservationStartMinutes = data.reservationStartMinutes || 0;
  let reservationEndMinutes = data.reservationEndMinutes || 0;

  if (data.reservationStartTime && effectiveStartTime) {
    reservationStartMinutes = calculateTimeBufferMinutes(effectiveStartTime, data.reservationStartTime);
  } else if (data.setupTime && effectiveStartTime) {
    reservationStartMinutes = calculateTimeBufferMinutes(effectiveStartTime, data.setupTime);
  }
  if (data.reservationEndTime && effectiveEndTime) {
    reservationEndMinutes = calculateTimeBufferMinutes(effectiveEndTime, data.reservationEndTime);
  } else if (data.teardownTime && effectiveEndTime) {
    reservationEndMinutes = calculateTimeBufferMinutes(effectiveEndTime, data.teardownTime);
  }

  return {
    eventTitle: data.eventTitle || data.subject || '',
    eventDescription: data.eventDescription || data.description || '',
    startDateTime,
    endDateTime,
    attendeeCount: parseInt(data.attendeeCount) || 0,
    requestedRooms: data.requestedRooms || data.locations || [],
    requiredFeatures: data.requiredFeatures || [],
    specialRequirements: data.specialRequirements || '',
    department: data.department || '',
    phone: data.phone || '',
    setupTimeMinutes: reservationStartMinutes,
    teardownTimeMinutes: reservationEndMinutes,
    reservationStartMinutes,
    reservationEndMinutes,
    reservationStartTime: data.reservationStartTime || null,
    reservationEndTime: data.reservationEndTime || null,
    setupTime: data.setupTime || null,
    teardownTime: data.teardownTime || null,
    doorOpenTime: data.doorOpenTime || null,
    doorCloseTime: data.doorCloseTime || null,
    setupNotes: data.setupNotes || '',
    doorNotes: data.doorNotes || '',
    eventNotes: data.eventNotes || '',
    isOnBehalfOf: data.isOnBehalfOf || false,
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    categories: data.categories || data.mecCategories || [],
    services: data.services || {},
    recurrence: data.recurrence || null,
    virtualMeetingUrl: data.virtualMeetingUrl || null,
    isOffsite: data.isOffsite || false,
    offsiteName: data.offsiteName || '',
    offsiteAddress: data.offsiteAddress || '',
    offsiteLat: data.offsiteLat || null,
    offsiteLon: data.offsiteLon || null,
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    startTime: data.startTime || null,
    endTime: data.endTime || null,
  };
}

/**
 * Build payload for the owner edit endpoint (PUT /api/room-reservations/:id/edit).
 *
 * Consolidated from 4 duplicate copies in Calendar.jsx (handleSavePendingEdit,
 * handleSaveRejectedEdit) and MyReservations.jsx (same two handlers).
 * This is the single source of truth — matches the backend destructured fields
 * at api-server.js PUT /api/room-reservations/:id/edit (lines 15852-15893).
 *
 * @param {Object} data - Form data (from getFormData or editableData)
 * @param {Object} options
 * @param {number|null} options.eventVersion - OCC version for conditionalUpdate
 * @returns {Object} owner edit API payload
 */
export function buildOwnerEditPayload(data, { eventVersion } = {}) {
  const effectiveStartTime = data.startTime || data.reservationStartTime;
  const effectiveEndTime = data.endTime || data.reservationEndTime;

  // Calculate reservation buffer minutes from times (same logic as buildDraftPayload)
  let reservationStartMinutes = data.reservationStartMinutes || 0;
  let reservationEndMinutes = data.reservationEndMinutes || 0;

  if (data.reservationStartTime && effectiveStartTime) {
    reservationStartMinutes = calculateTimeBufferMinutes(effectiveStartTime, data.reservationStartTime);
  } else if (data.setupTime && effectiveStartTime) {
    reservationStartMinutes = calculateTimeBufferMinutes(effectiveStartTime, data.setupTime);
  }
  if (data.reservationEndTime && effectiveEndTime) {
    reservationEndMinutes = calculateTimeBufferMinutes(effectiveEndTime, data.reservationEndTime);
  } else if (data.teardownTime && effectiveEndTime) {
    reservationEndMinutes = calculateTimeBufferMinutes(effectiveEndTime, data.teardownTime);
  }

  return {
    _version: eventVersion ?? null,
    eventTitle: data.eventTitle || '',
    eventDescription: data.eventDescription || '',
    startDateTime: `${data.startDate}T${effectiveStartTime}`,
    endDateTime: `${data.endDate}T${effectiveEndTime}`,
    startDate: data.startDate,
    startTime: data.startTime,
    endDate: data.endDate,
    endTime: data.endTime,
    attendeeCount: parseInt(data.attendeeCount) || 0,
    requestedRooms: data.requestedRooms || data.locations || [],
    requiredFeatures: data.requiredFeatures || [],
    specialRequirements: data.specialRequirements || '',
    department: data.department || '',
    phone: data.phone || '',
    setupTimeMinutes: reservationStartMinutes,
    teardownTimeMinutes: reservationEndMinutes,
    reservationStartMinutes,
    reservationEndMinutes,
    reservationStartTime: data.reservationStartTime || null,
    reservationEndTime: data.reservationEndTime || null,
    setupTime: data.setupTime || null,
    teardownTime: data.teardownTime || null,
    doorOpenTime: data.doorOpenTime || null,
    doorCloseTime: data.doorCloseTime || null,
    setupNotes: data.setupNotes || '',
    doorNotes: data.doorNotes || '',
    eventNotes: data.eventNotes || '',
    isOnBehalfOf: data.isOnBehalfOf || false,
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    categories: data.categories || data.mecCategories || [],
    services: data.services || {},
    recurrence: data.recurrence || null,
    virtualMeetingUrl: data.virtualMeetingUrl || null,
    isOffsite: data.isOffsite || false,
    offsiteName: data.offsiteName || '',
    offsiteAddress: data.offsiteAddress || '',
    offsiteLat: data.offsiteLat || null,
    offsiteLon: data.offsiteLon || null,
  };
}

/**
 * Build payload for the edit request submit endpoint (POST /api/events/:id/request-edit).
 *
 * Consolidated from 2 copies in Calendar.jsx (handleSubmitEditRequest)
 * and MyReservations.jsx (handleSubmitEditRequest).
 * Matches the backend destructured fields at api-server.js POST /api/events/:id/request-edit.
 *
 * @param {Object} data - Form data (from getFormData)
 * @param {Object} options
 * @param {number|null} options.eventVersion - OCC version
 * @returns {Object} edit request API payload
 */
export function buildEditRequestPayload(data, { eventVersion } = {}) {
  // Normalize datetime: append ':00' seconds if missing (backend stores with seconds)
  const normalizeDT = (dt) => dt && dt.length === 16 ? `${dt}:00` : dt;

  return {
    _version: eventVersion ?? null,
    eventTitle: data.eventTitle || '',
    eventDescription: data.eventDescription || '',
    startDateTime: normalizeDT(data.startDateTime) || null,
    endDateTime: normalizeDT(data.endDateTime) || null,
    attendeeCount: parseInt(data.attendeeCount) || 0,
    requestedRooms: data.requestedRooms || data.locations || [],
    specialRequirements: data.specialRequirements || '',
    department: data.department || '',
    phone: data.phone || '',
    setupTimeMinutes: data.setupTimeMinutes || data.reservationStartMinutes || 0,
    teardownTimeMinutes: data.teardownTimeMinutes || data.reservationEndMinutes || 0,
    setupTime: data.setupTime || null,
    teardownTime: data.teardownTime || null,
    reservationStartTime: data.reservationStartTime || null,
    reservationEndTime: data.reservationEndTime || null,
    doorOpenTime: data.doorOpenTime || null,
    doorCloseTime: data.doorCloseTime || null,
    setupNotes: data.setupNotes || '',
    doorNotes: data.doorNotes || '',
    eventNotes: data.eventNotes || '',
    isOnBehalfOf: data.isOnBehalfOf || false,
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    categories: data.categories || data.mecCategories || [],
    services: data.services || {},
    virtualMeetingUrl: data.virtualMeetingUrl || null,
    isOffsite: data.isOffsite || false,
    offsiteName: data.offsiteName || '',
    offsiteAddress: data.offsiteAddress || '',
    offsiteLat: data.offsiteLat || null,
    offsiteLon: data.offsiteLon || null,
  };
}

/**
 * Build payload for the requester submit endpoint (POST /api/events/request).
 *
 * @param {Object} data - Form data
 * @param {Object} options
 * @param {string} options.calendarId - Selected calendar ID
 * @param {string} options.calendarOwner - Calendar owner email
 * @returns {Object} request API payload
 */
export function buildRequesterPayload(data, { calendarId, calendarOwner } = {}) {
  const effectiveStartTime = data.startTime || data.reservationStartTime;
  const effectiveEndTime = data.endTime || data.reservationEndTime;

  return {
    eventTitle: data.eventTitle || data.subject || '',
    eventDescription: data.eventDescription || data.description || '',
    startDateTime: data.startDate && effectiveStartTime
      ? `${data.startDate}T${effectiveStartTime}:00` : '',
    endDateTime: data.endDate && effectiveEndTime
      ? `${data.endDate}T${effectiveEndTime}:00` : '',
    requestedRooms: data.requestedRooms || data.locations || [],
    attendeeCount: parseInt(data.attendeeCount) || 0,
    department: data.department || '',
    phone: data.phone || '',
    specialRequirements: data.specialRequirements || '',
    setupTimeMinutes: data.reservationStartMinutes || data.setupTimeMinutes || 0,
    teardownTimeMinutes: data.reservationEndMinutes || data.teardownTimeMinutes || 0,
    reservationStartMinutes: data.reservationStartMinutes || 0,
    reservationEndMinutes: data.reservationEndMinutes || 0,
    setupTime: data.reservationStartTime || data.setupTime || '',
    teardownTime: data.reservationEndTime || data.teardownTime || '',
    reservationStartTime: data.reservationStartTime || '',
    reservationEndTime: data.reservationEndTime || '',
    doorOpenTime: data.doorOpenTime || '',
    doorCloseTime: data.doorCloseTime || '',
    setupNotes: data.setupNotes || '',
    doorNotes: data.doorNotes || '',
    eventNotes: data.eventNotes || '',
    requesterName: data.requesterName || '',
    requesterEmail: data.requesterEmail || '',
    calendarId: calendarId || data.calendarId || null,
    calendarOwner: calendarOwner || data.calendarOwner || null,
    isOffsite: data.isOffsite || false,
    offsiteName: data.offsiteName || '',
    offsiteAddress: data.offsiteAddress || '',
    offsiteLat: data.offsiteLat || null,
    offsiteLon: data.offsiteLon || null,
    categories: data.categories || [],
    services: data.services || {},
    recurrence: data.recurrence || null,
    occurrenceOverrides: data.occurrenceOverrides || null,
  };
}

/**
 * Delete an event via the unified admin endpoint.
 *
 * Consolidated from 3 copies: useReviewModal.handleDelete (canonical),
 * ReservationRequests card-level, EventManagement card-level.
 * This is a stateless utility — callers manage their own confirmation state and UI updates.
 *
 * @param {string} eventId - MongoDB _id of the event
 * @param {Object} options
 * @param {string} options.apiToken - JWT bearer token
 * @param {number|null} options.version - OCC version (_version field)
 * @param {string} [options.graphToken] - Graph API token (for events with Graph data)
 * @param {string} [options.calendarId] - Calendar ID (for Graph sync)
 * @param {string} [options.editScope] - 'thisEvent' | 'allEvents' (for recurring events)
 * @param {string} [options.occurrenceDate] - ISO date of the occurrence (for thisEvent scope)
 * @param {string} [options.seriesMasterId] - Graph series master ID (for recurring events)
 * @param {string} [options.reason] - Deletion reason (required for owner-pending withdraw)
 * @returns {Promise<{ok: boolean, status: number, data: Object}>}
 */
export async function deleteEvent(eventId, { apiToken, version, graphToken, calendarId, editScope, occurrenceDate, seriesMasterId, reason } = {}) {
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    },
    body: JSON.stringify({
      graphToken,
      editScope,
      occurrenceDate,
      seriesMasterId,
      calendarId,
      _version: version ?? null,
      reason: reason?.trim() || undefined,
    }),
  });

  if (response.status === 409) {
    const data = await response.json();
    return { ok: false, status: 409, data };
  }
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to delete: ${response.status} ${errText}`);
  }
  return { ok: true, status: response.status, data: await response.json() };
}

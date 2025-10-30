/**
 * Event Data Transformers
 *
 * Utilities for transforming between different event data formats.
 * The codebase uses a flat structure for forms/UI components, but the backend
 * stores events in a nested structure (graphData, roomReservationData).
 */

/**
 * Transforms a raw MongoDB event document to the flat structure expected by forms
 *
 * @param {Object} event - Raw event from templeEvents__Events collection OR enriched calendar event
 * @returns {Object} Flattened event object for form consumption
 */
export function transformEventToFlatStructure(event) {
  if (!event) return null;

  // Calendar events have Graph data directly on the object (event.subject, event.start)
  // Reservation events have it nested (event.graphData.subject, event.graphData.start)
  const isCalendarEvent = event.subject && !event.graphData;

  return {
    // === STANDARDIZED ID PROPERTIES ===
    // Main UI identifier - used for component keys and general identification
    id: event.id || event.eventId || event._id,
    // Explicit eventId for API calls - primary business identifier
    eventId: event.eventId || event.id,
    // Microsoft Graph API ID (only exists if published to Outlook)
    graphEventId: event.graphData?.id || (isCalendarEvent ? event.id : null),
    // Boolean flag indicating if event is published to Outlook calendar
    hasGraphId: !!(event.graphData?.id || (isCalendarEvent && event.id && !event.id.startsWith('evt-request-'))),
    // MongoDB document ID for reference
    _id: event._id,

    // Handle both calendar events (direct properties) and reservation events (nested graphData)
    eventTitle: isCalendarEvent ? event.subject : (event.graphData?.subject || 'Untitled Event'),
    eventDescription: isCalendarEvent ? (event.bodyPreview || event.body?.content || '') : (event.graphData?.bodyPreview || ''),
    startDateTime: isCalendarEvent ? event.start?.dateTime : (event.graphData?.start?.dateTime),
    endDateTime: isCalendarEvent ? event.end?.dateTime : (event.graphData?.end?.dateTime),

    // Room reservation data (only present in reservation events)
    requestedRooms: event.roomReservationData?.requestedRooms || [],
    requesterName: event.roomReservationData?.requestedBy?.name || '',
    requesterEmail: event.roomReservationData?.requestedBy?.email || '',
    department: event.roomReservationData?.requestedBy?.department || '',
    phone: event.roomReservationData?.requestedBy?.phone || '',
    attendeeCount: event.roomReservationData?.attendeeCount || 0,
    priority: event.roomReservationData?.priority || 'medium',
    specialRequirements: event.roomReservationData?.specialRequirements || '',
    status: event.status === 'room-reservation-request' ? 'pending' : event.status,
    submittedAt: event.roomReservationData?.submittedAt || event.lastModifiedDateTime,
    changeKey: event.roomReservationData?.changeKey,

    // Timing data - can come from roomReservationData OR direct properties (calendar enrichments)
    setupTime: event.roomReservationData?.timing?.setupTime || '',
    teardownTime: event.roomReservationData?.timing?.teardownTime || '',
    doorOpenTime: event.roomReservationData?.timing?.doorOpenTime || '',
    doorCloseTime: event.roomReservationData?.timing?.doorCloseTime || '',
    setupTimeMinutes: event.roomReservationData?.timing?.setupTimeMinutes || event.setupMinutes || 0,
    teardownTimeMinutes: event.roomReservationData?.timing?.teardownTimeMinutes || event.teardownMinutes || 0,

    // Internal notes - can come from roomReservationData OR direct properties (calendar enrichments)
    setupNotes: event.roomReservationData?.internalNotes?.setupNotes || event.internalNotes?.setupNotes || '',
    doorNotes: event.roomReservationData?.internalNotes?.doorNotes || event.internalNotes?.doorNotes || '',
    eventNotes: event.roomReservationData?.internalNotes?.eventNotes || event.internalNotes?.eventNotes || '',

    // Contact person data
    contactName: event.roomReservationData?.contactPerson?.name || '',
    contactEmail: event.roomReservationData?.contactPerson?.email || '',
    isOnBehalfOf: event.roomReservationData?.contactPerson?.isOnBehalfOf || false,
    reviewNotes: event.roomReservationData?.reviewNotes || '',

    // Calendar-specific enrichments (for non-reservation events)
    mecCategories: event.mecCategories || [],
    assignedTo: event.assignedTo || '',
    location: isCalendarEvent ? event.location?.displayName : (event.graphData?.location?.displayName || ''),

    _isNewUnifiedEvent: true // Flag to identify source
  };
}

/**
 * Transforms an array of raw MongoDB events to flat structures
 *
 * @param {Array} events - Array of raw events from templeEvents__Events collection
 * @returns {Array} Array of flattened event objects
 */
export function transformEventsToFlatStructure(events) {
  if (!Array.isArray(events)) return [];
  return events.map(transformEventToFlatStructure).filter(Boolean);
}

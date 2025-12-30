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

  // Extract datetime strings
  const startDateTime = isCalendarEvent ? event.start?.dateTime : (event.graphData?.start?.dateTime);
  const endDateTime = isCalendarEvent ? event.end?.dateTime : (event.graphData?.end?.dateTime);

  // Parse datetime strings into separate date/time fields for form consumption
  let startDate = '', startTime = '', endDate = '', endTime = '';
  if (startDateTime && endDateTime) {
    try {
      const startDT = new Date(startDateTime);
      const endDT = new Date(endDateTime);

      if (!isNaN(startDT.getTime()) && !isNaN(endDT.getTime())) {
        startDate = startDT.toISOString().split('T')[0];
        startTime = startDT.toTimeString().slice(0, 5);
        endDate = endDT.toISOString().split('T')[0];
        endTime = endDT.toTimeString().slice(0, 5);
      }
    } catch (err) {
      console.error('Error parsing date/time in transformEventToFlatStructure:', err);
    }
  }

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
    startDateTime,
    endDateTime,
    startDate,
    startTime,
    endDate,
    endTime,

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

    // Timing data - can come from roomReservationData, internalData, OR direct properties (calendar enrichments)
    setupTime: event.roomReservationData?.timing?.setupTime || event.internalData?.setupTime || '',
    teardownTime: event.roomReservationData?.timing?.teardownTime || event.internalData?.teardownTime || '',
    doorOpenTime: event.roomReservationData?.timing?.doorOpenTime || event.internalData?.doorOpenTime || '',
    doorCloseTime: event.roomReservationData?.timing?.doorCloseTime || event.internalData?.doorCloseTime || '',
    setupTimeMinutes: event.roomReservationData?.timing?.setupTimeMinutes || event.internalData?.setupMinutes || event.setupMinutes || 0,
    teardownTimeMinutes: event.roomReservationData?.timing?.teardownTimeMinutes || event.internalData?.teardownMinutes || event.teardownMinutes || 0,

    // Internal notes - can come from roomReservationData, internalData, OR direct properties (calendar enrichments)
    setupNotes: event.roomReservationData?.internalNotes?.setupNotes || event.internalData?.setupNotes || event.internalNotes?.setupNotes || '',
    doorNotes: event.roomReservationData?.internalNotes?.doorNotes || event.internalData?.doorNotes || event.internalNotes?.doorNotes || '',
    eventNotes: event.roomReservationData?.internalNotes?.eventNotes || event.internalData?.eventNotes || event.internalNotes?.eventNotes || '',

    // Contact person data
    contactName: event.roomReservationData?.contactPerson?.name || '',
    contactEmail: event.roomReservationData?.contactPerson?.email || '',
    isOnBehalfOf: event.roomReservationData?.contactPerson?.isOnBehalfOf || false,
    reviewNotes: event.roomReservationData?.reviewNotes || '',

    // Calendar-specific enrichments (for non-reservation events)
    mecCategories: event.mecCategories || [],
    assignedTo: event.assignedTo || '',
    location: isCalendarEvent ? event.location?.displayName : (event.graphData?.location?.displayName || ''),

    // Virtual meeting data (for online events)
    virtualMeetingUrl: event.virtualMeetingUrl || event.graphData?.onlineMeetingUrl || null,
    virtualPlatform: event.virtualPlatform || null,
    graphData: event.graphData || null, // Preserve full graphData for fallback access

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

/**
 * Sorts events by their start time (earliest first)
 * Creates a new array to avoid mutating the source
 *
 * @param {Array} events - Array of events with start.dateTime property
 * @returns {Array} New sorted array of events
 */
export function sortEventsByStartTime(events) {
  if (!Array.isArray(events) || events.length === 0) return events;

  return [...events].sort((a, b) => {
    const timeA = new Date(a.start?.dateTime).getTime();
    const timeB = new Date(b.start?.dateTime).getTime();

    // Handle invalid dates by pushing them to the end
    if (isNaN(timeA)) return 1;
    if (isNaN(timeB)) return -1;

    return timeA - timeB;
  });
}

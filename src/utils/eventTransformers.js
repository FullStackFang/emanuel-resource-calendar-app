/**
 * Event Data Transformers
 *
 * Utilities for transforming between different event data formats.
 * The codebase uses a flat structure for forms/UI components, but the backend
 * stores events in a nested structure (graphData, roomReservationData, calendarData).
 *
 * SINGLE SOURCE OF TRUTH: All components that need to transform events to
 * flat structure should use these functions instead of inline transformations.
 *
 * This transformer handles THREE distinct input formats:
 * 1. Direct Graph API events: Fields at event.subject, event.categories, etc.
 * 2. Already-flat events: UI-created with event.eventTitle, event.startDate, etc.
 * 3. MongoDB documents: Fields in event.calendarData (authoritative after migration)
 *
 * For MongoDB documents, calendarData is the authoritative source (backend writes there only).
 * For other formats, top-level fields are read directly since they don't have calendarData.
 */

import { extractTextFromHtml } from './textUtils';

/**
 * Helper: Get field value with format-aware source selection
 *
 * Source priority depends on event format:
 * - MongoDB documents: calendarData is the authoritative source
 * - Direct Graph API events: fields are at top level (event.categories, etc.)
 * - Already-flat events: fields are at top level (event.eventTitle, etc.)
 *
 * @param {Object} event - The event object
 * @param {string} field - The field name to retrieve
 * @param {*} defaultValue - Default value if field not found
 * @returns {*} The field value from appropriate source or default
 */
function getField(event, field, defaultValue = undefined) {
  // First check calendarData (authoritative for MongoDB documents)
  if (event.calendarData?.[field] !== undefined) {
    return event.calendarData[field];
  }
  // For non-MongoDB formats (Graph API direct, already-flat), check top level
  // This handles: direct Graph API events, already-flat UI events, legacy data
  if (event[field] !== undefined) {
    return event[field];
  }
  return defaultValue;
}

/**
 * Helper: Format address from Graph API location data
 * @param {Object} address - Graph API address object
 * @returns {string} Formatted address string
 */
function formatGraphAddress(address) {
  if (!address) return '';
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
    address.countryOrRegion
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Helper: Calculate auto-default for teardownTime (endTime + 1 hour)
 * @param {string} endTime - End time in HH:MM format
 * @returns {string} Teardown time in HH:MM format
 */
function calculateDefaultTeardownTime(endTime) {
  if (!endTime) return '';
  try {
    const [hours, minutes] = endTime.split(':');
    const endTimeDate = new Date();
    endTimeDate.setHours(parseInt(hours), parseInt(minutes));
    endTimeDate.setHours(endTimeDate.getHours() + 1);
    const teardownHours = String(endTimeDate.getHours()).padStart(2, '0');
    const teardownMinutes = String(endTimeDate.getMinutes()).padStart(2, '0');
    return `${teardownHours}:${teardownMinutes}`;
  } catch {
    return '';
  }
}

/**
 * Transforms a raw MongoDB event document to the flat structure expected by forms
 *
 * This is the SINGLE SOURCE OF TRUTH for event transformation. Use this function
 * instead of inline transformation logic in components.
 *
 * Handles three formats:
 * 1. Calendar events (Graph API format): event.subject, event.start.dateTime
 * 2. Reservation events (nested format): event.graphData.subject, event.graphData.start.dateTime
 * 3. Already-flat events (UI-created): event.eventTitle, event.startDate
 *
 * @param {Object} event - Raw event from templeEvents__Events collection OR enriched calendar event
 * @returns {Object} Flattened event object for form consumption
 */
export function transformEventToFlatStructure(event) {
  if (!event) return null;

  // Detect if event is already in flat format (UI-created, e.g., from cell click)
  // These have startDate directly on the object (not in start.dateTime or graphData.start.dateTime)
  const isAlreadyFlat = event.startDate !== undefined && !event.start?.dateTime && !event.graphData?.start?.dateTime;

  // Calendar events have Graph data directly on the object (event.subject, event.start)
  // Reservation events have it nested (event.graphData.subject, event.graphData.start)
  const isCalendarEvent = event.subject && !event.graphData;

  // Extract datetime strings from Graph format
  // Use getField for calendarData support with top-level fallback
  const startDateTime = isCalendarEvent ? event.start?.dateTime : (event.graphData?.start?.dateTime || getField(event, 'startDateTime'));
  const endDateTime = isCalendarEvent ? event.end?.dateTime : (event.graphData?.end?.dateTime || getField(event, 'endDateTime'));

  // Parse datetime strings into separate date/time fields for form consumption
  // If already flat, preserve the existing values
  let startDate = '', startTime = '', endDate = '', endTime = '';

  if (isAlreadyFlat) {
    // Preserve existing flat format values (with calendarData fallback)
    startDate = getField(event, 'startDate', '');
    startTime = getField(event, 'startTime', '');
    endDate = getField(event, 'endDate', '');
    endTime = getField(event, 'endTime', '');
  } else if (startDateTime && endDateTime) {
    try {
      const startDT = new Date(startDateTime);
      const endDT = new Date(endDateTime);

      if (!isNaN(startDT.getTime()) && !isNaN(endDT.getTime())) {
        startDate = `${startDT.getFullYear()}-${String(startDT.getMonth() + 1).padStart(2, '0')}-${String(startDT.getDate()).padStart(2, '0')}`;
        startTime = startDT.toTimeString().slice(0, 5);
        endDate = `${endDT.getFullYear()}-${String(endDT.getMonth() + 1).padStart(2, '0')}-${String(endDT.getDate()).padStart(2, '0')}`;
        endTime = endDT.toTimeString().slice(0, 5);
      }
    } catch (err) {
      console.error('Error parsing date/time in transformEventToFlatStructure:', err);
    }
  }

  // For MongoDB documents, prefer explicit startTime/endTime from calendarData
  // over values parsed from startDateTime. These fields represent user intent:
  // null = "no time specified", '09:00' = "user entered 9am"
  if (event.calendarData) {
    if ('startTime' in event.calendarData) {
      startTime = event.calendarData.startTime || '';
    }
    if ('endTime' in event.calendarData) {
      endTime = event.calendarData.endTime || '';
    }
  }

  // Process eventDescription - strip HTML if present
  // Prioritize calendarData/top-level eventDescription (authoritative) over graphData.bodyPreview (may be stale)
  const rawDescription = isCalendarEvent
    ? (event.bodyPreview || event.body?.content || '')
    : (getField(event, 'eventDescription') || event.graphData?.body?.content || event.graphData?.bodyPreview || '');
  const eventDescription = rawDescription.includes('<') ? extractTextFromHtml(rawDescription) : rawDescription;

  // Detect if this is an offsite event (has Graph location but no internal rooms)
  // Note: "Unspecified" is a placeholder sent to Graph API when locations are cleared,
  // and should not be treated as a valid offsite location
  const graphLocation = isCalendarEvent ? event.location : event.graphData?.location;
  const hasGraphLocation = graphLocation?.displayName &&
                           graphLocation.displayName !== 'Unspecified';
  const internalLocations = getField(event, 'locations', []);
  const hasInternalRooms = (internalLocations && internalLocations.length > 0) ||
                          (event.roomReservationData?.requestedRooms && event.roomReservationData.requestedRooms.length > 0);
  const isOffsiteEvent = hasGraphLocation && !hasInternalRooms;

  // Extract timing data - can come from multiple sources
  // Prioritize calendarData/top-level fields (authoritative) over nested internalData (may be stale)
  const timingSource = event.roomReservationData?.timing || event.internalData || {};
  // calendarData/top-level fields take precedence over nested structures
  const setupTime = getField(event, 'setupTime') || timingSource.setupTime || startTime || '';
  const doorOpenTime = getField(event, 'doorOpenTime') || timingSource.doorOpenTime || startTime || '';
  const rawTeardownTime = getField(event, 'teardownTime') || timingSource.teardownTime || '';
  const rawDoorCloseTime = getField(event, 'doorCloseTime') || timingSource.doorCloseTime || '';

  // Auto-populate doorCloseTime with endTime if not set
  const doorCloseTime = rawDoorCloseTime || endTime || '';

  // Auto-populate teardownTime with endTime + 1 hour if not set
  const teardownTime = rawTeardownTime || calculateDefaultTeardownTime(endTime);

  // Extract categories from multiple possible sources (with calendarData priority)
  const categories = getField(event, 'categories') ||
                    event.graphData?.categories ||
                    getField(event, 'mecCategories') ||
                    event.internalData?.mecCategories ||
                    event.internalData?.categories ||
                    [];

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

    // Handle event title from multiple formats:
    // 1. Already-flat (UI-created): use eventTitle directly (may be empty for new events)
    // 2. Calendar events: use event.subject
    // 3. Reservation events: prefer calendarData.eventTitle, then graphData.subject
    // Only default to 'Untitled Event' for existing events (those with an id), not new events
    eventTitle: isAlreadyFlat
      ? (getField(event, 'eventTitle') ?? '')
      : (isCalendarEvent
        ? (event.subject || '')
        : (getField(event, 'eventTitle') || event.graphData?.subject || (event._id ? 'Untitled Event' : ''))),
    eventDescription,
    startDateTime,
    endDateTime,
    startDate,
    startTime,
    endDate,
    endTime,

    // Room reservation data - can come from roomReservationData, calendarData, or direct properties
    requestedRooms: getField(event, 'locations', []) || event.roomReservationData?.requestedRooms || [],
    requesterName: event.roomReservationData?.requestedBy?.name || getField(event, 'requesterName', ''),
    requesterEmail: event.roomReservationData?.requestedBy?.email || getField(event, 'requesterEmail', ''),
    department: event.roomReservationData?.requestedBy?.department || getField(event, 'department', ''),
    phone: event.roomReservationData?.requestedBy?.phone || getField(event, 'phone', ''),
    attendeeCount: event.roomReservationData?.attendeeCount || getField(event, 'attendeeCount', 0),
    priority: event.roomReservationData?.priority || getField(event, 'priority', 'medium'),
    specialRequirements: event.roomReservationData?.specialRequirements || getField(event, 'specialRequirements', ''),
    status: event.status === 'room-reservation-request' ? 'pending' : event.status,
    submittedAt: event.roomReservationData?.submittedAt || event.lastModifiedDateTime,
    changeKey: event.roomReservationData?.changeKey || event.changeKey,

    // Timing data with auto-calculated defaults
    setupTime,
    teardownTime,
    doorOpenTime,
    doorCloseTime,
    setupTimeMinutes: timingSource.setupTimeMinutes || event.internalData?.setupMinutes || getField(event, 'setupTimeMinutes', 0),
    teardownTimeMinutes: timingSource.teardownTimeMinutes || event.internalData?.teardownMinutes || getField(event, 'teardownTimeMinutes', 0),

    // Internal notes - can come from roomReservationData, internalData, calendarData, OR direct properties
    setupNotes: event.roomReservationData?.internalNotes?.setupNotes || event.internalData?.setupNotes || event.internalNotes?.setupNotes || getField(event, 'setupNotes', ''),
    doorNotes: event.roomReservationData?.internalNotes?.doorNotes || event.internalData?.doorNotes || event.internalNotes?.doorNotes || getField(event, 'doorNotes', ''),
    eventNotes: event.roomReservationData?.internalNotes?.eventNotes || event.internalData?.eventNotes || event.internalNotes?.eventNotes || getField(event, 'eventNotes', ''),

    // Contact person data
    contactName: event.roomReservationData?.contactPerson?.name || getField(event, 'contactName', ''),
    contactEmail: event.roomReservationData?.contactPerson?.email || getField(event, 'contactEmail', ''),
    isOnBehalfOf: event.roomReservationData?.contactPerson?.isOnBehalfOf || getField(event, 'isOnBehalfOf', false),
    reviewNotes: event.roomReservationData?.reviewNotes || getField(event, 'reviewNotes', ''),

    // Categories and services
    categories,
    mecCategories: categories, // Backwards compatibility alias
    services: getField(event, 'services') || event.internalData?.services || {},

    // Concurrent event settings (admin-only)
    isAllowedConcurrent: event.isAllowedConcurrent ?? false,
    allowedConcurrentCategories: event.allowedConcurrentCategories || [],

    // Series/recurrence data
    eventSeriesId: event.eventSeriesId || null,
    seriesIndex: event.seriesIndex || null,
    seriesLength: event.seriesLength || null,
    // Recurring event metadata (authoritative top-level, with graphData fallback)
    eventType: getField(event, 'eventType') || event.graphData?.type || 'singleInstance',
    seriesMasterId: getField(event, 'seriesMasterId') || event.graphData?.seriesMasterId || null,
    recurrence: getField(event, 'recurrence') || event.graphData?.recurrence || null,

    // All-day event flag
    isAllDayEvent: getField(event, 'isAllDayEvent') || event.graphData?.isAllDay || false,

    // Offsite location data
    isOffsite: isOffsiteEvent || getField(event, 'isOffsite', false),
    offsiteName: isOffsiteEvent ? graphLocation?.displayName : getField(event, 'offsiteName', ''),
    offsiteAddress: isOffsiteEvent ? formatGraphAddress(graphLocation?.address) : getField(event, 'offsiteAddress', ''),
    offsiteLat: isOffsiteEvent ? (graphLocation?.coordinates?.latitude || null) : getField(event, 'offsiteLat', null),
    offsiteLon: isOffsiteEvent ? (graphLocation?.coordinates?.longitude || null) : getField(event, 'offsiteLon', null),

    // Virtual meeting data (for online events)
    virtualMeetingUrl: getField(event, 'virtualMeetingUrl') || event.graphData?.onlineMeetingUrl || null,
    virtualPlatform: getField(event, 'virtualPlatform', null),

    // Calendar-specific enrichments
    assignedTo: getField(event, 'assignedTo', ''),
    location: isCalendarEvent ? event.location?.displayName : (event.graphData?.location?.displayName || ''),
    locationDisplayNames: getField(event, 'locationDisplayNames', ''),

    // Preserve full graphData for fallback access
    graphData: event.graphData || null,

    // Optimistic concurrency control
    _version: event._version || null,

    // Flags
    _isPreProcessed: true // Flag to tell FormBase that data is pre-processed
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

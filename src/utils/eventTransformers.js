/**
 * Event Data Transformers
 *
 * Utilities for transforming between different event data formats.
 * The codebase uses a flat structure for forms/UI components, but the backend
 * stores events in a nested structure (graphData, roomReservationData).
 *
 * SINGLE SOURCE OF TRUTH: All components that need to transform events to
 * flat structure should use these functions instead of inline transformations.
 */

import { extractTextFromHtml } from './textUtils';

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
  const startDateTime = isCalendarEvent ? event.start?.dateTime : (event.graphData?.start?.dateTime || event.startDateTime);
  const endDateTime = isCalendarEvent ? event.end?.dateTime : (event.graphData?.end?.dateTime || event.endDateTime);

  // Parse datetime strings into separate date/time fields for form consumption
  // If already flat, preserve the existing values
  let startDate = '', startTime = '', endDate = '', endTime = '';

  if (isAlreadyFlat) {
    // Preserve existing flat format values
    startDate = event.startDate || '';
    startTime = event.startTime || '';
    endDate = event.endDate || '';
    endTime = event.endTime || '';
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

  // Process eventDescription - strip HTML if present
  const rawDescription = isCalendarEvent
    ? (event.bodyPreview || event.body?.content || '')
    : (event.graphData?.bodyPreview || event.eventDescription || '');
  const eventDescription = rawDescription.includes('<') ? extractTextFromHtml(rawDescription) : rawDescription;

  // Detect if this is an offsite event (has Graph location but no internal rooms)
  const graphLocation = isCalendarEvent ? event.location : event.graphData?.location;
  const hasGraphLocation = graphLocation?.displayName;
  const hasInternalRooms = (event.locations && event.locations.length > 0) ||
                          (event.roomReservationData?.requestedRooms && event.roomReservationData.requestedRooms.length > 0);
  const isOffsiteEvent = hasGraphLocation && !hasInternalRooms;

  // Extract timing data - can come from multiple sources
  // Prioritize top-level fields (authoritative) over nested internalData (may be stale)
  const timingSource = event.roomReservationData?.timing || event.internalData || {};
  // Top-level fields take precedence over nested structures
  const setupTime = event.setupTime || timingSource.setupTime || startTime || '';
  const doorOpenTime = event.doorOpenTime || timingSource.doorOpenTime || startTime || '';
  const rawTeardownTime = event.teardownTime || timingSource.teardownTime || '';
  const rawDoorCloseTime = event.doorCloseTime || timingSource.doorCloseTime || '';

  // Auto-populate doorCloseTime with endTime if not set
  const doorCloseTime = rawDoorCloseTime || endTime || '';

  // Auto-populate teardownTime with endTime + 1 hour if not set
  const teardownTime = rawTeardownTime || calculateDefaultTeardownTime(endTime);

  // Extract categories from multiple possible sources
  const categories = event.categories ||
                    event.graphData?.categories ||
                    event.mecCategories ||
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
    // 1. Already-flat (UI-created): use event.eventTitle directly (may be empty for new events)
    // 2. Calendar events: use event.subject
    // 3. Reservation events: use event.graphData?.subject
    // Only default to 'Untitled Event' for existing events (those with an id), not new events
    eventTitle: isAlreadyFlat
      ? (event.eventTitle ?? '')
      : (isCalendarEvent
        ? (event.subject || '')
        : (event.graphData?.subject || event.eventTitle || (event._id ? 'Untitled Event' : ''))),
    eventDescription,
    startDateTime,
    endDateTime,
    startDate,
    startTime,
    endDate,
    endTime,

    // Room reservation data - can come from roomReservationData or direct properties
    requestedRooms: event.locations || event.roomReservationData?.requestedRooms || [],
    requesterName: event.roomReservationData?.requestedBy?.name || event.requesterName || '',
    requesterEmail: event.roomReservationData?.requestedBy?.email || event.requesterEmail || '',
    department: event.roomReservationData?.requestedBy?.department || event.department || '',
    phone: event.roomReservationData?.requestedBy?.phone || event.phone || '',
    attendeeCount: event.roomReservationData?.attendeeCount || event.attendeeCount || 0,
    priority: event.roomReservationData?.priority || event.priority || 'medium',
    specialRequirements: event.roomReservationData?.specialRequirements || event.specialRequirements || '',
    status: event.status === 'room-reservation-request' ? 'pending' : event.status,
    submittedAt: event.roomReservationData?.submittedAt || event.lastModifiedDateTime,
    changeKey: event.roomReservationData?.changeKey || event.changeKey,

    // Timing data with auto-calculated defaults
    setupTime,
    teardownTime,
    doorOpenTime,
    doorCloseTime,
    setupTimeMinutes: timingSource.setupTimeMinutes || event.internalData?.setupMinutes || event.setupMinutes || 0,
    teardownTimeMinutes: timingSource.teardownTimeMinutes || event.internalData?.teardownMinutes || event.teardownMinutes || 0,

    // Internal notes - can come from roomReservationData, internalData, OR direct properties
    setupNotes: event.roomReservationData?.internalNotes?.setupNotes || event.internalData?.setupNotes || event.internalNotes?.setupNotes || event.setupNotes || '',
    doorNotes: event.roomReservationData?.internalNotes?.doorNotes || event.internalData?.doorNotes || event.internalNotes?.doorNotes || event.doorNotes || '',
    eventNotes: event.roomReservationData?.internalNotes?.eventNotes || event.internalData?.eventNotes || event.internalNotes?.eventNotes || event.eventNotes || '',

    // Contact person data
    contactName: event.roomReservationData?.contactPerson?.name || event.contactName || '',
    contactEmail: event.roomReservationData?.contactPerson?.email || event.contactEmail || '',
    isOnBehalfOf: event.roomReservationData?.contactPerson?.isOnBehalfOf || event.isOnBehalfOf || false,
    reviewNotes: event.roomReservationData?.reviewNotes || event.reviewNotes || '',

    // Categories and services
    categories,
    mecCategories: categories, // Backwards compatibility alias
    services: event.services || event.internalData?.services || {},

    // Concurrent event settings (admin-only)
    isAllowedConcurrent: event.isAllowedConcurrent ?? false,
    allowedConcurrentCategories: event.allowedConcurrentCategories || [],

    // Series/recurrence data
    eventSeriesId: event.eventSeriesId || null,
    seriesIndex: event.seriesIndex || null,
    seriesLength: event.seriesLength || null,
    recurrence: event.recurrence || event.graphData?.recurrence || null,

    // All-day event flag
    isAllDayEvent: event.isAllDayEvent || event.graphData?.isAllDay || false,

    // Offsite location data
    isOffsite: isOffsiteEvent || event.isOffsite || false,
    offsiteName: isOffsiteEvent ? graphLocation?.displayName : (event.offsiteName || ''),
    offsiteAddress: isOffsiteEvent ? formatGraphAddress(graphLocation?.address) : (event.offsiteAddress || ''),
    offsiteLat: isOffsiteEvent ? (graphLocation?.coordinates?.latitude || null) : (event.offsiteLat || null),
    offsiteLon: isOffsiteEvent ? (graphLocation?.coordinates?.longitude || null) : (event.offsiteLon || null),

    // Virtual meeting data (for online events)
    virtualMeetingUrl: event.virtualMeetingUrl || event.graphData?.onlineMeetingUrl || null,
    virtualPlatform: event.virtualPlatform || null,

    // Calendar-specific enrichments
    assignedTo: event.assignedTo || '',
    location: isCalendarEvent ? event.location?.displayName : (event.graphData?.location?.displayName || ''),

    // Preserve full graphData for fallback access
    graphData: event.graphData || null,

    // Flags
    _isNewUnifiedEvent: true, // Flag to identify source
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

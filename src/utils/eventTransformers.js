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
export function getEventField(event, field, defaultValue = undefined) {
  // For ANY virtual recurring occurrence (whether overridden or not), top-level
  // fields are authoritative — Calendar.jsx expansion sets them to the clicked
  // day's values (startDate = occurrenceDate, startTime/endTime/etc. from the
  // occurrence, with any per-occurrence override merged on top). The inherited
  // calendarData on virtual occurrences still carries MASTER values (via `...event`
  // spread during expansion), so falling through to calendarData here would leak
  // the master's first-occurrence date into the form. Top-level therefore wins
  // for every virtual occurrence, regardless of hasOccurrenceOverride.
  if (event.isRecurringOccurrence) {
    if (event[field] !== undefined) return event[field];
  }
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
 * Get the categories array for an event, respecting recurring occurrence overrides.
 * Falls through: occurrence override → calendarData → top-level → graphData → singular → default.
 *
 * @param {Object} event - The event object
 * @returns {string[]} Categories array (never empty — defaults to ['Uncategorized'])
 */
export function getEventCategories(event) {
  if (event.isRecurringOccurrence && event.hasOccurrenceOverride && event.categories !== undefined) {
    return event.categories;
  }
  return event.calendarData?.categories
    || event.categories
    || event.graphData?.categories
    || (event.category ? [event.category] : ['Uncategorized']);
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
  // Use getEventField for calendarData support with top-level fallback
  // Prefer calendarData (authoritative after admin save) over graphData (may be stale if Graph sync lagged)
  const startDateTime = isCalendarEvent ? event.start?.dateTime : (getEventField(event, 'startDateTime') || event.graphData?.start?.dateTime);
  const endDateTime = isCalendarEvent ? event.end?.dateTime : (getEventField(event, 'endDateTime') || event.graphData?.end?.dateTime);

  // Parse datetime strings into separate date/time fields for form consumption
  // If already flat, preserve the existing values
  let startDate = '', startTime = '', endDate = '', endTime = '';

  if (isAlreadyFlat) {
    // Preserve existing flat format values (with calendarData fallback)
    startDate = getEventField(event, 'startDate', '');
    startTime = getEventField(event, 'startTime', '');
    endDate = getEventField(event, 'endDate', '');
    endTime = getEventField(event, 'endTime', '');
  } else if (startDateTime && endDateTime) {
    // Extract date/time directly from the string (timezone-safe).
    // Stored datetimes are local-time strings (e.g., "2026-03-15T14:30:00")
    // — using new Date() would interpret them in the browser's timezone, which
    // gives wrong results when the browser is outside America/New_York.
    const startMatch = String(startDateTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const endMatch = String(endDateTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (startMatch) {
      startDate = startMatch[1];
      startTime = startMatch[2];
    }
    if (endMatch) {
      endDate = endMatch[1];
      endTime = endMatch[2];
    }
  }

  // For MongoDB documents, prefer explicit startTime/endTime from calendarData
  // over values parsed from startDateTime.
  // - Truthy string (e.g. "14:30") → use it (user entered a time)
  // - Falsy (null, '', or undefined) → clear to '' (user did NOT enter a time;
  //   don't surface the backend's reservation-time/query fallback as event time).
  //   startDateTime is computed from effectiveStartTime (which falls back to
  //   reservationStartTime), so the parsed value would leak reservation times
  //   into the event time fields.
  //
  // SKIP for virtual recurring occurrences: Calendar.jsx expansion sets top-level
  // startTime/endTime (and startDateTime) to the occurrence's own values. The
  // inherited calendarData on those occurrences still carries the MASTER'S times,
  // so reading from calendarData here would leak master times into the form.
  //
  // INCLUDE exception/addition docs: they have their own calendarData (built by
  // mergeDefaultsWithOverrides), not the master's inherited calendarData.
  const isExceptionDoc = event.eventType === 'exception' || event.eventType === 'addition';
  if (event.calendarData && (!event.isRecurringOccurrence || isExceptionDoc)) {
    startTime = event.calendarData.startTime || '';
    endTime = event.calendarData.endTime || '';
  }

  // Process eventDescription - strip HTML if present
  // Prioritize calendarData/top-level eventDescription (authoritative) over graphData.bodyPreview (may be stale)
  const rawDescription = isCalendarEvent
    ? (event.bodyPreview || event.body?.content || '')
    : (getEventField(event, 'eventDescription') || event.graphData?.body?.content || event.graphData?.bodyPreview || '');
  const eventDescription = rawDescription.includes('<') ? extractTextFromHtml(rawDescription) : rawDescription;

  // Detect if this is an offsite event (has Graph location but no internal rooms)
  // Note: "Unspecified" is a placeholder sent to Graph API when locations are cleared,
  // and should not be treated as a valid offsite location
  const graphLocation = isCalendarEvent ? event.location : event.graphData?.location;
  const hasGraphLocation = graphLocation?.displayName &&
                           graphLocation.displayName !== 'Unspecified';
  const internalLocations = getEventField(event, 'locations', []);
  const hasInternalRooms = (internalLocations && internalLocations.length > 0) ||
                          (event.roomReservationData?.requestedRooms && event.roomReservationData.requestedRooms.length > 0) ||
                          (event.requestedRooms && event.requestedRooms.length > 0);
  const isOffsiteEvent = hasGraphLocation && !hasInternalRooms;

  // Extract timing data from calendarData (authoritative) or top-level fields
  // Do NOT fall back to startTime — empty values indicate the user hasn't set these yet,
  // which is important for form validation (isFormValid must reflect actual data, not auto-defaults)
  const setupTime = getEventField(event, 'setupTime') || '';
  const doorOpenTime = getEventField(event, 'doorOpenTime') || '';
  const rawTeardownTime = getEventField(event, 'teardownTime') || '';
  const rawDoorCloseTime = getEventField(event, 'doorCloseTime') || '';
  const reservationStartTime = getEventField(event, 'reservationStartTime') || '';
  const reservationEndTime = getEventField(event, 'reservationEndTime') || '';

  // Use raw values without auto-population - null means user hasn't set it
  const doorCloseTime = rawDoorCloseTime;
  const teardownTime = rawTeardownTime;

  // Extract categories from calendarData (authoritative) or top-level fields
  const categories = getEventField(event, 'categories') ||
                    event.graphData?.categories ||
                    getEventField(event, 'mecCategories') ||
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
    // 1. Recurring occurrences: top-level eventTitle is the override, takes priority
    // 2. Already-flat (UI-created): use eventTitle directly (may be empty for new events)
    // 3. Calendar events: use event.subject
    // 4. Reservation events: prefer calendarData.eventTitle, then graphData.subject
    // Only default to 'Untitled Event' for existing events (those with an id), not new events
    eventTitle: (event.isRecurringOccurrence && event.eventTitle !== undefined)
      ? event.eventTitle
      : (isAlreadyFlat
        ? (getEventField(event, 'eventTitle') ?? '')
        : (isCalendarEvent
          ? (event.subject || '')
          : (getEventField(event, 'eventTitle') || event.graphData?.subject || (event._id ? 'Untitled Event' : '')))),
    eventDescription,
    startDateTime,
    endDateTime,
    startDate,
    startTime,
    endDate,
    endTime,

    // Room reservation data - can come from roomReservationData, calendarData, or direct properties
    // For recurring occurrences (synthesized with ...override spread), top-level fields
    // represent the override and must take priority over calendarData (which has master values)
    requestedRooms: (() => {
      if (event.isRecurringOccurrence && event.locations !== undefined) {
        return event.locations;
      }
      const locs = getEventField(event, 'locations', []);
      return locs.length > 0 ? locs : (event.roomReservationData?.requestedRooms || event.requestedRooms || []);
    })(),
    requesterName: event.roomReservationData?.requestedBy?.name || getEventField(event, 'requesterName', ''),
    requesterEmail: event.roomReservationData?.requestedBy?.email || getEventField(event, 'requesterEmail', ''),
    attendeeCount: getEventField(event, 'attendeeCount', null) ?? '',
    specialRequirements: getEventField(event, 'specialRequirements', ''),
    status: event.status === 'room-reservation-request' ? 'pending' : event.status,
    submittedAt: event.roomReservationData?.submittedAt || event.lastModifiedDateTime,
    actionDate: event.roomReservationData?.reviewedAt || null,
    lastModifiedDateTime: event.lastModifiedDateTime || event.roomReservationData?.submittedAt || event.createdAt || null,
    changeKey: event.roomReservationData?.changeKey || event.changeKey,

    // Timing data with auto-calculated defaults
    setupTime,
    teardownTime,
    doorOpenTime,
    doorCloseTime,
    setupTimeMinutes: getEventField(event, 'setupTimeMinutes', 0),
    teardownTimeMinutes: getEventField(event, 'teardownTimeMinutes', 0),
    reservationStartTime,
    reservationEndTime,
    reservationStartMinutes: getEventField(event, 'reservationStartMinutes', 0),
    reservationEndMinutes: getEventField(event, 'reservationEndMinutes', 0),
    isHold: !startTime && !endTime && !!(reservationStartTime || reservationEndTime),

    // Internal notes from calendarData (authoritative) or roomReservationData
    setupNotes: getEventField(event, 'setupNotes') || event.roomReservationData?.internalNotes?.setupNotes || '',
    doorNotes: getEventField(event, 'doorNotes') || event.roomReservationData?.internalNotes?.doorNotes || '',
    eventNotes: getEventField(event, 'eventNotes') || event.roomReservationData?.internalNotes?.eventNotes || '',

    // Contact person data
    contactName: getEventField(event, 'contactName', '') || event.roomReservationData?.contactPerson?.name || '',
    contactEmail: getEventField(event, 'contactEmail', '') || event.roomReservationData?.contactPerson?.email || '',
    isOnBehalfOf: getEventField(event, 'isOnBehalfOf', undefined) ?? event.roomReservationData?.contactPerson?.isOnBehalfOf ?? false,
    reviewNotes: event.roomReservationData?.reviewNotes || getEventField(event, 'reviewNotes', ''),

    // Event organizer (may differ from requester — for security/operations contact)
    organizerName: getEventField(event, 'organizerName', '') || event.roomReservationData?.organizer?.name || '',
    organizerPhone: getEventField(event, 'organizerPhone', '') || event.roomReservationData?.organizer?.phone || '',
    organizerEmail: getEventField(event, 'organizerEmail', '') || event.roomReservationData?.organizer?.email || '',

    // Categories and services
    categories,
    mecCategories: categories, // Backwards compatibility alias
    services: getEventField(event, 'services') || {},

    // Concurrent event settings (admin-only)
    isAllowedConcurrent: event.isAllowedConcurrent ?? false,
    allowedConcurrentCategories: event.allowedConcurrentCategories || [],

    // Series/recurrence data
    eventSeriesId: event.eventSeriesId || null,
    seriesIndex: event.seriesIndex || null,
    seriesLength: event.seriesLength || null,
    // Recurring event metadata (authoritative top-level, with graphData fallback)
    eventType: getEventField(event, 'eventType') || event.graphData?.type || null,
    seriesMasterId: getEventField(event, 'seriesMasterId') || event.graphData?.seriesMasterId || null,
    seriesMasterEventId: event.seriesMasterEventId || null,
    recurrence: getEventField(event, 'recurrence') || event.graphData?.recurrence || null,

    // All-day event flag
    isAllDayEvent: getEventField(event, 'isAllDayEvent') || event.graphData?.isAllDay || false,

    // Offsite location data
    isOffsite: isOffsiteEvent || getEventField(event, 'isOffsite', false),
    offsiteName: isOffsiteEvent ? graphLocation?.displayName : getEventField(event, 'offsiteName', ''),
    offsiteAddress: isOffsiteEvent ? formatGraphAddress(graphLocation?.address) : getEventField(event, 'offsiteAddress', ''),
    offsiteLat: isOffsiteEvent ? (graphLocation?.coordinates?.latitude || null) : getEventField(event, 'offsiteLat', null),
    offsiteLon: isOffsiteEvent ? (graphLocation?.coordinates?.longitude || null) : getEventField(event, 'offsiteLon', null),

    // Virtual meeting data (for online events)
    virtualMeetingUrl: getEventField(event, 'virtualMeetingUrl') || event.graphData?.onlineMeetingUrl || null,
    virtualPlatform: getEventField(event, 'virtualPlatform', null),

    // Clergy assignments
    assignedRabbi: getEventField(event, 'assignedRabbi', null),
    assignedCantor: getEventField(event, 'assignedCantor', null),

    // Calendar-specific enrichments
    assignedTo: getEventField(event, 'assignedTo', ''),
    location: isCalendarEvent ? event.location?.displayName : (event.graphData?.location?.displayName || ''),
    locationDisplayNames: (event.isRecurringOccurrence && event.locationDisplayNames !== undefined)
      ? event.locationDisplayNames
      : getEventField(event, 'locationDisplayNames', ''),

    // Preserve full graphData for fallback access
    graphData: event.graphData || null,

    // Preserve calendarData for edit request comparison (original values)
    calendarData: event.calendarData || null,

    // Optimistic concurrency control
    _version: event._version || null,

    // Edit request data (for approval queue filtering)
    pendingEditRequest: event.pendingEditRequest || null,

    // Cancellation request data (for approval queue filtering)
    pendingCancellationRequest: event.pendingCancellationRequest || null,

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
 * Transforms a flat event into prefill overrides for duplicating via useEventCreation.open().
 *
 * Copies all event details EXCEPT:
 * - Dates (user must pick new dates)
 * - Requester info (current user is auto-filled by buildBlankReservation)
 * - Status, version, IDs (each duplicate is a fresh reservation)
 *
 * @param {Object} event - Flat event object (from transformEventToFlatStructure or reviewModal.editableData)
 * @returns {Object} Overrides object for useEventCreation.open()
 */
export function transformEventToDuplicatePrefill(event) {
  if (!event) return {};

  // Helper: read from top-level (flat events) or calendarData (raw MongoDB docs)
  const get = (field, fallback) => {
    const val = event[field] !== undefined ? event[field] : event.calendarData?.[field];
    return val !== undefined && val !== null ? val : fallback;
  };

  // Calculate duration for multi-day events
  const startDate = get('startDate', '');
  const endDate = get('endDate', '');
  let durationDays = 0;
  if (startDate && endDate) {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    durationDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  }

  // Rooms: flat events use requestedRooms/locations; raw MongoDB uses calendarData.locations
  const rooms = event.requestedRooms || event.locations || event.calendarData?.locations || [];

  return {
    // Carry over event details
    eventTitle: get('eventTitle', '') || '',
    eventDescription: get('eventDescription', ''),
    startTime: get('startTime', ''),
    endTime: get('endTime', ''),
    reservationStartTime: get('reservationStartTime', ''),
    reservationEndTime: get('reservationEndTime', ''),
    requestedRooms: rooms,
    attendeeCount: get('attendeeCount', ''),
    categories: [...(get('categories', []))],
    services: (() => { const s = get('services', {}); return s ? { ...s } : {}; })(),
    specialRequirements: get('specialRequirements', ''),
    setupTime: get('setupTime', ''),
    teardownTime: get('teardownTime', ''),
    setupTimeMinutes: get('setupTimeMinutes', 0),
    teardownTimeMinutes: get('teardownTimeMinutes', 0),
    doorOpenTime: get('doorOpenTime', ''),
    doorCloseTime: get('doorCloseTime', ''),
    isAllDayEvent: get('isAllDayEvent', false),
    isOffsite: get('isOffsite', false),
    offsiteName: get('offsiteName', ''),
    offsiteAddress: get('offsiteAddress', ''),
    isOnBehalfOf: get('isOnBehalfOf', false),
    organizerName: get('organizerName', ''),
    organizerPhone: get('organizerPhone', ''),
    organizerEmail: get('organizerEmail', ''),
    // Clergy assignments
    assignedRabbi: get('assignedRabbi', null),
    assignedCantor: get('assignedCantor', null),
    // Dates cleared — user must pick new dates via multi-date picker
    startDate: '',
    endDate: '',
    // Internal duplicate flags (stripped by useEventCreation.open before building reservation)
    _isDuplicate: true,
    _sourceEventDate: startDate,
    _durationDays: durationDays,
  };
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

/**
 * Derive the display values for the read-only "Reservation Start Date" and
 * "Reservation End Date" inputs on a series master in the review modal.
 *
 * On a series master (eventType === 'seriesMaster'), these read-only inputs
 * should display the **series range** (recurrence.range.startDate through
 * recurrence.range.endDate), not the first-occurrence date stored in
 * formData.startDate / formData.endDate. The underlying form state and
 * database fields are unchanged — this is a display-layer transform only, so
 * save paths and Graph sync continue to operate on first-occurrence dates.
 *
 * Fallback behavior: if `recurrence.range.startDate` / `endDate` are missing
 * (legacy data, singleInstance events, occurrences), the corresponding
 * formData value is used unchanged.
 *
 * @param {Object|null} reservation - Event being reviewed (only eventType is read)
 * @param {Object|null} recurrencePattern - Recurrence object: { pattern, range, ... }
 * @param {Object|null} formData - Form's flat state containing startDate / endDate
 * @returns {{displayStartDate: (string|undefined), displayEndDate: (string|undefined)}}
 */
/**
 * Extract the canonical occurrence date key (YYYY-MM-DD) from an event / form item.
 *
 * Used when constructing `editScope: 'thisEvent'` save / delete / edit payloads.
 * The backend's occurrence-write endpoints accept either YYYY-MM-DD or
 * YYYY-MM-DDTHH:MM:SS, but this helper always normalizes to YYYY-MM-DD so all
 * payload sites produce the same shape and downstream string matches (e.g. to
 * build exception-document eventIds) don't need to re-normalize.
 *
 * Preference order (first defined wins):
 *   1. `occurrenceDate` — canonical on exception / addition documents and on
 *      payloads already built for thisEvent scope
 *   2. `startDate` — flat top-level (virtual occurrences from Calendar.jsx)
 *   3. `start.dateTime` — Graph-shape (legacy or direct-from-Graph events)
 *
 * @param {Object|null|undefined} item - An event, reservation, or currentItem
 * @returns {string|null} YYYY-MM-DD or null if no date field is present
 */
export function getOccurrenceDateKey(item) {
  if (!item) return null;
  const pick = item.occurrenceDate || item.startDate || item.start?.dateTime;
  if (!pick) return null;
  // Normalize any full datetime (e.g., "2026-04-22T09:00:00") to just the date part.
  return String(pick).split('T')[0];
}

export function getSeriesMasterDisplayDates(reservation, recurrencePattern, formData) {
  const isSeriesMaster = reservation?.eventType === 'seriesMaster';
  const rangeStart = recurrencePattern?.range?.startDate;
  const rangeEnd = recurrencePattern?.range?.endDate;
  return {
    displayStartDate: (isSeriesMaster && rangeStart) ? rangeStart : formData?.startDate,
    displayEndDate: (isSeriesMaster && rangeEnd) ? rangeEnd : formData?.endDate,
  };
}

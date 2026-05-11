// src/utils/calendarEventUtils.js
//
// Pure utility functions for calendar/event display logic. Extracted from
// Calendar.jsx so that memoized child views (MonthView, WeekView, DayView)
// receive stable references and avoid wasted reconciliation cycles.
//
// All functions in this file MUST close over no component state or props.
// State-dependent helpers (e.g., userTimezone-dependent getMonthDayEventPosition)
// stay in the component.

import { logger } from './logger';
import { getEventField } from './eventTransformers';

export const isPendingEvent = (event) => {
  const status = event.status;
  return status === 'pending' || status === 'room-reservation-request';
};

export const isDraftEvent = (event) => event.status === 'draft';

/**
 * Check if an event has no location assigned.
 * Checks if the locations array (ObjectIds) is empty AND locationDisplayNames is empty.
 * Also treats "Unspecified" placeholder as unspecified (used when clearing locations via Graph API).
 */
export const isUnspecifiedLocation = (event) => {
  // Offsite events are NOT unspecified - they have their own group (check calendarData first)
  if (getEventField(event, 'isOffsite', false)) return false;
  // Has locations array with items = not unspecified (check calendarData first)
  const locations = getEventField(event, 'locations', []);
  if (locations && Array.isArray(locations) && locations.length > 0) return false;
  // Has locationDisplayNames (raw location name from Graph API) = not unspecified
  // "Unspecified" is a placeholder used when clearing locations, treat as unspecified (check calendarData first)
  const locationDisplayNames = getEventField(event, 'locationDisplayNames', '')?.trim();
  if (locationDisplayNames && locationDisplayNames !== 'Unspecified') return false;
  // Also check graphData.location.displayName as fallback
  const graphDisplayName = event.graphData?.location?.displayName?.trim();
  if (graphDisplayName && graphDisplayName !== 'Unspecified') return false;
  // No location data found = unspecified
  return true;
};

/**
 * Detect if a location string represents a virtual meeting.
 */
export const isVirtualLocation = (location) => {
  if (!location || typeof location !== 'string') return false;

  const lowerLocation = location.toLowerCase().trim();

  // Check for common virtual meeting patterns
  const virtualPatterns = [
    // Zoom patterns
    /zoom\.us/i,
    /zoom\.com/i,
    /zoommtg:/i,
    /zoom meeting/i,

    // Teams patterns
    /teams\.microsoft\.com/i,
    /teams\.live\.com/i,
    /microsoft teams/i,

    // Google Meet patterns
    /meet\.google\.com/i,
    /hangouts\.google\.com/i,
    /google meet/i,

    // WebEx patterns
    /webex\.com/i,
    /cisco\.webex\.com/i,

    // GoToMeeting patterns
    /gotomeeting\.com/i,
    /gotomeet\.me/i,

    // Generic virtual meeting indicators
    /^https?:\/\//i, // Any URL starting with http/https
    /meeting.*id/i,
    /join.*meeting/i,
    /conference.*call/i,
    /dial.*in/i,
    /phone.*conference/i,
  ];

  // Check for explicit virtual keywords
  const virtualKeywords = [
    'virtual',
    'online',
    'remote',
    'video call',
    'video conference',
    'web conference',
    'microsoft teams meeting',
    'zoom meeting',
    'google meet',
    'webex meeting',
    'skype meeting',
    'conference call',
    'dial-in',
    'phone conference',
    'teleconference',
    'video chat',
    'online meeting',
    'web meeting',
  ];

  if (virtualPatterns.some(pattern => pattern.test(lowerLocation))) {
    return true;
  }

  if (virtualKeywords.some(keyword => lowerLocation.includes(keyword))) {
    return true;
  }

  return false;
};

/**
 * Returns true if any of the event's locations is virtual.
 */
export const isEventVirtual = (event) => {
  const locationText = event.location?.displayName?.trim() || '';
  if (!locationText) return false;

  // Handle multiple locations separated by semicolons or commas
  const eventLocations = locationText
    .split(/[;,]/)
    .map(loc => loc.trim())
    .filter(loc => loc.length > 0);

  return eventLocations.some(location => isVirtualLocation(location));
};

/**
 * Returns true if the event lists the given physical location.
 */
export const hasPhysicalLocation = (event, targetLocation) => {
  const locationText = event.location?.displayName?.trim() || '';
  if (!locationText) return false;

  const eventLocations = locationText
    .split(/[;,]/)
    .map(loc => loc.trim())
    .filter(loc => loc.length > 0);

  return eventLocations.some(location => location === targetLocation);
};

/**
 * Extract categories from event (handles override semantics for recurring occurrences,
 * calendarData, top-level, and legacy singular `category`).
 */
export const getEventCategories = (event) => {
  // For recurring occurrences with overrides, top-level categories ARE the override
  if (event.isRecurringOccurrence && event.hasOccurrenceOverride && event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
    return event.categories;
  }
  // Check calendarData.categories first (authoritative for MongoDB documents)
  if (event.calendarData?.categories && Array.isArray(event.calendarData.categories) && event.calendarData.categories.length > 0) {
    return event.calendarData.categories;
  }
  // Check top-level categories array (for non-MongoDB formats)
  if (event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
    return event.categories;
  }
  // graphData.categories fallback removed — frontend reads top-level fields only
  // Check legacy singular category field
  if (event.category && event.category.trim() !== '' && event.category !== 'Uncategorized') {
    return [event.category];
  }
  return [];
};

export const isUncategorizedEvent = (event) => {
  const categories = getEventCategories(event);
  return categories.length === 0;
};

/**
 * Standardize date for API operations. Returns ISO UTC string.
 */
export const standardizeDate = (date) => {
  if (!date) return '';
  return date.toISOString();
};

/**
 * Returns the inclusive end-date string (YYYY-MM-DD) for day-range comparisons.
 *
 * Microsoft Graph / RFC 5545 all-day events store end as midnight of the day
 * AFTER the last day (exclusive end). A naive `compareDay <= endDateStr` then
 * includes one extra day. This helper subtracts one day when (and only when)
 * the event is all-day AND its end time is exactly midnight, so the legacy
 * 23:59:59-same-day convention is preserved unchanged.
 */
export const getEventEndDateExclusive = (event) => {
  const startStr = event.start?.dateTime?.split('T')[0] || '';
  const endDateTime = event.end?.dateTime || event.start?.dateTime;
  if (!endDateTime) return startStr;
  const [endDateStr, endTimeStr = ''] = String(endDateTime).split('T');
  const isAllDay =
    event.calendarData?.isAllDayEvent === true ||
    event.isAllDayEvent === true ||
    event.calendarData?.isAllDay === true;  // rSched-import schema variant (wrong key, same object)
  const endsAtMidnight = endTimeStr.startsWith('00:00');
  if (isAllDay && endsAtMidnight && endDateStr > startStr) {
    const d = new Date(`${endDateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return endDateStr;
};

/**
 * Check if an event occurs on a specific day (supports multi-day events).
 * @returns {Object|null} Position info object (truthy) or null (falsy)
 *   { position: 'only'|'start'|'middle'|'end', isMultiDay: boolean, totalDays: number }
 */
export const getEventPosition = (event, day) => {
  try {
    if (!event.start?.dateTime) {
      logger.error('Event missing start.dateTime:', event);
      return null;
    }
    const startDateStr = event.start.dateTime.split('T')[0];
    const endDateStr = getEventEndDateExclusive(event);
    const compareDay = new Date(day);
    const compareDateStr = compareDay.toISOString().split('T')[0];

    if (compareDateStr < startDateStr || compareDateStr > endDateStr) return null;

    const isMultiDay = startDateStr !== endDateStr;
    if (!isMultiDay) return { position: 'only', isMultiDay: false, totalDays: 1 };

    const totalDays = Math.round((new Date(endDateStr) - new Date(startDateStr)) / 86400000) + 1;
    const dayNumber = Math.round((new Date(compareDateStr) - new Date(startDateStr)) / 86400000) + 1;
    const position = compareDateStr === startDateStr ? 'start'
                   : compareDateStr === endDateStr ? 'end' : 'middle';
    return { position, isMultiDay: true, totalDays, dayNumber };
  } catch (err) {
    logger.error('Error comparing event date:', err, event);
    return null;
  }
};

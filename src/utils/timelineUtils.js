// src/utils/timelineUtils.js
// Shared timeline utility functions used by TimelineView and WeekTimelineModal

/**
 * Hour labels for 24-hour timeline display (12 AM through 11 PM)
 */
export const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const hour = i % 12 === 0 ? 12 : i % 12;
  const period = i < 12 ? 'AM' : 'PM';
  return `${hour} ${period}`;
});

/**
 * Check if an event is all-day (>= 23 hours duration)
 */
export const isAllDayEvent = (event) => {
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const durationHours = (end - start) / (1000 * 60 * 60);
  return durationHours >= 23;
};

/**
 * Calculate event block position and height as percentages of 24-hour day.
 * Uses timezone-aware local hours to ensure correct visual placement.
 *
 * @param {object} event - Event with start.dateTime and end.dateTime
 * @param {string} displayTimezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {{ top: string, height: string }} CSS percentage values
 */
export const calculateEventPosition = (event, displayTimezone) => {
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);

  let startHour, endHour;

  if (displayTimezone) {
    // Extract local hours/minutes in the display timezone
    const startParts = getLocalTimeParts(start, displayTimezone);
    const endParts = getLocalTimeParts(end, displayTimezone);
    startHour = startParts.hours + startParts.minutes / 60;
    endHour = endParts.hours + endParts.minutes / 60;
  } else {
    // Fallback: use JS Date local time (browser timezone)
    startHour = start.getHours() + start.getMinutes() / 60;
    endHour = end.getHours() + end.getMinutes() / 60;
  }

  // Handle events that cross midnight (end < start means next day)
  if (endHour <= startHour && endHour > 0) {
    endHour = 24; // Cap at end of day
  }

  const top = (startHour / 24) * 100;
  const height = ((endHour - startHour) / 24) * 100;

  return { top: `${top}%`, height: `${Math.max(height, 2)}%` };
};

/**
 * Extract hours and minutes in a specific timezone using Intl.DateTimeFormat.
 */
function getLocalTimeParts(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return { hours: hours === 24 ? 0 : hours, minutes };
  } catch {
    return { hours: date.getHours(), minutes: date.getMinutes() };
  }
}

/**
 * Calculate overlap-aware positioning for staggered event layout.
 * Events at the same time are offset horizontally within the row.
 *
 * @param {object} event - The event to position
 * @param {array} dayEvents - All events in the same location/day
 * @returns {{ left: string, right: string, zIndex: number, width?: string, hasOverlap?: boolean }}
 */
export const calculateOverlapLayout = (event, dayEvents) => {
  const overlapping = dayEvents.filter(other => {
    if (other.id === event.id || other.eventId === event.eventId) return false;

    const otherStart = new Date(other.start.dateTime);
    const otherEnd = new Date(other.end.dateTime);
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);

    return eventStart < otherEnd && eventEnd > otherStart;
  });

  if (overlapping.length === 0) {
    return { left: '4px', right: '4px', zIndex: 5 };
  }

  // Sort group by start time, then by duration (longer events behind)
  const group = [event, ...overlapping].sort((a, b) => {
    const aStart = new Date(a.start?.dateTime || a.startDateTime);
    const bStart = new Date(b.start?.dateTime || b.startDateTime);
    if (aStart.getTime() !== bStart.getTime()) return aStart - bStart;
    const aEnd = new Date(a.end?.dateTime || a.endDateTime);
    const bEnd = new Date(b.end?.dateTime || b.endDateTime);
    return (bEnd - bStart) - (aEnd - aStart);
  });

  const index = group.findIndex(e =>
    (e.id && e.id === event.id) || (e.eventId && e.eventId === event.eventId)
  );

  // Cascading offset: each event indented 20% from left, extends to right edge
  const OFFSET_PERCENT = 20;
  const MAX_LAYERS = 4;
  const effectiveIndex = Math.min(index, MAX_LAYERS - 1);
  const leftPercent = effectiveIndex * OFFSET_PERCENT;

  return {
    left: `calc(${leftPercent}% + 2px)`,
    right: '4px',
    zIndex: 5 + index,
    hasOverlap: true
  };
};

/**
 * Format event time range for timeline display.
 *
 * @param {object} event - Event with start.dateTime and end.dateTime
 * @returns {string} Formatted time range (e.g., "9:00 AM - 10:30 AM")
 */
export const formatTimelineEventTime = (event) => {
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return `${formatTime(start)} - ${formatTime(end)}`;
};

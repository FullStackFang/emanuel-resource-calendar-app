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
 * Convert a decimal hour (e.g., 9.5) to a display string ("9:30 AM").
 * Used by timeline modals for the quick-add hover indicator.
 */
export const formatDecimalHour = (decimalHour) => {
  const hours = Math.floor(decimalHour);
  const minutes = Math.round((decimalHour - hours) * 60);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
};

/**
 * Convert mouse Y position within a 24-hour grid element to a decimal hour,
 * snapped to 30-minute increments. Returns values in [0, 23.5].
 */
export const getDecimalHourFromMouseEvent = (e, gridEl) => {
  const rect = gridEl.getBoundingClientRect();
  const rawHour = ((e.clientY - rect.top) / rect.height) * 24;
  return Math.max(0, Math.min(23.5, Math.round(rawHour * 2) / 2));
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

/**
 * Return a deterministic, always-defined key for an event block.
 *
 * Consistency at every map-set/get site is critical for the overlap-column
 * layout — a missing or collision-prone key (e.g. two events both keyed by
 * `undefined`) causes one to silently fall through to the full-width layout
 * fallback and visually stack behind its time-overlapping siblings.
 *
 * Prefers `eventId` over `id` because virtual recurring occurrences
 * synthesized from a series master all INHERIT the master's top-level `id`
 * via `...event` spread (Calendar.jsx:1872). Only `eventId` is overridden
 * to be unique per occurrence (via `${event.eventId}-occurrence-${date}`).
 * Preferring `id` would collide every virtual occurrence of the same master
 * onto a single key, placing them in the same envelope/column bucket and
 * causing exactly the stacking bug this helper exists to prevent.
 *
 * Falls back to a synthetic composite key so events without either id
 * are still distinguishable.
 *
 * @param {object} event - Event object
 * @returns {string} A stable string key, never undefined
 */
export const getBlockKey = (event) => {
  if (!event) return '__nil__';
  if (event.eventId != null && event.eventId !== '') return String(event.eventId);
  if (event.id != null && event.id !== '') return String(event.id);
  // Synthetic composite — event.start.dateTime alone isn't unique (two events
  // can start at the same time), so include a title/subject discriminator.
  const when = event.start?.dateTime || '';
  const title = event.subject || event.eventTitle || '';
  const end = event.end?.dateTime || '';
  return `__synth__:${when}|${end}|${title}`;
};

/**
 * Compute the positioning envelope for a timeline event block.
 *
 * The block represents the **reservation** commitment (the full window during
 * which the room is held), not just the event/program time. The event time is
 * a subset rendered as a visual indicator *inside* the block.
 *
 * Returns:
 *   blockStart / blockEnd — Date boundaries for the block's vertical extent
 *   eventStart / eventEnd — Date boundaries for the event portion
 *   eventTopPct / eventSpanPct — Event zone offsets as percentages of the
 *     block height (for CSS custom properties driving the inner highlight)
 *   hasBuffer — true when the event is a strict subset of the reservation
 *     (i.e. there's setup and/or teardown time visibly outside the event)
 *
 * Hold-only events (no startTime/endTime): block = reservation, hasBuffer=false.
 * No-buffer events (event == reservation): block = event, hasBuffer=false.
 *
 * @param {object} event - Flat event with start.dateTime / end.dateTime and
 *   optional calendarData.reservationStartTime / reservationEndTime etc.
 * @returns {{
 *   blockStart: Date, blockEnd: Date,
 *   eventStart: Date, eventEnd: Date,
 *   eventTopPct: number, eventSpanPct: number,
 *   hasBuffer: boolean
 * }}
 */
export const calculateReservationEnvelope = (event) => {
  const get = (field) => event?.[field] ?? event?.calendarData?.[field] ?? '';

  const storedStart = new Date(event.start.dateTime);
  const storedEnd = new Date(event.end.dateTime);

  // Invalid Date protection — malformed event.start/end.dateTime would
  // otherwise leak NaN into every downstream timestamp comparison and
  // silently break the sort comparator in calculateColumnLayout.
  if (Number.isNaN(storedStart.getTime()) || Number.isNaN(storedEnd.getTime())) {
    const now = new Date();
    const fallbackStart = Number.isNaN(storedStart.getTime()) ? now : storedStart;
    const fallbackEnd = Number.isNaN(storedEnd.getTime())
      ? new Date(fallbackStart.getTime() + 60 * 60 * 1000)
      : storedEnd;
    return {
      blockStart: fallbackStart,
      blockEnd: fallbackEnd,
      eventStart: fallbackStart,
      eventEnd: fallbackEnd,
      eventTopPct: 0,
      eventSpanPct: 100,
      hasBuffer: false,
    };
  }

  const applyTime = (refDate, hhmm) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const d = new Date(refDate);
    d.setHours(h, m, 0, 0);
    return d;
  };

  // Sanity cap on buffer duration. Realistic setup/teardown for a room
  // reservation is minutes to a couple of hours. Values outside this range
  // (e.g. placeholder 00:00–23:59 from legacy data or migration artifacts)
  // would otherwise stretch the block to span the entire day and drag every
  // time-adjacent event into a single giant overlap cluster.
  const MAX_BUFFER_MS = 4 * 60 * 60 * 1000; // 4 hours

  const rawResStart = applyTime(storedStart, get('reservationStartTime'));
  const rawResEnd = applyTime(storedEnd, get('reservationEndTime'));
  const evtStart = applyTime(storedStart, get('startTime')) || storedStart;
  const evtEnd = applyTime(storedEnd, get('endTime')) || storedEnd;

  // Discard reservation boundaries that are implausibly far from the event
  // — treat them as bad data and fall back to the event boundary.
  const resStart = rawResStart &&
    (evtStart.getTime() - rawResStart.getTime()) <= MAX_BUFFER_MS
    ? rawResStart : null;
  const resEnd = rawResEnd &&
    (rawResEnd.getTime() - evtEnd.getTime()) <= MAX_BUFFER_MS
    ? rawResEnd : null;

  // Envelope: outer bounds of reservation and event. If a reservation boundary
  // is missing or discarded, use the event boundary (so a pure-event, no-buffer
  // booking stays the size of the event, not larger).
  const blockStart = resStart && resStart.getTime() < evtStart.getTime()
    ? resStart : evtStart;
  const blockEnd = resEnd && resEnd.getTime() > evtEnd.getTime()
    ? resEnd : evtEnd;

  const blockDuration = blockEnd.getTime() - blockStart.getTime();
  const hasBuffer = blockDuration > 0 &&
    (blockStart.getTime() < evtStart.getTime() ||
     blockEnd.getTime() > evtEnd.getTime());

  // Clamp to [0, 100] — consumed as CSS gradient-stop positions, so float
  // rounding that produces e.g. 100.0001% would add a stray sliver outside
  // the visible block area.
  const clampPct = (n) => Math.max(0, Math.min(100, n));

  const eventTopPct = blockDuration > 0
    ? clampPct(((evtStart.getTime() - blockStart.getTime()) / blockDuration) * 100)
    : 0;
  const eventSpanPct = blockDuration > 0
    ? clampPct(((evtEnd.getTime() - evtStart.getTime()) / blockDuration) * 100)
    : 100;

  return {
    blockStart,
    blockEnd,
    eventStart: evtStart,
    eventEnd: evtEnd,
    eventTopPct,
    eventSpanPct,
    hasBuffer,
  };
};

/**
 * Resolve an event's two time ranges for dual-range timeline rendering.
 *
 * The `primary` range is the event (program) time — what attendees care about.
 * The `secondary` range is the reservation (room hold) time — the full window
 * the room is committed, including setup/teardown buffers.
 *
 * When event-time and reservation-time fields are equal (no setup/teardown)
 * OR when only one set of fields exists (a "hold"-only booking), `secondary`
 * is null — the caller should render a single range.
 *
 * Uses an en-dash (–) for ranges per editorial typography convention.
 *
 * @param {object} event - Flat event object (top-level or nested calendarData)
 * @returns {{ primary: string, secondary: string | null }}
 */
export const resolveEventTimeRanges = (event) => {
  const get = (field) =>
    event?.[field] ?? event?.calendarData?.[field] ?? '';

  const eventStartRaw = get('startTime');
  const eventEndRaw = get('endTime');
  const resStartRaw = get('reservationStartTime');
  const resEndRaw = get('reservationEndTime');

  const formatFromDate = (date) => date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const formatFromHHMM = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return '';
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return formatFromDate(d);
  };

  const blockStart = formatFromDate(new Date(event.start.dateTime));
  const blockEnd = formatFromDate(new Date(event.end.dateTime));
  const blockRange = `${blockStart} – ${blockEnd}`;

  const hasEvent = !!(eventStartRaw && eventEndRaw);
  const hasRes = !!(resStartRaw && resEndRaw);
  const differ = hasEvent && hasRes &&
    (eventStartRaw !== resStartRaw || eventEndRaw !== resEndRaw);

  if (!differ) {
    return { primary: blockRange, secondary: null };
  }

  return {
    primary: `${formatFromHHMM(eventStartRaw)} – ${formatFromHHMM(eventEndRaw)}`,
    secondary: `${formatFromHHMM(resStartRaw)} – ${formatFromHHMM(resEndRaw)}`,
  };
};

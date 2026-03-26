/**
 * Time clamping utilities for keeping event times within reservation boundaries.
 *
 * When the SchedulingAssistant resizes a reservation block, event start/end
 * times may end up outside the new reservation window. These helpers auto-clamp
 * them back inside.
 */

/** Convert 'HH:MM' string to total minutes since midnight. Returns null for falsy input. */
export function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Convert total minutes since midnight to 'HH:MM' string. */
export function minutesToTimeStr(totalMinutes) {
  const mins = totalMinutes % 1440; // wrap 1440 -> 0 (midnight)
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Clamp event times to stay within the reservation window.
 *
 * @param {object} times - Object with startTime, endTime, reservationStartTime, reservationEndTime (all 'HH:MM' strings)
 * @returns {{ startTime: string, endTime: string } | null} - Clamped times, or null if no clamping was needed
 */
export function clampEventTimesToReservation({ startTime, endTime, reservationStartTime, reservationEndTime }) {
  // Skip when event times or reservation times are not set
  if (!startTime || !endTime || !reservationStartTime || !reservationEndTime) {
    return null;
  }

  const resStartMins = timeToMinutes(reservationStartTime);
  const resEndMinsRaw = timeToMinutes(reservationEndTime);
  let eventStartMins = timeToMinutes(startTime);
  let eventEndMins = timeToMinutes(endTime);

  // Midnight edge case: '00:00' reservation end means end-of-day (1440),
  // consistent with adjustForMidnight in validateTimes
  const resEndMins = (resEndMinsRaw === 0 && resStartMins > 0) ? 1440 : resEndMinsRaw;

  let clamped = false;

  // Clamp event start if reservation start moved past it
  if (eventStartMins < resStartMins) {
    eventStartMins = resStartMins;
    clamped = true;
  }

  // Clamp event end if reservation end moved before it
  if (eventEndMins > resEndMins) {
    eventEndMins = resEndMins;
    clamped = true;
  }

  if (!clamped) return null;

  // If window is too small for any event (start >= end), clear both
  if (eventStartMins >= eventEndMins) {
    return { startTime: '', endTime: '' };
  }

  return {
    startTime: minutesToTimeStr(eventStartMins),
    endTime: minutesToTimeStr(eventEndMins === 1440 ? 0 : eventEndMins),
  };
}

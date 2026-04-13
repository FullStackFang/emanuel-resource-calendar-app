/**
 * Time ordering and clamping utilities for reservation time fields.
 *
 * Enforces the invariant:
 *   Res Start <= Setup <= Door Open <= Event Start <= Door Close <= Event End <= Teardown <= Res End
 *   Res Start is the absolute lower bound; Res End is the absolute upper bound.
 *   Event End must be at or before Res End (reservation extends beyond event).
 *
 * Three directions of enforcement:
 * 1. expandReservationToContainOperationalTimes — operational time extends beyond res bounds -> expand res
 * 2. clampOperationalTimesToReservation — res narrows -> clamp inner times to stay within
 * 3. validateTimeOrdering — pure validation, returns error messages for any violations
 *
 * Also retains the original clampEventTimesToReservation for SA resize callbacks.
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

/** Treat '00:00' as end-of-day (1440) when a start time exists and is > 0. */
function adjustMidnight(minutes, referenceStartMinutes) {
  if (minutes === 0 && referenceStartMinutes !== null && referenceStartMinutes > 0) {
    return 1440;
  }
  return minutes;
}

/**
 * Expand reservation bounds outward so all operational times stay within.
 *
 * When an operational time (setup, doorOpen, startTime, etc.) extends beyond
 * reservationStartTime or reservationEndTime, the reservation bound is pushed
 * out to match.
 *
 * @returns {{ reservationStartTime?: string, reservationEndTime?: string } | null}
 *   The expanded values, or null if no expansion needed.
 */
export function expandReservationToContainOperationalTimes({
  reservationStartTime, reservationEndTime,
  setupTime, doorOpenTime, startTime,
  endTime, doorCloseTime, teardownTime,
}) {
  if (!reservationStartTime || !reservationEndTime) return null;

  const resStartMins = timeToMinutes(reservationStartTime);
  const resEndRaw = timeToMinutes(reservationEndTime);
  const resEndMins = adjustMidnight(resEndRaw, resStartMins);

  // Pre-event times that could push reservation start earlier
  const preEventTimes = [setupTime, doorOpenTime, startTime]
    .map(timeToMinutes)
    .filter(m => m !== null);

  // Post-event times that could push reservation end later
  const postEventTimes = [endTime, doorCloseTime, teardownTime]
    .map(timeToMinutes)
    .filter(m => m !== null);

  let newResStart = resStartMins;
  let newResEnd = resEndMins;

  for (const t of preEventTimes) {
    if (t < newResStart) newResStart = t;
  }
  for (const t of postEventTimes) {
    if (t > newResEnd) newResEnd = t;
  }

  const startChanged = newResStart !== resStartMins;
  const endChanged = newResEnd !== resEndMins;

  if (!startChanged && !endChanged) return null;

  const result = {};
  if (startChanged) result.reservationStartTime = minutesToTimeStr(newResStart);
  if (endChanged) result.reservationEndTime = minutesToTimeStr(newResEnd === 1440 ? 0 : newResEnd);
  return result;
}

/**
 * Clamp all operational times to stay within reservation bounds.
 *
 * When the reservation window narrows (user moves reservationStartTime later or
 * reservationEndTime earlier), inner times that now fall outside are pulled to
 * the nearest boundary.
 *
 * @returns {{ [field]: string } | null} Changed fields, or null if nothing clamped.
 */
export function clampOperationalTimesToReservation({
  reservationStartTime, reservationEndTime,
  setupTime, doorOpenTime, startTime,
  endTime, doorCloseTime, teardownTime,
}) {
  if (!reservationStartTime || !reservationEndTime) return null;

  const resStartMins = timeToMinutes(reservationStartTime);
  const resEndRaw = timeToMinutes(reservationEndTime);
  const resEndMins = adjustMidnight(resEndRaw, resStartMins);

  const changes = {};

  // Pre-event fields: clamp to >= resStart (excludes startTime — handled by clampEventTimesToReservation)
  const preFields = { setupTime, doorOpenTime };
  for (const [field, val] of Object.entries(preFields)) {
    const m = timeToMinutes(val);
    if (m !== null && m < resStartMins) {
      changes[field] = minutesToTimeStr(resStartMins);
    }
  }

  // Post-event fields: clamp to <= resEnd (excludes endTime — handled by clampEventTimesToReservation)
  const postFields = { doorCloseTime, teardownTime };
  for (const [field, val] of Object.entries(postFields)) {
    const m = timeToMinutes(val);
    if (m !== null && m > resEndMins) {
      changes[field] = minutesToTimeStr(resEndMins === 1440 ? 0 : resEndMins);
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Validate reservation time ordering.
 *
 * Chain: Res Start <= Setup <= Door Open <= Event Start <= Door Close <= Event End <= Teardown <= Res End
 * Door Close sits between Event Start and Event End (doors can close during the event).
 * Event End must be at or before Res End (reservation extends beyond event end).
 *
 * Checks nearest-neighbor pairs among PRESENT fields, correctly bridging gaps
 * when optional fields (setup, door open, door close, teardown) are absent.
 *
 * Multi-day events (startDate !== endDate) skip ordering — minute comparison is
 * meaningless across days.
 *
 * @returns {string[]} Error messages (empty array = valid).
 */
export function validateTimeOrdering({
  reservationStartTime, setupTime, doorOpenTime, startTime,
  endTime, doorCloseTime, teardownTime, reservationEndTime,
  startDate, endDate,
}) {
  // Multi-day events: times are on different days, skip ordering
  if (startDate && endDate && startDate !== endDate) return [];

  // Door Close sits between Event Start and Event End in the chain
  const orderedFields = [
    { value: reservationStartTime, name: 'Reservation Start' },
    { value: setupTime, name: 'Setup Time' },
    { value: doorOpenTime, name: 'Door Open' },
    { value: startTime, name: 'Event Start' },
    { value: doorCloseTime, name: 'Door Close' },
    { value: endTime, name: 'Event End' },
    { value: teardownTime, name: 'Teardown Time' },
    { value: reservationEndTime, name: 'Reservation End', isResEnd: true },
  ];

  const resStartMins = timeToMinutes(reservationStartTime);

  // Keep only fields that have a parseable HH:MM value
  const presentFields = orderedFields
    .map(f => ({ ...f, minutes: timeToMinutes(f.value) }))
    .filter(f => f.minutes !== null && !isNaN(f.minutes));

  const errors = [];

  // Check each nearest-neighbor pair among present fields
  for (let i = 0; i < presentFields.length - 1; i++) {
    const a = presentFields[i].minutes;
    let b = presentFields[i + 1].minutes;

    // Midnight adjustment for reservationEndTime (00:00 → 1440 when start > 0)
    if (presentFields[i + 1].isResEnd) {
      b = adjustMidnight(b, resStartMins);
    }

    if (a > b) {
      errors.push(`${presentFields[i].name} must be at or before ${presentFields[i + 1].name}`);
    }
  }

  return errors;
}

// src/utils/eventCreationDecision.js
//
// Pure decision logic for the admin/requester create flow.
//
// Why this exists: a recurring event submitted with a multi-day date range used
// to be fanned out into one-event-per-day batch creation, and every per-day
// payload still carried the recurrence — so each became a full series master.
// One submit produced ~42 duplicate masters ("38 events a day"). A recurrence
// pattern IS the repeat mechanism; its range governs the span. So when a
// complete recurrence is present we never batch, and we collapse the event to a
// single occurrence on its start date (the recurrence.range carries the span).

/**
 * Decide how a new event should be created from form data.
 *
 * @param {Object} data - Flat form data (startDate, endDate, adHocDates, recurrence).
 * @returns {{
 *   hasRecurrence: boolean,  // complete recurrence (pattern AND range) present
 *   isBatch: boolean,        // create one event per day across the range/ad-hoc dates
 *   startDate: string,       // event start date (unchanged)
 *   endDate: string,         // event end date (collapsed to startDate when recurring)
 * }}
 */
export function resolveCreationPlan(data = {}) {
  const hasRecurrence = !!(data.recurrence?.pattern && data.recurrence?.range);
  const hasAdHocDates = Array.isArray(data.adHocDates) && data.adHocDates.length > 0;
  const isMultiDayRange = !!(data.startDate && data.endDate && data.startDate !== data.endDate);

  // A recurring event must be a single master — never a per-day batch.
  const isBatch = !hasRecurrence && (hasAdHocDates || isMultiDayRange);

  return {
    hasRecurrence,
    isBatch,
    startDate: data.startDate,
    // Collapse the span to a single occurrence when recurring; the recurrence
    // range (not the event's own end date) defines how far the series extends.
    endDate: hasRecurrence ? data.startDate : data.endDate,
  };
}

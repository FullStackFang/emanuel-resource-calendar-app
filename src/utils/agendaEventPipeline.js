/**
 * Shared expand/dedup pipeline for the mobile agenda.
 *
 * MobileAgenda originally rendered raw /api/events/load documents 1:1, which
 * broke both ways at once:
 *  - un-overridden recurring occurrences have NO document of their own (they
 *    exist only as virtual expansions of the seriesMaster) and silently
 *    disappeared from the phone;
 *  - customized occurrences rendered TWICE (the exception/addition child AND
 *    the master's own card), with divergent rooms/categories.
 *
 * This mirrors the desktop pipeline in Calendar.jsx (~1522-1827) minus
 * desktop-only concerns (expansion cache, edit-request scoping, occurrence
 * numbering). Follow-up: refactor Calendar.jsx to consume this util.
 */
import { expandRecurringSeries } from './recurrenceUtils';
import { logger } from './logger';

function getRecurrence(event) {
  return event.recurrence || event.graphData?.recurrence || null;
}

const pad = (n) => String(n).padStart(2, '0');
const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param {Array<object>} rawEvents - raw documents from POST /api/events/load
 * @param {Date} rangeStart - inclusive local range start
 * @param {Date} rangeEnd - inclusive local range end
 * @returns {Array<object>} render-ready docs: children normalized, masters
 *          replaced by per-occurrence rows, stored occurrence records dropped
 */
export function prepareEventsForAgenda(rawEvents, rangeStart, rangeEnd) {
  const expandStart = toLocalDateStr(rangeStart);
  const expandEnd = toLocalDateStr(rangeEnd);

  const kept = [];
  const masters = [];
  const materializedDatesByMaster = new Map();

  for (const event of rawEvents) {
    const type = event.eventType || event.graphData?.type;
    const seriesMasterId = event.seriesMasterId || event.graphData?.seriesMasterId;

    if (event.eventType === 'exception' || event.eventType === 'addition') {
      // Materialized child: the authoritative row for its date. Normalize the
      // flags downstream consumers (cards, icons) read, and record its date so
      // master expansion skips it (this is the dedup that desktop does).
      if (event.seriesMasterEventId && event.occurrenceDate) {
        if (!materializedDatesByMaster.has(event.seriesMasterEventId)) {
          materializedDatesByMaster.set(event.seriesMasterEventId, new Set());
        }
        materializedDatesByMaster.get(event.seriesMasterEventId).add(event.occurrenceDate);
      }
      kept.push({
        ...event,
        isRecurringOccurrence: true,
        masterEventId: event.seriesMasterEventId,
        hasOccurrenceOverride: true,
        isAdHocAddition: event.eventType === 'addition',
      });
      continue;
    }

    if (type === 'seriesMaster' && getRecurrence(event)) {
      masters.push(event);
      continue;
    }

    // Stored Graph occurrence records are regenerated from their master.
    // (A seriesMaster with null recurrence is a stale record — falls through
    // and renders as a plain event, matching desktop behavior.)
    if (seriesMasterId) continue;

    kept.push(event);
  }

  for (const master of masters) {
    const recurrence = getRecurrence(master);
    if (!recurrence?.pattern || !recurrence?.range) {
      kept.push(master);
      continue;
    }

    const masterForExpansion = {
      eventId: master.eventId,
      start: { dateTime: master.startDateTime || master.calendarData?.startDateTime, timeZone: 'America/New_York' },
      end: { dateTime: master.endDateTime || master.calendarData?.endDateTime, timeZone: 'America/New_York' },
      subject: master.subject || master.eventTitle || master.calendarData?.eventTitle,
      recurrence,
      calendarData: master.calendarData,
    };

    let occurrences = [];
    try {
      occurrences = expandRecurringSeries(
        masterForExpansion,
        expandStart,
        expandEnd,
        [], // exceptions (Graph API only)
        master.occurrenceOverrides || [],
        materializedDatesByMaster.get(master.eventId) || null
      );
    } catch (error) {
      logger.error('agendaEventPipeline: error expanding series', master.eventId, error);
      continue;
    }

    for (const occurrence of occurrences) {
      const occurrenceDate = occurrence.start.dateTime.split('T')[0];
      kept.push({
        ...master,
        eventId: `${master.eventId}-occurrence-${occurrenceDate}`,
        eventType: 'occurrence',
        seriesMasterId: master.eventId,
        masterEventId: master.eventId,
        isRecurringOccurrence: true,
        recurrence: null,
        start: occurrence.start,
        end: occurrence.end,
        startDate: occurrenceDate,
        startDateTime: occurrence.start.dateTime,
        endDateTime: occurrence.end.dateTime,
        endDate: occurrence.end.dateTime.split('T')[0],
        startTime: occurrence.start.dateTime.split('T')[1]?.substring(0, 5),
        endTime: occurrence.end.dateTime.split('T')[1]?.substring(0, 5),
        subject: occurrence.subject || master.subject,
        eventTitle: occurrence.eventTitle || master.eventTitle || master.calendarData?.eventTitle,
        hasOccurrenceOverride: occurrence.hasOccurrenceOverride || false,
        isAdHocAddition: occurrence.isAdHocAddition || false,
        // Re-apply per-occurrence override fields: expandRecurringSeries spreads
        // them onto its output, but this row is rebuilt from ...master, so
        // master values would win without this (same block as Calendar.jsx).
        ...(occurrence.hasOccurrenceOverride ? {
          ...(occurrence.locations !== undefined && { locations: occurrence.locations }),
          ...(occurrence.locationDisplayNames !== undefined && { locationDisplayNames: occurrence.locationDisplayNames }),
          ...(occurrence.startTime !== undefined && { startTime: occurrence.startTime }),
          ...(occurrence.endTime !== undefined && { endTime: occurrence.endTime }),
          ...(occurrence.categories !== undefined && { categories: occurrence.categories }),
          ...(occurrence.services !== undefined && { services: occurrence.services }),
          ...(occurrence.eventDescription !== undefined && { eventDescription: occurrence.eventDescription }),
          ...(occurrence.isOffsite !== undefined && { isOffsite: occurrence.isOffsite }),
          ...(occurrence.offsiteName !== undefined && { offsiteName: occurrence.offsiteName }),
          ...(occurrence.offsiteAddress !== undefined && { offsiteAddress: occurrence.offsiteAddress }),
        } : {}),
      });
    }
  }

  return kept;
}

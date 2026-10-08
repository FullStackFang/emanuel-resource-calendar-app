'use strict';

/**
 * Graph sync for events already published to Outlook.
 *
 * Two write paths change a published event: admin Save
 * (PUT /api/admin/events/:id) and edit-request approval
 * (PUT /api/edit-requests/:id/approve). Each used to own a private copy of this
 * logic, and when a refactor deleted the approval's copy nothing noticed —
 * approved edits stopped reaching Outlook. Both handlers now call these
 * functions (locked by publishedMasterGraphSync.source.test.js).
 *
 *   buildMasterPatch          the Graph PATCH payload for the event itself
 *   buildOccurrencePatch      the PATCH payload for one occurrence instance
 *   reconcilePublishedSeries  everything a series master's children need
 *                             after the write: added dates, unsynced children,
 *                             cascade of master changes, newly excluded dates
 *
 * Helpers private to api-server.js arrive through `deps` (requiring them
 * would be a cycle); the graph service is read from deps at CALL time because
 * tests swap it in with setGraphApiService after the module loads.
 */

const { buildGraphRecurrence } = require('../utils/recurrenceGraphMapping');
const { recurrenceEquals, exclusionsAdded } = require('../utils/recurrenceCompare');
const {
  EVENT_TYPE,
  materializeAdditionDocuments,
  getExceptionsForMaster,
  findExceptionForDate,
  softDeleteException,
  mergeDefaultsWithOverrides,
} = require('../utils/exceptionDocumentService');

const DEFAULT_TIME_ZONE = 'America/New_York';

// changedFields → the Graph key groups they affect (approval mode only).
const TIME_FIELDS = ['startDateTime', 'endDateTime', 'startDate', 'endDate', 'startTime', 'endTime'];
const SUBJECT_FIELDS = ['eventTitle', ...TIME_FIELDS]; // times decide the [Hold] prefix
const LOCATION_FIELDS = ['locations', 'requestedRooms', 'locationDisplayNames',
  'isOffsite', 'offsiteName', 'offsiteAddress', 'offsiteLat', 'offsiteLon'];
const BODY_FIELDS = ['eventDescription'];
const CATEGORY_FIELDS = ['categories'];

function anyChanged(changedFields, fields) {
  return fields.some(f => changedFields.has(f));
}

/**
 * Did a recurrence change alter the SCHEDULE (pattern or range), as opposed to
 * only its exclusions/additions? Exclusions and additions are not part of
 * Graph's recurrence object, so only a schedule change needs a recurrence PATCH.
 */
function recurrenceScheduleChanged(oldR, newR) {
  const strip = r => (r ? { ...r, exclusions: [], additions: [] } : r);
  return !recurrenceEquals(strip(oldR), strip(newR));
}

/**
 * Build the Graph PATCH payload for a published event.
 *
 * Moved from the admin Save handler. Two modes:
 *
 *   changedFields === null  (admin Save) — `effective` is the submitted form;
 *     every key is emitted exactly as Save always has. The characterization
 *     suite (adminSaveGraphPayload.char.test.js) pins this byte for byte.
 *
 *   changedFields: Set      (approval) — `effective` is the POST-WRITE event
 *     state, flattened. An approval's changes are a DELTA, so a key group is
 *     emitted only when one of its fields changed; the values still come from
 *     the full effective state, which is why a time-only change can be aligned
 *     to the stored range and a room change resolves real names.
 *
 * Recurrence (only when the master is the target): Save sends it whenever the
 * form carries one; approval only when `recurrenceRewritten`. Start/end are
 * aligned to range.startDate in both cases whenever the master recurs — Graph
 * reads them as the FIRST occurrence and 400s (ErrorOccurrenceTimeSpanTooBig)
 * on a span covering the whole series.
 *
 * @param {Object} args
 * @param {Object} args.effective - Flat field source (see modes above)
 * @param {Set<string>|null} args.changedFields
 * @param {Object} args.event - Stored event (fallbacks: calendarData, graphData)
 * @param {string|null} [args.editScope]
 * @param {Array<{displayName, locationType}>} [args.locations] - Pre-resolved rooms
 * @param {boolean} [args.recurrenceRewritten] - approval mode only
 * @param {Object} args.deps - { buildGraphSubject, buildOffsiteGraphLocation, logger }
 * @returns {Object} Graph PATCH payload (may be empty in approval mode)
 */
function buildMasterPatch({ effective, changedFields, event, editScope = null, locations = [], recurrenceRewritten = false, deps }) {
  const { buildGraphSubject, buildOffsiteGraphLocation, logger } = deps;
  const updates = effective;
  const cd = event.calendarData || {};
  const saveMode = changedFields == null;
  const emit = fields => saveMode || anyChanged(changedFields, fields);
  const processedLocationsArray = locations || [];
  const isMasterTarget = !editScope || editScope === 'allEvents';
  const masterRecurrence = updates.recurrence;
  const masterRecurs = !!(masterRecurrence?.pattern && masterRecurrence?.range);
  const emitTimes = emit(TIME_FIELDS) || (!saveMode && recurrenceRewritten && masterRecurs);

  // TODO graphData-read: timezone and unchanged-field fallbacks below still read
  // graphData (carried verbatim from Save).
  // Save's form sends date and time separately and they are the user's intent.
  // Approval's effective state is a stored document whose combined
  // startDateTime is authoritative, so it wins there.
  const combine = (date, time, combined, stored, graph) => {
    if (!saveMode && combined) return combined;
    return (date && time) ? `${date}T${time}:00` : (combined || stored || graph);
  };
  const resolvedStartDateTime = combine(updates.startDate, updates.startTime, updates.startDateTime,
    cd.startDateTime, event.graphData?.start?.dateTime);
  const resolvedEndDateTime = combine(updates.endDate, updates.endTime, updates.endDateTime,
    cd.endDateTime, event.graphData?.end?.dateTime);

  const graphUpdate = {};
  if (emit(SUBJECT_FIELDS)) {
    graphUpdate.subject = buildGraphSubject(
      updates.eventTitle || cd.eventTitle || event.graphData?.subject, // TODO graphData-read
      updates.startTime !== undefined ? updates.startTime : cd.startTime,
      updates.endTime !== undefined ? updates.endTime : cd.endTime
    );
  }
  if (emitTimes) {
    graphUpdate.start = {
      dateTime: resolvedStartDateTime,
      timeZone: updates.startTimeZone || event.graphData?.start?.timeZone || DEFAULT_TIME_ZONE // TODO graphData-read
    };
    graphUpdate.end = {
      dateTime: resolvedEndDateTime,
      timeZone: updates.endTimeZone || event.graphData?.end?.timeZone || DEFAULT_TIME_ZONE // TODO graphData-read
    };
  }

  // Location — send separate locations array to Graph API
  if (emit(LOCATION_FIELDS)) {
    if (processedLocationsArray.length > 0) {
      if (updates.isOffsite) {
        // Complete Graph location object for offsite events with address/coordinates
        graphUpdate.location = buildOffsiteGraphLocation(
          updates.offsiteName,
          updates.offsiteAddress,
          updates.offsiteLat,
          updates.offsiteLon
        );
        graphUpdate.locations = [graphUpdate.location];
      } else {
        // location.displayName must be semicolon-joined, locations array has individual items
        graphUpdate.location = {
          displayName: processedLocationsArray.map(loc => loc.displayName).join('; '),
          locationType: 'default'
        };
        graphUpdate.locations = processedLocationsArray;
      }
    } else if (updates.locations && Array.isArray(updates.locations) && updates.locations.length > 0) {
      // Locations already in Graph API format (array of {displayName, locationType} objects)
      const locationsArray = updates.locations
        .map(loc => {
          if (typeof loc === 'string') {
            return { displayName: loc, locationType: 'default' };
          }
          return {
            displayName: loc.displayName || loc.name || '',
            locationType: loc.locationType || 'default'
          };
        })
        .filter(loc => loc.displayName);

      if (locationsArray.length > 0) {
        graphUpdate.location = {
          displayName: locationsArray.map(loc => loc.displayName).join('; '),
          locationType: 'default'
        };
        graphUpdate.locations = locationsArray;
      }
    } else if (
      // Explicitly cleared (empty array). Must come BEFORE the legacy updates.location check.
      (Array.isArray(updates.requestedRooms) && updates.requestedRooms.length === 0) ||
      (Array.isArray(updates.locations) && updates.locations.length === 0)
    ) {
      // Graph ignores empty strings/null, so clear with a placeholder it accepts
      graphUpdate.location = { displayName: 'Unspecified', locationType: 'default' };
      graphUpdate.locations = [];
      logger.info('Clearing locations in Graph API - using "Unspecified" placeholder');
    } else if (updates.location) {
      // Legacy single location field
      const singleLocation = {
        displayName: typeof updates.location === 'string'
          ? updates.location
          : updates.location.displayName || updates.location.name || '',
        locationType: 'default'
      };
      graphUpdate.location = singleLocation;
      graphUpdate.locations = [singleLocation];
    } else if (event.graphData?.location?.displayName) { // TODO graphData-read
      // Keep existing Graph location if not changed
      graphUpdate.location = event.graphData.location;
      if (event.graphData?.locations && Array.isArray(event.graphData.locations)) {
        graphUpdate.locations = event.graphData.locations;
      }
    }
  }

  // Body/description - support multiple formats
  if (emit(BODY_FIELDS)) {
    if (updates.body?.content) {
      graphUpdate.body = {
        contentType: updates.body.contentType === 'text' ? 'Text' : 'HTML',
        content: updates.body.content
      };
    } else if (updates.eventDescription) {
      graphUpdate.body = { contentType: 'HTML', content: updates.eventDescription };
    } else if (updates.description) {
      graphUpdate.body = { contentType: 'HTML', content: updates.description };
    }
  }

  // Only 'categories' syncs to Outlook - 'mecCategories' is internal only
  if (emit(CATEGORY_FIELDS)) {
    if (updates.categories && Array.isArray(updates.categories)) {
      graphUpdate.categories = updates.categories;
    } else if (event.graphData?.categories && Array.isArray(event.graphData.categories)) { // TODO graphData-read
      graphUpdate.categories = event.graphData.categories;
    }
  }

  // Recurrence: only when the master is the PATCH target. An explicit null
  // (removal) must be SENT — Graph ignores absent fields, so omitting it would
  // leave the series intact instead of converting it to a singleInstance.
  if (isMasterTarget) {
    const recurrenceTimezone = updates.startTimeZone || event.graphData?.start?.timeZone || DEFAULT_TIME_ZONE; // TODO graphData-read
    const sendRecurrence = saveMode || recurrenceRewritten;
    if (masterRecurs) {
      const recurrenceUpdate = buildGraphRecurrence(masterRecurrence, recurrenceTimezone);
      if (recurrenceUpdate) {
        if (sendRecurrence) {
          graphUpdate.recurrence = recurrenceUpdate;
          logger.info('Added recurrence to Graph update:', recurrenceUpdate);
        }
        // Align start/end to range.startDate (same calendar day, duration = one
        // occurrence). Mirrors graphEventBuilder.js used by publish/republish.
        const rangeStart = recurrenceUpdate.range.startDate;
        if ((sendRecurrence || !saveMode) && rangeStart && graphUpdate.start?.dateTime && graphUpdate.end?.dateTime) {
          const startTimeOfDay = graphUpdate.start.dateTime.split('T')[1] || '00:00:00';
          const endTimeOfDay = graphUpdate.end.dateTime.split('T')[1] || '23:59:00';
          graphUpdate.start.dateTime = `${rangeStart}T${startTimeOfDay}`;
          graphUpdate.end.dateTime = `${rangeStart}T${endTimeOfDay}`;
          logger.info('Aligned start/end to recurrence range.startDate:', {
            alignedStart: graphUpdate.start.dateTime,
            alignedEnd: graphUpdate.end.dateTime,
          });
        }
      }
    } else if (sendRecurrence && 'recurrence' in updates && !updates.recurrence) {
      graphUpdate.recurrence = null;
      logger.info('Removing recurrence from Graph event (series → singleInstance)');
    }
  }

  return graphUpdate;
}

/**
 * Build the Graph PATCH payload for ONE occurrence instance of a series.
 *
 * Moved from the admin Save thisEvent branch; approval's occurrence path uses
 * it too. A cleared start AND end time with a reservation window is a hold, so
 * the subject carries the [Hold] prefix and no event times are sent.
 *
 * @param {Object} args
 * @param {Object} args.overrideData - Fields this edit overrides
 * @param {Object} args.exceptionDoc - The written child (effective start/end)
 * @param {Object} args.event - The series master
 * @param {Object} args.deps - { buildGraphLocationFields }
 * @returns {Object} Graph PATCH payload (may be empty)
 */
function buildOccurrencePatch({ overrideData, exceptionDoc, event, deps }) {
  // TODO graphData-read: the series timezone still comes from graphData.
  const graphTimezone = event.graphData?.start?.timeZone || DEFAULT_TIME_ZONE;
  const isOccurrenceHold = overrideData.startTime !== undefined && !overrideData.startTime
    && overrideData.endTime !== undefined && !overrideData.endTime
    && (overrideData.reservationStartTime || event.calendarData?.reservationStartTime);

  const graphUpdate = {};
  if (isOccurrenceHold) {
    const rawTitle = overrideData.eventTitle || event.calendarData?.eventTitle || event.eventTitle || '';
    const baseTitle = rawTitle.replace(/^(\[Hold\]\s*)+/, '');
    graphUpdate.subject = `[Hold] ${baseTitle}`;
  } else if (overrideData.eventTitle) {
    graphUpdate.subject = overrideData.eventTitle;
  }
  if (overrideData.eventDescription !== undefined) {
    graphUpdate.body = { contentType: 'html', content: overrideData.eventDescription || '' };
  }
  if (!isOccurrenceHold) {
    if (exceptionDoc.startDateTime) {
      graphUpdate.start = { dateTime: exceptionDoc.startDateTime + ':00', timeZone: graphTimezone };
    }
    if (exceptionDoc.endDateTime) {
      graphUpdate.end = { dateTime: exceptionDoc.endDateTime + ':00', timeZone: graphTimezone };
    }
  }
  if (overrideData.categories !== undefined) graphUpdate.categories = overrideData.categories;
  if (overrideData.locationDisplayNames !== undefined) {
    Object.assign(graphUpdate, deps.buildGraphLocationFields(overrideData.locationDisplayNames || ''));
  }
  return graphUpdate;
}

// Master fields whose change must be cascaded onto linked children.
const CASCADE_FIELDS = ['eventTitle', 'startTime', 'endTime', 'locationDisplayNames', 'categories'];

function cascadeNeeded(before, after) {
  const a = before.calendarData || {};
  const b = after.calendarData || {};
  return CASCADE_FIELDS.some(f => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null));
}

/**
 * Post-write Graph reconciliation for a published series master.
 *
 * Runs after the event write commits, for both Save and approval:
 *   1. Materialize addition documents for dates in recurrence.additions[].
 *   2. Cancel newly excluded dates (D2): the delta exclusionsAdded(stored, saved),
 *      or the FULL list when `recurrenceRewritten` (a recurrence PATCH may have
 *      reset Graph's cancellations — sandbox probe D0). A date that has a live
 *      child is cancelled by soft-deleting the child and deleting its own Graph
 *      event; the series instance lookup cannot see an addition's standalone
 *      event. Instance cancellations are $addToSet into
 *      graphData.cancelledOccurrences so publish-time entries survive.
 *   3. Create Graph events for children that have no graphEventId yet.
 *   4. Cascade master title/time/location/category changes onto children that
 *      were ALREADY linked, re-merging each child's overrides over the new
 *      master so a child's own customization still wins.
 *
 * Follow-up writes never touch `_version`. No retry: a Graph error is one
 * `failed` entry, not a backoff inside the request. NEVER throws.
 *
 * @param {Object} args
 * @param {Object} args.event - The master BEFORE the write
 * @param {Object} args.updatedEvent - The master AFTER the write
 * @param {string|null} args.editScope
 * @param {boolean} args.recurrenceRewritten
 * @param {string} [args.actor] - Email recorded on created/deleted children
 * @param {Object} args.deps - { graphApi, collection, logger,
 *        syncExceptionDocumentsToGraph, syncRecurrenceExclusionsToGraph,
 *        buildGraphLocationFields, ensureSeconds }
 * @returns {Promise<{synced: Array, failed: Array, cancelledExclusions: Array, materialized: string[]}>}
 */
async function reconcilePublishedSeries({ event, updatedEvent, editScope, recurrenceRewritten, actor, deps }) {
  const result = { synced: [], failed: [], cancelledExclusions: [], materialized: [] };
  const { collection, logger } = deps;

  if (!updatedEvent || updatedEvent.eventType !== EVENT_TYPE.SERIES_MASTER) return result;
  if (editScope && editScope !== 'allEvents') return result;

  try {
    const m = await materializeAdditionDocuments(collection, updatedEvent, { createdBy: actor, createdByEmail: actor });
    result.materialized = m.created;
  } catch (err) {
    logger.warn('Non-fatal: failed to materialize added dates:', err.message);
    result.failed.push({ kind: 'addition', date: null, error: err.message });
  }

  const graphId = updatedEvent.graphData?.id;
  const owner = updatedEvent.calendarOwner;
  if (!graphId || !owner) {
    if (result.materialized.length > 0) {
      logger.warn('Materialized addition documents but cannot sync to Graph', {
        eventId: updatedEvent.eventId,
        dates: result.materialized,
        reason: !graphId ? 'no graphData.id' : 'no calendarOwner',
      });
    }
    return result;
  }

  const graphApi = deps.graphApi;
  const calendarId = updatedEvent.calendarId;
  // TODO graphData-read: the series timezone still comes from graphData.
  const graphTz = updatedEvent.graphData?.start?.timeZone || DEFAULT_TIME_ZONE;

  // ---- 2. Newly excluded dates ------------------------------------------
  try {
    const savedExclusions = Array.isArray(updatedEvent.recurrence?.exclusions)
      ? updatedEvent.recurrence.exclusions.map(String) : [];
    const toCancel = recurrenceRewritten
      ? savedExclusions
      : exclusionsAdded(event.recurrence, updatedEvent.recurrence);

    const instanceDates = [];
    const recorded = [];
    for (const date of toCancel) {
      const child = await findExceptionForDate(collection, updatedEvent.eventId, date);
      if (!child) {
        instanceDates.push(date);
        continue;
      }
      try {
        if (child.graphEventId) {
          await graphApi.deleteCalendarEvent(owner, calendarId, child.graphEventId);
          result.cancelledExclusions.push({ date, graphId: child.graphEventId });
          // An exception's graphEventId IS the series instance; an addition's
          // is a standalone event and not a series cancellation.
          if (child.eventType === EVENT_TYPE.EXCEPTION) recorded.push({ date, graphId: child.graphEventId });
        }
        await softDeleteException(collection, updatedEvent.eventId, date, {
          deletedBy: actor || 'system',
          reason: 'Occurrence excluded from the series',
        });
        // An exception overrides a SERIES instance. If it was never linked to
        // Outlook, that instance is still there and must be found the usual
        // way (production 2026-10-08: Kaiserman 11/19). An addition has no
        // series instance to find.
        if (!child.graphEventId && child.eventType === EVENT_TYPE.EXCEPTION) {
          instanceDates.push(date);
        }
      } catch (err) {
        logger.warn('Non-fatal: failed to cancel excluded child:', { date, error: err.message });
        result.failed.push({ kind: 'exclusion', date, error: err.message });
      }
    }

    if (instanceDates.length > 0) {
      const cancel = await deps.syncRecurrenceExclusionsToGraph(owner, calendarId, graphId, instanceDates, graphTz);
      for (const c of cancel.cancelledOccurrences) {
        result.cancelledExclusions.push(c);
        recorded.push(c);
      }
      for (const f of cancel.failed) result.failed.push({ kind: 'exclusion', date: f.date, error: f.error });
    }

    if (recorded.length > 0) {
      await collection.updateOne(
        { _id: updatedEvent._id },
        { $addToSet: { 'graphData.cancelledOccurrences': { $each: recorded } } }
      );
    }
  } catch (err) {
    logger.warn('Non-fatal: exclusion sync failed:', err.message);
    result.failed.push({ kind: 'exclusion', date: null, error: err.message });
  }

  // ---- 3 & 4. Children: create unsynced, cascade to linked ----------------
  let children = [];
  try {
    children = await getExceptionsForMaster(collection, updatedEvent.eventId);
  } catch (err) {
    logger.warn('Non-fatal: failed to load child documents:', err.message);
    result.failed.push({ kind: 'exception', date: null, error: err.message });
  }

  const unsynced = children.filter(doc => !doc.graphEventId);
  const linked = children.filter(doc => doc.graphEventId);

  if (unsynced.length > 0) {
    try {
      const kindByDate = new Map(unsynced.map(d => [d.occurrenceDate, d.eventType]));
      const sync = await deps.syncExceptionDocumentsToGraph(
        owner, calendarId, graphId, updatedEvent.eventId,
        { subject: updatedEvent.eventTitle, start: { timeZone: graphTz } },
        { preloadedDocs: unsynced }
      );
      for (const s of sync.synced) result.synced.push({ kind: kindByDate.get(s.date) || 'exception', date: s.date, graphId: s.graphId });
      for (const f of sync.failed) result.failed.push({ kind: kindByDate.get(f.date) || 'exception', date: f.date, error: f.reason });
    } catch (err) {
      logger.warn('Non-fatal: failed to sync unsynced children:', err.message);
      result.failed.push({ kind: 'exception', date: null, error: err.message });
    }
  }

  if (linked.length > 0 && cascadeNeeded(event, updatedEvent)) {
    for (const child of linked) {
      try {
        const { effectiveFields: eff } = mergeDefaultsWithOverrides(updatedEvent, child.overrides || {}, child.occurrenceDate);
        const patch = {
          subject: eff.eventTitle || updatedEvent.calendarData?.eventTitle || updatedEvent.eventTitle,
          start: { dateTime: deps.ensureSeconds(eff.startDateTime), timeZone: graphTz },
          end: { dateTime: deps.ensureSeconds(eff.endDateTime), timeZone: graphTz },
        };
        if (eff.categories !== undefined) patch.categories = eff.categories;
        if (eff.locationDisplayNames !== undefined) {
          Object.assign(patch, deps.buildGraphLocationFields(eff.locationDisplayNames));
        }
        await graphApi.updateCalendarEvent(owner, calendarId, child.graphEventId, patch);
        result.synced.push({ kind: child.eventType, date: child.occurrenceDate, graphId: child.graphEventId });
      } catch (err) {
        logger.warn('Non-fatal: failed to cascade master edit to child:', { date: child.occurrenceDate, error: err.message });
        result.failed.push({ kind: child.eventType, date: child.occurrenceDate, error: err.message });
      }
    }
  }

  return result;
}

module.exports = {
  buildMasterPatch,
  buildOccurrencePatch,
  reconcilePublishedSeries,
  recurrenceScheduleChanged,
};

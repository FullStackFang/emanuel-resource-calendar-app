/**
 * Exception Document Service
 *
 * CRUD helpers for recurring event exception and addition documents.
 *
 * When a user modifies a single occurrence of a recurring series, the change
 * is stored as a separate templeEvents__Events document with:
 *   - eventType: EVENT_TYPE.EXCEPTION or EVENT_TYPE.ADDITION
 *   - seriesMasterEventId: links back to the series master's eventId
 *   - occurrenceDate: the specific YYYY-MM-DD date this represents
 *   - overrides: only the fields that differ from the master
 *   - denormalized top-level + calendarData fields (master defaults + overrides merged)
 *
 * This replaces the old occurrenceOverrides[] array on the series master.
 */

const { ObjectId } = require('mongodb');
const { unwrapFindOneResult } = require('./concurrencyUtils');

const EVENT_TYPE = {
  SINGLE_INSTANCE: 'singleInstance',
  SERIES_MASTER: 'seriesMaster',
  OCCURRENCE: 'occurrence',
  EXCEPTION: 'exception',
  ADDITION: 'addition',
};

const EXCEPTION_TYPES = [EVENT_TYPE.EXCEPTION, EVENT_TYPE.ADDITION];

const MAX_EXCEPTIONS_PER_QUERY = 500;

/**
 * Structural DATE_IMMUTABLE guard for occurrence / exception writes.
 *
 * Occurrence dates are immutable: moving a recurring event to a different day
 * must be done via the series schedule (or by clicking the target date on the
 * calendar), not by mutating an existing occurrence's date. This helper is
 * invoked at the top of {@link createExceptionDocument} and
 * {@link updateExceptionDocument}, so every write path that goes through the
 * shared helpers inherits the guarantee automatically — no per-call-site
 * duplication required.
 *
 * Thrown error shape matches the existing `resolveSeriesMaster` pattern
 * (`err.statusCode = 400; err.code = '...'`), so call sites can catch once and
 * surface the 400 response uniformly.
 *
 * Rules:
 *   - If `overrides.startDate` is defined AND !== `dateKey` → throw 400 DATE_IMMUTABLE
 *   - If `overrides.endDate` is defined AND !== `dateKey` → throw 400 DATE_IMMUTABLE
 *   - Same-value re-sends (override === dateKey) pass as no-ops.
 *   - Omitted `startDate` / `endDate` pass (only present-and-different triggers).
 *
 * @param {Object} overrides - Proposed override fields for this occurrence
 * @param {string} dateKey - Canonical occurrence date (YYYY-MM-DD)
 * @throws {Error} With `statusCode: 400`, `code: 'DATE_IMMUTABLE'` on mismatch
 * @private
 */
function _validateOccurrenceDateNotChanged(overrides, dateKey) {
  if (!overrides || !dateKey) return;
  if (overrides.startDate !== undefined && overrides.startDate !== dateKey) {
    const err = new Error(
      `Occurrence startDate (${overrides.startDate}) cannot differ from its occurrenceDate (${dateKey}). To move this event to a different day, edit the series schedule or create a new event.`
    );
    err.statusCode = 400;
    err.code = 'DATE_IMMUTABLE';
    throw err;
  }
  if (overrides.endDate !== undefined && overrides.endDate !== dateKey) {
    const err = new Error(
      `Occurrence endDate (${overrides.endDate}) cannot differ from its occurrenceDate (${dateKey}). To move this event to a different day, edit the series schedule or create a new event.`
    );
    err.statusCode = 400;
    err.code = 'DATE_IMMUTABLE';
    throw err;
  }
}

// Fields copied from master to produce complete denormalized docs.
// Override value wins when the field key exists in the overrides object (even if null).
const INHERITABLE_FIELDS = [
  'eventTitle', 'eventDescription',
  'startTime', 'endTime', 'startDate', 'endDate',
  'setupTime', 'teardownTime', 'doorOpenTime', 'doorCloseTime',
  'reservationStartTime', 'reservationEndTime',
  'locations', 'locationDisplayNames',
  'categories', 'services', 'assignedTo',
  'attendeeCount', 'eventNotes', 'setupNotes', 'doorNotes', 'specialRequirements',
  'isOffsite', 'offsiteName', 'offsiteAddress',
];

// calendarData sub-fields that mirror top-level fields
const CALENDAR_DATA_FIELDS = [
  'eventTitle', 'eventDescription',
  'startDateTime', 'endDateTime', 'startDate', 'startTime', 'endDate', 'endTime',
  'locations', 'locationDisplayNames',
  'categories',
  'setupTime', 'teardownTime', 'doorOpenTime', 'doorCloseTime',
  'reservationStartTime', 'reservationEndTime',
  'attendeeCount',
  'eventNotes', 'setupNotes', 'doorNotes', 'specialRequirements',
];

/**
 * Merge master defaults with override fields to produce effective values.
 *
 * For each inheritable field, if the overrides object contains that key (even if null),
 * the override wins. Otherwise the master's value is used.
 *
 * @param {Object} masterEvent - The series master document
 * @param {Object} overrides - Override fields (from user edit)
 * @param {string} occurrenceDate - YYYY-MM-DD date string
 * @returns {Object} { effectiveFields, effectiveCalendarData }
 */
function mergeDefaultsWithOverrides(masterEvent, overrides, occurrenceDate) {
  const effective = {};

  for (const field of INHERITABLE_FIELDS) {
    if (field in overrides) {
      effective[field] = overrides[field];
    } else {
      effective[field] = masterEvent.calendarData?.[field] !== undefined
        ? masterEvent.calendarData[field]
        : masterEvent[field];
    }
  }

  const startTime = effective.startTime || effective.reservationStartTime || '00:00';
  const endTime = effective.endTime || effective.reservationEndTime || '23:59';
  // Always include seconds for consistent string comparison in conflict detection
  const startTimeFull = startTime.length === 5 ? startTime + ':00' : startTime;
  const endTimeFull = endTime.length === 5 ? endTime + ':00' : endTime;
  effective.startDateTime = `${occurrenceDate}T${startTimeFull}`;
  effective.endDateTime = `${occurrenceDate}T${endTimeFull}`;
  effective.startDate = occurrenceDate;
  effective.endDate = occurrenceDate;

  const calendarData = {};
  for (const field of CALENDAR_DATA_FIELDS) {
    if (effective[field] !== undefined) {
      calendarData[field] = effective[field];
    }
  }

  return { effectiveFields: effective, effectiveCalendarData: calendarData };
}

/**
 * Shared builder for exception and addition documents.
 * @private
 */
async function _insertOccurrenceDocument(collection, masterEvent, occurrenceDate, data, eventType, eventIdSuffix, options = {}) {
  const masterEventId = masterEvent.eventId;
  const now = new Date();
  const eventId = `${masterEventId}${eventIdSuffix}${occurrenceDate}`;

  const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(
    masterEvent, data, occurrenceDate
  );

  // Resurrect-or-insert: the eventId is deterministic per (master, date, kind),
  // so a soft-deleted predecessor still occupies the slot. Inserting again
  // would collide with the unique index. If we find a soft-deleted doc with
  // the same eventId, restore it and apply the new overrides instead of
  // inserting a fresh document — preserving the audit trail and avoiding
  // E11000 duplicate-key errors when a user re-customizes a date after delete.
  const existingByEventId = await collection.findOne({ eventId });
  if (existingByEventId && existingByEventId.isDeleted === true) {
    const update = {
      $set: {
        eventType,
        seriesMasterEventId: masterEventId,
        occurrenceDate,
        overrides: { ...data },
        ...effectiveFields,
        calendarData: effectiveCalendarData,
        userId: masterEvent.userId,
        calendarOwner: masterEvent.calendarOwner,
        calendarId: masterEvent.calendarId,
        status: masterEvent.status,
        isDeleted: false,
        roomReservationData: masterEvent.roomReservationData || null,
        graphEventId: options.graphEventId || null,
        graphData: null,
        lastModifiedDateTime: now,
        lastModifiedBy: options.createdBy || masterEvent.lastModifiedBy || 'system',
      },
      $unset: { deletedAt: '', deletedBy: '' },
      $inc: { _version: 1 },
      $push: {
        statusHistory: {
          status: masterEvent.status,
          changedAt: now,
          changedBy: options.createdBy || masterEvent.createdBy || 'system',
          changedByEmail: options.createdByEmail || masterEvent.createdByEmail || null,
          reason: `${eventType === EVENT_TYPE.EXCEPTION ? 'Exception' : 'Addition'} document recreated (resurrected from soft-delete)`,
        },
      },
    };
    const result = await collection.findOneAndUpdate(
      { _id: existingByEventId._id },
      update,
      { returnDocument: 'after' }
    );
    return unwrapFindOneResult(result);
  }

  const doc = {
    _id: new ObjectId(),
    eventId,
    eventType,
    seriesMasterEventId: masterEventId,
    occurrenceDate,
    overrides: { ...data },

    // Denormalized effective values for indexed queries and display
    ...effectiveFields,
    calendarData: effectiveCalendarData,

    userId: masterEvent.userId,
    calendarOwner: masterEvent.calendarOwner,
    calendarId: masterEvent.calendarId,
    status: masterEvent.status,
    isDeleted: false,
    roomReservationData: masterEvent.roomReservationData || null,
    graphEventId: options.graphEventId || null,
    graphData: null,
    _version: 1,
    statusHistory: [{
      status: masterEvent.status,
      changedAt: now,
      changedBy: options.createdBy || masterEvent.createdBy || 'system',
      changedByEmail: options.createdByEmail || masterEvent.createdByEmail || null,
      reason: `${eventType === EVENT_TYPE.EXCEPTION ? 'Exception' : 'Addition'} document created`,
    }],

    createdAt: now,
    createdBy: options.createdBy || masterEvent.createdBy || 'system',
    createdByEmail: options.createdByEmail || masterEvent.createdByEmail || null,
    lastModifiedDateTime: now,
    lastModifiedBy: options.createdBy || masterEvent.lastModifiedBy || 'system',
  };

  await collection.insertOne(doc);
  return doc;
}

/**
 * Create a new exception document for a modified occurrence.
 *
 * @param {Collection} collection - The templeEvents__Events collection
 * @param {Object} masterEvent - The series master document
 * @param {string} occurrenceDate - YYYY-MM-DD date string
 * @param {Object} overrides - Only the fields that differ from the master
 * @param {Object} [options]
 * @param {string} [options.createdBy] - Who created this exception
 * @param {string} [options.createdByEmail] - Creator's email
 * @param {string} [options.graphEventId] - Graph event ID if already synced
 * @returns {Object} The inserted exception document
 */
async function createExceptionDocument(collection, masterEvent, occurrenceDate, overrides, options = {}) {
  _validateOccurrenceDateNotChanged(overrides, occurrenceDate);
  return _insertOccurrenceDocument(collection, masterEvent, occurrenceDate, overrides, EVENT_TYPE.EXCEPTION, '-', options);
}

/**
 * Create a new addition document for an ad-hoc date outside the recurrence pattern.
 *
 * @param {Collection} collection - The templeEvents__Events collection
 * @param {Object} masterEvent - The series master document
 * @param {string} occurrenceDate - YYYY-MM-DD date string
 * @param {Object} fields - Full event field values for this addition
 * @param {Object} [options]
 * @param {string} [options.createdBy]
 * @param {string} [options.createdByEmail]
 * @param {string} [options.graphEventId]
 * @returns {Object} The inserted addition document
 */
async function createAdditionDocument(collection, masterEvent, occurrenceDate, fields, options = {}) {
  return _insertOccurrenceDocument(collection, masterEvent, occurrenceDate, fields, EVENT_TYPE.ADDITION, '-add-', options);
}

/**
 * Update an existing exception document with new override fields.
 *
 * Merges new overrides into the existing overrides object and recomputes
 * denormalized effective values from the master.
 *
 * @param {Collection} collection - The templeEvents__Events collection
 * @param {Object} exceptionDoc - The existing exception document
 * @param {Object} masterEvent - The series master document (for default values)
 * @param {Object} newOverrides - Additional/updated override fields
 * @param {Object} [options]
 * @param {string} [options.modifiedBy]
 * @param {number} [options.expectedVersion] - For OCC
 * @returns {Object|null} The updated document, or null on OCC conflict
 */
async function updateExceptionDocument(collection, exceptionDoc, masterEvent, newOverrides, options = {}) {
  _validateOccurrenceDateNotChanged(newOverrides, exceptionDoc.occurrenceDate);
  const mergedOverrides = { ...exceptionDoc.overrides, ...newOverrides };
  const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(
    masterEvent, mergedOverrides, exceptionDoc.occurrenceDate
  );

  const filter = { _id: exceptionDoc._id };
  if (options.expectedVersion != null) {
    filter._version = options.expectedVersion;
  }

  const update = {
    $set: {
      overrides: mergedOverrides,
      ...effectiveFields,
      calendarData: effectiveCalendarData,
      lastModifiedDateTime: new Date(),
      ...(options.modifiedBy && { lastModifiedBy: options.modifiedBy }),
    },
    $inc: { _version: 1 },
  };

  const result = await collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
  const updatedDoc = unwrapFindOneResult(result);

  if (!updatedDoc && options.expectedVersion != null) {
    return null;
  }

  return updatedDoc;
}

/**
 * Find an existing exception or addition document for a specific occurrence date.
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId - The master's eventId
 * @param {string} occurrenceDate - YYYY-MM-DD
 * @returns {Object|null}
 */
async function findExceptionForDate(collection, seriesMasterEventId, occurrenceDate) {
  return collection.findOne({
    seriesMasterEventId,
    occurrenceDate,
    eventType: { $in: EXCEPTION_TYPES },
    isDeleted: { $ne: true },
  });
}

/**
 * Get all exception/addition documents for a series master, optionally within a date range.
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {Object} [dateRange] - { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * @returns {Array<Object>}
 */
async function getExceptionsForMaster(collection, seriesMasterEventId, dateRange) {
  const query = {
    seriesMasterEventId,
    eventType: { $in: EXCEPTION_TYPES },
    isDeleted: { $ne: true },
  };

  if (dateRange) {
    if (dateRange.start) query.occurrenceDate = { $gte: dateRange.start };
    if (dateRange.end) {
      query.occurrenceDate = query.occurrenceDate || {};
      query.occurrenceDate.$lte = dateRange.end;
    }
  }

  // NOTE: sort is done in JS, not Mongo, because Cosmos DB rejects ORDER BY on
  // any path not in its indexing policy and `occurrenceDate` is excluded there.
  const docs = await collection.find(query).limit(MAX_EXCEPTIONS_PER_QUERY).toArray();
  docs.sort((a, b) => (a.occurrenceDate || '').localeCompare(b.occurrenceDate || ''));
  return docs;
}

/**
 * Cascade soft-delete all exception/addition documents for a series master.
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {Object} [options]
 * @param {string} [options.deletedBy]
 * @param {string} [options.reason]
 * @returns {number} Number of documents updated
 */
async function cascadeDeleteExceptions(collection, seriesMasterEventId, options = {}) {
  const now = new Date();
  const result = await collection.updateMany(
    {
      seriesMasterEventId,
      eventType: { $in: EXCEPTION_TYPES },
      isDeleted: { $ne: true },
    },
    {
      $set: {
        isDeleted: true,
        status: 'deleted',
        deletedAt: now,
        deletedBy: options.deletedBy || 'system',
        lastModifiedDateTime: now,
      },
      $push: {
        statusHistory: {
          status: 'deleted',
          changedAt: now,
          changedBy: options.deletedBy || 'system',
          reason: options.reason || 'Series deleted',
        },
      },
      $inc: { _version: 1 },
    }
  );
  return result.modifiedCount;
}

/**
 * Cascade status update to all exception/addition documents for a series master.
 * Used when publishing, rejecting, or restoring a series.
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {string} newStatus
 * @param {Object} [options]
 * @param {string} [options.changedBy]
 * @param {string} [options.reason]
 * @returns {number} Number of documents updated
 */
async function cascadeStatusUpdate(collection, seriesMasterEventId, newStatus, options = {}) {
  const now = new Date();
  const setFields = {
    status: newStatus,
    lastModifiedDateTime: now,
    ...(options.changedBy && { lastModifiedBy: options.changedBy }),
  };
  // Propagate reviewer info when publishing (so exception docs show who approved)
  if (options.reviewedBy) {
    setFields['roomReservationData.reviewedBy'] = options.reviewedBy;
  }
  if (options.reviewNotes !== undefined) {
    setFields['roomReservationData.reviewNotes'] = options.reviewNotes;
  }
  const result = await collection.updateMany(
    {
      seriesMasterEventId,
      eventType: { $in: EXCEPTION_TYPES },
      isDeleted: { $ne: true },
    },
    {
      $set: setFields,
      $push: {
        statusHistory: {
          status: newStatus,
          changedAt: now,
          changedBy: options.changedBy || 'system',
          reason: options.reason || `Series status changed to ${newStatus}`,
        },
      },
      $inc: { _version: 1 },
    }
  );
  return result.modifiedCount;
}

/**
 * Resolve the canonical series master document from any related event reference.
 *
 * When a caller loads a document by _id, it may be the master, an exception, or
 * an addition. Per-occurrence write paths must always operate against the master
 * so that createExceptionDocument/updateExceptionDocument receive the correct
 * masterEventId. Failing to resolve leads to Bug B: date-suffixed seriesMasterEventId
 * and double-suffixed eventId corruption on re-edit.
 *
 * @param {Collection} collection - templeEvents__Events
 * @param {Object} event - May be a seriesMaster, exception, or addition document
 * @returns {Promise<Object>} The series master document (input returned unchanged if already master)
 * @throws {Error} statusCode=400 OrphanedException if exception has no seriesMasterEventId
 * @throws {Error} statusCode=404 MasterNotFound if linked master cannot be found
 * @throws {Error} statusCode=400 InvalidEventType for unsupported eventType values
 *
 * NOTE: Master lookup intentionally does NOT filter isDeleted. The allEvents cascade
 * delete path must reach a soft-deleted master to clean up any surviving live children.
 */
async function resolveSeriesMaster(collection, event) {
  if (event.eventType === EVENT_TYPE.SERIES_MASTER) return event;

  if (event.eventType === EVENT_TYPE.EXCEPTION || event.eventType === EVENT_TYPE.ADDITION) {
    if (!event.seriesMasterEventId) {
      const err = new Error('Exception document missing seriesMasterEventId');
      err.statusCode = 400;
      err.code = 'OrphanedException';
      throw err;
    }
    const master = await collection.findOne({
      eventId: event.seriesMasterEventId,
      eventType: EVENT_TYPE.SERIES_MASTER,
    });
    if (!master) {
      const err = new Error(`Series master '${event.seriesMasterEventId}' not found`);
      err.statusCode = 404;
      err.code = 'MasterNotFound';
      throw err;
    }
    return master;
  }

  const err = new Error(`resolveSeriesMaster: unexpected eventType '${event.eventType}'`);
  err.statusCode = 400;
  err.code = 'InvalidEventType';
  throw err;
}

/**
 * Reconcile an incoming `occurrenceOverrides[]` array against the live
 * exception child documents of a series master.
 *
 * This is the shared backend behavior for all save paths that accept the
 * "Recurrence tab" override array (draft save, owner edit, admin save). It
 * enforces the rule: the array of exception documents IS the source of truth
 * for customizations; the inline `calendarData.occurrenceOverrides[]` field on
 * the master is computed at read time and NEVER persisted.
 *
 * Two-step reconciliation:
 *   1. UPDATE — for each incoming override that already has a live exception
 *      child, merge the incoming fields onto the existing doc.
 *   2. SOFT-DELETE — for each live exception child whose `occurrenceDate` is
 *      missing from the incoming array (the user clicked "Remove
 *      customization"), soft-delete it. recurrence.exclusions is NOT touched
 *      — removing a customization restores the virtual pattern occurrence;
 *      excluding a date is a separate operation handled elsewhere.
 *
 * Additions are managed via `recurrence.additions` and intentionally excluded.
 *
 * Creation of new exception documents from incoming entries that have no
 * existing child is intentionally NOT handled here. New customizations are
 * routed through the `editScope='thisEvent'` path which calls
 * {@link createExceptionDocument} directly.
 *
 * @param {Collection} collection - templeEvents__Events
 * @param {Object} master - The series master document (must have eventId)
 * @param {Array<Object>} incomingOverrides - Frontend's filtered overrides
 *        from the Recurrence tab; each entry MUST have `occurrenceDate`.
 * @param {Object} [options]
 * @param {string} [options.modifiedBy] - User identifier for audit trail
 * @param {string} [options.deleteReason] - Reason for soft-delete (default:
 *        'Customization removed via Recurrence tab')
 * @param {Function} [options.extractOverrideData] - Override extraction fn
 *        (signature: `(incoming, resolvedLocations) => overrideData`)
 * @param {Function} [options.resolveLocationOverride] - Location resolver fn
 *        (signature: `(incoming.locations) => Promise<resolvedLocations>`)
 * @param {Function} [options.deleteGraphEvent] - Optional Graph cleanup fn
 *        (signature: `(calendarOwner, calendarId, graphId) => Promise<void>`)
 * @param {Object} [options.logger] - Optional logger with `info`/`warn` methods
 * @returns {Promise<{ updated: Array<string>, softDeleted: Array<string> }>}
 *        Arrays of `occurrenceDate` keys that were updated and soft-deleted.
 */
async function reconcileOccurrenceOverrides(collection, master, incomingOverrides, options = {}) {
  const updated = [];
  const softDeleted = [];

  if (!master || master.eventType !== EVENT_TYPE.SERIES_MASTER) {
    return { updated, softDeleted };
  }
  if (!Array.isArray(incomingOverrides)) {
    return { updated, softDeleted };
  }

  const log = options.logger || { info: () => {}, warn: () => {} };
  const deleteReason = options.deleteReason || 'Customization removed via Recurrence tab';

  const incomingDateSet = new Set(
    incomingOverrides.map(o => o && o.occurrenceDate).filter(Boolean)
  );

  for (const incoming of incomingOverrides) {
    if (!incoming || !incoming.occurrenceDate) continue;
    const dateKey = incoming.occurrenceDate;
    const existingException = await findExceptionForDate(collection, master.eventId, dateKey);
    try {
      const resolvedLocs = (incoming.locations && options.resolveLocationOverride)
        ? await options.resolveLocationOverride(incoming.locations)
        : null;
      const overrideData = options.extractOverrideData
        ? options.extractOverrideData(incoming, resolvedLocs)
        : incoming;
      if (existingException) {
        await updateExceptionDocument(
          collection, existingException, master, overrideData,
          { modifiedBy: options.modifiedBy }
        );
      } else {
        // Create the exception doc on first sight. Includes the empty-marker
        // case (entry with only `occurrenceDate`) — the "Customize" popover on
        // the Recurrence tab adds a bare marker so the date enters the
        // exceptions list, and that marker must round-trip through save.
        // _insertOccurrenceDocument handles soft-delete resurrection internally.
        await createExceptionDocument(
          collection, master, dateKey, overrideData,
          { createdBy: options.modifiedBy, createdByEmail: options.modifiedBy }
        );
      }
      updated.push(dateKey);
      log.info?.('Persisted recurrence tab override to exception doc:', { dateKey });
    } catch (err) {
      log.warn?.('Non-fatal: failed to persist recurrence tab override:', {
        dateKey, error: err.message,
      });
    }
  }

  const liveChildren = await getExceptionsForMaster(collection, master.eventId);
  const orphans = liveChildren.filter(child =>
    child.eventType === EVENT_TYPE.EXCEPTION && !incomingDateSet.has(child.occurrenceDate)
  );

  for (const orphan of orphans) {
    try {
      const orphanGraphId = orphan.graphData && orphan.graphData.id;
      if (orphanGraphId && options.deleteGraphEvent) {
        try {
          await options.deleteGraphEvent(
            orphan.calendarOwner || master.calendarOwner,
            orphan.calendarId || master.calendarId,
            orphanGraphId
          );
        } catch (graphDelErr) {
          log.warn?.('Non-fatal: failed to delete Graph event for orphan exception:', {
            date: orphan.occurrenceDate, graphId: orphanGraphId, error: graphDelErr.message,
          });
        }
      }
      await softDeleteException(collection, master.eventId, orphan.occurrenceDate, {
        deletedBy: options.modifiedBy,
        reason: deleteReason,
      });
      softDeleted.push(orphan.occurrenceDate);
      log.info?.('Soft-deleted orphan exception document:', { date: orphan.occurrenceDate });
    } catch (orphanErr) {
      log.warn?.('Non-fatal: failed to soft-delete orphan exception:', {
        date: orphan.occurrenceDate, error: orphanErr.message,
      });
    }
  }

  return { updated, softDeleted };
}

/**
 * Soft-delete a single exception document (for single-occurrence deletion).
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {string} occurrenceDate - YYYY-MM-DD
 * @param {Object} [options]
 * @param {string} [options.deletedBy]
 * @param {string} [options.reason]
 * @returns {Object|null} The updated document, or null if not found
 */
async function softDeleteException(collection, seriesMasterEventId, occurrenceDate, options = {}) {
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    {
      seriesMasterEventId,
      occurrenceDate,
      eventType: { $in: EXCEPTION_TYPES },
      isDeleted: { $ne: true },
    },
    {
      $set: {
        isDeleted: true,
        status: 'deleted',
        deletedAt: now,
        deletedBy: options.deletedBy || 'system',
        lastModifiedDateTime: now,
      },
      $push: {
        statusHistory: {
          status: 'deleted',
          changedAt: now,
          changedBy: options.deletedBy || 'system',
          reason: options.reason || 'Occurrence deleted',
        },
      },
      $inc: { _version: 1 },
    },
    { returnDocument: 'after' }
  );
  return unwrapFindOneResult(result) || null;
}

/**
 * Undelete a soft-deleted exception document for single-occurrence restore (DL-10).
 *
 * Symmetric counterpart to {@link softDeleteException}. Used by the master-update
 * endpoint when an `allEvents`-scope edit removes a date from
 * `master.recurrence.exclusions[]`. Crucially, this does NOT touch `overrides`
 * or denormalized effective fields — the prior customization is preserved
 * verbatim, which is what users expect when "restoring" a date.
 *
 * Distinct from the resurrect branch in `_insertOccurrenceDocument` (which is
 * coupled to "I have new override data to apply"). This helper is for pure
 * restore, where the user is undoing a delete, not re-customizing.
 *
 * @param {Collection} collection
 * @param {Object} masterEvent - Series master (used for eventId derivation + status lookup)
 * @param {string} occurrenceDate - YYYY-MM-DD
 * @param {Object} [options]
 * @param {string} [options.restoredBy]
 * @param {string} [options.restoredByEmail]
 * @returns {Promise<Object|null>} The restored document, or null if no soft-deleted exception existed
 */
async function undeleteExceptionForRestore(collection, masterEvent, occurrenceDate, options = {}) {
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    {
      seriesMasterEventId: masterEvent.eventId,
      occurrenceDate,
      eventType: { $in: EXCEPTION_TYPES },
      isDeleted: true,
    },
    {
      $set: {
        isDeleted: false,
        status: masterEvent.status,
        lastModifiedDateTime: now,
        lastModifiedBy: options.restoredBy || 'system',
      },
      $unset: { deletedAt: '', deletedBy: '' },
      $push: {
        statusHistory: {
          status: masterEvent.status,
          changedAt: now,
          changedBy: options.restoredBy || 'system',
          changedByEmail: options.restoredByEmail || null,
          reason: 'Single-occurrence restore (exclusion removed)',
        },
      },
      $inc: { _version: 1 },
    },
    { returnDocument: 'after' }
  );
  return unwrapFindOneResult(result) || null;
}

/**
 * Build an override entry for a single exception/addition document.
 *
 * Preferred source: the nested `overrides` field populated by
 * {@link _insertOccurrenceDocument} at write time. When that's missing or
 * empty (legacy docs, partial writes, schema drift), fall back to reading
 * the denormalized top-level inheritable fields so the recurrence tab still
 * surfaces the customized badge. This matches the Calendar path's tolerant
 * behavior, which iterates the full child doc and doesn't depend on the
 * nested `overrides` shape.
 *
 * @param {Object} doc - Exception or addition document
 * @returns {Object} Override entry shaped `{ occurrenceDate, ...fields }`
 * @private
 */
function _buildOverrideEntry(doc) {
  const hasNestedOverrides = doc.overrides && Object.keys(doc.overrides).length > 0;
  if (hasNestedOverrides) {
    return { occurrenceDate: doc.occurrenceDate, ...doc.overrides };
  }
  const fromTopLevel = {};
  for (const field of INHERITABLE_FIELDS) {
    if (doc[field] !== undefined) {
      fromTopLevel[field] = doc[field];
    }
  }
  return { occurrenceDate: doc.occurrenceDate, ...fromTopLevel };
}

/**
 * Enrich seriesMaster events with an `occurrenceOverrides` array synthesized
 * from their exception/addition child documents.
 *
 * Both the Calendar load endpoint (`POST /api/events/load`) and the unified
 * list endpoint (`GET /api/events/list`) surface a shared review modal. That
 * modal's RecurrenceTabContent reads `reservation.occurrenceOverrides` to
 * populate the exceptions list. This helper is the single source of truth for
 * how that array is computed, so the Approval Queue and Calendar cannot drift
 * from each other.
 *
 * @param {Collection} collection - templeEvents__Events
 * @param {Array<Object>} events - Primary result array; masters get mutated (copy-on-write)
 * @param {Object} [options]
 * @param {Function} [options.log] - Receives `{ masterCount, overrideCount, perMaster }` for diagnostics
 * @returns {Promise<Array<Object>>} New events array with overrides spread onto masters
 */
async function enrichSeriesMastersWithOverrides(collection, events, options = {}) {
  if (!Array.isArray(events) || events.length === 0) return events;

  const masterEventIdSet = new Set(
    events
      .filter(e => e.eventType === EVENT_TYPE.SERIES_MASTER)
      .map(e => e.eventId)
      .filter(Boolean)
  );

  if (masterEventIdSet.size === 0) {
    options.log?.({ masterCount: 0, overrideCount: 0, perMaster: [], source: 'in-array' });
    return events;
  }

  // Primary: iterate the events array itself for exception/addition children
  // whose seriesMasterEventId matches a master in the array. This is how the
  // Calendar `/api/events/load` path has always worked reliably — children
  // are in the same result set as their master, no separate query needed.
  let childDocs = events.filter(e =>
    EXCEPTION_TYPES.includes(e.eventType) &&
    e.seriesMasterEventId &&
    masterEventIdSet.has(e.seriesMasterEventId) &&
    e.isDeleted !== true
  );
  let source = 'in-array';

  // Fallback: if no in-array children were found (e.g., the caller's primary
  // query filtered them out for user-facing purposes), query the collection.
  // Use retry-on-empty to guard against Cosmos cross-partition query flakiness.
  if (childDocs.length === 0) {
    const query = {
      seriesMasterEventId: { $in: Array.from(masterEventIdSet) },
      eventType: { $in: EXCEPTION_TYPES },
      isDeleted: { $ne: true },
    };
    childDocs = await collection.find(query).toArray();
    source = 'query';

    if (childDocs.length === 0) {
      // Retry once — Cosmos cross-partition queries sometimes return empty
      // on the first call while index metadata is warming.
      childDocs = await collection.find(query).toArray();
      if (childDocs.length > 0 && options.retry) {
        options.retry({ childCount: childDocs.length, masterEventIds: Array.from(masterEventIdSet) });
      }
    }
  }

  const overridesByMaster = {};
  for (const doc of childDocs) {
    if (!doc.seriesMasterEventId || !doc.occurrenceDate) continue;
    const list = overridesByMaster[doc.seriesMasterEventId] || [];
    list.push(_buildOverrideEntry(doc));
    overridesByMaster[doc.seriesMasterEventId] = list;
  }

  const diagnostic = {
    masterCount: masterEventIdSet.size,
    overrideCount: childDocs.length,
    source,
    perMaster: Object.entries(overridesByMaster).map(([id, list]) => ({
      masterEventId: id,
      count: list.length,
    })),
  };
  if (options.log) options.log(diagnostic);

  if (masterEventIdSet.size > 0 && childDocs.length === 0 && options.warn) {
    options.warn('[exceptionEnrichment] masters found but no exception/addition children (in-array or query)', {
      masterEventIds: Array.from(masterEventIdSet),
    });
  }

  if (Object.keys(overridesByMaster).length === 0) return events;

  return events.map(e =>
    e.eventType === EVENT_TYPE.SERIES_MASTER && overridesByMaster[e.eventId]
      ? { ...e, occurrenceOverrides: overridesByMaster[e.eventId] }
      : e
  );
}

module.exports = {
  EVENT_TYPE,
  EXCEPTION_TYPES,
  MAX_EXCEPTIONS_PER_QUERY,
  INHERITABLE_FIELDS,
  mergeDefaultsWithOverrides,
  createExceptionDocument,
  createAdditionDocument,
  updateExceptionDocument,
  findExceptionForDate,
  getExceptionsForMaster,
  cascadeDeleteExceptions,
  cascadeStatusUpdate,
  softDeleteException,
  undeleteExceptionForRestore,
  resolveSeriesMaster,
  enrichSeriesMastersWithOverrides,
  reconcileOccurrenceOverrides,
};

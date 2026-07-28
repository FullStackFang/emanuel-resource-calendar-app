// backend/services/syncReconcileService.js
//
// Orchestration for Sync Health reconcile: observe reality, ask
// utils/syncReconcilePlan what may be done about it, and execute.
//
// Dependencies are INJECTED ({eventsCollection, graphApi, auditService,
// broadcast}) for the same reason syncHealthService injects them: api-server
// swaps its Graph client at runtime via setGraphApiService(), which is how
// graphApiMock gets installed, so a module-level require here would pin the
// real client and bypass the mock.
//
// The invariant this file exists to hold: NOTHING IS WRITTEN UNTIL REALITY HAS
// BEEN RE-READ AND MATCHED AGAINST THE PLAN. An Outlook delete cannot be
// undone, so `apply` re-observes from scratch — it never trusts the report the
// admin was looking at, nor the plan it issued moments earlier.

const { ObjectId } = require('mongodb');

const {
  ACTION,
  ACTIONS_BY_FINDING,
  FINDING_TYPE,
  ARCHIVE_REASON,
  MATCH_TIER,
  buildPlan,
  fingerprintOf,
  verifyExpectedState,
  findDuplicateCandidates,
  classifyLinkMatch,
  isIrreversible,
} = require('../utils/syncReconcilePlan');
const { toEasternDateKey, toEasternTimeKey } = require('../utils/syncHealthDiff');
const { localDateOf } = require('./syncHealthService');
const { republishEventCore } = require('./republishCore');
const { conditionalUpdate } = require('../utils/concurrencyUtils');
const { buildStatusHistoryEntry } = require('../utils/eventFieldBuilder');
const { withGraphRetry } = require('../utils/graphRetry');
const logger = require('../utils/logger');

const AUDIT_SOURCE = 'SyncHealthReconcile';

// attendees is the expensive addition here, and the only reason to ask for it:
// deleting an event with attendees sends them a cancellation.
const PROBE_SELECT = 'id,subject,start,end,type,seriesMasterId,isCancelled,attendees';
const CANDIDATE_SELECT = 'id,subject,start,end,type,seriesMasterId,isCancelled';

// Enough of the day for an admin to recognise "my event is not in this list".
const MAX_DAY_EVENTS_RETURNED = 25;

const statusOf = (err) => err?.status ?? err?.statusCode;
const isNotFound = (err) => statusOf(err) === 404;

/**
 * Shift a 'YYYY-MM-DD' by whole days using UTC arithmetic.
 * UTC, not local `new Date(y,m,d)`, so a DST transition cannot move the result
 * off the date line (same reasoning as addOneUtcDay in graphEventBuilder).
 * @private
 */
function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/**
 * Probe Outlook for one event id.
 * @private
 * @returns {Promise<object>} always resolves; `found: false` for a 404
 */
async function probeOutlookEvent(graphApi, calendarOwner, graphId) {
  try {
    const raw = await withGraphRetry(() =>
      graphApi.getEvent(calendarOwner, null, graphId, { select: PROBE_SELECT }));
    return {
      found: true,
      graphId: raw.id || graphId,
      subject: raw.subject || '(no subject)',
      date: toEasternDateKey(raw.start?.dateTime, raw.start?.timeZone),
      type: raw.type || null,
      seriesMasterId: raw.seriesMasterId || null,
      attendeeCount: Array.isArray(raw.attendees) ? raw.attendees.length : 0,
      // The ONLY undo reference a Graph delete will ever have.
      snapshot: raw,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return {
        found: false, graphId, subject: null, date: null,
        type: null, seriesMasterId: null, attendeeCount: 0, snapshot: null,
      };
    }
    throw err;
  }
}

/**
 * Re-derive WHY an Outlook entry should be removed.
 *
 * The shipped finding carries only {graphId, subject, date, reason} — a string.
 * Deleting on the strength of that string would delete whatever the report
 * happened to say minutes ago. This asks the database again: is the document
 * still deleted, or is the date still excluded?
 *
 * @private
 * @returns {Promise<object|null>}
 */
async function deriveJustification(eventsCollection, probe, targetDate) {
  const graphId = probe.graphId;

  // (a) an app document that is deleted but still linked to this Outlook item.
  const deletedDoc = await eventsCollection.findOne({
    $or: [{ 'graphData.id': graphId }, { graphEventId: graphId }],
  });
  if (deletedDoc) {
    return {
      kind: 'deletedDoc',
      mongoId: String(deletedDoc._id),
      _version: deletedDoc._version ?? null,
      isDeleted: deletedDoc.isDeleted === true || deletedDoc.status === 'deleted',
    };
  }

  // (b) an excluded date of a series the app tracks that Outlook never dropped.
  const date = probe.date || targetDate || null;
  if (probe.seriesMasterId && date) {
    const master = await eventsCollection.findOne({
      'graphData.id': probe.seriesMasterId,
      eventType: 'seriesMaster',
    });
    if (master) {
      return {
        kind: 'exclusion',
        mongoId: String(master._id),
        _version: master._version ?? null,
        exclusionDate: date,
        exclusionDatePresent: (master.recurrence?.exclusions || []).includes(date),
      };
    }
  }

  return null;
}

/**
 * Everything Outlook shows on one day, cancelled entries dropped.
 *
 * Returned to the client as-is (capped) so an admin can SEE that the event they
 * are about to publish really is absent, rather than trusting the report's
 * summary of a run that may be minutes old.
 *
 * @private
 */
async function listOutlookDay(graphApi, calendarOwner, date) {
  if (!date) return [];

  // The window is asked for in UTC but the day we want is LOCAL. A UTC-day
  // slice (00:00Z..23:59Z) starts at 19:00 the previous evening and ends at
  // 18:59 — so a 20:00 booking on the target date falls at 01:00Z the NEXT day
  // and is missed entirely. That is not just a display problem: a real
  // link-to-existing candidate would be invisible and the admin would be
  // offered "publish", creating a duplicate of an event Outlook already had.
  //
  // Fetch a padded window and narrow it with the same Eastern date key the diff
  // uses, so "that day" means the same thing everywhere.
  const dayEvents = await withGraphRetry(() => graphApi.getCalendarEvents(
    calendarOwner, null, `${shiftDate(date, -1)}T00:00:00Z`, `${shiftDate(date, 2)}T00:00:00Z`,
    { select: CANDIDATE_SELECT }
  ));

  return (dayEvents || [])
    .filter((e) => e && e.isCancelled !== true)
    .map((e) => ({
      graphId: e.id,
      subject: e.subject || '(no subject)',
      date: toEasternDateKey(e.start?.dateTime, e.start?.timeZone),
      // Local wall clock, so it can be read against the app's local times
      // without a five-hour mental subtraction.
      startTime: toEasternTimeKey(e.start?.dateTime, e.start?.timeZone),
      endTime: toEasternTimeKey(e.end?.dateTime, e.end?.timeZone),
      seriesMasterId: e.seriesMasterId || null,
      type: e.type || null,
    }))
    .filter((e) => e.date === date)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

/**
 * Narrow a day's Outlook entries to the ones no app document claims.
 *
 * "Untracked" is decided the same way the report decides it — by linkage, never
 * by title — so a candidate list can only ever contain events the app really
 * does not manage. Entries belonging to a series the app tracks are excluded
 * too: an occurrence of a tracked master is tracked.
 *
 * @private
 */
async function filterUntracked(eventsCollection, dayEvents) {
  if (!dayEvents || dayEvents.length === 0) return [];

  const ids = dayEvents.map((e) => e.graphId).filter(Boolean);
  const seriesIds = [...new Set(dayEvents.map((e) => e.seriesMasterId).filter(Boolean))];

  const claimed = await eventsCollection.find(
    {
      $or: [
        { 'graphData.id': { $in: [...ids, ...seriesIds] } },
        { graphEventId: { $in: ids } },
      ],
    },
    { projection: { 'graphData.id': 1, graphEventId: 1 } }
  ).toArray();

  const claimedIds = new Set();
  for (const doc of claimed) {
    if (doc.graphData?.id) claimedIds.add(doc.graphData.id);
    if (doc.graphEventId) claimedIds.add(doc.graphEventId);
  }

  return dayEvents.filter(
    (e) => !claimedIds.has(e.graphId) && !(e.seriesMasterId && claimedIds.has(e.seriesMasterId))
  );
}

/**
 * The app-side view of one document, as every reconcile path sees it.
 *
 * Shared by the single-finding observation and the batch planner so the two
 * cannot drift — a batch that judged matches on a differently-shaped record
 * than the one apply re-observes would be exactly the bug the fingerprint
 * handshake exists to prevent.
 *
 * The fields below `endDate` are decision context: not read by buildPlan and
 * never fingerprinted. They exist because an admin cannot choose between
 * archive, link and publish from a title alone — a years-old 'Hold' record
 * wants archiving; a real booking next month wants publishing.
 *
 * @param {object} doc - raw Mongo event document
 * @returns {object}
 */
function describeDoc(doc) {
  return {
    mongoId: String(doc._id),
    _version: doc._version ?? null,
    status: doc.status ?? null,
    isDeleted: doc.isDeleted === true,
    eventType: doc.eventType ?? null,
    eventTitle: doc.eventTitle || doc.calendarData?.eventTitle || null,
    graphDataId: doc.graphData?.id || null,
    graphEventId: doc.graphEventId || null,
    date: localDateOf(doc),
    startTime: doc.calendarData?.startTime ?? doc.startTime ?? '',
    endTime: doc.calendarData?.endTime ?? doc.endTime ?? '',
    endDate: doc.calendarData?.endDate ?? doc.endDate ?? null,
    locationDisplayNames: doc.locationDisplayNames || doc.calendarData?.locationDisplayNames || [],
    categories: doc.categories || doc.calendarData?.categories || [],
    requestedByName: doc.roomReservationData?.requestedBy?.name || null,
    requestedByEmail: doc.roomReservationData?.requestedBy?.email || null,
    createdAt: doc.createdAt || null,
    createdByEmail: doc.createdByEmail || doc.createdBy || null,
    lastModifiedDateTime: doc.lastModifiedDateTime || null,
  };
}

/**
 * Read current reality for one finding. No writes, ever.
 *
 * @param {object} params
 * @param {import('mongodb').Collection} params.eventsCollection
 * @param {object} params.graphApi
 * @param {string} params.findingType
 * @param {string} params.calendarOwner
 * @param {{mongoId?: string, graphId?: string, date?: string}} params.target
 * @param {string} [params.action] - only affects how much is probed
 * @param {string} [params.linkTargetGraphId]
 * @returns {Promise<object>} an observation, consumable by buildPlan/fingerprintOf
 */
async function observe({
  eventsCollection, graphApi, findingType, calendarOwner, target = {}, action, linkTargetGraphId,
}) {
  const observation = {
    findingType,
    calendarOwner,
    target,
    doc: null,
    justification: null,
    outlookProbe: null,
    candidates: [],
    linkTargetGraphId: linkTargetGraphId || null,
    observedAt: new Date().toISOString(),
  };

  if (findingType === FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK) {
    if (!target.graphId) return observation;
    observation.outlookProbe = await probeOutlookEvent(graphApi, calendarOwner, target.graphId);
    if (observation.outlookProbe.found) {
      observation.justification = await deriveJustification(
        eventsCollection, observation.outlookProbe, target.date
      );
    }
    return observation;
  }

  if (findingType === FINDING_TYPE.UNTETHERED) {
    if (!target.mongoId || !ObjectId.isValid(target.mongoId)) return observation;
    const doc = await eventsCollection.findOne({ _id: new ObjectId(target.mongoId) });
    if (!doc) return observation;

    observation.rawDoc = doc; // service-internal; never fingerprinted
    observation.doc = describeDoc(doc);

    // What Outlook ACTUALLY shows that day. This is how an admin verifies the
    // finding instead of taking the report's word for it: if the event really
    // is absent, they can see the absence. Fetched for every untethered
    // observation (one calendarView day-slice), and reused for the duplicate
    // probe below rather than fetched twice.
    if (observation.doc.date) {
      observation.dayEvents = await listOutlookDay(graphApi, calendarOwner, observation.doc.date);
      const untracked = await filterUntracked(eventsCollection, observation.dayEvents);
      observation.untrackedThatDay = untracked;
      observation.candidates = findDuplicateCandidates(observation.doc, untracked);
    }
    return observation;
  }

  return observation;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Observe fresh, decide, and return the plan plus the fingerprint apply must
 * hand back. Never trusts the rendered report.
 *
 * @returns {Promise<{ok: boolean, status?: number, code?: string, reason?: string,
 *                    plan?: object, expectedState?: object, observation?: object}>}
 */
async function planReconcile(params) {
  const { findingType, action, now = new Date() } = params;
  const observation = await observe(params);

  // CONTEXT MODE: no action chosen yet. Return what was observed and what is
  // on offer, with no ops and no fingerprint. This exists because the panel
  // previously asked an admin to choose between archive, link and publish
  // knowing only the event's title — there was no way to tell a years-old
  // 'Hold' placeholder from a real booking, or to check whether Outlook really
  // lacks the event. Reads only; nothing here can write.
  if (!action) {
    return {
      ok: true,
      context: true,
      availableActions: ACTIONS_BY_FINDING[findingType] || [],
      observed: publicObservation(observation),
    };
  }

  const plan = buildPlan(findingType, action, observation);

  if (plan.abort) {
    // Candidates ride along even on a refusal: "you have not told me which
    // Outlook event to link to" is answered BY the candidate list, so the UI
    // gets its pick-list from the same observation instead of guessing.
    return {
      ok: false,
      status: 409,
      code: plan.code,
      reason: plan.reason,
      candidates: observation.candidates || [],
      observation,
    };
  }

  return {
    ok: true,
    plan: {
      findingType,
      action,
      ops: plan.ops,
      warnings: plan.warnings,
      irreversible: isIrreversible(plan),
      recommendation: plan.recommendation || action,
      requiresAllowDuplicate: plan.requiresAllowDuplicate === true,
      candidates: plan.candidates || observation.candidates || [],
    },
    expectedState: fingerprintOf(observation, now),
    observation,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** Refusal shape shared by every guard. @private */
const deny = (status, code, extra = {}) => ({ ok: false, status, code, ...extra });

/**
 * Execute one plan, after proving reality has not moved.
 *
 * Guard order matters and is deliberate:
 *   1. confirmIrreversible for statically-irreversible actions — refuses before
 *      a single Graph call is made, so an unconfirmed delete costs nothing.
 *   2. re-observe + re-plan — the plan's own refusals (justification gone,
 *      series-master target) are re-derived, not replayed from the client.
 *   3. fingerprint comparison — anything that moved aborts here, still with
 *      zero writes performed.
 *   4. duplicate guard.
 *   5. only now, writes.
 *
 * @returns {Promise<object>} {ok, status?, code?, results?, ...}
 */
async function applyReconcile(params) {
  const {
    eventsCollection, graphApi, auditService, broadcast,
    findingType, action, calendarOwner, target = {},
    expectedState, allowDuplicate, confirmIrreversible,
    actor = {}, now = new Date(),
  } = params;

  // (1) Cheapest guard first. deleteOutlook is irreversible by construction, so
  // this is decidable without observing anything.
  if (action === ACTION.DELETE_OUTLOOK && confirmIrreversible !== true) {
    return deny(400, 'CONFIRMATION_REQUIRED', {
      reason: 'This permanently deletes an Outlook entry. Re-send with confirmIrreversible: true.',
    });
  }

  // (2) Fresh observation and a freshly-derived plan.
  const observation = await observe(params);
  const plan = buildPlan(findingType, action, observation);
  if (plan.abort) {
    return deny(409, plan.code, { reason: plan.reason, observed: publicObservation(observation) });
  }

  // (3) Did anything move since the plan was issued?
  const observedState = fingerprintOf(observation, now);
  const drifts = verifyExpectedState(expectedState, observedState, now);
  if (drifts.length > 0) {
    return deny(409, 'STALE_FINDING', {
      reason: 'This finding changed since the report ran.',
      drifts,
      observed: publicObservation(observation),
      observedState,
    });
  }

  // (4) Backstop for (1), plus any future irreversible op.
  if (isIrreversible(plan) && confirmIrreversible !== true) {
    return deny(400, 'CONFIRMATION_REQUIRED', {
      reason: 'This plan contains an irreversible step. Re-send with confirmIrreversible: true.',
    });
  }
  if (plan.requiresAllowDuplicate && allowDuplicate !== true) {
    return deny(422, 'DUPLICATE_CANDIDATE', {
      reason: 'Outlook already has a matching entry on this date. Link to it, or re-send with allowDuplicate: true.',
      candidates: plan.candidates,
    });
  }

  // (5) Writes.
  const context = {
    eventsCollection, graphApi, observation, plan, calendarOwner, actor, now, broadcast,
  };
  let outcome;
  try {
    outcome = await executeOps(context);
  } catch (err) {
    // OCC loss inside a Mongo write. conditionalUpdate throws ApiError(409).
    if (statusOf(err) === 409) {
      return deny(409, 'VERSION_CONFLICT', { reason: err.message });
    }
    throw err;
  }

  if (!outcome.ok) return outcome;

  await writeAudit({
    auditService, observation, plan, findingType, action, calendarOwner, actor,
    expectedState: observedState, results: outcome.results,
  });

  return { ok: true, results: outcome.results, observed: publicObservation(observation) };
}

/**
 * The parts of an observation that are safe and useful to return to a client.
 * Drops rawDoc and the full pre-delete Graph snapshot (audit-only).
 * @private
 */
function publicObservation(observation) {
  const probe = observation.outlookProbe;
  return {
    findingType: observation.findingType,
    calendarOwner: observation.calendarOwner,
    doc: observation.doc,
    justification: observation.justification,
    outlookProbe: probe ? { ...probe, snapshot: undefined } : null,
    candidates: observation.candidates,
    // What Outlook shows on the event's date — the admin's own evidence that
    // the event is (or is not) really missing. Capped: a busy day at this
    // temple runs to dozens of entries and the panel only needs enough to
    // recognise the absence.
    dayEvents: (observation.dayEvents || []).slice(0, MAX_DAY_EVENTS_RETURNED),
    dayEventsTotal: (observation.dayEvents || []).length,
    untrackedThatDayCount: (observation.untrackedThatDay || []).length,
    observedAt: observation.observedAt,
  };
}

/**
 * Run the plan's ops in order.
 * @private
 */
async function executeOps(context) {
  const { plan } = context;
  const results = [];

  for (const op of plan.ops) {
    switch (op.op) {
      case 'graphDelete': {
        results.push(await runGraphDelete(context, op));
        break;
      }
      case 'mongoArchive': {
        results.push(await runArchive(context, op));
        break;
      }
      case 'mongoLink': {
        // The publish path emits graphCreate + mongoLink, and republishEventCore
        // performs BOTH as one create-then-link unit (that ordering is the
        // whole point of sharing it). The create step already recorded the link.
        if (results.some((r) => r.op === 'graphCreate')) break;
        results.push(await runLink(context, op));
        break;
      }
      case 'graphCreate': {
        const created = await runPublish(context, op);
        if (created.conflict) return created.conflict;
        results.push(created.result);
        break;
      }
      default:
        throw new Error(`Unknown reconcile op: ${op.op}`);
    }
  }

  return { ok: true, results };
}

/** @private */
async function runGraphDelete(context, op) {
  const { graphApi, calendarOwner } = context;
  try {
    await withGraphRetry(() => graphApi.deleteCalendarEvent(calendarOwner, null, op.graphId));
    return { op: op.op, status: 'done', graphId: op.graphId };
  } catch (err) {
    // Idempotent re-run: someone (or a previous apply) already removed it.
    if (isNotFound(err)) {
      return { op: op.op, status: 'alreadyGone', graphId: op.graphId };
    }
    throw err;
  }
}

/** @private */
async function runArchive(context, op) {
  const { eventsCollection, observation, actor, now, broadcast } = context;
  const doc = observation.rawDoc;

  await conditionalUpdate(
    eventsCollection,
    { _id: new ObjectId(op.mongoId) },
    {
      $set: {
        status: 'deleted',
        isDeleted: true,
        deletedAt: now,
        deletedBy: actor.userId,
        deletedByEmail: actor.email,
        previousStatus: doc.status,
      },
      $push: {
        statusHistory: buildStatusHistoryEntry('deleted', actor.userId, actor.email, ARCHIVE_REASON),
      },
    },
    { expectedVersion: observation.doc._version, modifiedBy: actor.email }
  );

  emit(broadcast, {
    eventId: op.mongoId, action: 'archived', actorEmail: actor.email,
    oldStatus: doc.status, newStatus: 'deleted',
  });

  return { op: op.op, status: 'done', mongoId: op.mongoId };
}

/** @private */
async function runLink(context, op) {
  const { eventsCollection, observation, actor, broadcast } = context;
  const doc = observation.rawDoc;
  const graphId = op.graphId || observation.linkTargetGraphId;

  // Full-object $set, not a dotted path — graphData can be null on child docs,
  // and Cosmos fails dotted-path writes through a null parent.
  const newGraphData = {
    ...(doc.graphData && typeof doc.graphData === 'object' ? doc.graphData : {}),
    id: graphId,
  };

  await conditionalUpdate(
    eventsCollection,
    { _id: new ObjectId(op.mongoId) },
    {
      $set: { graphData: newGraphData },
      $push: {
        statusHistory: buildStatusHistoryEntry(
          doc.status, actor.userId, actor.email,
          `Linked to existing Outlook event via sync-health reconcile (${graphId})`
        ),
      },
    },
    { expectedVersion: observation.doc._version, modifiedBy: actor.email }
  );

  emit(broadcast, {
    eventId: op.mongoId, action: 'linked', actorEmail: actor.email,
    oldStatus: doc.status, newStatus: doc.status,
  });

  return { op: op.op, status: 'done', mongoId: op.mongoId, graphId };
}

/** @private */
async function runPublish(context, op) {
  const { eventsCollection, graphApi, observation, actor, calendarOwner, broadcast } = context;
  const doc = observation.rawDoc;

  const result = await republishEventCore({
    eventsCollection,
    graphApi,
    event: doc,
    expectedVersion: observation.doc._version,
    userId: actor.userId,
    userEmail: actor.email,
    statusReason: 'Published to Outlook via sync-health reconcile',
  });

  if (!result.ok) {
    // The Graph event exists but is unlinked. Compensate immediately — this is
    // the publish endpoint's orphan case, except here we can clean it up
    // because we created it moments ago and nothing else can be pointing at it.
    const orphanId = result.createdEvent.id;
    let compensated = false;
    try {
      await withGraphRetry(() => graphApi.deleteCalendarEvent(calendarOwner, null, orphanId));
      compensated = true;
    } catch (cleanupErr) {
      logger.error('Reconcile publish: failed to delete orphan Graph event — manual cleanup required', {
        mongoId: op.mongoId, orphanedGraphId: orphanId, error: cleanupErr.message,
      });
    }
    return {
      conflict: deny(409, 'VERSION_CONFLICT', {
        reason: compensated
          ? 'The record changed while the Outlook event was being created. The new Outlook event was removed again; nothing was linked.'
          : 'The record changed while the Outlook event was being created, and the new Outlook event could not be removed. Delete it in Outlook and retry.',
        orphanedGraphId: orphanId,
        orphanCompensated: compensated,
      }),
    };
  }

  emit(broadcast, {
    eventId: op.mongoId, action: 'republished', actorEmail: actor.email,
    oldStatus: doc.status, newStatus: doc.status,
  });

  return {
    result: {
      op: op.op, status: 'done', mongoId: op.mongoId,
      graphId: result.createdEvent.id, webLink: result.createdEvent.webLink,
    },
  };
}

/** SSE is best-effort; a broadcast failure must not fail a completed write. @private */
function emit(broadcast, payload) {
  if (typeof broadcast !== 'function') return;
  try {
    broadcast(payload);
  } catch (err) {
    logger.warn('[syncReconcile] SSE broadcast failed: %s', err.message);
  }
}

/**
 * One audit entry per apply.
 *
 * For a Graph delete this is not bookkeeping — the pre-delete snapshot stored
 * here is the only record that the Outlook event ever existed.
 * @private
 */
async function writeAudit({
  auditService, observation, plan, findingType, action, calendarOwner, actor, expectedState, results,
}) {
  if (!auditService?.recordEvent) return;

  const graphIdsCreated = results.filter(r => r.op === 'graphCreate' && r.graphId).map(r => r.graphId);
  const graphIdsDeleted = results.filter(r => r.op === 'graphDelete' && r.status === 'done').map(r => r.graphId);

  await auditService.recordEvent({
    eventId: observation.doc?.mongoId || observation.justification?.mongoId || observation.target?.graphId || null,
    userId: actor.userId,
    changeType: 'update',
    source: AUDIT_SOURCE,
    metadata: {
      findingType,
      action,
      calendarOwner,
      actorEmail: actor.email,
      reason: plan.ops.map(o => o.description).join(' '),
      graphIdsCreated,
      graphIdsDeleted,
      expectedState,
      results,
      // Irreversible ops only: the full Graph event as it was immediately
      // before deletion.
      preDeleteSnapshot: graphIdsDeleted.length > 0 ? observation.outlookProbe?.snapshot || null : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Batch link
// ---------------------------------------------------------------------------

// Cosmos pacing, per the migration conventions: 25 writes then breathe.
const BATCH_CHUNK = 25;
const BATCH_PAUSE_MS = 1000;
// A guard against someone posting the whole collection at a planner that makes
// a Graph call per distinct date.
const MAX_BATCH_ROWS = 200;

/**
 * Plan a link-to-existing across many untethered documents at once.
 *
 * Link is the ONLY action offered in bulk. It writes Mongo only, is reversible
 * by unsetting the id, and creates nothing — so a wrong row is recoverable.
 * Bulk publish would mint duplicate Outlook events and bulk delete cannot be
 * undone at all; neither is offered here at any tier.
 *
 * Graph is probed once per DISTINCT DATE, not once per document. The live
 * backlog is 46 records that share far fewer dates, and a probe per record
 * would be both slow and rude to the Graph throttle.
 *
 * Every row carries its own `expectedState`, so apply verifies each one
 * independently — a row that moved since planning aborts alone instead of
 * poisoning the batch.
 *
 * @returns {Promise<{ok: boolean, rows: Array<object>, summary: object}>}
 */
async function planBatchLink({
  eventsCollection, graphApi, calendarOwner, mongoIds = [], now = new Date(),
}) {
  const ids = mongoIds.filter((id) => ObjectId.isValid(id)).slice(0, MAX_BATCH_ROWS);
  if (ids.length === 0) return { ok: true, rows: [], summary: emptyBatchSummary() };

  const docs = await eventsCollection
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .toArray();

  const untrackedByDate = new Map();
  const rows = [];

  for (const raw of docs) {
    const doc = describeDoc(raw);

    // Skip anything that is no longer the problem being fixed. Cheap, and it
    // keeps the review table honest when the report on screen is a few minutes
    // old.
    if (doc.graphDataId) {
      rows.push(batchRow(doc, MATCH_TIER.NONE, null, 'Already linked to an Outlook event.', null));
      continue;
    }
    if (doc.isDeleted || doc.status !== 'published') {
      rows.push(batchRow(doc, MATCH_TIER.NONE, null, `No longer published (${doc.status}).`, null));
      continue;
    }
    if (!doc.date) {
      rows.push(batchRow(doc, MATCH_TIER.NONE, null, 'No readable date, so nothing can be matched.', null));
      continue;
    }

    if (!untrackedByDate.has(doc.date)) {
      const dayEvents = await listOutlookDay(graphApi, calendarOwner, doc.date);
      untrackedByDate.set(doc.date, await filterUntracked(eventsCollection, dayEvents));
    }

    const candidates = findDuplicateCandidates(doc, untrackedByDate.get(doc.date));
    const { tier, candidate, reason } = classifyLinkMatch(doc, candidates);

    // The fingerprint is built from an observation shaped exactly like the one
    // apply will re-derive, so the two are comparable.
    const expectedState = fingerprintOf(
      { findingType: FINDING_TYPE.UNTETHERED, calendarOwner, doc, justification: null, outlookProbe: null },
      now
    );

    rows.push(batchRow(doc, tier, candidate, reason, expectedState, candidates));
  }

  return { ok: true, rows, summary: summarizeBatch(rows) };
}

/** @private */
function batchRow(doc, tier, candidate, reason, expectedState, candidates = []) {
  return {
    mongoId: doc.mongoId,
    eventTitle: doc.eventTitle,
    date: doc.date,
    startTime: doc.startTime,
    endTime: doc.endTime,
    location: Array.isArray(doc.locationDisplayNames)
      ? doc.locationDisplayNames.join('; ')
      : doc.locationDisplayNames || '',
    createdAt: doc.createdAt,
    tier,
    reason,
    candidate,
    candidates,
    expectedState,
    // Only confident rows arrive pre-selected. Everything else needs a human to
    // agree with it first.
    selectedByDefault: tier === MATCH_TIER.CONFIDENT,
  };
}

const emptyBatchSummary = () => ({ total: 0, confident: 0, ambiguous: 0, none: 0 });

/** @private */
function summarizeBatch(rows) {
  return rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.tier] += 1;
    return acc;
  }, emptyBatchSummary());
}

/**
 * Apply a reviewed batch of links.
 *
 * Each selection is executed through the ordinary single-finding
 * applyReconcile, so every row inherits the full guard chain: fresh
 * observation, fingerprint comparison, candidate membership check, OCC write,
 * audit entry and SSE broadcast. A batch is a loop over the safe path, never a
 * faster parallel one.
 *
 * Failures are isolated and reported per row — one stale record does not stop
 * the other forty.
 *
 * @returns {Promise<{ok: boolean, results: Array<object>, summary: object}>}
 */
async function applyBatchLink({
  eventsCollection, graphApi, auditService, broadcast,
  calendarOwner, selections = [], actor, now = new Date(),
}) {
  const results = [];
  const chosen = selections.slice(0, MAX_BATCH_ROWS);

  for (let i = 0; i < chosen.length; i += 1) {
    const { mongoId, graphId, expectedState } = chosen[i] || {};
    try {
      const outcome = await applyReconcile({
        eventsCollection, graphApi, auditService, broadcast,
        findingType: FINDING_TYPE.UNTETHERED,
        action: ACTION.LINK_EXISTING,
        calendarOwner,
        target: { mongoId },
        linkTargetGraphId: graphId,
        expectedState,
        actor,
        now,
      });

      results.push(outcome.ok
        ? { mongoId, graphId, status: 'done' }
        : { mongoId, graphId, status: 'skipped', code: outcome.code, reason: outcome.reason });
    } catch (err) {
      logger.error('[syncReconcile] batch link row failed', { mongoId, error: err.message });
      results.push({ mongoId, graphId, status: 'failed', reason: err.message });
    }

    // Cosmos pacing between chunks — the same discipline the migration scripts
    // use, since this is the same shape of workload.
    if ((i + 1) % BATCH_CHUNK === 0 && i + 1 < chosen.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  return {
    ok: true,
    results,
    summary: {
      total: results.length,
      done: results.filter((r) => r.status === 'done').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    },
  };
}

module.exports = {
  AUDIT_SOURCE,
  MAX_BATCH_ROWS,
  observe,
  planReconcile,
  applyReconcile,
  planBatchLink,
  applyBatchLink,
};

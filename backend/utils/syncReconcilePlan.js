// backend/utils/syncReconcilePlan.js
//
// Pure decision layer for Sync Health reconcile. NO I/O — no Mongo, no Graph,
// no ambient clock (callers pass `now`). Sibling of syncHealthDiff.js: the
// service decides WHAT to observe, this file decides what may be done about it.
//
// Three responsibilities:
//   fingerprintOf(observation)              — the facts a plan depends on
//   verifyExpectedState(expected, observed) — what moved since planning
//   buildPlan(findingType, action, observation) — ordered ops, or a refusal
//
// The design constraint that shapes all of it: an Outlook delete cannot be
// undone. So a plan is never trusted across time. `plan` fingerprints reality,
// `apply` re-observes and re-compares, and any drift aborts BEFORE the first
// write. The fingerprint deliberately includes the app-side JUSTIFICATION for a
// delete (the exclusion is still recorded / the document is still deleted), not
// merely that the Outlook item still exists — otherwise un-deleting a document
// between plan and apply would still let the Outlook entry be destroyed.

const { buildGraphSubject } = require('./graphEventBuilder');

// A plan is a description of reality at a moment. Ten minutes is long enough
// for an admin to read it and short enough that they re-read a stale one.
const PLAN_TTL_MS = 10 * 60 * 1000;

const FINDING_TYPE = {
  SHOULD_NOT_BE_IN_OUTLOOK: 'shouldNotBeInOutlook',
  UNTETHERED: 'untethered',
};

const ACTION = {
  DELETE_OUTLOOK: 'deleteOutlook',
  LINK_EXISTING: 'linkExisting',
  ARCHIVE: 'archive',
  PUBLISH: 'publish',
};

// Which actions each finding type offers. The UI reads this so the panel and
// the server cannot disagree about what is available.
const ACTIONS_BY_FINDING = Object.freeze({
  [FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK]: [ACTION.DELETE_OUTLOOK],
  [FINDING_TYPE.UNTETHERED]: [ACTION.LINK_EXISTING, ACTION.ARCHIVE, ACTION.PUBLISH],
});

const ARCHIVE_REASON = 'Archived via sync-health reconcile';

// ---------------------------------------------------------------------------
// Subject normalization / duplicate candidates
// ---------------------------------------------------------------------------

/**
 * Reduce a subject to something two spellings of the same event share.
 *
 * The `[Hold]` prefix is the reason this exists: buildGraphSubject adds it to
 * every title that has no times, and the entire legacy untethered population is
 * exactly those "Hold"/"Do not book" records. A candidate that Outlook shows as
 * '[Hold] WISE HALL CLOSED' and a document whose would-be subject is the same
 * string must compare equal even if only one side carries the prefix.
 *
 * @param {string} subject
 * @returns {string} lower-cased, prefix-stripped, whitespace-collapsed
 */
function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^\s*\[hold\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The subject this document WOULD get if published now.
 * @param {object} doc - observation.doc
 * @returns {string}
 */
function wouldBeSubject(doc) {
  return buildGraphSubject(doc?.eventTitle, doc?.startTime, doc?.endTime);
}

/**
 * Untracked Outlook entries that look like this document already published.
 *
 * Matching is subject + date, deliberately NOT subject + date + start time:
 * the duplicates this has to find are legacy entries created by hand or by an
 * interrupted publish, whose times routinely differ. Looser matching finds them;
 * the admin then picks from the listed candidates, so nothing is auto-linked.
 *
 * @param {object} doc - observation.doc (needs eventTitle, startTime, endTime, date)
 * @param {Array<object>} untracked - [{ graphId, subject, date }]
 * @returns {Array<object>} matching entries, in input order
 */
function findDuplicateCandidates(doc, untracked = []) {
  if (!doc || !doc.date) return [];
  const wanted = normalizeSubject(wouldBeSubject(doc));
  if (!wanted) return [];

  return (untracked || []).filter(
    (entry) => entry && entry.date === doc.date && normalizeSubject(entry.subject) === wanted
  );
}

// ---------------------------------------------------------------------------
// Batch link classification
// ---------------------------------------------------------------------------

const MATCH_TIER = {
  CONFIDENT: 'confident',
  AMBIGUOUS: 'ambiguous',
  NONE: 'none',
};

/**
 * How safe is it to link this document to a probed candidate without a human
 * looking at it?
 *
 * Subject + date is a good FILTER but a poor IDENTITY — the live data contains
 * two separate app records both titled 'Hold Streicker', and a placeholder name
 * like 'Do not book!' can repeat on the same day. Linking the wrong pair is
 * quiet: nothing errors, the record simply points at someone else's event and
 * every future edit lands on it.
 *
 * Start time is what turns the filter into an identity. Both sides are local
 * wall clock by the time they reach here (the app stores local, and Graph's UTC
 * instant is converted with toEasternTimeKey), so they are directly comparable.
 * Only an exact subject + date + start-time agreement with exactly ONE
 * candidate is auto-selectable; everything else is shown to a human with the
 * reason it was held back.
 *
 * @param {object} doc - observation.doc (needs date, startTime, eventTitle)
 * @param {Array<object>} candidates - from findDuplicateCandidates
 * @returns {{tier: string, candidate: object|null, reason: string}}
 */
function classifyLinkMatch(doc, candidates = []) {
  if (!candidates || candidates.length === 0) {
    return { tier: MATCH_TIER.NONE, candidate: null, reason: 'Outlook has nothing with this name on this date.' };
  }

  if (candidates.length > 1) {
    return {
      tier: MATCH_TIER.AMBIGUOUS,
      candidate: null,
      reason: `Outlook has ${candidates.length} entries with this name on this date — pick the right one yourself.`,
    };
  }

  const [candidate] = candidates;

  if (!doc.startTime) {
    return {
      tier: MATCH_TIER.AMBIGUOUS,
      candidate,
      reason: 'This record has no start time, so the match rests on name and date alone.',
    };
  }
  if (!candidate.startTime) {
    return {
      tier: MATCH_TIER.AMBIGUOUS,
      candidate,
      reason: 'The Outlook entry has no readable start time, so the match rests on name and date alone.',
    };
  }
  if (candidate.startTime !== doc.startTime) {
    return {
      tier: MATCH_TIER.AMBIGUOUS,
      candidate,
      reason: `Times differ — this record says ${doc.startTime}, Outlook says ${candidate.startTime}.`,
    };
  }

  return {
    tier: MATCH_TIER.CONFIDENT,
    candidate,
    reason: `Name, date and start time all agree (${doc.date} ${doc.startTime}).`,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * The exact set of observed facts a plan depends on.
 *
 * Everything here is re-observed at apply time and compared. Anything NOT here
 * is free to change without invalidating the plan — which is why duplicate
 * candidates are excluded: an unrelated Outlook event appearing on the same day
 * must not invalidate an archive, and the duplicate guard is enforced
 * separately at apply (422 DUPLICATE_CANDIDATE) rather than as staleness.
 *
 * @param {object} observation
 * @param {Date} [now] - injectable clock
 * @returns {object} fingerprint, safe to round-trip through JSON
 */
function fingerprintOf(observation, now = new Date()) {
  const { findingType, calendarOwner, doc, justification, outlookProbe } = observation || {};

  return {
    findingType: findingType || null,
    calendarOwner: calendarOwner || null,
    doc: doc
      ? {
        mongoId: doc.mongoId,
        version: doc._version ?? null,
        status: doc.status ?? null,
        isDeleted: doc.isDeleted === true,
        eventType: doc.eventType ?? null,
        graphDataId: doc.graphDataId ?? null,
        graphEventId: doc.graphEventId ?? null,
      }
      : null,
    justification: justification
      ? {
        kind: justification.kind ?? null,
        mongoId: justification.mongoId ?? null,
        version: justification._version ?? null,
        isDeleted: justification.isDeleted === true,
        exclusionDate: justification.exclusionDate ?? null,
        exclusionDatePresent: justification.exclusionDatePresent === true,
      }
      : null,
    outlook: outlookProbe
      ? {
        found: outlookProbe.found === true,
        graphId: outlookProbe.graphId ?? null,
        subject: outlookProbe.subject ?? null,
        type: outlookProbe.type ?? null,
        seriesMasterId: outlookProbe.seriesMasterId ?? null,
      }
      : null,
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
  };
}

/** Record one drift so the client can say precisely what moved. */
const drift = (field, expected, observed, message) => ({ field, expected, observed, message });

/**
 * Compare the fingerprint the client sent back against reality right now.
 *
 * Returns a LIST, not a boolean, so the 409 can tell an admin what changed
 * rather than just refusing. An empty list means it is safe to write.
 *
 * @param {object} expected - the fingerprint returned by plan
 * @param {object} observed - fingerprintOf(a fresh observation)
 * @param {Date} [now] - injectable clock
 * @returns {Array<object>} drifts
 */
function verifyExpectedState(expected, observed, now = new Date()) {
  const drifts = [];

  if (!expected || typeof expected !== 'object') {
    return [drift('expectedState', 'an object', typeof expected, 'No expectedState was supplied.')];
  }

  // Expiry first: an expired plan is stale by definition, whether or not
  // anything moved. Soft TTL — the client just re-plans.
  if (expected.expiresAt && new Date(expected.expiresAt).getTime() <= now.getTime()) {
    drifts.push(drift('expiresAt', expected.expiresAt, now.toISOString(),
      'This plan has expired. Run the check again to see current state.'));
  }

  if (expected.findingType !== observed.findingType) {
    drifts.push(drift('findingType', expected.findingType, observed.findingType,
      'The finding type no longer matches.'));
  }

  // --- the app-side document ---
  const e = expected.doc;
  const o = observed.doc;
  if (e && !o) {
    drifts.push(drift('doc', e.mongoId, null, 'The app record no longer exists.'));
  } else if (e && o) {
    if (e.version !== o.version) {
      drifts.push(drift('doc.version', e.version, o.version,
        'The app record was edited after this plan was made.'));
    }
    if (e.status !== o.status) {
      drifts.push(drift('doc.status', e.status, o.status, 'The record status changed.'));
    }
    if (e.isDeleted !== o.isDeleted) {
      drifts.push(drift('doc.isDeleted', e.isDeleted, o.isDeleted,
        o.isDeleted ? 'The record was deleted.' : 'The record was restored.'));
    }
    // A link appearing means someone published or linked it meanwhile — the
    // single most important untethered drift.
    if (e.graphDataId !== o.graphDataId) {
      drifts.push(drift('doc.graphDataId', e.graphDataId, o.graphDataId,
        o.graphDataId ? 'The record is now linked to an Outlook event.' : 'The Outlook link was removed.'));
    }
    if (e.graphEventId !== o.graphEventId) {
      drifts.push(drift('doc.graphEventId', e.graphEventId, o.graphEventId,
        'The record\'s Outlook link changed.'));
    }
    if (e.eventType !== o.eventType) {
      drifts.push(drift('doc.eventType', e.eventType, o.eventType, 'The record type changed.'));
    }
  }

  // --- why a delete is justified ---
  const ej = expected.justification;
  const oj = observed.justification;
  if (ej && !oj) {
    drifts.push(drift('justification', ej.kind, null,
      'The reason this Outlook entry should be removed no longer holds.'));
  } else if (ej && oj) {
    if (ej.kind !== oj.kind) {
      drifts.push(drift('justification.kind', ej.kind, oj.kind,
        'The reason this Outlook entry should be removed changed.'));
    }
    if (ej.version !== oj.version) {
      drifts.push(drift('justification.version', ej.version, oj.version,
        'The record justifying this removal was edited.'));
    }
    if (ej.isDeleted !== oj.isDeleted) {
      drifts.push(drift('justification.isDeleted', ej.isDeleted, oj.isDeleted,
        'The record justifying this removal was restored in the app.'));
    }
    if (ej.exclusionDatePresent !== oj.exclusionDatePresent) {
      drifts.push(drift('justification.exclusionDatePresent',
        ej.exclusionDatePresent, oj.exclusionDatePresent,
        'The excluded date is no longer excluded in the app.'));
    }
  }

  // --- the Outlook item itself ---
  const eo = expected.outlook;
  const oo = observed.outlook;
  if (eo && !oo) {
    drifts.push(drift('outlook', eo.graphId, null, 'The Outlook entry could not be re-checked.'));
  } else if (eo && oo) {
    if (eo.found !== oo.found) {
      drifts.push(drift('outlook.found', eo.found, oo.found,
        oo.found ? 'The Outlook entry reappeared.' : 'The Outlook entry is already gone.'));
    }
    if (eo.graphId !== oo.graphId) {
      drifts.push(drift('outlook.graphId', eo.graphId, oo.graphId, 'The Outlook entry id changed.'));
    }
    if (eo.subject !== oo.subject) {
      drifts.push(drift('outlook.subject', eo.subject, oo.subject,
        'The Outlook entry was renamed — check it is still the one you meant.'));
    }
    // Deleting a series master destroys every occurrence, so a type change to
    // seriesMaster is fatal even though the id is unchanged.
    if (eo.type !== oo.type) {
      drifts.push(drift('outlook.type', eo.type, oo.type,
        oo.type === 'seriesMaster'
          ? 'That id now resolves to a whole recurring series, not one occurrence.'
          : 'The Outlook entry type changed.'));
    }
    if (eo.seriesMasterId !== oo.seriesMasterId) {
      drifts.push(drift('outlook.seriesMasterId', eo.seriesMasterId, oo.seriesMasterId,
        'The Outlook entry now belongs to a different series.'));
    }
  }

  return drifts;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

const refuse = (code, reason) => ({ abort: true, code, reason, ops: [], warnings: [] });

/**
 * shouldNotBeInOutlook → delete the surviving Outlook entry.
 * @private
 */
function planDelete(observation) {
  const { justification, outlookProbe } = observation;

  // Re-derived justification, not the report's word for it. The Outlook item
  // existing is NOT a reason to delete it.
  if (!justification || !justification.kind) {
    return refuse('NO_JUSTIFICATION',
      'The app no longer shows a reason to remove this Outlook entry. Run the check again.');
  }
  if (justification.kind === 'deletedDoc' && justification.isDeleted !== true) {
    return refuse('NO_JUSTIFICATION',
      'The app record was restored, so its Outlook entry should stay.');
  }
  if (justification.kind === 'exclusion' && justification.exclusionDatePresent !== true) {
    return refuse('NO_JUSTIFICATION',
      'That date is no longer excluded in the app, so its Outlook entry should stay.');
  }

  if (!outlookProbe || outlookProbe.found !== true) {
    return refuse('ALREADY_RESOLVED', 'That Outlook entry is already gone. Nothing to do.');
  }
  // The diff only ever emits calendarView instance ids, but an id that resolves
  // to a master would take the entire series with it.
  if (outlookProbe.type === 'seriesMaster') {
    return refuse('SERIES_MASTER_TARGET',
      'That id is a whole recurring series, not a single occurrence. Deleting it would remove every date.');
  }

  const where = outlookProbe.date ? ` on ${outlookProbe.date}` : '';
  const warnings = [];
  if (outlookProbe.attendeeCount > 0) {
    warnings.push(
      `This Outlook entry has ${outlookProbe.attendeeCount} attendee(s). Deleting it sends them a cancellation.`
    );
  }

  return {
    abort: false,
    ops: [{
      op: 'graphDelete',
      graphId: outlookProbe.graphId,
      direction: 'Removes it from Outlook',
      irreversible: true,
      description: `Permanently delete the Outlook entry "${outlookProbe.subject || '(no subject)'}"${where}.`,
    }],
    warnings,
  };
}

/**
 * untethered → archive in the app (soft delete via the existing restore-able flow).
 * @private
 */
function planArchive(observation) {
  const { doc } = observation;
  if (!doc) return refuse('NOT_FOUND', 'That app record no longer exists.');
  if (doc.isDeleted === true) {
    return refuse('ALREADY_RESOLVED', 'That record is already archived.');
  }

  return {
    abort: false,
    ops: [{
      op: 'mongoArchive',
      mongoId: doc.mongoId,
      reason: ARCHIVE_REASON,
      direction: 'Changes only this app\'s record',
      irreversible: false,
      description: `Archive "${doc.eventTitle || '(no title)'}" in the app. Nothing is created or deleted in Outlook, and it can be restored.`,
    }],
    warnings: [],
  };
}

/**
 * untethered → adopt an existing Outlook event as this record's link.
 * @private
 */
function planLink(observation) {
  const { doc, linkTargetGraphId, candidates = [] } = observation;
  if (!doc) return refuse('NOT_FOUND', 'That app record no longer exists.');
  if (!linkTargetGraphId) {
    return refuse('NO_LINK_TARGET', 'Choose which Outlook event this record should point at.');
  }
  if (doc.graphDataId === linkTargetGraphId) {
    return refuse('ALREADY_RESOLVED', 'That record is already linked to this Outlook event.');
  }
  if (doc.graphDataId) {
    return refuse('ALREADY_LINKED',
      'That record is already linked to a different Outlook event. Run the check again.');
  }
  // Only ever link to something the probe actually surfaced, so a stale or
  // hand-typed id cannot be adopted.
  const chosen = candidates.find((c) => c.graphId === linkTargetGraphId);
  if (!chosen) {
    return refuse('UNKNOWN_CANDIDATE',
      'That Outlook event is not one of the matches found for this record. Run the check again.');
  }

  return {
    abort: false,
    ops: [{
      op: 'mongoLink',
      mongoId: doc.mongoId,
      graphId: chosen.graphId,
      direction: 'Changes only this app\'s record',
      irreversible: false,
      description: `Point "${doc.eventTitle || '(no title)'}" at the existing Outlook entry "${chosen.subject}"${chosen.date ? ` on ${chosen.date}` : ''}. Nothing is created or changed in Outlook.`,
    }],
    warnings: [],
  };
}

/**
 * untethered → create the Outlook event now.
 * @private
 */
function planPublish(observation) {
  const { doc, candidates = [] } = observation;
  if (!doc) return refuse('NOT_FOUND', 'That app record no longer exists.');
  if (doc.graphDataId) {
    return refuse('ALREADY_RESOLVED', 'That record is already linked to an Outlook event.');
  }
  // v1 refuses series: creating a master without also syncing its exclusions and
  // child documents would immediately manufacture new "still in Outlook"
  // findings for every excluded date.
  if (doc.eventType === 'seriesMaster') {
    return refuse('SERIES_NOT_SUPPORTED',
      'Publishing a recurring series from here is not supported yet — its excluded dates and modified occurrences would not be carried over. Use archive or link instead.');
  }
  if (doc.status !== 'published') {
    return refuse('NOT_PUBLISHED',
      `Only published records can be pushed to Outlook (this one is "${doc.status}").`);
  }
  // A calendar event with no date is not a thing Outlook can hold.
  // buildGraphEventDataFromRecord would emit `start: { dateTime: undefined }`
  // and Graph would reject it — refuse here instead, where the reason can be
  // explained. Such a record cannot be published at all; archiving is the only
  // sensible action for it.
  if (!doc.date) {
    return refuse('NO_DATE',
      'This record has no readable date, so there is nothing to put on the calendar. Archiving it is the only sensible action — investigate the record before restoring it.');
  }

  const warnings = [];
  if (candidates.length > 0) {
    warnings.push(
      `Outlook already has ${candidates.length} entry(ies) with this name on this date. Linking to one is usually right; creating another will duplicate it.`
    );
  }

  return {
    abort: false,
    // Recommend the safer action when Outlook already looks like it has this.
    recommendation: candidates.length > 0 ? ACTION.LINK_EXISTING : ACTION.PUBLISH,
    requiresAllowDuplicate: candidates.length > 0,
    candidates,
    ops: [{
      op: 'graphCreate',
      mongoId: doc.mongoId,
      subject: wouldBeSubject(doc),
      direction: 'Creates 1 Outlook event',
      irreversible: false,
      description: `Create the Outlook event "${wouldBeSubject(doc)}"${doc.date ? ` on ${doc.date}` : ''}.`,
    }, {
      op: 'mongoLink',
      mongoId: doc.mongoId,
      direction: 'Changes only this app\'s record',
      irreversible: false,
      description: 'Store the new Outlook event\'s id on the app record so future edits reach it.',
    }],
    warnings,
  };
}

const PLANNERS = {
  [FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK]: { [ACTION.DELETE_OUTLOOK]: planDelete },
  [FINDING_TYPE.UNTETHERED]: {
    [ACTION.ARCHIVE]: planArchive,
    [ACTION.LINK_EXISTING]: planLink,
    [ACTION.PUBLISH]: planPublish,
  },
};

/**
 * Build the ordered op list for one finding + action, or refuse.
 *
 * Op order matters and mirrors the publish endpoint: Graph create BEFORE the
 * Mongo link persist, so a crash leaves an orphan Outlook event (recoverable,
 * and its id is recorded) rather than a document pointing at nothing.
 *
 * @param {string} findingType
 * @param {string} action
 * @param {object} observation
 * @returns {{abort: boolean, code?: string, reason?: string, ops: Array<object>,
 *            warnings: Array<string>, recommendation?: string,
 *            requiresAllowDuplicate?: boolean, candidates?: Array<object>}}
 */
function buildPlan(findingType, action, observation) {
  const byAction = PLANNERS[findingType];
  if (!byAction) {
    return refuse('UNKNOWN_FINDING_TYPE', `No reconcile actions exist for "${findingType}".`);
  }
  const planner = byAction[action];
  if (!planner) {
    return refuse('UNKNOWN_ACTION',
      `"${action}" is not available for ${findingType}. Available: ${ACTIONS_BY_FINDING[findingType].join(', ')}.`);
  }
  return planner(observation || {});
}

/** Does this plan contain anything that cannot be undone? */
const isIrreversible = (plan) => (plan?.ops || []).some((op) => op.irreversible === true);

module.exports = {
  PLAN_TTL_MS,
  FINDING_TYPE,
  ACTION,
  MATCH_TIER,
  classifyLinkMatch,
  ACTIONS_BY_FINDING,
  ARCHIVE_REASON,
  normalizeSubject,
  wouldBeSubject,
  findDuplicateCandidates,
  fingerprintOf,
  verifyExpectedState,
  buildPlan,
  isIrreversible,
};

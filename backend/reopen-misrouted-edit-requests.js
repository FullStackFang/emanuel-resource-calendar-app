/**
 * Re-open edit requests whose approval landed on a sandbox duplicate.
 *
 * Background (2026-10-13): the Resource Scheduler import left two documents
 * per imported event sharing one eventId — a sandbox copy (no Outlook link)
 * and the production copy. Edit requests were anchored to the sandbox copy
 * and their approvals were applied there (or refused by the version check),
 * so Outlook never changed. The endpoints now resolve by eventObjectId.
 *
 * This script repairs the EXISTING records by handing them back to the
 * approval queue rather than applying them itself: for each affected event it
 * re-points the requests at the production copy and sets the newest one back
 * to 'pending' with the chronological union of every request's proposed
 * changes. Approving it in the app runs the real conflict check, Outlook sync,
 * audit and email. Past events, deleted production copies and requests whose
 * values are already in production are only marked.
 *
 * Every write is recorded twice: a `repair` block on the request (with the
 * full BEFORE state) and an 'edit-request-repaired' audit entry. `--revert`
 * restores the BEFORE state for any request not acted on since.
 *
 * Usage:
 *   node reopen-misrouted-edit-requests.js --dry-run
 *   node reopen-misrouted-edit-requests.js
 *   node reopen-misrouted-edit-requests.js --verify
 *   node reopen-misrouted-edit-requests.js --revert [--dry-run]
 *
 * Options:
 *   --sandbox-owner=<email>   default templeeventssandbox@emanuelnyc.org
 *   --production-owner=<email> default templeevents@emanuelnyc.org
 *   --operator=<email>        recorded on audit entries (default: OS user)
 *   --today=YYYY-MM-DD        override the date used for the past-event test
 *   --out=<dir>               dry-run also writes <dir>/reopen-plan.json
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { retryWithBackoff } = require('./utils/retryWithBackoff');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const SCRIPT = 'reopen-misrouted-edit-requests';
const EVENTS = 'templeEvents__Events';
const EDIT_REQUESTS = 'templeEvents__EditRequests';
const AUDIT = 'templeEvents__EventAuditHistory';
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;

// Fields that are always present in proposedChanges regardless of change
// (submit does not diff them), so they never count as "something to apply".
const CONTACT_FIELDS = new Set(['isOnBehalfOf', 'contactName', 'contactEmail', 'requestedRooms']);

const OUTCOME = {
  REOPENED: 'reopened',
  MERGED_INTO: 'merged-into',
  ALREADY_IN_PRODUCTION: 'already-in-production',
  PAST_SKIPPED: 'past-skipped',
  PRODUCTION_DELETED: 'production-deleted',
  MANUAL: 'manual',
};
const REPOINT_OUTCOMES = new Set([OUTCOME.REOPENED, OUTCOME.MERGED_INTO, OUTCOME.ALREADY_IN_PRODUCTION, OUTCOME.PAST_SKIPPED]);

const R = (op) => retryWithBackoff(op, { maxAttempts: 6 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const norm = (v) => (v === undefined || v === null || v === '') ? '' : (Array.isArray(v) ? v.map(String).sort().join('|') : String(v));
const sameValue = (a, b) => norm(a) === norm(b);
// submit diffed against calendarData; fall back to the top-level field
const fieldOf = (doc, f) => (doc?.calendarData && doc.calendarData[f] !== undefined) ? doc.calendarData[f] : doc?.[f];
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// Same seven fields the submit endpoint snapshots (buildEditRequestBaselineSnapshot).
function baselineSnapshotOf(event) {
  const cd = event.calendarData || {};
  return {
    _version: event._version || 1,
    eventTitle: cd.eventTitle || event.eventTitle || null,
    startDateTime: cd.startDateTime || event.startDateTime || null,
    endDateTime: cd.endDateTime || event.endDateTime || null,
    locations: cd.locations || event.locations || [],
    locationDisplayNames: cd.locationDisplayNames || event.locationDisplayNames || '',
    recurrence: event.recurrence || cd.recurrence || null,
  };
}

/**
 * Chronological union of proposedChanges across a group: later value wins per
 * field; fields already equal to production are dropped (they are the
 * spurious inclusions a sandbox-baseline diff produces). Contact fields are
 * taken from the newest request as-is. Pure.
 */
function mergeProposedChanges(requests, production) {
  const sorted = [...requests].sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
  const merged = {};
  const disagreements = [];
  for (const r of sorted) {
    for (const [field, value] of Object.entries(r.proposedChanges || {})) {
      if (CONTACT_FIELDS.has(field)) continue;
      if (sameValue(value, fieldOf(production, field))) continue;
      if (field in merged && !sameValue(merged[field], value)) {
        disagreements.push({ field, earlier: merged[field], later: value, laterRequest: r.editRequestId });
      }
      merged[field] = value;
    }
  }
  const newest = sorted[sorted.length - 1];
  for (const field of CONTACT_FIELDS) {
    if (newest?.proposedChanges && field in newest.proposedChanges) merged[field] = newest.proposedChanges[field];
  }
  const effectiveCount = Object.keys(merged).filter((f) => !CONTACT_FIELDS.has(f)).length;
  return { merged, effectiveCount, disagreements, newest };
}

/** Decide what to do with one event's group of requests. Pure. */
function planGroup({ requests, productionCopies, today }) {
  const live = productionCopies.filter((d) => !d.isDeleted && d.status !== 'deleted');
  const anyOccurrence = requests.some((r) => r.editScope === 'thisEvent');
  if (anyOccurrence) return { outcome: OUTCOME.MANUAL, reason: 'occurrence-scoped request on a duplicated series', production: live[0] || null };
  if (live.length > 1) return { outcome: OUTCOME.MANUAL, reason: `${live.length} live production copies`, production: null };
  if (live.length === 0) {
    return { outcome: OUTCOME.PRODUCTION_DELETED, reason: productionCopies.length ? 'production copy is deleted' : 'no production copy', production: productionCopies[0] || null };
  }
  const production = live[0];
  const endDate = production.endDate || production.startDate || '';
  if (endDate && endDate < today) return { outcome: OUTCOME.PAST_SKIPPED, reason: `event ended ${endDate}`, production };
  const merge = mergeProposedChanges(requests, production);
  if (merge.effectiveCount === 0) return { outcome: OUTCOME.ALREADY_IN_PRODUCTION, reason: 'every proposed value already matches production', production, merge };
  return { outcome: OUTCOME.REOPENED, reason: `${merge.effectiveCount} field(s) differ from production`, production, merge };
}

function beforeStateOf(r) {
  return {
    status: r.status,
    eventObjectId: r.eventObjectId,
    reviewedBy: r.reviewedBy ?? null,
    reviewedAt: r.reviewedAt ?? null,
    reviewNotes: r.reviewNotes ?? '',
    proposedChanges: r.proposedChanges ?? {},
    baselineSnapshot: r.baselineSnapshot ?? null,
    _version: r._version ?? 1,
  };
}

async function loadAffected(db, { sandboxOwner, productionOwner }) {
  const events = db.collection(EVENTS);
  const sandboxDocs = await R(() => events.find({ calendarOwner: sandboxOwner }, { projection: { _id: 1 } }).toArray());
  const sandboxIds = new Set(sandboxDocs.map((d) => String(d._id)));
  const approved = await R(() => db.collection(EDIT_REQUESTS).find({ status: 'approved', 'repair.script': { $exists: false } }).toArray());
  const affected = approved.filter((r) => r.eventObjectId && sandboxIds.has(String(r.eventObjectId)));
  const groups = new Map();
  for (const r of affected) {
    if (!groups.has(r.eventId)) groups.set(r.eventId, []);
    groups.get(r.eventId).push(r);
  }
  const plans = [];
  for (const [eventId, requests] of groups) {
    const productionCopies = await R(() => events.find({ eventId, calendarOwner: productionOwner }).toArray());
    plans.push({ eventId, requests, ...planGroup({ requests, productionCopies, today: localToday() }) });
  }
  return { plans, affectedCount: affected.length };
}

async function applyPlan(db, plan, { operator, dryRun }) {
  const now = new Date();
  const editRequests = db.collection(EDIT_REQUESTS);
  const audit = db.collection(AUDIT);
  const sorted = [...plan.requests].sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
  const newest = sorted[sorted.length - 1];
  const target = plan.production;
  const toEventObjectId = REPOINT_OUTCOMES.has(plan.outcome) && target ? target._id : null;

  const writes = [];
  for (const r of sorted) {
    const isNewest = r.editRequestId === newest.editRequestId;
    let outcome = plan.outcome;
    if (plan.outcome === OUTCOME.REOPENED && !isNewest) outcome = OUTCOME.MERGED_INTO;

    const repair = {
      script: SCRIPT,
      runAt: now,
      operator,
      outcome,
      reason: plan.reason,
      fromEventObjectId: r.eventObjectId,
      toEventObjectId: toEventObjectId || r.eventObjectId,
      before: beforeStateOf(r),
      ...(outcome === OUTCOME.MERGED_INTO && { mergedInto: newest.editRequestId }),
      ...(outcome === OUTCOME.REOPENED && {
        mergedFrom: sorted.filter((x) => x !== r).map((x) => x.editRequestId),
        disagreements: plan.merge.disagreements,
      }),
    };

    const $set = { repair, lastModifiedDateTime: now, lastModifiedBy: operator };
    if (toEventObjectId) $set.eventObjectId = toEventObjectId;
    const update = { $set, $inc: { _version: 1 } };
    if (outcome === OUTCOME.REOPENED) {
      Object.assign($set, {
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
        proposedChanges: plan.merge.merged,
        baselineSnapshot: baselineSnapshotOf(target),
      });
      update.$push = {
        statusHistory: {
          status: 'pending',
          changedAt: now,
          changedBy: SCRIPT,
          reason: 'Re-opened: the original approval was applied to a sandbox duplicate, never to this event',
        },
      };
    }
    writes.push({ request: r, outcome, update, repair });
  }

  if (dryRun) return writes.map((w) => ({ editRequestId: w.request.editRequestId, outcome: w.outcome }));

  for (const w of writes) {
    await R(() => editRequests.updateOne({ _id: w.request._id, 'repair.script': { $exists: false } }, w.update));
    await R(() => audit.insertOne({
      eventId: plan.eventId,
      reservationId: toEventObjectId || w.request.eventObjectId,
      action: 'edit-request-repaired',
      performedBy: SCRIPT,
      performedByEmail: operator,
      timestamp: now,
      changes: [],
      metadata: {
        editRequestId: w.request.editRequestId,
        editRequestDocId: w.request._id,
        outcome: w.outcome,
        reason: plan.reason,
        fromEventObjectId: w.request.eventObjectId,
        toEventObjectId: toEventObjectId || w.request.eventObjectId,
        before: w.repair.before,
        ...(w.outcome === OUTCOME.REOPENED && { proposedChangesMerged: plan.merge.merged, mergedFrom: w.repair.mergedFrom }),
        ...(w.outcome === OUTCOME.MERGED_INTO && { mergedInto: w.repair.mergedInto }),
      },
    }));
  }
  return writes.map((w) => ({ editRequestId: w.request.editRequestId, outcome: w.outcome }));
}

async function runRepair(db, options) {
  const { dryRun, operator, out } = options;
  const { plans, affectedCount } = await loadAffected(db, options);
  const summary = {};
  const rows = [];
  for (let i = 0; i < plans.length; i += BATCH_SIZE) {
    const batch = plans.slice(i, i + BATCH_SIZE);
    for (const plan of batch) {
      const results = await applyPlan(db, plan, { operator, dryRun });
      for (const r of results) summary[r.outcome] = (summary[r.outcome] || 0) + 1;
      rows.push({
        eventId: plan.eventId,
        title: plan.production?.eventTitle || plan.production?.calendarData?.eventTitle || plan.requests[0]?.baselineSnapshot?.eventTitle || '',
        startDate: plan.production?.startDate || null,
        productionId: plan.production ? String(plan.production._id) : null,
        outcome: plan.outcome,
        reason: plan.reason,
        requests: results,
        merged: plan.merge?.merged || null,
        disagreements: plan.merge?.disagreements || [],
      });
    }
    const processed = Math.min(i + BATCH_SIZE, plans.length);
    const percent = plans.length ? Math.round((processed / plans.length) * 100) : 100;
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${plans.length})`);
    if (i + BATCH_SIZE < plans.length) await sleep(BATCH_DELAY_MS);
  }
  process.stdout.write('\n');
  if (dryRun && out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'reopen-plan.json'), JSON.stringify(rows, null, 2));
  }
  return { affectedCount, groups: plans.length, summary, rows };
}

async function runRevert(db, { operator, dryRun }) {
  const editRequests = db.collection(EDIT_REQUESTS);
  const audit = db.collection(AUDIT);
  const repaired = await R(() => editRequests.find({ 'repair.script': SCRIPT, 'repair.revertedAt': { $exists: false } }).toArray());
  const now = new Date();
  const summary = { reverted: 0, skipped: 0 };
  const skipped = [];
  for (let i = 0; i < repaired.length; i += BATCH_SIZE) {
    const batch = repaired.slice(i, i + BATCH_SIZE);
    for (const r of batch) {
      const expectedStatus = r.repair.outcome === OUTCOME.REOPENED ? 'pending' : r.repair.before.status;
      if (r.status !== expectedStatus) {
        summary.skipped += 1;
        skipped.push({ editRequestId: r.editRequestId, status: r.status, reason: 'acted on since repair' });
        continue;
      }
      summary.reverted += 1;
      if (dryRun) continue;
      const b = r.repair.before;
      await R(() => editRequests.updateOne({ _id: r._id, status: expectedStatus }, {
        $set: {
          status: b.status,
          eventObjectId: b.eventObjectId,
          reviewedBy: b.reviewedBy,
          reviewedAt: b.reviewedAt,
          reviewNotes: b.reviewNotes,
          proposedChanges: b.proposedChanges,
          baselineSnapshot: b.baselineSnapshot,
          'repair.revertedAt': now,
          'repair.revertedBy': operator,
          lastModifiedDateTime: now,
          lastModifiedBy: operator,
        },
        $pull: { statusHistory: { changedBy: SCRIPT } },
        $inc: { _version: 1 },
      }));
      await R(() => audit.insertOne({
        eventId: r.eventId,
        reservationId: b.eventObjectId,
        action: 'edit-request-repair-reverted',
        performedBy: SCRIPT,
        performedByEmail: operator,
        timestamp: now,
        changes: [],
        metadata: { editRequestId: r.editRequestId, editRequestDocId: r._id, revertedOutcome: r.repair.outcome, restored: b },
      }));
    }
    const processed = Math.min(i + BATCH_SIZE, repaired.length);
    process.stdout.write(`\r   [Progress] ${repaired.length ? Math.round((processed / repaired.length) * 100) : 100}% (${processed}/${repaired.length})`);
    if (i + BATCH_SIZE < repaired.length) await sleep(BATCH_DELAY_MS);
  }
  process.stdout.write('\n');
  return { found: repaired.length, summary, skipped };
}

async function runVerify(db, { sandboxOwner }) {
  const events = db.collection(EVENTS);
  const sandboxDocs = await R(() => events.find({ calendarOwner: sandboxOwner }, { projection: { _id: 1 } }).toArray());
  const sandboxIds = sandboxDocs.map((d) => d._id);
  const stillAnchored = await R(() => db.collection(EDIT_REQUESTS).countDocuments({ status: 'approved', eventObjectId: { $in: sandboxIds }, 'repair.script': { $exists: false } }));
  const reopenedPending = await R(() => db.collection(EDIT_REQUESTS).countDocuments({ 'repair.outcome': OUTCOME.REOPENED, 'repair.revertedAt': { $exists: false }, status: 'pending' }));
  const reopenedDone = await R(() => db.collection(EDIT_REQUESTS).countDocuments({ 'repair.outcome': OUTCOME.REOPENED, 'repair.revertedAt': { $exists: false }, status: { $ne: 'pending' } }));
  const byOutcome = await R(() => db.collection(EDIT_REQUESTS).aggregate([
    { $match: { 'repair.script': SCRIPT } },
    { $group: { _id: '$repair.outcome', n: { $sum: 1 } } },
  ]).toArray());
  return { stillAnchoredUnrepaired: stillAnchored, reopenedAwaitingApproval: reopenedPending, reopenedActedOn: reopenedDone, byOutcome: Object.fromEntries(byOutcome.map((x) => [x._id, x.n])) };
}

function parseArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    dryRun: flag('dry-run'),
    verify: flag('verify'),
    revert: flag('revert'),
    sandboxOwner: value('sandbox-owner', 'templeeventssandbox@emanuelnyc.org').toLowerCase(),
    productionOwner: value('production-owner', 'templeevents@emanuelnyc.org').toLowerCase(),
    operator: value('operator', `${process.env.USERNAME || process.env.USER || 'unknown'}@cli`),
    out: value('out', null),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`${SCRIPT}`);
  console.log(`   Database:   ${DB_NAME}`);
  console.log(`   Sandbox:    ${options.sandboxOwner}`);
  console.log(`   Production: ${options.productionOwner}`);
  console.log(`   Mode:       ${options.verify ? 'verify' : options.revert ? 'revert' : 'repair'}${options.dryRun ? ' (dry run — no writes)' : ''}`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  try {
    if (options.verify) {
      console.log(JSON.stringify(await runVerify(db, options), null, 2));
      return;
    }
    if (options.revert) {
      const result = await runRevert(db, options);
      console.log(`   Repaired requests found: ${result.found}`);
      console.log(`   Reverted: ${result.summary.reverted} | skipped (acted on since): ${result.summary.skipped}`);
      for (const s of result.skipped) console.log(`     - ${s.editRequestId}: ${s.status}`);
      return;
    }
    const before = await runVerify(db, options);
    console.log(`   Before: ${before.stillAnchoredUnrepaired} approved request(s) still anchored to a sandbox copy`);
    const result = await runRepair(db, options);
    console.log(`   Events: ${result.groups} | requests: ${result.affectedCount}`);
    console.log(`   Outcomes: ${JSON.stringify(result.summary)}`);
    if (options.dryRun) {
      for (const row of result.rows) {
        console.log(`   ${row.outcome.padEnd(22)} ${row.startDate || 'no date'}  ${row.title}  (${row.requests.length} request${row.requests.length === 1 ? '' : 's'}) — ${row.reason}`);
        if (row.merged) console.log(`      would propose: ${JSON.stringify(row.merged).slice(0, 220)}`);
        for (const d of row.disagreements) console.log(`      disagreement on ${d.field}: ${JSON.stringify(d.earlier)} -> ${JSON.stringify(d.later)} (${d.laterRequest})`);
      }
      if (options.out) console.log(`   Plan written to ${path.join(options.out, 'reopen-plan.json')}`);
    } else {
      const after = await runVerify(db, options);
      console.log(`   After: ${after.stillAnchoredUnrepaired} still anchored | ${after.reopenedAwaitingApproval} re-opened and awaiting approval`);
    }
  } finally {
    await client.close();
  }
}

module.exports = { mergeProposedChanges, planGroup, runRepair, runRevert, runVerify, OUTCOME, SCRIPT };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

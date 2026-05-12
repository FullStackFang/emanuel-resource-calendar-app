/**
 * Recovery Script: Untethered Published Events
 *
 * Repairs records broken by the publish-rollback defect (see plan
 * /home/fullstackfang/.claude/plans/so-i-noticed-that-sprightly-hippo.md).
 *
 * Symptom: events with `status='published'` whose
 *   - `roomReservationData.createdGraphEventIds` has one or more entries, but
 *   - `graphData.id` is missing or null
 *
 * Cause: the publish endpoint's post-publish `$set: {'graphData.id': X}` used
 * dotted-path against documents that had `graphData: null` from initial
 * creation. Cosmos silently dropped the `$set` while letting the sibling
 * `$push` to `createdGraphEventIds` apply. The result is a "published but
 * untethered" record whose subsequent edits never reach Outlook.
 *
 * What this script does (idempotent, three modes):
 *   --dry-run  Print every affected record and what we WOULD do, no writes.
 *   (default)  For each affected record:
 *              1. Query Graph for each id in createdGraphEventIds.
 *              2. Identify surviving Graph events.
 *              3. If 0 survive: log "needs manual republish", skip.
 *              4. If 1+ survive: pick the canonical (last in array, most
 *                 likely the most recent successful publish), delete the
 *                 rest via Graph (compensating cleanup), and update MongoDB
 *                 with the canonical id in graphData.{id, iCalUId}.
 *   --verify   Re-query after a run and assert each formerly-affected
 *              record now has graphData.id matching one of
 *              createdGraphEventIds.
 *
 * Usage:
 *   node recover-untethered-publishes.js --dry-run
 *   node recover-untethered-publishes.js
 *   node recover-untethered-publishes.js --verify
 *   node recover-untethered-publishes.js --diagnose <_id>
 *   node recover-untethered-publishes.js --relink <_id> [--force]
 *   node recover-untethered-publishes.js --clean-orphans <_id> [--force]
 *
 * Isolation: imports (does not modify) backend/utils/retryWithBackoff.js and
 * backend/services/graphApiService.js. Adds zero exports to any file that
 * api-server.js loads.
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const { retryWithBackoff } = require('./utils/retryWithBackoff');
const graphApiService = require('./services/graphApiService');
// Shared Graph event builder — same logic as the publish endpoint and the
// new POST /api/admin/events/:id/republish endpoint. Centralized so all three
// call sites stay in sync (buildGraphSubject/buildOffsiteGraphLocation are used
// transitively inside buildGraphEventDataFromRecord).
const { buildGraphEventDataFromRecord } = require('./utils/graphEventBuilder');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;
const INTER_BATCH_DELAY_MS = 1000;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');
// By default the script SKIPS addition/exception child documents. Those are
// part of the exception-as-Document architecture and their createdGraphEventIds
// often reference the PARENT series master's Graph event, not their own — so
// linking them would create incorrect references. Pass --include-addition to
// override (only after manual review).
const includeAdditions = process.argv.includes('--include-additions');

// --relink <_id> / --republish <_id> mode (aliases): targeted single-record
// recovery. Creates a fresh Graph event from current MongoDB state and
// overwrites graphData.id. Operator is expected to delete the stale Outlook
// events manually AFTER verifying the fresh one looks correct (see plan Fix
// 5c). "Republish" is the user-facing name (see plan Fix 8a); "relink"
// describes the database operation. Both flags accepted — operator can pick
// whichever reads better.
const relinkArgIdx = process.argv.indexOf('--relink');
const republishArgIdx = process.argv.indexOf('--republish');
const relinkId = relinkArgIdx >= 0 ? process.argv[relinkArgIdx + 1] : null;
const republishId = republishArgIdx >= 0 ? process.argv[republishArgIdx + 1] : null;
const targetSingleRecordId = relinkId || republishId;
const isRelink = !!targetSingleRecordId;
const isForce = process.argv.includes('--force');

// --diagnose <_id> mode: read-only probe. Compares MongoDB calendarData.eventTitle
// to Outlook Graph subject for the linked event; reports MISMATCH if admin save
// PATCH has not propagated. Single command for triaging "edits don't reach
// Outlook" reports (see plan Fix 6).
const diagnoseArgIdx = process.argv.indexOf('--diagnose');
const diagnoseId = diagnoseArgIdx >= 0 ? process.argv[diagnoseArgIdx + 1] : null;
const isDiagnose = !!diagnoseId;

// --clean-orphans <_id> mode: targeted single-record cleanup. Walks
// roomReservationData.createdGraphEventIds and deletes every Graph event that
// is NOT the currently-linked graphData.id. Use after a --relink/--republish
// has been verified working — the previous Graph event(s) remain in the
// owner mailbox as orphans (publish/republish are non-destructive by design
// to preserve a manual escape hatch). Without --force this is a dry-run.
// Auto-detects whether the argument is a Mongo ObjectId (24-char hex) or an
// application-level eventId (e.g. 'evt-request-…'); the latter is resolved
// via a findOne lookup before the cleanup runs.
const cleanOrphansArgIdx = process.argv.indexOf('--clean-orphans');
const cleanOrphansId = cleanOrphansArgIdx >= 0 ? process.argv[cleanOrphansArgIdx + 1] : null;
const isCleanOrphans = !!cleanOrphansId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cosmos-only retry. Imports from shared util; does NOT define a new export.
 */
async function withCosmosRetry(operation, maxAttempts = 3) {
  return retryWithBackoff(operation, { maxAttempts });
}

/**
 * Retry with Graph-specific predicate (429, 503, ETIMEDOUT, ECONNRESET).
 * Graph 429s do NOT match isCosmosRetryable, so we explicit the predicate.
 */
async function withGraphRetry(operation, maxAttempts = 3) {
  return retryWithBackoff(operation, {
    maxAttempts,
    retryableError: (err) =>
      err?.statusCode === 429 || err?.statusCode === 503 ||
      err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET',
  });
}

/**
 * Fetch a Graph event by id. Returns null on 404 (Graph event was deleted).
 * graphApiService.getEvent is the actual method (see services/graphApiService.js:232).
 */
async function fetchGraphEvent(calendarOwner, calendarId, graphId) {
  try {
    return await withGraphRetry(() =>
      graphApiService.getEvent(calendarOwner, calendarId, graphId)
    );
  } catch (err) {
    if (err?.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Predicate: is this document an untethered published event?
 * Matches the production bug shape exactly.
 */
const UNTETHERED_QUERY = {
  status: 'published',
  isDeleted: { $ne: true },
  'roomReservationData.createdGraphEventIds.0': { $exists: true },
  $or: [
    { graphData: null },
    { 'graphData.id': null },
    { 'graphData.id': { $exists: false } },
  ],
};

/**
 * Progress bar — one line, redrawn via \r. No per-doc spam in normal mode.
 */
function drawProgress(label, processed, total) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
  process.stdout.write(`\r   [${label}] ${percent}% (${processed}/${total})`);
}

/**
 * Plan the recovery action for a single record. Pure read-side: no writes.
 * Returns one of:
 *   { kind: 'skip-no-owner' }           — calendarOwner missing
 *   { kind: 'skip-child', eventType }   — addition/exception document
 *   { kind: 'no-survivors', probed }    — every Graph id 404'd
 *   { kind: 'link', canonical, duplicates, probed }
 *                                       — link to canonical, delete duplicates
 *   { kind: 'probe-failed', errors }    — Graph queries threw non-404 errors
 *
 * `probed` is an array of { id, status: 'found'|'404'|'error', subject?, lastModifiedDateTime?, error? }
 * for transparent reporting.
 */
async function planRecord(event) {
  if (!event.calendarOwner) {
    return { kind: 'skip-no-owner' };
  }

  const eventType = event.eventType || 'singleInstance';
  if (!includeAdditions && (eventType === 'addition' || eventType === 'exception')) {
    return { kind: 'skip-child', eventType };
  }

  const calendarOwner = event.calendarOwner;
  const calendarId = event.calendarId || null;
  const createdIds = event.roomReservationData?.createdGraphEventIds || [];

  // Probe each candidate id
  const probed = [];
  const errors = [];
  for (const graphId of createdIds) {
    try {
      const fetched = await fetchGraphEvent(calendarOwner, calendarId, graphId);
      if (fetched) {
        probed.push({
          id: graphId,
          status: 'found',
          subject: fetched.subject,
          lastModifiedDateTime: fetched.lastModifiedDateTime,
          iCalUId: fetched.iCalUId,
        });
      } else {
        probed.push({ id: graphId, status: '404' });
      }
    } catch (err) {
      probed.push({ id: graphId, status: 'error', error: err.message });
      errors.push({ id: graphId, message: err.message });
    }
  }

  const survivors = probed.filter((p) => p.status === 'found');

  if (errors.length > 0 && survivors.length === 0) {
    return { kind: 'probe-failed', errors, probed };
  }

  if (survivors.length === 0) {
    return { kind: 'no-survivors', probed };
  }

  // Canonical = LAST surviving (most recent publish attempt).
  const canonical = survivors[survivors.length - 1];
  const duplicates = survivors.filter((s) => s.id !== canonical.id);

  return { kind: 'link', canonical, duplicates, probed };
}

/**
 * Format a per-record plan summary line for human review.
 */
function formatPlan(event, plan) {
  const title = event.calendarData?.eventTitle || event.eventTitle || '(no title)';
  const eventType = event.eventType || 'singleInstance';
  const owner = event.calendarOwner || '(missing)';

  const header = [
    `   ─ ${event._id} | eventType=${eventType} | owner=${owner}`,
    `       title: "${title}"`,
    `       eventId: ${event.eventId}`,
  ];

  switch (plan.kind) {
    case 'skip-no-owner':
      header.push(`       ACTION: SKIP — no calendarOwner, cannot query Graph`);
      break;
    case 'skip-child':
      header.push(`       ACTION: SKIP — ${plan.eventType} document (use --include-additions to override)`);
      break;
    case 'no-survivors':
      header.push(`       ACTION: SKIP — every Graph id returned 404; needs manual republish via UI`);
      for (const p of plan.probed) {
        header.push(`         · ${p.id.slice(-32)} → ${p.status}`);
      }
      break;
    case 'probe-failed':
      header.push(`       ACTION: ABORT — Graph queries failed and no surviving event identified`);
      for (const e of plan.errors) {
        header.push(`         · ${e.id.slice(-32)} → ${e.message}`);
      }
      break;
    case 'link': {
      const dupCount = plan.duplicates.length;
      header.push(`       ACTION: LINK → ${plan.canonical.id.slice(-40)}`);
      header.push(`         canonical subject: "${plan.canonical.subject || '(unknown)'}"`);
      header.push(`         canonical lastModified: ${plan.canonical.lastModifiedDateTime || '(unknown)'}`);
      if (dupCount > 0) {
        header.push(`       PLUS DELETE ${dupCount} duplicate Outlook event(s):`);
        for (const d of plan.duplicates) {
          header.push(`         · ${d.id.slice(-40)} (subject: "${d.subject || '(unknown)'}")`);
        }
      } else {
        header.push(`       (no duplicates to delete — 1 surviving Graph event)`);
      }
      break;
    }
  }
  return header.join('\n');
}

// ---------------------------------------------------------------------------
// Verify mode — re-runs the query and asserts repair completeness.
// ---------------------------------------------------------------------------

async function verify(collection) {
  const remaining = await collection.countDocuments(UNTETHERED_QUERY);
  console.log(`\n   Remaining untethered records: ${remaining}`);
  if (remaining === 0) {
    console.log('\n✅ Verification passed. All formerly-untethered records are now linked.');
    return;
  }

  console.log('\n⚠️  Verification failed. Remaining records:');
  const samples = await collection.find(UNTETHERED_QUERY).limit(10).toArray();
  for (const event of samples) {
    console.log(`     - ${event._id} | eventId: ${event.eventId} | createdGraphEventIds: ${JSON.stringify(event.roomReservationData?.createdGraphEventIds)}`);
  }
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Diagnose mode — read-only probe to triage "edits don't reach Outlook" reports.
// Compares MongoDB calendarData.eventTitle against the linked Outlook Graph
// event's subject. See plan Fix 6.
// ---------------------------------------------------------------------------

function pad(s, n) {
  const str = String(s ?? '');
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function printDiagnoseField(label, value) {
  console.log(`     ${pad(label + ':', 30)} ${value ?? '(missing)'}`);
}

async function diagnose(collection, id) {
  console.log(`\n📋 Diagnose: ${id}\n`);

  let _id;
  try {
    _id = new ObjectId(id);
  } catch (err) {
    console.error(`❌ Invalid ObjectId: ${id}`);
    process.exitCode = 1;
    return;
  }

  const event = await collection.findOne({ _id });
  if (!event) {
    console.error(`❌ No record found with _id ${id}`);
    process.exitCode = 1;
    return;
  }

  const cd = event.calendarData || {};
  const mongoTitle = cd.eventTitle;
  const mongoStart = cd.startDateTime;
  const mongoEnd = cd.endDateTime;
  const graphId = event.graphData?.id;

  console.log(`   MongoDB state:`);
  printDiagnoseField('_id', event._id);
  printDiagnoseField('eventId', event.eventId);
  printDiagnoseField('eventType', event.eventType || 'singleInstance');
  printDiagnoseField('status', event.status);
  printDiagnoseField('isDeleted', !!event.isDeleted);
  printDiagnoseField('calendarOwner', event.calendarOwner);
  printDiagnoseField('calendarId', event.calendarId);
  printDiagnoseField('_version', event._version);
  printDiagnoseField('graphData.id', graphId);
  printDiagnoseField('graphData.iCalUId', event.graphData?.iCalUId);
  printDiagnoseField('calendarData.eventTitle', mongoTitle);
  printDiagnoseField('calendarData.startDateTime', mongoStart);
  printDiagnoseField('calendarData.endDateTime', mongoEnd);
  printDiagnoseField('lastModifiedDateTime', event.lastModifiedDateTime);
  printDiagnoseField('lastModifiedBy', event.lastModifiedBy);
  printDiagnoseField('createdGraphEventIds.length', event.roomReservationData?.createdGraphEventIds?.length || 0);

  // Show last 3 statusHistory entries to spot recovery / relink trail
  const history = event.statusHistory || [];
  console.log(`\n   Recent statusHistory (last ${Math.min(3, history.length)} of ${history.length}):`);
  for (const entry of history.slice(-3)) {
    const at = entry.changedAt?.$date || entry.changedAt;
    console.log(`     · ${at} | ${entry.status} | by ${entry.changedBy || entry.changedByEmail || '?'}`);
    console.log(`         reason: ${(entry.reason || '').slice(0, 140)}`);
  }

  // If no graphData.id, no Graph probe possible
  if (!graphId) {
    console.log(`\n   ⚠️  DIAGNOSIS: no graphData.id set — record is untethered.`);
    console.log(`     This record is in the same shape as the original publish-rollback bug.`);
    console.log(`     Run: node recover-untethered-publishes.js --dry-run`);
    console.log(`     then: node recover-untethered-publishes.js   (apply)`);
    return;
  }
  if (!event.calendarOwner) {
    console.log(`\n   ⚠️  DIAGNOSIS: graphData.id is set but calendarOwner is missing.`);
    console.log(`     Admin save would silently skip Graph sync (gate at api-server.js:24194 requires event.calendarOwner).`);
    return;
  }

  // Probe Graph for the linked event
  console.log(`\n   Graph state (probing graphData.id):`);
  let graphEvent;
  try {
    graphEvent = await withGraphRetry(() =>
      graphApiService.getEvent(event.calendarOwner, event.calendarId || null, graphId)
    );
  } catch (err) {
    if (err?.statusCode === 404) {
      printDiagnoseField('Found', 'NO (HTTP 404 — Graph event no longer exists)');
      console.log(`\n   ⚠️  DIAGNOSIS: stale graphData.id`);
      console.log(`     The Graph event referenced by graphData.id has been deleted from Outlook.`);
      console.log(`     Admin save would call Graph PATCH against this id and get a 404, which the server`);
      console.log(`     swallows silently (HTTP 200 returned to client, MongoDB updates, email fires, but`);
      console.log(`     Outlook is never touched).`);
      console.log(`\n     Fix path: relink to a fresh Graph event:`);
      console.log(`       node recover-untethered-publishes.js --relink ${id} --force`);
      return;
    }
    printDiagnoseField('Found', `ERROR (${err.message})`);
    console.log(`\n   ⚠️  DIAGNOSIS: Graph probe failed with a non-404 error.`);
    console.log(`     ${err.message}`);
    return;
  }

  printDiagnoseField('Found', 'YES (HTTP 200)');
  printDiagnoseField('Graph subject', graphEvent.subject);
  printDiagnoseField('Graph type', graphEvent.type);
  printDiagnoseField('Graph isCancelled', graphEvent.isCancelled);
  printDiagnoseField('Graph lastModifiedDateTime', graphEvent.lastModifiedDateTime);
  printDiagnoseField('Graph createdDateTime', graphEvent.createdDateTime);
  printDiagnoseField('Graph webLink', graphEvent.webLink);
  if (graphEvent.start) {
    printDiagnoseField('Graph start.dateTime', graphEvent.start.dateTime);
  }
  if (graphEvent.end) {
    printDiagnoseField('Graph end.dateTime', graphEvent.end.dateTime);
  }

  // Compare and diagnose
  const titleMatches = (graphEvent.subject || '') === (mongoTitle || '');
  const startMatches = !mongoStart || !graphEvent.start?.dateTime ||
    graphEvent.start.dateTime.startsWith(mongoStart.slice(0, 16));
  const endMatches = !mongoEnd || !graphEvent.end?.dateTime ||
    graphEvent.end.dateTime.startsWith(mongoEnd.slice(0, 16));

  console.log(`\n   Comparison:`);
  printDiagnoseField('eventTitle === subject', titleMatches ? 'MATCH' : 'MISMATCH ⚠');
  printDiagnoseField('startDateTime', startMatches ? 'MATCH' : 'MISMATCH ⚠');
  printDiagnoseField('endDateTime', endMatches ? 'MATCH' : 'MISMATCH ⚠');

  if (titleMatches && startMatches && endMatches) {
    console.log(`\n   ✅ DIAGNOSIS: MongoDB and Outlook are in sync.`);
    console.log(`     If users report otherwise, the Outlook calendar UI may be cached.`);
    console.log(`     Have them refresh, or open the webLink above directly.`);
    return;
  }

  console.log(`\n   ⚠️  DIAGNOSIS: MongoDB and Outlook have DIVERGED.`);
  console.log(`     MongoDB calendarData.eventTitle is: "${mongoTitle}"`);
  console.log(`     Outlook Graph subject is:           "${graphEvent.subject}"`);
  console.log(`     Admin save PATCH is NOT propagating changes to Outlook.\n`);
  console.log(`     Most likely causes (ranked):`);
  console.log(`       H1 — Field-shape mismatch: frontend sends eventTitle in a shape that`);
  console.log(`            api-server.js:hasFieldChanged doesn't see. Verify in DevTools:`);
  console.log(`            • Open Network panel`);
  console.log(`            • Edit the title in the app`);
  console.log(`            • Find the PUT request to /api/admin/events/${id}`);
  console.log(`            • Check the Request payload: is "eventTitle" a top-level key?`);
  console.log(`            • Check the Response status: 200 or error?`);
  console.log(`       H2 — Silent Graph 404: covered above (Graph event exists, so not this).`);
  console.log(`       H3 — Frontend dispatching to the wrong endpoint (owner-edit instead of`);
  console.log(`            admin save). The owner-edit endpoint at /api/room-reservations/:id/edit`);
  console.log(`            does NOT sync to Graph. Confirm the PUT URL in DevTools.`);
  console.log(`\n     If DevTools confirms an admin save PUT with eventTitle at top level returning 200,`);
  console.log(`     the bug is in the api-server admin save endpoint's PATCH path — paste the DevTools`);
  console.log(`     request/response and we'll deepen the investigation.`);
}

// ---------------------------------------------------------------------------
// Clean-orphans mode — targeted single-record cleanup. Walks
// roomReservationData.createdGraphEventIds, probes each id in Graph, and
// deletes the ones that are NOT the currently-linked graphData.id. The
// non-destructive design of relink/republish means every recovery action
// leaves behind a stale Outlook event; this mode is the operator-driven
// counterpart that cleans them up after the new event is verified working.
//
// Safety rails:
//   - Refuses to operate when graphData.id is missing (untethered records
//     belong to the main repair flow, not to this cleanup).
//   - Refuses to operate when calendarOwner is missing (can't talk to Graph).
//   - Never touches the linked graphData.id.
//   - Default is a dry-run; --force is required to actually delete.
//   - createdGraphEventIds array is preserved for audit trail (delete from
//     Graph only, not from the Mongo array).
//   - Pushes a statusHistory entry recording every Graph id we deleted.
// ---------------------------------------------------------------------------

async function cleanOrphans(collection, idArg) {
  console.log(`\n📋 Clean orphans: ${idArg}`);
  console.log(`   Database: ${DB_NAME}`);
  console.log(`   Mode: ${isForce ? 'APPLY (--force)' : 'DRY RUN (default; pass --force to delete)'}`);

  // Accept either a Mongo ObjectId (24-char hex) or an application eventId
  // ('evt-…'). ObjectId.isValid returns true only for the exact 24-hex form,
  // so we use it as the discriminator and fall back to an eventId lookup.
  let event;
  if (ObjectId.isValid(idArg) && /^[0-9a-fA-F]{24}$/.test(idArg)) {
    const _id = new ObjectId(idArg);
    event = await withCosmosRetry(() => collection.findOne({ _id }));
    if (!event) {
      console.error(`❌ No record found with _id ${idArg}`);
      process.exitCode = 1;
      return;
    }
  } else {
    event = await withCosmosRetry(() => collection.findOne({ eventId: idArg }));
    if (!event) {
      console.error(`❌ No record found with eventId ${idArg}`);
      process.exitCode = 1;
      return;
    }
    console.log(`   Resolved eventId → _id: ${event._id}`);
  }

  const linkedId = event.graphData?.id;
  const owner = event.calendarOwner;
  const calendarId = event.calendarId || null;
  const createdIds = event.roomReservationData?.createdGraphEventIds || [];

  console.log(`   eventId: ${event.eventId}`);
  console.log(`   title: "${event.calendarData?.eventTitle || '(no title)'}"`);
  console.log(`   calendarOwner: ${owner || '(missing)'}`);
  console.log(`   linked graphData.id: ${linkedId || '(missing)'}`);
  console.log(`   createdGraphEventIds.length: ${createdIds.length}\n`);

  if (!owner) {
    console.error(`❌ Cannot clean orphans: calendarOwner is missing — no way to call Graph.`);
    process.exitCode = 1;
    return;
  }
  if (!linkedId) {
    console.error(`❌ Cannot clean orphans: graphData.id is missing.`);
    console.error(`   This record is untethered. Run the main repair flow first:`);
    console.error(`     node recover-untethered-publishes.js --dry-run`);
    console.error(`     node recover-untethered-publishes.js`);
    console.error(`   …then come back to clean orphans.`);
    process.exitCode = 1;
    return;
  }
  if (createdIds.length === 0) {
    console.log(`✅ Nothing to clean: createdGraphEventIds is empty.`);
    return;
  }

  // Probe every candidate so the report is honest about what's already gone
  // vs what we'd actually delete. Skip the linked id from the probe — we
  // don't want to risk a transient error against it influencing the plan.
  const candidates = createdIds.filter((gid) => gid !== linkedId);
  if (candidates.length === 0) {
    console.log(`✅ Nothing to clean: every id in createdGraphEventIds is the linked one.`);
    return;
  }

  console.log(`   Probing ${candidates.length} candidate orphan id(s)...\n`);

  const probed = [];
  for (const gid of candidates) {
    try {
      const fetched = await fetchGraphEvent(owner, calendarId, gid);
      if (fetched) {
        probed.push({
          id: gid,
          status: 'found',
          subject: fetched.subject,
          lastModifiedDateTime: fetched.lastModifiedDateTime,
          webLink: fetched.webLink,
        });
      } else {
        probed.push({ id: gid, status: '404' });
      }
    } catch (err) {
      probed.push({ id: gid, status: 'error', error: err.message });
    }
  }

  // Report
  for (const p of probed) {
    const tail = p.id.slice(-40);
    if (p.status === 'found') {
      console.log(`   · ${tail}`);
      console.log(`       subject: "${p.subject || '(no subject)'}"`);
      console.log(`       lastModified: ${p.lastModifiedDateTime || '(unknown)'}`);
      console.log(`       webLink: ${p.webLink || '(unknown)'}`);
      console.log(`       ACTION: ${isForce ? 'DELETE' : 'WOULD DELETE'}`);
    } else if (p.status === '404') {
      console.log(`   · ${tail} → already gone (HTTP 404), skipping`);
    } else {
      console.log(`   · ${tail} → probe error: ${p.error} (skipping for safety)`);
    }
    console.log('');
  }

  const toDelete = probed.filter((p) => p.status === 'found');
  if (toDelete.length === 0) {
    console.log(`✅ Nothing to delete: every orphan candidate is either gone or unreachable.`);
    return;
  }

  if (!isForce) {
    console.log(`\n   Dry-run summary: would delete ${toDelete.length} orphan Graph event(s).`);
    console.log(`   Re-run with --force to actually delete:\n`);
    console.log(`     node recover-untethered-publishes.js --clean-orphans ${id} --force\n`);
    return;
  }

  // Apply phase — delete each surviving orphan, swallow per-id failures so
  // one bad id doesn't block the rest. Track deletes for the statusHistory
  // entry so audit trail is complete even if some delete attempts fail.
  const deleted = [];
  const failed = [];
  for (const p of toDelete) {
    try {
      await withGraphRetry(() =>
        graphApiService.deleteCalendarEvent(owner, calendarId, p.id)
      );
      deleted.push(p.id);
      console.log(`   ✅ Deleted ${p.id.slice(-40)}`);
    } catch (err) {
      failed.push({ id: p.id, error: err.message });
      console.error(`   ❌ Failed to delete ${p.id.slice(-40)}: ${err.message}`);
    }
  }

  // Audit entry — even if some deletes failed, record what DID happen so the
  // record's history reflects the cleanup attempt. Don't bump _version: this
  // is metadata-only, not a state transition.
  if (deleted.length > 0) {
    const reason = `Cleaned ${deleted.length} orphan Graph event(s) via recovery script` +
      (failed.length > 0 ? ` (${failed.length} delete attempt(s) failed)` : '') +
      `: ${deleted.map((gid) => gid.slice(-32)).join(', ')}`;
    await withCosmosRetry(() => collection.updateOne(
      { _id: event._id },
      {
        $push: {
          statusHistory: {
            status: event.status,
            changedAt: new Date().toISOString(),
            changedBy: 'recovery-script',
            changedByEmail: 'recovery-script@internal',
            reason,
          },
        },
      },
    ));
  }

  console.log(`\n   Cleanup summary:`);
  console.log(`     deleted: ${deleted.length}`);
  console.log(`     failed:  ${failed.length}`);
  console.log(`     already gone (404): ${probed.filter((p) => p.status === '404').length}`);
  if (failed.length > 0) {
    console.log(`\n   Failed deletes (retry individually or delete from Outlook UI):`);
    for (const f of failed) {
      console.log(`     · ${f.id} — ${f.error}`);
    }
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Relink mode — single-record recovery: create a fresh Graph event from the
// current MongoDB state and overwrite graphData.id. Operator manually deletes
// the stale Outlook events afterward. See plan Fix 5c for the rationale and
// safety rails.
// ---------------------------------------------------------------------------

// buildGraphSubject, buildOffsiteGraphLocation, buildGraphEventDataFromRecord
// now live in backend/utils/graphEventBuilder.js — imported at the top of this
// file. Removed inline copies to keep this script in lockstep with the
// publish/republish endpoint's payload construction.

async function relink(collection, id) {
  console.log(`\n📋 Relink: ${id}`);
  console.log(`   Database: ${DB_NAME}`);
  console.log(`   Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'APPLY'}`);

  let _id;
  try {
    _id = new ObjectId(id);
  } catch (err) {
    console.error(`\n❌ Invalid ObjectId: ${id}`);
    process.exitCode = 1;
    return;
  }

  const event = await collection.findOne({ _id });
  if (!event) {
    console.error(`\n❌ No record found with _id ${id}`);
    process.exitCode = 1;
    return;
  }

  // Safety rails
  if (event.status !== 'published') {
    console.error(`\n❌ Refusing to relink: status is '${event.status}', expected 'published'.`);
    console.error(`   For pending/draft records, publish via the UI instead.`);
    process.exitCode = 1;
    return;
  }
  if (!event.calendarOwner) {
    console.error(`\n❌ Refusing to relink: calendarOwner is missing on this record.`);
    process.exitCode = 1;
    return;
  }
  // --force gate only applies to APPLY mode. Dry-run is read-only — let it
  // proceed and print what WOULD happen so operators can review the plan
  // before deciding to add --force.
  if (event.graphData?.id && !isForce && !isDryRun) {
    console.error(`\n❌ Refusing to relink: graphData.id is already set (${event.graphData.id}).`);
    console.error(`   This would orphan the existing Outlook event.`);
    console.error(`   Re-run with --force to acknowledge and proceed.`);
    process.exitCode = 1;
    return;
  }
  if (event.graphData?.id && isDryRun) {
    console.log(`\n   ⚠️  Note: graphData.id is already set (${event.graphData.id}).`);
    console.log(`       Running with --force in apply mode WILL orphan this Outlook event.`);
  }

  // Build the Graph event payload from current state
  const graphEventData = buildGraphEventDataFromRecord(event);
  console.log(`\n   Record: ${event.calendarData?.eventTitle || event.eventTitle || '(no title)'}`);
  console.log(`   eventType: ${event.eventType || 'singleInstance'}`);
  console.log(`   calendarOwner: ${event.calendarOwner}`);
  console.log(`   calendarId: ${event.calendarId || '(default)'}`);
  console.log(`   Existing graphData.id: ${event.graphData?.id || '(none)'}`);
  console.log(`   New Graph event subject: "${graphEventData.subject}"`);
  console.log(`   New Graph event start:   ${graphEventData.start.dateTime} (${graphEventData.start.timeZone})`);
  console.log(`   New Graph event end:     ${graphEventData.end.dateTime}`);
  console.log(`   New Graph event location: ${graphEventData.location?.displayName}`);
  if (graphEventData.recurrence) {
    console.log(`   New Graph event recurrence: ${graphEventData.recurrence.pattern.type} (${graphEventData.recurrence.range.startDate} -> ${graphEventData.recurrence.range.endDate || '∞'})`);
  }

  if (isDryRun) {
    console.log(`\n   (dry-run: WOULD create a fresh Graph event and overwrite graphData.id; no writes made)`);
    return;
  }

  // Create the fresh Graph event
  let createdEvent;
  try {
    createdEvent = await withGraphRetry(() =>
      graphApiService.createCalendarEvent(event.calendarOwner, event.calendarId || null, graphEventData)
    );
  } catch (err) {
    console.error(`\n❌ Graph createCalendarEvent failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n   ✅ Fresh Graph event created`);
  console.log(`   New Graph id:     ${createdEvent.id}`);
  console.log(`   New iCalUId:      ${createdEvent.iCalUId}`);
  console.log(`   Web link:         ${createdEvent.webLink}`);

  // Persist the new linkage (OCC-guarded). Preserve any existing graphData
  // auxiliary fields (e.g. location.displayName from delta sync) — only the
  // id and iCalUId need to point at the new event.
  const previousGraphId = event.graphData?.id || null;
  const newGraphData = {
    ...(event.graphData && typeof event.graphData === 'object' ? event.graphData : {}),
    id: createdEvent.id,
    iCalUId: createdEvent.iCalUId,
  };

  const updateResult = await withCosmosRetry(() => collection.updateOne(
    { _id, _version: event._version },
    {
      $set: { graphData: newGraphData },
      $inc: { _version: 1 },
      $push: {
        'roomReservationData.createdGraphEventIds': createdEvent.id,
        statusHistory: {
          status: 'published',
          changedAt: new Date(),
          changedBy: 'recovery-script',
          changedByEmail: 'recovery-script@internal',
          reason: previousGraphId
            ? `Relinked to fresh Graph event (orphaned previous: ${previousGraphId})`
            : 'Relinked to fresh Graph event',
        },
      },
    }
  ));

  if (updateResult.matchedCount === 0) {
    console.error(`\n⚠️  OCC conflict: _version changed between read and write.`);
    console.error(`   The Graph event WAS created (id: ${createdEvent.id}). To complete the relink:`);
    console.error(`   1. Manually update MongoDB with the new graphData, OR`);
    console.error(`   2. Delete the orphan Graph event from Outlook and re-run.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n   ✅ MongoDB updated. _version: ${event._version} → ${event._version + 1}`);
  if (previousGraphId) {
    console.log(`\n   ⚠️  Previous Graph event is now ORPHANED in Outlook: ${previousGraphId}`);
    console.log(`       Manually delete it from Outlook after verifying the new one works.`);
  }
  console.log(`\n   Next steps:`);
  console.log(`   1. Open the web link above and verify subject/recurrence/room are correct.`);
  console.log(`   2. Edit the record in the app and confirm the new Outlook event reflects the change.`);
  console.log(`   3. If sync works, manually delete the old Outlook event(s).`);
  console.log(`   4. If sync DOESN'T work, the admin save PATCH path has a deeper bug; do not delete anything yet.`);
}

// ---------------------------------------------------------------------------
// Main repair loop
// ---------------------------------------------------------------------------

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    // Diagnose mode short-circuits the batch loop — read-only probe for a
    // single record. See plan Fix 6.
    if (isDiagnose) {
      await diagnose(collection, diagnoseId);
      return;
    }

    // Clean-orphans mode short-circuits the batch loop — operates on a
    // single record and deletes Graph events listed in
    // roomReservationData.createdGraphEventIds that aren't graphData.id.
    // Default dry-run; pass --force to actually delete.
    if (isCleanOrphans) {
      await cleanOrphans(collection, cleanOrphansId);
      return;
    }

    // Relink/republish mode short-circuits the batch loop entirely — it
    // operates on a single record by _id and creates a fresh Graph event
    // rather than linking to an existing one. See plan Fix 5c + Fix 8a.
    if (isRelink) {
      await relink(collection, targetSingleRecordId);
      return;
    }

    console.log(`\n📋 Recovery: Untethered Published Events`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN (no writes)' : isVerify ? 'VERIFY' : 'APPLY'}`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    const total = await collection.countDocuments(UNTETHERED_QUERY);
    console.log(`   Affected records found: ${total}\n`);

    if (total === 0) {
      console.log('✅ Nothing to repair.');
      return;
    }

    if (isDryRun) {
      console.log(`   Probing Graph for each candidate id (read-only)...`);
      console.log(`   Include addition/exception documents: ${includeAdditions ? 'YES (--include-additions)' : 'NO (default — pass --include-additions to override)'}\n`);

      const allRecords = await collection.find(UNTETHERED_QUERY).toArray();
      const summary = {
        link: 0,
        linkWithDuplicateDelete: 0,
        totalDuplicatesWouldBeDeleted: 0,
        noSurvivors: 0,
        skipChild: 0,
        skipNoOwner: 0,
        probeFailed: 0,
      };

      for (const event of allRecords) {
        const plan = await planRecord(event);
        console.log(formatPlan(event, plan));
        console.log('');

        switch (plan.kind) {
          case 'link':
            if (plan.duplicates.length > 0) {
              summary.linkWithDuplicateDelete++;
              summary.totalDuplicatesWouldBeDeleted += plan.duplicates.length;
            } else {
              summary.link++;
            }
            break;
          case 'no-survivors': summary.noSurvivors++; break;
          case 'skip-child': summary.skipChild++; break;
          case 'skip-no-owner': summary.skipNoOwner++; break;
          case 'probe-failed': summary.probeFailed++; break;
        }
      }

      console.log(`\n   ═══ DRY-RUN SUMMARY ═══`);
      console.log(`   Total affected:                              ${allRecords.length}`);
      console.log(`   Would LINK (no duplicates):                  ${summary.link}`);
      console.log(`   Would LINK + DELETE Outlook duplicates:      ${summary.linkWithDuplicateDelete}  (deleting ${summary.totalDuplicatesWouldBeDeleted} total Outlook event(s))`);
      console.log(`   Need manual republish (no surviving Graph):  ${summary.noSurvivors}`);
      console.log(`   SKIP — addition/exception child documents:   ${summary.skipChild}  (review separately)`);
      console.log(`   SKIP — missing calendarOwner:                ${summary.skipNoOwner}`);
      console.log(`   ABORT — Graph queries failed:                ${summary.probeFailed}`);
      console.log(`\n   To apply: run without --dry-run`);
      if (summary.skipChild > 0) {
        console.log(`   ⚠️  ${summary.skipChild} child document(s) are being skipped. These have eventType=addition or eventType=exception`);
        console.log(`       and their createdGraphEventIds may reference the PARENT series master's Graph event.`);
        console.log(`       Investigate them manually before running with --include-additions.`);
      }
      return;
    }

    // Real run — paginate, batch by BATCH_SIZE
    const stats = {
      processed: 0,
      repaired: 0,
      noSurvivors: 0,
      duplicatesDeleted: 0,
      duplicateDeleteFailures: 0,
      skippedChild: 0,
      skippedNoOwner: 0,
      probeFailed: 0,
      occConflict: 0,
    };

    let cursor = collection.find(UNTETHERED_QUERY).batchSize(BATCH_SIZE);
    const allRecords = [];
    for await (const doc of cursor) allRecords.push(doc);

    console.log(`   Include addition/exception documents: ${includeAdditions ? 'YES (--include-additions)' : 'NO (default)'}\n`);

    for (let batchStart = 0; batchStart < allRecords.length; batchStart += BATCH_SIZE) {
      const batch = allRecords.slice(batchStart, batchStart + BATCH_SIZE);

      for (const event of batch) {
        const plan = await planRecord(event);

        if (plan.kind === 'skip-no-owner') { stats.skippedNoOwner++; stats.processed++; drawProgress('Repair', stats.processed, total); continue; }
        if (plan.kind === 'skip-child') { stats.skippedChild++; stats.processed++; drawProgress('Repair', stats.processed, total); continue; }
        if (plan.kind === 'no-survivors') { stats.noSurvivors++; stats.processed++; drawProgress('Repair', stats.processed, total); continue; }
        if (plan.kind === 'probe-failed') {
          stats.probeFailed++; stats.processed++;
          console.log(`\n   ⚠️  Probe failed for ${event._id}, leaving as-is`);
          drawProgress('Repair', stats.processed, total);
          continue;
        }

        // plan.kind === 'link' — apply the repair
        const calendarOwner = event.calendarOwner;
        const calendarId = event.calendarId || null;

        // Delete duplicates from Outlook (compensating cleanup)
        for (const dup of plan.duplicates) {
          try {
            await withGraphRetry(() =>
              graphApiService.deleteCalendarEvent(calendarOwner, calendarId, dup.id)
            );
            stats.duplicatesDeleted++;
          } catch (delErr) {
            stats.duplicateDeleteFailures++;
            console.log(`\n   ⚠️  Failed to delete duplicate Graph event ${dup.id} (event ${event._id}): ${delErr.message}`);
          }
        }

        // Repair the document with the canonical id.
        // OCC guard: _version matches the value we read with. $inc for
        // version bump consistency with the rest of the codebase.
        const repairUpdate = {
          $set: {
            graphData: {
              id: plan.canonical.id,
              iCalUId: plan.canonical.iCalUId || null,
            },
          },
          $inc: { _version: 1 },
          $push: {
            statusHistory: {
              status: 'published',
              changedAt: new Date(),
              changedBy: 'recovery-script',
              changedByEmail: 'recovery-script@internal',
              reason: 'Graph handle recovered after partial-write publish defect',
            },
          },
        };

        const result = await withCosmosRetry(() => collection.updateOne(
          { _id: event._id, _version: event._version },
          repairUpdate
        ));

        if (result.matchedCount === 1) {
          stats.repaired++;
        } else {
          // Version changed under us — likely a concurrent admin save. Skip;
          // next run will pick it up if it's still untethered.
          stats.occConflict++;
          console.log(`\n   ⚠️  OCC conflict on ${event._id} — _version changed (will retry next run)`);
        }

        stats.processed++;
        drawProgress('Repair', stats.processed, total);
      }

      // Inter-batch delay to respect Cosmos RU budget
      if (batchStart + BATCH_SIZE < allRecords.length) {
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
      }
    }

    process.stdout.write('\n');
    console.log(`\n✅ Repair pass complete.`);
    console.log(`   Processed:                          ${stats.processed}`);
    console.log(`   Repaired (linked):                  ${stats.repaired}`);
    console.log(`   Duplicate Graph deletes:            ${stats.duplicatesDeleted}`);
    console.log(`   Duplicate delete failures:          ${stats.duplicateDeleteFailures}`);
    console.log(`   No survivors (need re-publish):     ${stats.noSurvivors}`);
    console.log(`   Skipped — child documents:          ${stats.skippedChild}`);
    console.log(`   Skipped — missing calendarOwner:    ${stats.skippedNoOwner}`);
    console.log(`   Probe failed (Graph errors):        ${stats.probeFailed}`);
    console.log(`   OCC conflict (will retry next run): ${stats.occConflict}`);
    console.log('');
    console.log(`   Re-run with --verify to confirm completeness.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Recovery failed:', err);
  process.exitCode = 1;
});

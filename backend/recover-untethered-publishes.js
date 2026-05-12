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
 *
 * Isolation: imports (does not modify) backend/utils/retryWithBackoff.js and
 * backend/services/graphApiService.js. Adds zero exports to any file that
 * api-server.js loads.
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const { retryWithBackoff } = require('./utils/retryWithBackoff');
const graphApiService = require('./services/graphApiService');

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
// Main repair loop
// ---------------------------------------------------------------------------

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

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

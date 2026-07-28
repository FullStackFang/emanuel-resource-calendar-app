/**
 * Backfill: per-occurrence customizations that never reached Outlook
 *
 * Companion to backfill-addition-graph-events.js, for the other half of the
 * same defect family. An `exception` document represents a single customized
 * occurrence of a series (a changed room, time or title on one date). It syncs
 * by locating that date's Graph occurrence instance and PATCHing it, then
 * storing the instance id in `graphEventId`.
 *
 * That lookup compared `new Date('2026-03-17').toDateString()` against
 * `new Date('2026-03-17T14:00:00').toDateString()` — UTC-parsed versus
 * local-parsed — which never matched west of Greenwich. It failed every time,
 * so no exception document was ever linked and no customization reached
 * Outlook. Fixed in utils/graphOccurrenceLookup.js; this repairs the records
 * left behind.
 *
 * Per published exception document with no graphEventId:
 *   1. Resolve its series master (must itself be linked to Outlook).
 *   2. Find the Graph occurrence instance for the date.
 *   3. PATCH it with the document's stored state and persist the instance id.
 *
 * Dates that are ad-hoc ADDITIONS are skipped — those have no series instance
 * to patch and belong to backfill-addition-graph-events.js.
 *
 * Idempotent: a document is skipped once it has a graphEventId, so an
 * interrupted run resumes cleanly and a completed run is a no-op.
 *
 * Usage:
 *   node backfill-exception-graph-links.js --dry-run   # preview, no writes
 *   node backfill-exception-graph-links.js             # apply
 *   node backfill-exception-graph-links.js --verify    # check completeness
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const { retryWithBackoff } = require('./utils/retryWithBackoff');
const { withGraphRetry } = require('./utils/graphRetry');
const graphApiService = require('./services/graphApiService');
const { findGraphOccurrenceForDate } = require('./utils/graphOccurrenceLookup');
const { buildGraphEventDataFromRecord } = require('./utils/graphEventBuilder');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 25;
const INTER_BATCH_DELAY_MS = 1000;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

/** Exception documents that are live, published, and not linked to Outlook. */
const UNLINKED_QUERY = {
  eventType: 'exception',
  status: 'published',
  isDeleted: { $ne: true },
  $or: [{ graphEventId: null }, { graphEventId: { $exists: false } }],
};

const withCosmosRetry = (op) => retryWithBackoff(op, { maxAttempts: 3 });

function drawProgress(label, processed, total) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
  process.stdout.write(`\r   [${label}] ${percent}% (${processed}/${total})`);
}

const titleOf = (doc) => doc.eventTitle || doc.calendarData?.eventTitle || '(no title)';

/**
 * Load each document's series master once, keyed by the master's eventId.
 */
async function loadMasters(collection, docs) {
  const ids = [...new Set(docs.map((d) => d.seriesMasterEventId).filter(Boolean))];
  const masters = await withCosmosRetry(() => collection.find({
    eventId: { $in: ids },
    eventType: 'seriesMaster',
  }).toArray());
  return new Map(masters.map((m) => [m.eventId, m]));
}

/**
 * Decide what to do with one document. Pure read-side; no writes.
 */
function planDoc(doc, master) {
  if (!master) return { kind: 'skip', reason: 'series master not found' };
  if (!master.graphData?.id) return { kind: 'skip', reason: 'master not linked to Outlook (run recover-untethered-publishes.js)' };
  if (!master.calendarOwner) return { kind: 'skip', reason: 'master has no calendarOwner' };

  const additions = master.recurrence?.additions || [];
  if (additions.includes(doc.occurrenceDate)) {
    return { kind: 'skip', reason: 'ad-hoc added date — handled by backfill-addition-graph-events.js' };
  }
  return { kind: 'patch', master };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function verify(collection) {
  const remaining = await collection.find(UNLINKED_QUERY).toArray();
  const masters = await loadMasters(collection, remaining);

  const actionable = remaining.filter((d) => planDoc(d, masters.get(d.seriesMasterEventId)).kind === 'patch');

  console.log(`\n   Unlinked exception documents: ${remaining.length}`);
  console.log(`   Of those, actionable:         ${actionable.length}`);

  if (actionable.length === 0) {
    console.log('\n✅ Verification passed. Every actionable customization is linked to Outlook.');
    if (remaining.length > 0) {
      console.log('\n   Remaining unlinked documents are all skips (see --dry-run for reasons).');
    }
    return;
  }

  console.log('\n⚠️  Verification incomplete. Still unlinked:');
  for (const doc of actionable.slice(0, 20)) {
    console.log(`     - ${doc.occurrenceDate} "${titleOf(doc)}" (${doc._id})`);
  }
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const collection = client.db(DB_NAME).collection(COLLECTION);

    console.log(`\n📋 Backfill: occurrence customizations missing from Outlook`);
    console.log(`   Database:   ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode:       ${isDryRun ? 'DRY RUN (no writes)' : isVerify ? 'VERIFY' : 'APPLY'}`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    const docs = await withCosmosRetry(() => collection.find(UNLINKED_QUERY).toArray());
    console.log(`   Unlinked exception documents: ${docs.length}\n`);

    if (docs.length === 0) {
      console.log('✅ Nothing to backfill.');
      return;
    }

    const masters = await loadMasters(collection, docs);
    const stats = { processed: 0, patched: 0, skipped: 0, noInstance: 0, failures: [] };

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);

      for (const doc of batch) {
        stats.processed++;
        const master = masters.get(doc.seriesMasterEventId);
        const plan = planDoc(doc, master);

        if (plan.kind === 'skip') {
          stats.skipped++;
          if (isDryRun) {
            console.log(`   ─ SKIP ${doc.occurrenceDate} "${titleOf(doc)}" — ${plan.reason}`);
          }
          drawProgress('Backfill', stats.processed, docs.length);
          continue;
        }

        const timeZone = master.graphData?.start?.timeZone;

        if (isDryRun) {
          console.log(`   ─ ${doc.occurrenceDate} "${titleOf(doc)}" (${doc._id})`);
          console.log(`       series: "${titleOf(master)}" owner=${master.calendarOwner}`);
          console.log(`       overrides: ${JSON.stringify(doc.overrides || {})}`);
          console.log(`       WOULD locate the Graph instance for this date and PATCH it`);
          drawProgress('Backfill', stats.processed, docs.length);
          continue;
        }

        try {
          const match = await withGraphRetry(() => findGraphOccurrenceForDate(
            graphApiService, master.calendarOwner, master.calendarId || null,
            master.graphData.id, doc.occurrenceDate, timeZone
          ));

          if (!match) {
            // The occurrence may have been cancelled or excluded in Outlook.
            stats.noInstance++;
            stats.failures.push({
              date: doc.occurrenceDate, title: titleOf(doc), id: String(doc._id),
              error: 'no Graph instance found for this date',
            });
            drawProgress('Backfill', stats.processed, docs.length);
            continue;
          }

          // The document carries its own effective state (master defaults with
          // overrides merged) and no `recurrence`, so this patches the single
          // instance to exactly what the app shows.
          const payload = buildGraphEventDataFromRecord(doc);
          await withGraphRetry(() => graphApiService.updateCalendarEvent(
            master.calendarOwner, master.calendarId || null, match.id, payload
          ));
          await withCosmosRetry(() => collection.updateOne(
            { _id: doc._id },
            { $set: { graphEventId: match.id } }
          ));
          stats.patched++;
        } catch (err) {
          stats.failures.push({
            date: doc.occurrenceDate, title: titleOf(doc), id: String(doc._id),
            error: err.message,
          });
        }

        drawProgress('Backfill', stats.processed, docs.length);
      }

      if (i + BATCH_SIZE < docs.length) {
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
      }
    }

    process.stdout.write('\n');
    console.log(`\n${isDryRun ? '   ═══ DRY-RUN SUMMARY ═══' : '✅ Backfill complete.'}`);
    console.log(`   Documents processed:           ${stats.processed}`);
    console.log(`   ${isDryRun ? 'Would patch' : 'Patched + linked'}:${isDryRun ? '                   ' : '              '}${isDryRun ? stats.processed - stats.skipped : stats.patched}`);
    console.log(`   Skipped:                       ${stats.skipped}`);
    if (!isDryRun) console.log(`   No Graph instance for date:    ${stats.noInstance}`);
    console.log(`   Failures:                      ${stats.failures.length}`);

    if (stats.failures.length > 0) {
      console.log(`\n   Failures (re-run to retry — the script is idempotent):`);
      for (const f of stats.failures) {
        console.log(`     · ${f.date} "${f.title}" ${f.id} — ${f.error}`);
      }
      process.exitCode = 1;
    }

    console.log(`\n   ${isDryRun ? 'To apply: run without --dry-run' : 'Re-run with --verify to confirm completeness.'}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Backfill failed:', err);
  process.exitCode = 1;
});

/**
 * Backfill: ad-hoc added dates that never reached Outlook
 *
 * Repairs the defect fixed in "fix(recurrence): added dates never reached
 * Outlook". Dates added to a recurring series via the Recurrence tab were
 * stored as bare strings in `master.recurrence.additions[]` but never
 * materialized into `addition` child documents, so the Graph sync — which is
 * driven by child documents — never created their standalone Outlook events.
 * The dates render in the app; Outlook has never heard of them.
 *
 * What this script does, per published series master that has additions:
 *   1. materializeAdditionDocuments() — create any missing addition child docs
 *      (idempotent; adopts an existing exception/addition doc for the date).
 *   2. For each addition child doc with no graphEventId, create the standalone
 *      Graph event from the document's own stored state and persist the id.
 *
 * Reuses the same helpers as the running server (materializeAdditionDocuments,
 * buildGraphEventDataFromRecord) so the events it creates are identical to what
 * publish would create today. It adds no duplicate payload logic.
 *
 * Idempotent and safe to re-run: a date is skipped once it has a graphEventId,
 * so an interrupted run resumes cleanly and a completed run is a no-op.
 *
 * Masters that are not themselves linked to Outlook (no graphData.id) are
 * SKIPPED and reported — those belong to recover-untethered-publishes.js first.
 *
 * Usage:
 *   node backfill-addition-graph-events.js --dry-run   # preview, no writes
 *   node backfill-addition-graph-events.js             # apply
 *   node backfill-addition-graph-events.js --verify    # check completeness
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const { retryWithBackoff } = require('./utils/retryWithBackoff');
const graphApiService = require('./services/graphApiService');
const { materializeAdditionDocuments } = require('./utils/exceptionDocumentService');
const { buildGraphEventDataFromRecord } = require('./utils/graphEventBuilder');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 25;
const INTER_BATCH_DELAY_MS = 1000;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

/** Masters in scope: published, live, and carrying at least one added date. */
const MASTER_QUERY = {
  eventType: 'seriesMaster',
  status: 'published',
  isDeleted: { $ne: true },
  'recurrence.additions.0': { $exists: true },
};

const withCosmosRetry = (op) => retryWithBackoff(op, { maxAttempts: 3 });
const withGraphRetry = (op) => retryWithBackoff(op, {
  maxAttempts: 3,
  retryableError: (err) =>
    err?.statusCode === 429 || err?.statusCode === 503 ||
    err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET',
});

function drawProgress(label, processed, total) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
  process.stdout.write(`\r   [${label}] ${percent}% (${processed}/${total})`);
}

const titleOf = (doc) => doc.eventTitle || doc.calendarData?.eventTitle || '(no title)';

/**
 * Child documents on an ADDED date that still have no Graph event.
 *
 * Selected by date, not by eventType. A date that was added and then customized
 * can be represented by an `exception` document rather than an `addition` one,
 * and it still needs a standalone Outlook event: added dates are outside the
 * recurrence pattern, so there is no series instance on that day to attach to.
 * Filtering on eventType:'addition' silently skipped those.
 */
async function findUnsyncedAdditions(collection, master) {
  const additions = master.recurrence?.additions || [];
  if (additions.length === 0) return [];
  return withCosmosRetry(() => collection.find({
    seriesMasterEventId: master.eventId,
    occurrenceDate: { $in: additions },
    isDeleted: { $ne: true },
    $or: [{ graphEventId: null }, { graphEventId: { $exists: false } }],
  }).toArray());
}

// ---------------------------------------------------------------------------
// Verify mode
// ---------------------------------------------------------------------------

async function verify(collection) {
  const masters = await collection.find(MASTER_QUERY).toArray();
  let totalDates = 0;
  let stillMissing = 0;
  const offenders = [];

  for (const master of masters) {
    const additions = master.recurrence?.additions || [];
    totalDates += additions.length;

    const children = await collection.find({
      seriesMasterEventId: master.eventId,
      isDeleted: { $ne: true },
      occurrenceDate: { $in: additions },
    }).toArray();
    const linked = new Set(children.filter((c) => c.graphEventId).map((c) => c.occurrenceDate));

    const missing = additions.filter((d) => !linked.has(d));
    if (missing.length > 0) {
      stillMissing += missing.length;
      offenders.push({ master, missing });
    }
  }

  console.log(`\n   Published series with additions: ${masters.length}`);
  console.log(`   Total added dates:               ${totalDates}`);
  console.log(`   Still missing from Outlook:      ${stillMissing}`);

  if (stillMissing === 0) {
    console.log('\n✅ Verification passed. Every added date has a Graph event.');
    return;
  }

  console.log('\n⚠️  Verification incomplete. Remaining:');
  for (const { master, missing } of offenders) {
    console.log(`     - "${titleOf(master)}" (${master._id})`);
    console.log(`         graphData.id: ${master.graphData?.id || '(MISSING — run recover-untethered-publishes.js first)'}`);
    console.log(`         dates: ${missing.join(', ')}`);
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

    console.log(`\n📋 Backfill: added dates missing from Outlook`);
    console.log(`   Database:   ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode:       ${isDryRun ? 'DRY RUN (no writes)' : isVerify ? 'VERIFY' : 'APPLY'}`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    const masters = await withCosmosRetry(() => collection.find(MASTER_QUERY).toArray());
    const totalDates = masters.reduce((n, m) => n + (m.recurrence?.additions?.length || 0), 0);
    console.log(`   Series with added dates: ${masters.length}`);
    console.log(`   Added dates in total:    ${totalDates}\n`);

    if (masters.length === 0) {
      console.log('✅ Nothing to backfill.');
      return;
    }

    const stats = {
      mastersProcessed: 0,
      mastersSkippedUntethered: 0,
      mastersSkippedNoOwner: 0,
      docsMaterialized: 0,
      graphEventsCreated: 0,
      alreadyLinked: 0,
      failures: [],
    };

    for (let i = 0; i < masters.length; i += BATCH_SIZE) {
      const batch = masters.slice(i, i + BATCH_SIZE);

      for (const master of batch) {
        stats.mastersProcessed++;

        // A master with no Graph event of its own is a different defect; its
        // additions are not the thing to repair first.
        if (!master.graphData?.id) {
          stats.mastersSkippedUntethered++;
          if (isDryRun) {
            console.log(`   ─ SKIP (untethered master) "${titleOf(master)}" ${master._id}`);
            console.log(`       run recover-untethered-publishes.js first`);
          }
          drawProgress('Backfill', stats.mastersProcessed, masters.length);
          continue;
        }
        if (!master.calendarOwner) {
          stats.mastersSkippedNoOwner++;
          if (isDryRun) {
            console.log(`   ─ SKIP (no calendarOwner) "${titleOf(master)}" ${master._id}`);
          }
          drawProgress('Backfill', stats.mastersProcessed, masters.length);
          continue;
        }

        if (isDryRun) {
          // Report without writing: which dates lack a child doc, and which
          // existing children lack a Graph event.
          const additions = master.recurrence?.additions || [];
          const children = await collection.find({
            seriesMasterEventId: master.eventId,
            isDeleted: { $ne: true },
            occurrenceDate: { $in: additions },
          }).toArray();
          const byDate = new Map(children.map((c) => [c.occurrenceDate, c]));

          const wouldCreateDoc = additions.filter((d) => !byDate.has(d));
          const wouldCreateGraph = additions.filter((d) => !byDate.get(d)?.graphEventId);
          const linked = additions.length - wouldCreateGraph.length;

          stats.docsMaterialized += wouldCreateDoc.length;
          stats.graphEventsCreated += wouldCreateGraph.length;
          stats.alreadyLinked += linked;

          console.log(`   ─ "${titleOf(master)}" ${master._id}`);
          console.log(`       owner: ${master.calendarOwner}`);
          console.log(`       added dates (${additions.length}): ${additions.join(', ')}`);
          console.log(`       WOULD create ${wouldCreateDoc.length} addition doc(s), ${wouldCreateGraph.length} Outlook event(s)`);
          if (linked > 0) console.log(`       already linked: ${linked}`);
          drawProgress('Backfill', stats.mastersProcessed, masters.length);
          continue;
        }

        try {
          const materialized = await materializeAdditionDocuments(collection, master, {
            createdBy: 'backfill-script',
            createdByEmail: 'backfill-script@internal',
          });
          stats.docsMaterialized += materialized.created.length;

          const unsynced = await findUnsyncedAdditions(collection, master);
          // Count what needed no work, so the tally matches --dry-run's.
          // (materialized.existing means "already had a child doc", which is not
          // the same as "already has an Outlook event".)
          stats.alreadyLinked += (master.recurrence?.additions?.length || 0) - unsynced.length;

          for (const doc of unsynced) {
            try {
              // Build from the child document's own state: it carries its own
              // date, time, room and title, and has no `recurrence`, so this
              // produces the standalone (non-recurring) event we want.
              const payload = buildGraphEventDataFromRecord(doc);
              const created = await withGraphRetry(() => graphApiService.createCalendarEvent(
                master.calendarOwner, master.calendarId || null, payload
              ));
              await withCosmosRetry(() => collection.updateOne(
                { _id: doc._id },
                { $set: { graphEventId: created.id } }
              ));
              stats.graphEventsCreated++;
            } catch (docErr) {
              stats.failures.push({
                master: titleOf(master),
                masterId: String(master._id),
                date: doc.occurrenceDate,
                error: docErr.message,
              });
            }
          }
        } catch (masterErr) {
          stats.failures.push({
            master: titleOf(master),
            masterId: String(master._id),
            date: '(all)',
            error: masterErr.message,
          });
        }

        drawProgress('Backfill', stats.mastersProcessed, masters.length);
      }

      if (i + BATCH_SIZE < masters.length) {
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
      }
    }

    process.stdout.write('\n');
    console.log(`\n${isDryRun ? '   ═══ DRY-RUN SUMMARY ═══' : '✅ Backfill complete.'}`);
    console.log(`   Series processed:                    ${stats.mastersProcessed}`);
    console.log(`   Addition docs ${isDryRun ? 'to create' : 'created'}:${isDryRun ? '            ' : '              '}${stats.docsMaterialized}`);
    console.log(`   Outlook events ${isDryRun ? 'to create' : 'created'}:${isDryRun ? '           ' : '             '}${stats.graphEventsCreated}`);
    console.log(`   Already linked (skipped):            ${stats.alreadyLinked}`);
    console.log(`   Skipped — untethered master:         ${stats.mastersSkippedUntethered}`);
    console.log(`   Skipped — no calendarOwner:          ${stats.mastersSkippedNoOwner}`);
    console.log(`   Failures:                            ${stats.failures.length}`);

    if (stats.failures.length > 0) {
      console.log(`\n   Failures (re-run to retry — the script is idempotent):`);
      for (const f of stats.failures) {
        console.log(`     · "${f.master}" ${f.date} — ${f.error}`);
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

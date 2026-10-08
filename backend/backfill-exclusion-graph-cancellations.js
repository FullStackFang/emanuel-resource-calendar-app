/**
 * Backfill: excluded dates still present in Outlook
 *
 * Repairs drift left by the defect fixed in edit-request-approval-graph-sync.
 * A date excluded from a published series AFTER publish (an approved edit
 * request, or the Recurrence tab on admin Save) was removed in MongoDB only;
 * its Outlook instance stayed. Live instance: evt-request-1780078660390-6l4gmxc9j
 * still shows 10/14 in Outlook.
 *
 * Per published, live series master with graphData.id and >= 1 exclusion,
 * per excluded date:
 *   1. If a live exception/addition child exists for the date, soft-delete it
 *      and delete its own Graph event (the series instance lookup cannot see an
 *      addition's standalone event).
 *   2. Otherwise resolve the series instance with findGraphOccurrenceForDate in
 *      the master's own timezone; if found, delete it and $addToSet
 *      { date, graphId } into graphData.cancelledOccurrences.
 *   3. Not found = already cancelled = done.
 *
 * Idempotent: a second run finds nothing and deletes nothing. Masters without
 * graphData.id are reported and skipped (recover-untethered-publishes.js first).
 *
 * Usage:
 *   node backfill-exclusion-graph-cancellations.js --dry-run   # preview, no writes
 *   node backfill-exclusion-graph-cancellations.js             # apply
 *   node backfill-exclusion-graph-cancellations.js --verify    # count still-present dates
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const { retryWithBackoff } = require('./utils/retryWithBackoff');
const { withGraphRetry } = require('./utils/graphRetry');
const { findGraphOccurrenceForDate, DEFAULT_TIME_ZONE } = require('./utils/graphOccurrenceLookup');
const { findExceptionForDate, softDeleteException, EVENT_TYPE } = require('./utils/exceptionDocumentService');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 25;
const INTER_BATCH_DELAY_MS = 1000;

/** Masters in scope: published, live, carrying at least one excluded date. */
const MASTER_QUERY = {
  eventType: 'seriesMaster',
  status: 'published',
  isDeleted: { $ne: true },
  'recurrence.exclusions.0': { $exists: true },
};

const withCosmosRetry = (op) => retryWithBackoff(op, { maxAttempts: 3 });
const titleOf = (doc) => doc.eventTitle || doc.calendarData?.eventTitle || '(no title)';

/**
 * Decide what each excluded date of one master needs. Reads only.
 * @returns {Promise<Array<{date, kind: 'child'|'instance', graphId, childId?, timeZone}>>}
 */
async function planMaster(collection, graphApi, master) {
  // TODO graphData-read: the series timezone still comes from graphData.
  const timeZone = master.graphData?.start?.timeZone || DEFAULT_TIME_ZONE;
  const actions = [];
  for (const date of master.recurrence.exclusions.map(String)) {
    const child = await withCosmosRetry(() => findExceptionForDate(collection, master.eventId, date));
    if (child) {
      actions.push({ date, kind: 'child', graphId: child.graphEventId || null, childType: child.eventType, timeZone });
      // An unlinked EXCEPTION still has its series instance in Outlook
      // (production 2026-10-08: Kaiserman 11/19). Fall through to find it.
      if (child.graphEventId || child.eventType !== EVENT_TYPE.EXCEPTION) continue;
    }
    const match = await withGraphRetry(() => findGraphOccurrenceForDate(
      graphApi, master.calendarOwner, master.calendarId, master.graphData.id, date, timeZone
    ));
    if (match) actions.push({ date, kind: 'instance', graphId: match.id, timeZone });
  }
  return actions;
}

async function applyActions(collection, graphApi, master, actions) {
  const recorded = [];
  for (const a of actions) {
    if (a.graphId) {
      await withGraphRetry(() => graphApi.deleteCalendarEvent(master.calendarOwner, master.calendarId, a.graphId));
    }
    if (a.kind === 'child') {
      await withCosmosRetry(() => softDeleteException(collection, master.eventId, a.date, {
        deletedBy: 'backfill-exclusion-graph-cancellations',
        reason: 'Occurrence excluded from the series (backfill)',
      }));
    }
    // An exception's graphEventId is the series instance; an addition's is not.
    if (a.graphId && (a.kind === 'instance' || a.childType === EVENT_TYPE.EXCEPTION)) {
      recorded.push({ date: a.date, graphId: a.graphId });
    }
  }
  if (recorded.length > 0) {
    await withCosmosRetry(() => collection.updateOne(
      { _id: master._id },
      { $addToSet: { 'graphData.cancelledOccurrences': { $each: recorded } } }
    ));
  }
}

/**
 * @param {Object} args
 * @param {Collection} args.collection
 * @param {Object} args.graphApi - getRecurringEventInstances, deleteCalendarEvent
 * @param {'dry-run'|'apply'|'verify'} args.mode
 * @param {Function} [args.log]
 * @param {Function} [args.progress]
 * @param {number} [args.delayMs]
 * @returns {Promise<Object>} stats
 */
async function runBackfill({ collection, graphApi, mode, log = console.log, progress = () => {}, delayMs = INTER_BATCH_DELAY_MS }) {
  const masters = await withCosmosRetry(() => collection.find(MASTER_QUERY).toArray());
  const stats = { masters: masters.length, untethered: 0, noOwner: 0, planned: 0, applied: 0, stillPresent: 0, failures: [] };

  for (let i = 0; i < masters.length; i += BATCH_SIZE) {
    for (const master of masters.slice(i, i + BATCH_SIZE)) {
      if (!master.graphData?.id) {
        stats.untethered += 1;
        if (mode !== 'apply') log(`   ─ SKIP (untethered master) "${titleOf(master)}" ${master.eventId}`);
        continue;
      }
      if (!master.calendarOwner) {
        stats.noOwner += 1;
        if (mode !== 'apply') log(`   ─ SKIP (no calendarOwner) "${titleOf(master)}" ${master.eventId}`);
        continue;
      }
      try {
        const actions = await planMaster(collection, graphApi, master);
        stats.planned += actions.length;
        if (mode === 'verify') {
          stats.stillPresent += actions.filter(a => a.graphId).length;
          continue;
        }
        if (mode === 'dry-run') {
          for (const a of actions) {
            log(`   • "${titleOf(master)}" ${master.eventId} ${a.date} → ${a.kind === 'child' ? `remove ${a.childType} child` : 'cancel instance'} ${a.graphId || '(no Graph event)'} [timezone ${a.timeZone}]`);
          }
          continue;
        }
        await applyActions(collection, graphApi, master, actions);
        stats.applied += actions.length;
      } catch (err) {
        stats.failures.push({ eventId: master.eventId, error: err.message });
      }
    }
    progress(Math.min(i + BATCH_SIZE, masters.length), masters.length);
    if (i + BATCH_SIZE < masters.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return stats;
}

async function main() {
  const mode = process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--dry-run') ? 'dry-run' : 'apply';
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const collection = client.db(DB_NAME).collection(COLLECTION);
    // Required lazily so the unit tests never load MSAL/Azure config.
    const graphApi = require('./services/graphApiService');

    console.log('\n📋 Backfill: excluded dates still present in Outlook');
    console.log(`   Database:   ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode:       ${mode.toUpperCase()}`);
    const before = await withCosmosRetry(() => collection.countDocuments(MASTER_QUERY));
    console.log(`   Series with exclusions: ${before}\n`);

    const stats = await runBackfill({
      collection, graphApi, mode,
      progress: (done, total) => {
        const percent = total > 0 ? Math.round((done / total) * 100) : 100;
        process.stdout.write(`\r   [Progress] ${percent}% (${done}/${total})`);
      },
    });

    console.log('\n');
    console.log(`   Untethered (skipped): ${stats.untethered}`);
    console.log(`   No owner (skipped):   ${stats.noOwner}`);
    if (mode === 'verify') {
      console.log(`   Excluded dates still present in Outlook: ${stats.stillPresent}`);
    } else if (mode === 'dry-run') {
      console.log(`   Would cancel: ${stats.planned}`);
    } else {
      console.log(`   Cancelled:    ${stats.applied}`);
    }
    if (stats.failures.length > 0) {
      console.log(`   Failures: ${stats.failures.length}`);
      for (const f of stats.failures) console.log(`     ${f.eventId}: ${f.error}`);
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}

module.exports = { runBackfill, planMaster, MASTER_QUERY };

/**
 * Migration: Backfill recurrence.exclusions on orphan soft-deleted exceptions
 *
 * Production may have exception documents with `isDeleted: true` whose
 * `occurrenceDate` is NOT present in their master's `recurrence.exclusions[]`.
 * These were created under the pre-DL-1 delete handler, which soft-deleted the
 * exception but did NOT add the date to exclusions.
 *
 * Symptom: every read of the affected series silently re-materializes a virtual
 * occurrence at that date with the master's default fields — the user
 * "deleted" the customization but the date came back.
 *
 * This script aligns the data with DL-1 semantics by adding each orphan's
 * occurrenceDate to its master's recurrence.exclusions via $addToSet
 * (idempotent — safe to re-run).
 *
 * Reference: docs/superpowers/specs/2026-04-24-recurrence-business-logic-design.md §7.2
 *
 * Usage:
 *   node migrate-backfill-exception-exclusions.js --dry-run   # Preview changes
 *   node migrate-backfill-exception-exclusions.js              # Apply changes
 *   node migrate-backfill-exception-exclusions.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;
const RATE_LIMIT_MS = 1000;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\n📋 Migration: Backfill recurrence.exclusions for orphan soft-deleted exceptions`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    // Find every soft-deleted exception document.
    const orphanQuery = {
      eventType: 'exception',
      isDeleted: true,
    };

    const totalSoftDeleted = await collection.countDocuments(orphanQuery);
    console.log(`   Soft-deleted exception documents: ${totalSoftDeleted}`);

    if (totalSoftDeleted === 0) {
      console.log('\n✅ No soft-deleted exceptions found. Nothing to do.');
      return;
    }

    // Pull all soft-deleted exceptions with the fields we need.
    const exceptions = await collection.find(orphanQuery, {
      projection: {
        _id: 1,
        eventId: 1,
        seriesMasterEventId: 1,
        occurrenceDate: 1,
      }
    }).toArray();

    // Group by master so we can issue one update per master, even if the master
    // has many orphan exceptions. Cosmos DB rate-limit-friendly.
    const orphansByMaster = new Map(); // masterEventId -> Set<dateKey>
    const orphansWithoutLink = [];
    const orphansWithoutDate = [];
    for (const ex of exceptions) {
      if (!ex.seriesMasterEventId) {
        orphansWithoutLink.push(ex);
        continue;
      }
      if (!ex.occurrenceDate) {
        orphansWithoutDate.push(ex);
        continue;
      }
      if (!orphansByMaster.has(ex.seriesMasterEventId)) {
        orphansByMaster.set(ex.seriesMasterEventId, new Set());
      }
      orphansByMaster.get(ex.seriesMasterEventId).add(ex.occurrenceDate);
    }

    // For each master, find which dates are NOT yet in exclusions (so we count
    // accurately and skip already-correct masters).
    const masterIds = Array.from(orphansByMaster.keys());
    const masters = await collection.find(
      { eventId: { $in: masterIds } },
      { projection: { _id: 1, eventId: 1, recurrence: 1, calendarData: 1 } }
    ).toArray();

    const masterByEventId = new Map(masters.map(m => [m.eventId, m]));

    // Build update plan: { master, datesToAdd, recurrencePath }
    const plan = [];
    let mastersMissing = 0;
    let mastersNonRecurring = 0;
    let datesAlreadyExcluded = 0;
    let datesToBackfill = 0;

    for (const [masterEventId, dateSet] of orphansByMaster) {
      const master = masterByEventId.get(masterEventId);
      if (!master) {
        mastersMissing++;
        continue;
      }
      const recurrence = master.recurrence || master.calendarData?.recurrence;
      if (!recurrence) {
        // Orphan whose master is no longer recurring — skip silently per spec
        // (E-2 covers these via the orphan-cascade rules; backfill cannot help).
        mastersNonRecurring++;
        continue;
      }
      const recurrencePath = master.recurrence ? 'recurrence' : 'calendarData.recurrence';
      const existingExclusions = new Set(recurrence.exclusions || []);
      const newDates = [];
      for (const dateKey of dateSet) {
        if (existingExclusions.has(dateKey)) {
          datesAlreadyExcluded++;
        } else {
          newDates.push(dateKey);
          datesToBackfill++;
        }
      }
      if (newDates.length > 0) {
        plan.push({ master, datesToAdd: newDates, recurrencePath });
      }
    }

    console.log(`\n   Summary:`);
    console.log(`   - Soft-deleted exceptions inspected: ${exceptions.length}`);
    console.log(`   - Orphans missing seriesMasterEventId: ${orphansWithoutLink.length}`);
    console.log(`   - Orphans missing occurrenceDate: ${orphansWithoutDate.length}`);
    console.log(`   - Distinct masters referenced: ${orphansByMaster.size}`);
    console.log(`   - Masters not found in DB: ${mastersMissing}`);
    console.log(`   - Masters no longer recurring (skipped): ${mastersNonRecurring}`);
    console.log(`   - Dates already in exclusions (no-op): ${datesAlreadyExcluded}`);
    console.log(`   - Dates to backfill: ${datesToBackfill}`);
    console.log(`   - Master updates planned: ${plan.length}`);

    if (datesToBackfill === 0) {
      console.log('\n✅ All soft-deleted exceptions already have their dates in master exclusions. Nothing to do.');
      return;
    }

    if (isDryRun) {
      console.log(`\n   Sample plan (showing up to 10 masters):`);
      for (const item of plan.slice(0, 10)) {
        console.log(`     - master ${item.master.eventId}: add [${item.datesToAdd.join(', ')}] to ${item.recurrencePath}.exclusions`);
      }
      console.log(`\n🔍 DRY RUN: Would add ${datesToBackfill} dates to exclusions across ${plan.length} masters.`);
      return;
    }

    // Apply backfill in batches.
    console.log(`\n   Applying backfill in batches of ${BATCH_SIZE}...`);
    let updated = 0;
    for (let i = 0; i < plan.length; i += BATCH_SIZE) {
      const batch = plan.slice(i, i + BATCH_SIZE);

      // One update per master; $addToSet with $each keeps the array deduped.
      // We can't use updateMany here because each master adds a different set
      // of dates. Use Promise.all for parallel execution within the batch.
      const ops = batch.map(({ master, datesToAdd, recurrencePath }) =>
        collection.updateOne(
          { _id: master._id },
          {
            $addToSet: { [`${recurrencePath}.exclusions`]: { $each: datesToAdd } },
            $inc: { _version: 1 },
            $set: { lastModifiedDateTime: new Date() }
          }
        )
      );

      const results = await Promise.all(ops);
      updated += results.reduce((sum, r) => sum + (r.modifiedCount || 0), 0);

      const processed = Math.min(i + BATCH_SIZE, plan.length);
      const percent = Math.round((processed / plan.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${plan.length})`);

      if (i + BATCH_SIZE < plan.length) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
      }
    }

    console.log(`\n\n✅ Migration complete. Updated ${updated} masters with ${datesToBackfill} new exclusion dates.`);

    if (orphansWithoutLink.length > 0) {
      console.log(`\n⚠️  ${orphansWithoutLink.length} orphan exceptions had no seriesMasterEventId — skipped (data corruption; investigate separately).`);
    }
    if (orphansWithoutDate.length > 0) {
      console.log(`⚠️  ${orphansWithoutDate.length} orphan exceptions had no occurrenceDate — skipped (data corruption; investigate separately).`);
    }
    if (mastersMissing > 0) {
      console.log(`⚠️  ${mastersMissing} masters referenced by orphans were not found in DB — likely already hard-deleted.`);
    }

    // Verify
    await verify(collection);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function verify(collection) {
  // Count soft-deleted exceptions whose date is missing from their master's
  // exclusions. Zero == migration complete.
  const exceptions = await collection.find(
    { eventType: 'exception', isDeleted: true },
    { projection: { seriesMasterEventId: 1, occurrenceDate: 1 } }
  ).toArray();

  if (exceptions.length === 0) {
    console.log('\n📊 Verification:');
    console.log('   No soft-deleted exceptions exist. Migration not applicable.');
    return;
  }

  const orphansByMaster = new Map();
  for (const ex of exceptions) {
    if (!ex.seriesMasterEventId || !ex.occurrenceDate) continue;
    if (!orphansByMaster.has(ex.seriesMasterEventId)) {
      orphansByMaster.set(ex.seriesMasterEventId, new Set());
    }
    orphansByMaster.get(ex.seriesMasterEventId).add(ex.occurrenceDate);
  }

  const masters = await collection.find(
    { eventId: { $in: Array.from(orphansByMaster.keys()) } },
    { projection: { eventId: 1, recurrence: 1, calendarData: 1 } }
  ).toArray();

  let stillOrphaned = 0;
  for (const master of masters) {
    const recurrence = master.recurrence || master.calendarData?.recurrence;
    if (!recurrence) continue;
    const exclusions = new Set(recurrence.exclusions || []);
    const expectedDates = orphansByMaster.get(master.eventId);
    for (const dateKey of expectedDates) {
      if (!exclusions.has(dateKey)) stillOrphaned++;
    }
  }

  console.log('\n📊 Verification:');
  console.log(`   Total soft-deleted exceptions: ${exceptions.length}`);
  console.log(`   Distinct masters referenced: ${orphansByMaster.size}`);
  console.log(`   Dates still missing from master exclusions: ${stillOrphaned}`);

  if (stillOrphaned === 0) {
    console.log('\n✅ All soft-deleted exception dates are present in master exclusions.');
  } else {
    console.log(`\n⚠️  ${stillOrphaned} dates still need backfill. Re-run without --verify to apply.`);
  }
}

main();

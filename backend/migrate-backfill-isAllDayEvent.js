/**
 * Migration: Backfill calendarData.isAllDayEvent canonical key
 *
 * Two sources can leave calendarData.isAllDayEvent unset on an otherwise
 * all-day event:
 *
 *   1. rSched import (rschedImportService.js:440) writes the flag under the
 *      wrong key calendarData.isAllDay instead of calendarData.isAllDayEvent.
 *   2. Graph-synced documents that lost the calendarData.isAllDayEvent
 *      projection during a re-sync but still have graphData.isAllDay = true.
 *
 * Both populate calendarData.isAllDayEvent: true so backend operations
 * (conflict detection, audit projection, future syncs) and direct MongoDB
 * readers see the canonical field.
 *
 * Usage:
 *   node migrate-backfill-isAllDayEvent.js --dry-run   # Preview changes
 *   node migrate-backfill-isAllDayEvent.js              # Apply changes
 *   node migrate-backfill-isAllDayEvent.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

// Backfill canonical isAllDayEvent where rSched used the wrong key,
// OR where graphData has the flag but calendarData lost the projection.
const BACKFILL_QUERY = {
  'calendarData.isAllDayEvent': { $ne: true },
  $or: [
    { 'calendarData.isAllDay': true },
    { 'graphData.isAllDay': true }
  ]
};

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\nMigration: Backfill calendarData.isAllDayEvent`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    const totalEvents = await collection.countDocuments({});
    const totalAffected = await collection.countDocuments(BACKFILL_QUERY);
    const rschedVariant = await collection.countDocuments({
      'calendarData.isAllDayEvent': { $ne: true },
      'calendarData.isAllDay': true
    });
    const graphDataVariant = await collection.countDocuments({
      'calendarData.isAllDayEvent': { $ne: true },
      'calendarData.isAllDay': { $ne: true },
      'graphData.isAllDay': true
    });

    console.log(`   Total events: ${totalEvents}`);
    console.log(`   Events needing backfill: ${totalAffected}`);
    console.log(`     - rSched-import variant (calendarData.isAllDay): ${rschedVariant}`);
    console.log(`     - graphData-only variant: ${graphDataVariant}`);

    if (totalAffected === 0) {
      console.log('\nNothing to backfill.');
      return;
    }

    if (isDryRun) {
      const samples = await collection.find(BACKFILL_QUERY).limit(10).toArray();
      console.log(`\n   Sample affected events (showing up to 10):`);
      for (const event of samples) {
        const title = event.calendarData?.eventTitle || event.eventTitle || event.subject || 'N/A';
        const flagSource =
          event.calendarData?.isAllDay === true ? 'calendarData.isAllDay' :
          event.graphData?.isAllDay === true ? 'graphData.isAllDay' : '?';
        console.log(`     - ${event.eventId || event._id} | source: ${flagSource} | title: ${title}`);
      }
      console.log(`\nDRY RUN: Would set calendarData.isAllDayEvent: true on ${totalAffected} events`);
      return;
    }

    console.log(`\n   Updating ${totalAffected} events in batches of ${BATCH_SIZE}...`);
    const docsToProcess = await collection.find(BACKFILL_QUERY).toArray();

    let updated = 0;
    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);

      const result = await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $set: { 'calendarData.isAllDayEvent': true } }
      );

      updated += result.modifiedCount;

      const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
      const percent = Math.round((processed / docsToProcess.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

      if (i + BATCH_SIZE < docsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n\nMigration complete. Updated ${updated} events.`);

    await verify(collection);

  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function verify(collection) {
  const remaining = await collection.countDocuments(BACKFILL_QUERY);
  const totalAllDay = await collection.countDocuments({ 'calendarData.isAllDayEvent': true });
  const total = await collection.countDocuments({});

  console.log(`\nVerification:`);
  console.log(`   Total events: ${total}`);
  console.log(`   Events with calendarData.isAllDayEvent: true: ${totalAllDay}`);
  console.log(`   Events still needing backfill: ${remaining}`);

  if (remaining === 0) {
    console.log(`\nAll candidate events now have calendarData.isAllDayEvent: true.`);
  } else {
    console.log(`\n${remaining} events still match the backfill query.`);
  }
}

main();

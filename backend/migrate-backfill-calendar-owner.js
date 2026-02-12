/**
 * Migration: Backfill calendarOwner on orphan events
 *
 * Events created before the calendarOwner fix may have null/missing calendarOwner,
 * or may have the wrong value 'templesandbox@emanuelnyc.org' (typo - missing "events").
 * This script sets them to the correct calendar owner based on CALENDAR_MODE.
 *
 * Usage:
 *   node migrate-backfill-calendar-owner.js --dry-run   # Preview changes
 *   node migrate-backfill-calendar-owner.js              # Apply changes
 *   node migrate-backfill-calendar-owner.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

// Determine default calendar owner from environment
const CALENDAR_MODE = process.env.CALENDAR_MODE || 'sandbox';
const DEFAULT_OWNER = CALENDAR_MODE === 'production'
  ? 'templeevents@emanuelnyc.org'
  : 'templeeventssandbox@emanuelnyc.org';

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\n📋 Migration: Backfill calendarOwner`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Calendar Mode: ${CALENDAR_MODE}`);
    console.log(`   Default Owner: ${DEFAULT_OWNER}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    // Known typo values that need fixing (missing "events" in the middle)
    const TYPO_VALUES = ['templesandbox@emanuelnyc.org'];

    // Find events with null/missing/empty calendarOwner OR the typo value
    const orphanQuery = {
      $or: [
        { calendarOwner: null },
        { calendarOwner: { $exists: false } },
        { calendarOwner: '' },
        { calendarOwner: { $in: TYPO_VALUES } }
      ]
    };

    const totalOrphans = await collection.countDocuments(orphanQuery);
    const totalEvents = await collection.countDocuments({});

    console.log(`   Total events: ${totalEvents}`);
    console.log(`   Events missing calendarOwner: ${totalOrphans}`);

    if (totalOrphans === 0) {
      console.log('\n✅ No orphan events found. Nothing to do.');
      return;
    }

    if (isDryRun) {
      // Show sample of affected events
      const samples = await collection.find(orphanQuery).limit(10).toArray();
      console.log(`\n   Sample affected events (showing up to 10):`);
      for (const event of samples) {
        console.log(`     - ${event.eventId || event._id} | status: ${event.status} | title: ${event.calendarData?.eventTitle || event.eventTitle || 'N/A'}`);
      }
      console.log(`\n🔍 DRY RUN: Would update ${totalOrphans} events with calendarOwner: "${DEFAULT_OWNER}"`);
      return;
    }

    // Apply migration in batches
    console.log(`\n   Updating ${totalOrphans} events in batches of ${BATCH_SIZE}...`);
    const docsToProcess = await collection.find(orphanQuery).toArray();

    let updated = 0;
    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);

      const result = await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $set: { calendarOwner: DEFAULT_OWNER } }
      );

      updated += result.modifiedCount;

      const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
      const percent = Math.round((processed / docsToProcess.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

      // Rate limit delay between batches (for Cosmos DB)
      if (i + BATCH_SIZE < docsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n\n✅ Migration complete. Updated ${updated} events.`);

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
  const TYPO_VALUES = ['templesandbox@emanuelnyc.org'];

  const orphanQuery = {
    $or: [
      { calendarOwner: null },
      { calendarOwner: { $exists: false } },
      { calendarOwner: '' },
      { calendarOwner: { $in: TYPO_VALUES } }
    ]
  };

  const remaining = await collection.countDocuments(orphanQuery);
  const typoCount = await collection.countDocuments({ calendarOwner: { $in: TYPO_VALUES } });
  const total = await collection.countDocuments({});
  const withOwner = await collection.countDocuments({
    calendarOwner: { $exists: true, $ne: null, $ne: '' }
  });

  console.log(`\n📊 Verification:`);
  console.log(`   Total events: ${total}`);
  console.log(`   Events with calendarOwner: ${withOwner}`);
  console.log(`   Events missing calendarOwner: ${remaining - typoCount}`);
  console.log(`   Events with typo calendarOwner: ${typoCount}`);
  console.log(`   Total needing fix: ${remaining}`);

  if (remaining === 0) {
    console.log(`\n✅ All events have correct calendarOwner.`);
  } else {
    console.log(`\n⚠️  ${remaining} events still need calendarOwner fix.`);
  }
}

main();

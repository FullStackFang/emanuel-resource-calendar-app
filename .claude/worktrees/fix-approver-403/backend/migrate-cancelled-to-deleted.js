/**
 * Migration: Convert cancelled events to deleted
 *
 * The 'cancelled' status has been consolidated into 'deleted'.
 * This script updates all events with status 'cancelled' to status 'deleted',
 * sets isDeleted: true, and copies cancel metadata to deletion fields.
 *
 * Usage:
 *   node migrate-cancelled-to-deleted.js --dry-run   # Preview changes
 *   node migrate-cancelled-to-deleted.js              # Apply changes
 *   node migrate-cancelled-to-deleted.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\n📋 Migration: Convert cancelled events to deleted`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      const cancelledCount = await collection.countDocuments({ status: 'cancelled' });
      const deletedCount = await collection.countDocuments({ status: 'deleted' });
      console.log(`   Remaining cancelled events: ${cancelledCount}`);
      console.log(`   Total deleted events: ${deletedCount}`);
      if (cancelledCount === 0) {
        console.log('\n   ✅ Migration verified — no cancelled events remain.');
      } else {
        console.log(`\n   ⚠️  ${cancelledCount} cancelled events still need migration.`);
      }
      return;
    }

    // Find all cancelled events
    const cancelledEvents = await collection.find({ status: 'cancelled' }).toArray();
    console.log(`   Found ${cancelledEvents.length} cancelled events to migrate.\n`);

    if (cancelledEvents.length === 0) {
      console.log('   Nothing to migrate.');
      return;
    }

    if (isDryRun) {
      console.log('   DRY RUN — no changes will be made.\n');
      for (const event of cancelledEvents.slice(0, 5)) {
        const cd = event.calendarData || {};
        console.log(`   - ${cd.eventTitle || event.eventTitle || 'Untitled'} (${event._id})`);
        console.log(`     cancelReason: ${event.roomReservationData?.cancelReason || 'none'}`);
        console.log(`     cancelledAt: ${event.roomReservationData?.cancelledAt || 'none'}`);
      }
      if (cancelledEvents.length > 5) {
        console.log(`   ... and ${cancelledEvents.length - 5} more.`);
      }
      return;
    }

    // Process in batches
    let processed = 0;
    for (let i = 0; i < cancelledEvents.length; i += BATCH_SIZE) {
      const batch = cancelledEvents.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map(e => e._id);

      // Build per-event updates to copy cancel metadata
      for (const event of batch) {
        const cancelledAt = event.roomReservationData?.cancelledAt || new Date();
        const cancelledBy = event.roomReservationData?.cancelledBy || null;
        const cancelReason = event.roomReservationData?.cancelReason || 'Cancelled (migrated to deleted)';

        await collection.updateOne(
          { _id: event._id },
          {
            $set: {
              status: 'deleted',
              isDeleted: true,
              deletedAt: cancelledAt,
              deletedBy: cancelledBy,
            },
            $push: {
              statusHistory: {
                status: 'deleted',
                changedAt: new Date(),
                reason: `Migration: cancelled status consolidated into deleted. Original reason: ${cancelReason}`
              }
            }
          }
        );
      }

      processed = Math.min(i + BATCH_SIZE, cancelledEvents.length);
      const percent = Math.round((processed / cancelledEvents.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${cancelledEvents.length})`);

      // Rate limit delay between batches
      if (i + BATCH_SIZE < cancelledEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n\n   ✅ Migrated ${processed} events from cancelled to deleted.`);

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

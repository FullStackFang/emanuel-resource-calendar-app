// migrate-backfill-status-history.js
// Migration script to backfill statusHistory for existing events that have null/empty statusHistory.
//
// For non-deleted events: Creates an initial entry from current status using createdAt/createdBy.
// For deleted events: Creates an entry from previousStatus (or 'draft' fallback) + a deleted entry.
//
// This ensures the restore endpoint can correctly determine the previous status
// by walking statusHistory backwards.
//
// Run with:
//   node migrate-backfill-status-history.js --dry-run    # Preview changes
//   node migrate-backfill-status-history.js              # Apply changes
//   node migrate-backfill-status-history.js --verify     # Verify results

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const BATCH_SIZE = 100;

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerify = args.includes('--verify');

async function migrate() {
  const mode = isDryRun ? 'DRY RUN' : (isVerify ? 'VERIFY' : 'APPLY');
  console.log(`\n===============================================`);
  console.log(`  Migration: Backfill statusHistory`);
  console.log(`  Mode: ${mode}`);
  console.log(`===============================================\n`);

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('Error: MONGODB_CONNECTION_STRING or MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 30)}...`);
  console.log(`   Batch Size: ${BATCH_SIZE}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Step 1: Gather statistics
    console.log('--- Current State ---\n');

    const totalDocs = await collection.countDocuments({});
    console.log(`Total documents: ${totalDocs}`);

    const hasStatusHistory = await collection.countDocuments({
      statusHistory: { $exists: true, $ne: null, $not: { $size: 0 } }
    });
    const needsMigration = await collection.countDocuments({
      $or: [
        { statusHistory: { $exists: false } },
        { statusHistory: null },
        { statusHistory: { $size: 0 } }
      ]
    });

    console.log(`Events with statusHistory: ${hasStatusHistory}`);
    console.log(`Events without statusHistory (need migration): ${needsMigration}`);

    if (isVerify) {
      // Verify mode - just show stats and exit
      console.log('\n--- Verification Summary ---\n');

      if (needsMigration === 0 && hasStatusHistory > 0) {
        console.log('PASS: Migration is complete. All events have statusHistory.');
      } else if (needsMigration > 0) {
        console.log(`INCOMPLETE: ${needsMigration} events still need migration.`);
      } else if (hasStatusHistory === 0) {
        console.log('NOT STARTED: No events have statusHistory yet.');
      } else {
        console.log('No events in collection.');
      }

      // Check for empty arrays (should not exist after migration)
      const emptyArrays = await collection.countDocuments({ statusHistory: { $size: 0 } });
      if (emptyArrays > 0) {
        console.log(`WARNING: ${emptyArrays} events have empty statusHistory arrays`);
      } else {
        console.log('Data consistency: OK (no empty statusHistory arrays)');
      }

      await client.close();
      return;
    }

    if (needsMigration === 0) {
      console.log('\nNo events need migration. All events already have statusHistory.');
      await client.close();
      return;
    }

    // Step 2: Find all events that need migration
    console.log(`\n--- ${isDryRun ? 'DRY RUN - Previewing' : 'Applying'} Migration ---\n`);

    const eventsToMigrate = await collection.find({
      $or: [
        { statusHistory: { $exists: false } },
        { statusHistory: null },
        { statusHistory: { $size: 0 } }
      ]
    }).project({
      _id: 1,
      eventTitle: 1,
      status: 1,
      isDeleted: 1,
      previousStatus: 1,
      createdAt: 1,
      createdBy: 1,
      createdByEmail: 1,
      deletedAt: 1,
      deletedBy: 1,
      submittedAt: 1,
      'roomReservationData.requestedBy.userId': 1,
      'roomReservationData.requestedBy.email': 1,
      requesterEmail: 1
    }).toArray();

    console.log(`Found ${eventsToMigrate.length} events to migrate`);

    if (isDryRun) {
      // Show sample of what would be migrated
      console.log('\nSample of events to migrate (first 10):');
      const sample = eventsToMigrate.slice(0, 10);
      for (const event of sample) {
        const statusHistory = buildStatusHistory(event);
        console.log(`  Event: ${event.eventTitle || 'Untitled'} (status: ${event.status || 'unknown'})`);
        console.log(`    -> Would set statusHistory with ${statusHistory.length} entries:`);
        for (const entry of statusHistory) {
          console.log(`       [${entry.status}] by ${entry.changedByEmail || entry.changedBy} - "${entry.reason}"`);
        }
      }

      // Show status distribution
      const statusDistribution = {};
      for (const event of eventsToMigrate) {
        const status = event.status || 'unknown';
        statusDistribution[status] = (statusDistribution[status] || 0) + 1;
      }

      console.log('\nStatus distribution of events to migrate:');
      for (const [status, count] of Object.entries(statusDistribution)) {
        console.log(`  ${status}: ${count}`);
      }

      console.log('\n--- DRY RUN COMPLETE ---');
      console.log(`Would migrate ${eventsToMigrate.length} events.`);
      console.log('Run without --dry-run to apply changes.');

      await client.close();
      return;
    }

    // Step 3: Apply migration in batches (individual updates since each event gets unique statusHistory)
    let totalMigrated = 0;
    let totalErrors = 0;

    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        try {
          const statusHistory = buildStatusHistory(event);
          await collection.updateOne(
            { _id: event._id },
            { $set: { statusHistory } }
          );
          totalMigrated++;
        } catch (error) {
          totalErrors++;
          console.error(`   Error migrating event ${event._id}: ${error.message}`);
        }
      }

      // Progress bar
      const processed = Math.min(i + BATCH_SIZE, eventsToMigrate.length);
      const percent = Math.round((processed / eventsToMigrate.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${eventsToMigrate.length})`);

      // Rate limit delay between batches (for Cosmos DB)
      if (i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n');

    // Step 4: Verify results
    console.log('--- Post-Migration Stats ---\n');

    const newHasStatusHistory = await collection.countDocuments({
      statusHistory: { $exists: true, $ne: null, $not: { $size: 0 } }
    });
    const stillNeedsMigration = await collection.countDocuments({
      $or: [
        { statusHistory: { $exists: false } },
        { statusHistory: null },
        { statusHistory: { $size: 0 } }
      ]
    });

    console.log(`Events with statusHistory: ${newHasStatusHistory}`);
    console.log(`Events still needing migration: ${stillNeedsMigration}`);

    console.log('\n--- Migration Summary ---\n');
    console.log(`Total migrated: ${totalMigrated}`);
    console.log(`Total errors: ${totalErrors}`);

    if (stillNeedsMigration === 0) {
      console.log('\nMigration completed successfully!');
    } else {
      console.log(`\nWARNING: ${stillNeedsMigration} events could not be migrated.`);
    }

    await client.close();
    console.log('\nDisconnected from MongoDB');

  } catch (error) {
    console.error('\nFatal error:', error);
    await client.close();
    process.exit(1);
  }
}

/**
 * Build a statusHistory array for an event based on its current state.
 *
 * For non-deleted events: Single entry with current status.
 * For deleted events: Entry for previousStatus (or 'draft' fallback) + deleted entry.
 */
function buildStatusHistory(event) {
  const createdAt = event.createdAt || new Date();
  const createdBy = event.createdBy || event.roomReservationData?.requestedBy?.userId || 'unknown';
  const createdByEmail = event.createdByEmail || event.requesterEmail ||
    event.roomReservationData?.requestedBy?.email || 'unknown';

  if (event.isDeleted || event.status === 'deleted') {
    // Deleted event: create previousStatus entry + deleted entry
    const previousStatus = event.previousStatus || 'draft';
    return [
      {
        status: previousStatus,
        changedAt: createdAt,
        changedBy: createdBy,
        changedByEmail: createdByEmail,
        reason: `Backfilled: event was ${previousStatus} before deletion`
      },
      {
        status: 'deleted',
        changedAt: event.deletedAt || new Date(),
        changedBy: event.deletedBy || 'unknown',
        changedByEmail: event.deletedBy || 'unknown',
        reason: 'Backfilled: event was deleted'
      }
    ];
  }

  // Non-deleted event: single entry with current status
  const status = event.status || 'draft';
  let reason = `Backfilled: event created with status ${status}`;

  return [{
    status,
    changedAt: createdAt,
    changedBy: createdBy,
    changedByEmail: createdByEmail,
    reason
  }];
}

migrate();

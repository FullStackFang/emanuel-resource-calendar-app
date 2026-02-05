// migrate-add-recurrence-to-calendardata.js
// Migration script to copy recurring event metadata from graphData to top-level fields
//
// This completes the graphData isolation cleanup by moving recurring event fields
// (type, seriesMasterId, recurrence) to top-level authoritative fields.
//
// Fields migrated:
//   graphData.type -> eventType
//   graphData.seriesMasterId -> seriesMasterId
//   graphData.recurrence -> recurrence
//
// Run with:
//   node migrate-add-recurrence-to-calendardata.js --dry-run    # Preview changes
//   node migrate-add-recurrence-to-calendardata.js              # Apply changes
//   node migrate-add-recurrence-to-calendardata.js --verify     # Verify results

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
  console.log(`  Migration: Add Recurring Event Metadata`);
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

    // Count events with graphData containing recurring fields
    const hasGraphType = await collection.countDocuments({ 'graphData.type': { $exists: true } });
    const hasGraphSeriesMasterId = await collection.countDocuments({ 'graphData.seriesMasterId': { $exists: true, $ne: null } });
    const hasGraphRecurrence = await collection.countDocuments({ 'graphData.recurrence': { $exists: true, $ne: null } });

    console.log(`\nEvents with graphData.type: ${hasGraphType}`);
    console.log(`Events with graphData.seriesMasterId (non-null): ${hasGraphSeriesMasterId}`);
    console.log(`Events with graphData.recurrence (non-null): ${hasGraphRecurrence}`);

    // Count events already migrated (have top-level eventType)
    const hasEventType = await collection.countDocuments({ eventType: { $exists: true } });
    const hasSeriesMasterId = await collection.countDocuments({ seriesMasterId: { $exists: true } });
    const hasRecurrence = await collection.countDocuments({ recurrence: { $exists: true } });

    console.log(`\nEvents with eventType (migrated): ${hasEventType}`);
    console.log(`Events with seriesMasterId (migrated): ${hasSeriesMasterId}`);
    console.log(`Events with recurrence (migrated): ${hasRecurrence}`);

    // Find events that need migration (have graphData but no eventType)
    const needsMigration = await collection.countDocuments({
      'graphData.type': { $exists: true },
      eventType: { $exists: false }
    });

    console.log(`\nEvents needing migration: ${needsMigration}`);

    if (isVerify) {
      // Verify mode - just show stats and exit
      console.log('\n--- Verification Summary ---\n');

      if (needsMigration === 0 && hasEventType > 0) {
        console.log('PASS: Migration is complete. All events with graphData have eventType.');
      } else if (needsMigration > 0) {
        console.log(`INCOMPLETE: ${needsMigration} events still need migration.`);
      } else if (hasEventType === 0 && hasGraphType > 0) {
        console.log('NOT STARTED: No events have been migrated yet.');
      } else {
        console.log('No events require migration (no graphData present).');
      }

      // Check for data consistency
      const inconsistent = await collection.countDocuments({
        $or: [
          // Has eventType but doesn't match graphData.type
          {
            eventType: { $exists: true },
            'graphData.type': { $exists: true },
            $expr: { $ne: ['$eventType', '$graphData.type'] }
          }
        ]
      });

      if (inconsistent > 0) {
        console.log(`WARNING: ${inconsistent} events have inconsistent eventType vs graphData.type`);
      } else {
        console.log('Data consistency: OK');
      }

      await client.close();
      return;
    }

    if (needsMigration === 0) {
      console.log('\nNo events need migration. All events already have top-level recurring fields.');
      await client.close();
      return;
    }

    // Step 2: Find all events that need migration
    console.log(`\n--- ${isDryRun ? 'DRY RUN - Previewing' : 'Applying'} Migration ---\n`);

    const eventsToMigrate = await collection.find({
      'graphData.type': { $exists: true },
      eventType: { $exists: false }
    }).toArray();

    console.log(`Found ${eventsToMigrate.length} events to migrate`);

    if (isDryRun) {
      // Show sample of what would be migrated
      console.log('\nSample of events to migrate (first 5):');
      const sample = eventsToMigrate.slice(0, 5);
      for (const event of sample) {
        console.log(`\n  Event: ${event.eventTitle || event.graphData?.subject || 'Untitled'}`);
        console.log(`    graphData.type: ${event.graphData?.type}`);
        console.log(`    graphData.seriesMasterId: ${event.graphData?.seriesMasterId || 'null'}`);
        console.log(`    graphData.recurrence: ${event.graphData?.recurrence ? 'present' : 'null'}`);
        console.log(`    -> Would set eventType: ${event.graphData?.type || 'singleInstance'}`);
        console.log(`    -> Would set seriesMasterId: ${event.graphData?.seriesMasterId || 'null'}`);
        console.log(`    -> Would set recurrence: ${event.graphData?.recurrence ? 'present' : 'null'}`);
      }

      // Show event type distribution
      const typeDistribution = {};
      for (const event of eventsToMigrate) {
        const type = event.graphData?.type || 'singleInstance';
        typeDistribution[type] = (typeDistribution[type] || 0) + 1;
      }

      console.log('\nEvent type distribution:');
      for (const [type, count] of Object.entries(typeDistribution)) {
        console.log(`  ${type}: ${count}`);
      }

      console.log('\n--- DRY RUN COMPLETE ---');
      console.log(`Would migrate ${eventsToMigrate.length} events.`);
      console.log('Run without --dry-run to apply changes.');

      await client.close();
      return;
    }

    // Step 3: Apply migration in batches
    let totalMigrated = 0;
    let totalErrors = 0;

    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);

      // Build bulk operations for this batch
      const bulkOps = batch.map(event => ({
        updateOne: {
          filter: { _id: event._id },
          update: {
            $set: {
              eventType: event.graphData?.type || 'singleInstance',
              seriesMasterId: event.graphData?.seriesMasterId || null,
              recurrence: event.graphData?.recurrence || null
            }
          }
        }
      }));

      try {
        const result = await collection.bulkWrite(bulkOps, { ordered: false });
        totalMigrated += result.modifiedCount;
      } catch (error) {
        // Handle partial failures (some docs may have been updated)
        if (error.result) {
          totalMigrated += error.result.nModified || 0;
        }
        totalErrors += batch.length - (error.result?.nModified || 0);
        console.error(`   Batch error: ${error.message}`);
      }

      // Progress bar
      const processed = Math.min(i + BATCH_SIZE, eventsToMigrate.length);
      const percent = Math.round((processed / eventsToMigrate.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${eventsToMigrate.length})`);

      // Rate limit delay between batches
      if (i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n');

    // Step 4: Verify results
    console.log('--- Post-Migration Stats ---\n');

    const newHasEventType = await collection.countDocuments({ eventType: { $exists: true } });
    const newHasSeriesMasterId = await collection.countDocuments({ seriesMasterId: { $exists: true } });
    const newHasRecurrence = await collection.countDocuments({ recurrence: { $exists: true } });
    const stillNeedsMigration = await collection.countDocuments({
      'graphData.type': { $exists: true },
      eventType: { $exists: false }
    });

    console.log(`Events with eventType: ${newHasEventType}`);
    console.log(`Events with seriesMasterId: ${newHasSeriesMasterId}`);
    console.log(`Events with recurrence: ${newHasRecurrence}`);
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

migrate();

// migrate-add-version-field.js
// Migration script to add _version field to all event documents for optimistic concurrency control
//
// The _version field is an integer that increments on every write operation.
// This enables atomic version-guarded updates via findOneAndUpdate.
//
// Fields added:
//   _version: 1 (initial version for existing documents)
//
// Run with:
//   node migrate-add-version-field.js --dry-run    # Preview changes
//   node migrate-add-version-field.js              # Apply changes
//   node migrate-add-version-field.js --verify     # Verify results

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
  console.log(`  Migration: Add _version Field`);
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

    const hasVersion = await collection.countDocuments({ _version: { $exists: true } });
    const needsMigration = await collection.countDocuments({ _version: { $exists: false } });

    console.log(`Events with _version: ${hasVersion}`);
    console.log(`Events without _version (need migration): ${needsMigration}`);

    if (isVerify) {
      // Verify mode - just show stats and exit
      console.log('\n--- Verification Summary ---\n');

      if (needsMigration === 0 && hasVersion > 0) {
        console.log('PASS: Migration is complete. All events have _version field.');
      } else if (needsMigration > 0) {
        console.log(`INCOMPLETE: ${needsMigration} events still need migration.`);
      } else if (hasVersion === 0) {
        console.log('NOT STARTED: No events have been migrated yet.');
      } else {
        console.log('No events in collection.');
      }

      // Check for invalid _version values
      const invalidVersion = await collection.countDocuments({
        _version: { $exists: true, $not: { $type: 'int' } }
      });

      // Also check for non-number types (double is OK too)
      const nonNumericVersion = await collection.countDocuments({
        _version: { $exists: true },
        $nor: [
          { _version: { $type: 'int' } },
          { _version: { $type: 'double' } },
          { _version: { $type: 'long' } }
        ]
      });

      if (nonNumericVersion > 0) {
        console.log(`WARNING: ${nonNumericVersion} events have non-numeric _version values`);
      } else {
        console.log('Data consistency: OK');
      }

      await client.close();
      return;
    }

    if (needsMigration === 0) {
      console.log('\nNo events need migration. All events already have _version field.');
      await client.close();
      return;
    }

    // Step 2: Find all events that need migration
    console.log(`\n--- ${isDryRun ? 'DRY RUN - Previewing' : 'Applying'} Migration ---\n`);

    const eventsToMigrate = await collection.find({
      _version: { $exists: false }
    }).project({ _id: 1, eventTitle: 1, status: 1 }).toArray();

    console.log(`Found ${eventsToMigrate.length} events to migrate`);

    if (isDryRun) {
      // Show sample of what would be migrated
      console.log('\nSample of events to migrate (first 5):');
      const sample = eventsToMigrate.slice(0, 5);
      for (const event of sample) {
        console.log(`  Event: ${event.eventTitle || 'Untitled'} (status: ${event.status || 'unknown'})`);
        console.log(`    -> Would set _version: 1`);
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

    // Step 3: Apply migration in batches
    let totalMigrated = 0;
    let totalErrors = 0;

    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);

      try {
        const result = await collection.updateMany(
          { _id: { $in: batch.map(d => d._id) }, _version: { $exists: false } },
          { $set: { _version: 1 } }
        );
        totalMigrated += result.modifiedCount;
      } catch (error) {
        totalErrors += batch.length;
        console.error(`   Batch error: ${error.message}`);
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

    const newHasVersion = await collection.countDocuments({ _version: { $exists: true } });
    const stillNeedsMigration = await collection.countDocuments({ _version: { $exists: false } });

    console.log(`Events with _version: ${newHasVersion}`);
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

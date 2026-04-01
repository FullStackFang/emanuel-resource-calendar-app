// migrate-cleanup-calendar-data.js
// Phase 3: Cleanup migration script to remove redundant top-level fields
//
// WARNING: Only run this script AFTER Phase 2 has been stable in production for 1-2 weeks!
//
// PURPOSE: Remove redundant top-level fields that have been consolidated into calendarData.
// After this migration, fields will ONLY exist in calendarData, reducing document size
// and simplifying the schema.
//
// PREREQUISITES:
// 1. Phase 1 migration completed (calendarData object exists)
// 2. Phase 2 code changes deployed (application reads from calendarData with fallback)
// 3. Stable production operation for 1-2 weeks with no issues
//
// Run with: node migrate-cleanup-calendar-data.js
// Dry run: node migrate-cleanup-calendar-data.js --dry-run
// Verify: node migrate-cleanup-calendar-data.js --verify

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');

// Fields to remove from top level (now in calendarData)
// These are the same fields that were migrated in Phase 1
const FIELDS_TO_REMOVE = [
  // Core event info
  'eventTitle',
  'eventDescription',

  // Date/time fields
  'startDateTime',
  'endDateTime',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'isAllDayEvent',

  // Setup/teardown timing
  'setupTime',
  'teardownTime',
  'setupTimeMinutes',
  'teardownTimeMinutes',
  'doorOpenTime',
  'doorCloseTime',

  // Notes
  'setupNotes',
  'doorNotes',
  'eventNotes',

  // Location fields
  'locations',
  'locationDisplayNames',
  'locationCodes',

  // Offsite location
  'isOffsite',
  'offsiteName',
  'offsiteAddress',
  'offsiteLat',
  'offsiteLon',

  // Virtual meeting
  'virtualMeetingUrl',
  'virtualPlatform',

  // Categories and assignments
  'categories',
  'mecCategories',
  'services',
  'assignedTo',

  // Series/recurrence data
  'eventSeriesId',
  'seriesLength',
  'seriesIndex',

  // Requester info
  'requesterName',
  'requesterEmail',
  'department',
  'phone',

  // Event details
  'attendeeCount',
  'priority',
  'specialRequirements',

  // Contact person
  'contactName',
  'contactEmail',
  'isOnBehalfOf',
  'reviewNotes'
];

async function verifyCleanup(collection) {
  console.log('\n📊 Cleanup Verification Report\n');

  const totalDocs = await collection.countDocuments({});
  const withCalendarData = await collection.countDocuments({ calendarData: { $exists: true } });
  const withoutCalendarData = await collection.countDocuments({ calendarData: { $exists: false } });

  console.log(`Total documents: ${totalDocs}`);
  console.log(`With calendarData: ${withCalendarData} (${((withCalendarData / totalDocs) * 100).toFixed(1)}%)`);
  console.log(`Without calendarData: ${withoutCalendarData} (${((withoutCalendarData / totalDocs) * 100).toFixed(1)}%)`);

  // Check for any remaining top-level fields that should have been cleaned
  console.log('\n📋 Remaining top-level fields (should be 0 after cleanup):');

  for (const field of FIELDS_TO_REMOVE.slice(0, 10)) { // Check first 10 fields
    const countWithField = await collection.countDocuments({
      calendarData: { $exists: true },
      [field]: { $exists: true }
    });
    if (countWithField > 0) {
      console.log(`   ${field}: ${countWithField} documents still have this field`);
    }
  }

  // Sample a document to show current structure
  const sampleDoc = await collection.findOne({ calendarData: { $exists: true } });
  if (sampleDoc) {
    console.log('\n📝 Sample document structure:');
    const topLevelKeys = Object.keys(sampleDoc).filter(k => !k.startsWith('_'));
    console.log(`   Top-level keys: ${topLevelKeys.join(', ')}`);

    const remainingCleanupFields = FIELDS_TO_REMOVE.filter(f => sampleDoc[f] !== undefined);
    if (remainingCleanupFields.length > 0) {
      console.log(`\n⚠️  Redundant top-level fields still present: ${remainingCleanupFields.join(', ')}`);
    } else {
      console.log('\n✅ No redundant top-level fields found in sample document');
    }
  }

  // Final assessment
  const docsWithRedundantFields = await collection.countDocuments({
    calendarData: { $exists: true },
    $or: FIELDS_TO_REMOVE.map(f => ({ [f]: { $exists: true } }))
  });

  console.log(`\n📊 Documents with redundant top-level fields: ${docsWithRedundantFields}`);

  if (docsWithRedundantFields === 0) {
    console.log('✅ Cleanup complete - no redundant fields remain!');
  } else {
    console.log(`⚠️  ${docsWithRedundantFields} documents still need cleanup`);
  }
}

async function cleanupCalendarData() {
  console.log('🚀 Starting Phase 3: Remove redundant top-level fields from templeEvents__Events\n');
  console.log('⚠️  WARNING: This is a DESTRUCTIVE operation. Run with --dry-run first!\n');

  if (VERIFY_ONLY) {
    console.log('🔍 VERIFY MODE - Checking cleanup status\n');
  } else if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...`);
  console.log(`   Fields to remove: ${FIELDS_TO_REMOVE.length}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // If verify only, just run verification and exit
    if (VERIFY_ONLY) {
      await verifyCleanup(collection);
      return;
    }

    // Step 1: Pre-flight check - ensure Phase 1 completed
    const withoutCalendarData = await collection.countDocuments({ calendarData: { $exists: false } });
    if (withoutCalendarData > 0) {
      console.error('❌ Error: Phase 1 migration incomplete!');
      console.error(`   ${withoutCalendarData} documents do not have calendarData.`);
      console.error('   Run migrate-create-calendar-data.js first.');
      process.exit(1);
    }

    // Step 2: Count documents and fields to clean
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Build $unset operation
    const unsetFields = {};
    FIELDS_TO_REMOVE.forEach(field => { unsetFields[field] = ''; });

    // Count documents that need cleanup
    const docsToClean = await collection.countDocuments({
      calendarData: { $exists: true },
      $or: FIELDS_TO_REMOVE.map(f => ({ [f]: { $exists: true } }))
    });

    console.log(`📋 Documents with redundant top-level fields: ${docsToClean}\n`);

    if (docsToClean === 0) {
      console.log('✅ No documents need cleanup. Phase 3 already complete!');
      await verifyCleanup(collection);
      return;
    }

    // Step 3: Execute cleanup
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would remove ${FIELDS_TO_REMOVE.length} top-level fields from ${docsToClean} documents`);
      console.log(`\nFields to remove:`);
      FIELDS_TO_REMOVE.forEach(f => console.log(`   - ${f}`));

      // Show a sample of what would change
      const sampleDoc = await collection.findOne({
        calendarData: { $exists: true },
        $or: FIELDS_TO_REMOVE.map(f => ({ [f]: { $exists: true } }))
      });

      if (sampleDoc) {
        const fieldsToRemove = FIELDS_TO_REMOVE.filter(f => sampleDoc[f] !== undefined);
        console.log(`\nSample document ${sampleDoc._id} would have ${fieldsToRemove.length} fields removed:`);
        fieldsToRemove.slice(0, 10).forEach(f => {
          const value = JSON.stringify(sampleDoc[f])?.substring(0, 50);
          console.log(`   ${f}: ${value}${value?.length >= 50 ? '...' : ''}`);
        });
      }
    } else {
      console.log(`🗑️  Removing ${FIELDS_TO_REMOVE.length} top-level fields from ${docsToClean} documents...`);

      // Process in batches to avoid Cosmos DB rate limiting
      const BATCH_SIZE = 100;
      let totalUpdated = 0;
      let totalErrors = 0;

      // Get all document IDs that need cleanup
      const docsToProcess = await collection.find({
        calendarData: { $exists: true },
        $or: FIELDS_TO_REMOVE.map(f => ({ [f]: { $exists: true } }))
      }, { projection: { _id: 1 } }).toArray();

      const totalToProcess = docsToProcess.length;
      console.log(`   Processing ${totalToProcess} documents in batches of ${BATCH_SIZE}...\n`);

      for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
        const batch = docsToProcess.slice(i, i + BATCH_SIZE);
        const batchIds = batch.map(doc => doc._id);

        try {
          const result = await collection.updateMany(
            { _id: { $in: batchIds } },
            { $unset: unsetFields }
          );
          totalUpdated += result.modifiedCount;
        } catch (batchError) {
          // If batch fails, try one at a time
          for (const doc of batch) {
            try {
              await collection.updateOne(
                { _id: doc._id },
                { $unset: unsetFields }
              );
              totalUpdated++;
            } catch (singleError) {
              totalErrors++;
            }
            // Small delay between individual updates
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }

        // Show progress bar
        const processed = Math.min(i + BATCH_SIZE, totalToProcess);
        const percent = Math.round((processed / totalToProcess) * 100);
        const barWidth = 30;
        const filled = Math.round((percent / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        process.stdout.write(`\r   [${bar}] ${percent}% (${processed}/${totalToProcess})`);

        // Add delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < docsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log('\n');
      console.log(`✅ Updated ${totalUpdated} documents`);
      if (totalErrors > 0) {
        console.log(`⚠️  Errors: ${totalErrors} documents failed to update`);
      }
    }

    // Step 4: Verify results
    await verifyCleanup(collection);

    // Summary
    console.log('\n📝 Cleanup Summary:');
    console.log(`   Documents processed: ${docsToClean}`);
    console.log(`   Fields removed per document: ${FIELDS_TO_REMOVE.length}\n`);

    if (DRY_RUN) {
      console.log('🔍 DRY RUN COMPLETE - No changes were made');
      console.log('   Run without --dry-run flag to apply changes\n');
    } else {
      console.log('✅ Phase 3 cleanup completed successfully!');
      console.log('   Run with --verify flag to confirm results\n');
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run cleanup
cleanupCalendarData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

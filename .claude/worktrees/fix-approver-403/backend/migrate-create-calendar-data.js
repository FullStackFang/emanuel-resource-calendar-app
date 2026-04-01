// migrate-create-calendar-data.js
// Phase 1: Migration script to consolidate top-level fields into calendarData nested object
//
// PURPOSE: Organize scattered top-level event fields into a structured calendarData object
// for better schema organization while maintaining backward compatibility.
//
// ARCHITECTURE:
//   - Top-level fields: Identity, status tracking, timestamps (kept for indexing)
//   - calendarData: Consolidated calendar/event data fields
//   - graphData: Microsoft Graph/Outlook integration layer (unchanged)
//   - internalData: Future integrations layer (unchanged)
//   - roomReservationData: Reservation workflow data (unchanged)
//
// This migration:
// 1. Copies top-level fields into calendarData nested object
// 2. Preserves original top-level fields for backward compatibility
// 3. Does NOT modify graphData, internalData, or roomReservationData
//
// Run with: node migrate-create-calendar-data.js
// Dry run: node migrate-create-calendar-data.js --dry-run
// Verify: node migrate-create-calendar-data.js --verify

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');

// Fields to migrate into calendarData
// These are application-layer fields that should be grouped together
const FIELDS_TO_MIGRATE = [
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

async function verifyMigration(collection) {
  console.log('\n📊 Verification Report\n');

  const totalDocs = await collection.countDocuments({});
  const withCalendarData = await collection.countDocuments({ calendarData: { $exists: true } });
  const withoutCalendarData = await collection.countDocuments({ calendarData: { $exists: false } });

  console.log(`Total documents: ${totalDocs}`);
  console.log(`With calendarData: ${withCalendarData} (${((withCalendarData / totalDocs) * 100).toFixed(1)}%)`);
  console.log(`Without calendarData: ${withoutCalendarData} (${((withoutCalendarData / totalDocs) * 100).toFixed(1)}%)`);

  // Sample a document with calendarData to show structure
  if (withCalendarData > 0) {
    const sampleDoc = await collection.findOne({ calendarData: { $exists: true } });
    console.log('\n📝 Sample calendarData fields:');
    const calendarDataKeys = Object.keys(sampleDoc.calendarData || {});
    console.log(`   Fields present: ${calendarDataKeys.length}`);
    console.log(`   Fields: ${calendarDataKeys.slice(0, 10).join(', ')}${calendarDataKeys.length > 10 ? '...' : ''}`);

    // Verify a few key fields
    console.log('\n🔍 Field verification (sample document):');
    const keyFields = ['eventTitle', 'startDateTime', 'categories', 'locations'];
    for (const field of keyFields) {
      const inCalendarData = sampleDoc.calendarData?.[field];
      const atTopLevel = sampleDoc[field];
      console.log(`   ${field}:`);
      console.log(`     calendarData: ${JSON.stringify(inCalendarData)?.substring(0, 50) || 'undefined'}`);
      console.log(`     top-level: ${JSON.stringify(atTopLevel)?.substring(0, 50) || 'undefined'}`);
    }
  }

  // Check for documents that have top-level fields but no calendarData
  const needsMigration = await collection.countDocuments({
    calendarData: { $exists: false },
    $or: [
      { eventTitle: { $exists: true } },
      { startDateTime: { $exists: true } },
      { categories: { $exists: true } }
    ]
  });

  console.log(`\n📋 Documents needing migration: ${needsMigration}`);

  if (withoutCalendarData === 0) {
    console.log('\n✅ All documents have calendarData - migration complete!');
  } else if (needsMigration > 0) {
    console.log('\n⚠️  Some documents still need migration');
  }
}

async function migrateCalendarData() {
  console.log('🚀 Starting migration: Create calendarData object in templeEvents__Events\n');

  if (VERIFY_ONLY) {
    console.log('🔍 VERIFY MODE - Checking migration status\n');
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
  console.log(`   Fields to migrate: ${FIELDS_TO_MIGRATE.length}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // If verify only, just run verification and exit
    if (VERIFY_ONLY) {
      await verifyMigration(collection);
      return;
    }

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Step 2: Count documents by current field status
    const stats = {
      hasCalendarData: await collection.countDocuments({ calendarData: { $exists: true } }),
      missingCalendarData: await collection.countDocuments({ calendarData: { $exists: false } }),
      hasEventTitle: await collection.countDocuments({ eventTitle: { $exists: true } }),
      hasGraphData: await collection.countDocuments({ 'graphData.subject': { $exists: true } }),
      hasRoomReservationData: await collection.countDocuments({ roomReservationData: { $exists: true } })
    };

    console.log('📈 Current field distribution:');
    console.log(`   - Already has calendarData: ${stats.hasCalendarData}`);
    console.log(`   - Missing calendarData: ${stats.missingCalendarData}`);
    console.log(`   - Has eventTitle (top-level): ${stats.hasEventTitle}`);
    console.log(`   - Has graphData: ${stats.hasGraphData}`);
    console.log(`   - Has roomReservationData: ${stats.hasRoomReservationData}\n`);

    if (stats.missingCalendarData === 0) {
      console.log('✅ All events already have calendarData. No migration needed!');
      await verifyMigration(collection);
      return;
    }

    const BATCH_SIZE = 100; // Process in batches to avoid Cosmos DB rate limiting
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Step 3: Query events that need migration (don't have calendarData yet)
    console.log('🔄 Querying events that need migration...');
    const eventsToMigrate = await collection.find({
      calendarData: { $exists: false }
    }).toArray();

    console.log(`   Found ${eventsToMigrate.length} events to migrate\n`);

    // Step 4: Process events in batches
    const totalToProcess = eventsToMigrate.length;

    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        try {
          // Build calendarData object by copying existing top-level fields
          const calendarData = {};

          for (const field of FIELDS_TO_MIGRATE) {
            // Only copy fields that exist and are not undefined
            if (event[field] !== undefined) {
              calendarData[field] = event[field];
            }
          }

          // Skip if no fields to migrate
          const fieldCount = Object.keys(calendarData).length;
          if (fieldCount === 0) {
            totalSkipped++;
            continue;
          }

          // Dry run: just count, don't update
          if (DRY_RUN) {
            totalUpdated++;
          } else {
            // Actually update the document - add calendarData without removing top-level fields
            await collection.updateOne(
              { _id: event._id },
              { $set: { calendarData } }
            );
            totalUpdated++;
          }

        } catch (error) {
          totalErrors++;
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
      if (i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log('\n'); // New line after progress bar

    // Step 5: Verify migration results
    await verifyMigration(collection);

    // Summary
    console.log('\n📝 Migration Summary:');
    console.log(`   Total documents found: ${eventsToMigrate.length}`);
    console.log(`   Successful updates: ${totalUpdated}`);
    console.log(`   Skipped (no fields): ${totalSkipped}`);
    console.log(`   Errors: ${totalErrors}\n`);

    if (DRY_RUN) {
      console.log('🔍 DRY RUN COMPLETE - No changes were made');
      console.log('   Run without --dry-run flag to apply changes\n');
    } else {
      console.log('✅ Migration completed successfully!');
      console.log('   Run with --verify flag to check results\n');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
migrateCalendarData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

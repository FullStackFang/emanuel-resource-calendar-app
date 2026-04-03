// migrate-backfill-attendee-count.js
// Migration script to backfill null/missing attendeeCount with 0
//
// PURPOSE: Events created before attendeeCount was made required may have
// null values in calendarData.attendeeCount. This script sets them to 0
// to prevent null-related errors in the frontend and API.
//
// NOTE: 0 satisfies "is not null" checks but will NOT pass the submission
// validation (which requires attendeeCount >= 1). Users will need to
// provide a real count when editing these events.
//
// Run with: node migrate-backfill-attendee-count.js
// Dry run:  node migrate-backfill-attendee-count.js --dry-run
// Verify:   node migrate-backfill-attendee-count.js --verify

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 2000;
const MAX_RETRIES = 3;

async function runWithRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 16500 && attempt < retries) {
        // Parse RetryAfterMs from error message, default to 1000ms
        const match = err.message.match(/RetryAfterMs=(\d+)/);
        const retryAfterMs = match ? parseInt(match[1]) : 1000;
        const waitMs = retryAfterMs + 500; // add buffer
        process.stdout.write(`\r   [Rate limited] Waiting ${waitMs}ms before retry ${attempt}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        throw err;
      }
    }
  }
}

async function migrateBackfillAttendeeCount() {
  console.log('Starting migration: Backfill calendarData.attendeeCount\n');

  if (DRY_RUN) {
    console.log('DRY RUN MODE - No changes will be made to the database\n');
  }

  if (!MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Step 1: Count totals
    const totalDocs = await collection.countDocuments({});
    console.log(`Total documents in collection: ${totalDocs}\n`);

    // Query for events with null/missing attendeeCount in calendarData
    const needsBackfillQuery = {
      calendarData: { $exists: true },
      $or: [
        { 'calendarData.attendeeCount': null },
        { 'calendarData.attendeeCount': { $exists: false } }
      ]
    };

    const needsBackfillCount = await collection.countDocuments(needsBackfillQuery);
    console.log(`Events needing attendeeCount backfill: ${needsBackfillCount}\n`);

    // --verify mode: just report counts and exit
    if (VERIFY) {
      const withAttendeeCount = await collection.countDocuments({
        calendarData: { $exists: true },
        'calendarData.attendeeCount': { $exists: true, $ne: null }
      });
      const withZero = await collection.countDocuments({
        'calendarData.attendeeCount': 0
      });
      const withPositive = await collection.countDocuments({
        'calendarData.attendeeCount': { $gt: 0 }
      });

      console.log('Verification Results:');
      console.log(`   Events with attendeeCount set: ${withAttendeeCount}`);
      console.log(`   Events with attendeeCount = 0: ${withZero}`);
      console.log(`   Events with attendeeCount > 0: ${withPositive}`);
      console.log(`   Events still needing backfill: ${needsBackfillCount}`);
      return;
    }

    if (needsBackfillCount === 0) {
      console.log('No events need backfilling. All events already have attendeeCount set.\n');
      return;
    }

    // Step 2: Fetch and process in batches (Cosmos DB rate limiting)
    const docsToProcess = await collection.find(needsBackfillQuery).toArray();

    console.log(`Processing ${docsToProcess.length} events in batches of ${BATCH_SIZE}...\n`);

    let updated = 0;
    let errors = 0;

    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);

      if (DRY_RUN) {
        updated += batch.length;
      } else {
        try {
          const result = await runWithRetry(() =>
            collection.updateMany(
              { _id: { $in: batch.map(d => d._id) } },
              { $set: { 'calendarData.attendeeCount': 0 } }
            )
          );
          updated += result.modifiedCount;
        } catch (err) {
          errors += batch.length;
          console.error(`\n  Error updating batch at index ${i} after ${MAX_RETRIES} retries:`, err.message);
        }
      }

      // Progress bar (sole output during normal execution)
      const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
      const percent = Math.round((processed / docsToProcess.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

      // Rate limit delay between batches
      if (i + BATCH_SIZE < docsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log('\n\nMigration Summary:');
    console.log(`   Events processed: ${docsToProcess.length}`);
    if (!DRY_RUN) {
      console.log(`   Events updated: ${updated}`);
      console.log(`   Errors: ${errors}`);
    }
    console.log('\nMigration complete!\n');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Database connection closed');
  }
}

migrateBackfillAttendeeCount();

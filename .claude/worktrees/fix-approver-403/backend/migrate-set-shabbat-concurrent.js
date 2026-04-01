// migrate-set-shabbat-concurrent.js
// Migration script to set isAllowedConcurrent = true for all "Shabbat Services" events
//
// This allows Shabbat Services events to have nested events (like B'nei Mitzvahs)
// scheduled at the same time without triggering conflict warnings.
//
// Run with: node migrate-set-shabbat-concurrent.js
// Dry run:  node migrate-set-shabbat-concurrent.js --dry-run

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

// Check for dry run flag
const isDryRun = process.argv.includes('--dry-run');

async function migrateShabbatConcurrent() {
  console.log('🚀 Starting migration: Set isAllowedConcurrent for Shabbat Services\n');

  if (isDryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    console.error('Please ensure your .env file contains MONGODB_URI or MONGODB_CONNECTION_STRING');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 30)}...\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Step 2: Find all Shabbat Services events
    const shabbatQuery = {
      'graphData.subject': 'Shabbat Services'
    };

    const shabbatCount = await collection.countDocuments(shabbatQuery);
    console.log(`🕍 Found ${shabbatCount} "Shabbat Services" events\n`);

    // Step 3: Check current isAllowedConcurrent distribution
    const alreadyTrue = await collection.countDocuments({
      ...shabbatQuery,
      isAllowedConcurrent: true
    });
    const alreadyFalse = await collection.countDocuments({
      ...shabbatQuery,
      isAllowedConcurrent: false
    });
    const notSet = await collection.countDocuments({
      ...shabbatQuery,
      isAllowedConcurrent: { $exists: false }
    });

    console.log('📈 Current isAllowedConcurrent status for Shabbat Services:');
    console.log(`   - Already true: ${alreadyTrue}`);
    console.log(`   - Already false: ${alreadyFalse}`);
    console.log(`   - Not set: ${notSet}`);
    console.log(`   - Total to update: ${alreadyFalse + notSet}\n`);

    // Step 4: Preview some events that will be updated
    const samplesToShow = 5;
    const sampleEvents = await collection.find({
      ...shabbatQuery,
      $or: [
        { isAllowedConcurrent: false },
        { isAllowedConcurrent: { $exists: false } }
      ]
    }).limit(samplesToShow).toArray();

    if (sampleEvents.length > 0) {
      console.log(`📋 Sample events to be updated (showing ${sampleEvents.length} of ${alreadyFalse + notSet}):`);
      sampleEvents.forEach((event, index) => {
        const startDate = event.graphData?.start?.dateTime
          ? new Date(event.graphData.start.dateTime).toLocaleDateString()
          : 'Unknown date';
        console.log(`   ${index + 1}. "${event.graphData?.subject}" on ${startDate}`);
        console.log(`      ID: ${event._id}`);
        console.log(`      Current isAllowedConcurrent: ${event.isAllowedConcurrent ?? 'not set'}`);
      });
      console.log('');
    }

    if (isDryRun) {
      console.log('⚠️  DRY RUN - Skipping actual update\n');
      console.log('To perform the actual migration, run without --dry-run flag');
      return;
    }

    // Step 5: Perform the update
    console.log('🔄 Updating Shabbat Services events...\n');

    const updateResult = await collection.updateMany(
      shabbatQuery,
      {
        $set: {
          isAllowedConcurrent: true,
          lastModifiedDateTime: new Date().toISOString()
        }
      }
    );

    console.log('✅ Migration complete!\n');
    console.log('📊 Results:');
    console.log(`   - Matched: ${updateResult.matchedCount}`);
    console.log(`   - Modified: ${updateResult.modifiedCount}`);

    // Step 6: Verify the update
    const verifyCount = await collection.countDocuments({
      ...shabbatQuery,
      isAllowedConcurrent: true
    });
    console.log(`\n✅ Verification: ${verifyCount} Shabbat Services events now have isAllowedConcurrent = true`);

    if (verifyCount !== shabbatCount) {
      console.warn(`\n⚠️  Warning: Expected ${shabbatCount} but found ${verifyCount}`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the migration
migrateShabbatConcurrent();

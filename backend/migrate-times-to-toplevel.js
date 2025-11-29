// migrate-times-to-toplevel.js
// Migration script to copy time fields from internalData to top level
//
// Data Architecture:
// - graphData: Outlook/Microsoft Graph data (external system)
// - internalData: MEC system data (external system)
// - Top Level: Application's canonical fields (source of truth)
//
// This script copies time fields from internalData to top level for events
// created via unified-form that only have time data in internalData.
//
// Run with: node migrate-times-to-toplevel.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateTimesToTopLevel() {
  console.log('🚀 Starting migration: Copy time fields from internalData to top level\n');

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    console.error('Please ensure your .env file contains MONGODB_URI');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Fields to migrate from internalData to top level
    const timeFields = [
      'startTime',
      'endTime',
      'setupTime',
      'teardownTime',
      'doorOpenTime',
      'doorCloseTime'
    ];

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Step 2: Find events that need migration
    // Events where internalData has time fields but top level doesn't
    const eventsToMigrate = await collection.find({
      $or: [
        // Has internalData.startTime but missing/empty top-level startTime
        {
          'internalData.startTime': { $exists: true, $ne: '' },
          $or: [
            { startTime: { $exists: false } },
            { startTime: '' },
            { startTime: null }
          ]
        },
        // Has internalData.setupTime but missing/empty top-level setupTime
        {
          'internalData.setupTime': { $exists: true, $ne: '' },
          $or: [
            { setupTime: { $exists: false } },
            { setupTime: '' },
            { setupTime: null }
          ]
        },
        // Has internalData.doorOpenTime but missing/empty top-level doorOpenTime
        {
          'internalData.doorOpenTime': { $exists: true, $ne: '' },
          $or: [
            { doorOpenTime: { $exists: false } },
            { doorOpenTime: '' },
            { doorOpenTime: null }
          ]
        }
      ]
    }).toArray();

    console.log(`📈 Found ${eventsToMigrate.length} events that need migration\n`);

    if (eventsToMigrate.length === 0) {
      console.log('✅ No events need migration. All time fields are already at top level.\n');
      return;
    }

    // Step 3: Process in batches to avoid Cosmos DB rate limiting
    const BATCH_SIZE = 100;
    let totalUpdated = 0;
    let fieldsUpdated = {
      startTime: 0,
      endTime: 0,
      setupTime: 0,
      teardownTime: 0,
      doorOpenTime: 0,
      doorCloseTime: 0
    };

    console.log('🔄 Processing events in batches...\n');

    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        const updateFields = {};

        // Check each time field and copy from internalData if top level is missing
        for (const field of timeFields) {
          const internalValue = event.internalData?.[field];
          const topLevelValue = event[field];

          // Copy if internalData has value and top level is missing/empty
          if (internalValue && internalValue !== '' &&
              (!topLevelValue || topLevelValue === '')) {
            updateFields[field] = internalValue;
            fieldsUpdated[field]++;
          }
        }

        // Only update if there are fields to update
        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne(
            { _id: event._id },
            { $set: updateFields }
          );
          totalUpdated++;
        }
      }

      console.log(`   Progress: ${Math.min(i + BATCH_SIZE, eventsToMigrate.length)}/${eventsToMigrate.length} events processed`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    // Step 4: Print summary
    console.log('\n📊 Migration Summary:');
    console.log(`   Total events updated: ${totalUpdated}`);
    console.log('\n   Fields copied to top level:');
    for (const [field, count] of Object.entries(fieldsUpdated)) {
      if (count > 0) {
        console.log(`   - ${field}: ${count} events`);
      }
    }

    // Step 5: Verify by sampling
    console.log('\n🔍 Verification - Sample of migrated events:');
    const sampleEvents = await collection.find({
      'internalData.startTime': { $exists: true, $ne: '' }
    }).limit(3).toArray();

    sampleEvents.forEach((event, index) => {
      console.log(`\n   Event ${index + 1}: ${event.graphData?.subject || event.eventTitle || 'Unknown'}`);
      console.log(`   - Top-level startTime: "${event.startTime || '(empty)'}"`);
      console.log(`   - internalData.startTime: "${event.internalData?.startTime || '(empty)'}"`);
      console.log(`   - Top-level setupTime: "${event.setupTime || '(empty)'}"`);
      console.log(`   - internalData.setupTime: "${event.internalData?.setupTime || '(empty)'}"`);
    });

    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
migrateTimesToTopLevel()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

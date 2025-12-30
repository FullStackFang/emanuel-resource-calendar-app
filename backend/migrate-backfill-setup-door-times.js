// migrate-backfill-setup-door-times.js
// Migration script to backfill missing setupTime and doorOpenTime with startTime
//
// PURPOSE: Events imported from rschedData may not have setup/door times set.
// This script defaults empty setupTime and doorOpenTime to the event's startTime.
//
// Run with: node migrate-backfill-setup-door-times.js
// Dry run: node migrate-backfill-setup-door-times.js --dry-run

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');

async function migrateBackfillSetupDoorTimes() {
  console.log('🚀 Starting migration: Backfill setupTime and doorOpenTime\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
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

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Step 2: Find events that need setupTime backfill
    const needsSetupTime = await collection.countDocuments({
      $and: [
        { $or: [
          { setupTime: null },
          { setupTime: '' },
          { setupTime: { $exists: false } }
        ]},
        { startTime: { $exists: true, $ne: null, $ne: '' } }
      ]
    });

    // Step 3: Find events that need doorOpenTime backfill
    const needsDoorOpenTime = await collection.countDocuments({
      $and: [
        { $or: [
          { doorOpenTime: null },
          { doorOpenTime: '' },
          { doorOpenTime: { $exists: false } }
        ]},
        { startTime: { $exists: true, $ne: null, $ne: '' } }
      ]
    });

    console.log(`📋 Events needing setupTime backfill: ${needsSetupTime}`);
    console.log(`📋 Events needing doorOpenTime backfill: ${needsDoorOpenTime}\n`);

    if (needsSetupTime === 0 && needsDoorOpenTime === 0) {
      console.log('✅ No events need backfilling. All events already have setupTime and doorOpenTime set.\n');
      return;
    }

    // Step 4: Get all events that need any backfill
    const eventsToUpdate = await collection.find({
      $and: [
        { $or: [
          { setupTime: null },
          { setupTime: '' },
          { setupTime: { $exists: false } },
          { doorOpenTime: null },
          { doorOpenTime: '' },
          { doorOpenTime: { $exists: false } }
        ]},
        { startTime: { $exists: true, $ne: null, $ne: '' } }
      ]
    }).toArray();

    console.log(`🔄 Processing ${eventsToUpdate.length} events...\n`);

    let setupTimeUpdated = 0;
    let doorOpenTimeUpdated = 0;
    let errors = 0;

    for (const event of eventsToUpdate) {
      const updates = {};
      const eventTitle = event.eventTitle || event.graphData?.subject || 'Untitled';
      const startTime = event.startTime;

      // Check if setupTime needs to be set
      const needsSetup = !event.setupTime || event.setupTime === '';
      if (needsSetup) {
        updates.setupTime = startTime;
      }

      // Check if doorOpenTime needs to be set
      const needsDoor = !event.doorOpenTime || event.doorOpenTime === '';
      if (needsDoor) {
        updates.doorOpenTime = startTime;
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update "${eventTitle}" (${event._id}):`);
        if (needsSetup) console.log(`    - setupTime: '' → '${startTime}'`);
        if (needsDoor) console.log(`    - doorOpenTime: '' → '${startTime}'`);
      } else {
        try {
          await collection.updateOne(
            { _id: event._id },
            { $set: updates }
          );

          if (needsSetup) setupTimeUpdated++;
          if (needsDoor) doorOpenTimeUpdated++;

          console.log(`  ✅ Updated "${eventTitle}" (${event._id})`);
          if (needsSetup) console.log(`    - setupTime: '${startTime}'`);
          if (needsDoor) console.log(`    - doorOpenTime: '${startTime}'`);
        } catch (err) {
          errors++;
          console.error(`  ❌ Error updating "${eventTitle}" (${event._id}):`, err.message);
        }
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   Events processed: ${eventsToUpdate.length}`);
    if (!DRY_RUN) {
      console.log(`   setupTime updated: ${setupTimeUpdated}`);
      console.log(`   doorOpenTime updated: ${doorOpenTimeUpdated}`);
      console.log(`   Errors: ${errors}`);
    }
    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the migration
migrateBackfillSetupDoorTimes();

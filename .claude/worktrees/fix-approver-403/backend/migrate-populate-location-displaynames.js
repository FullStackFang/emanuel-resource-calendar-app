// migrate-populate-location-displaynames.js
// Migration script to populate top-level locationDisplayNames field from graphData.location.displayName
//
// Purpose:
// - Separate graphData (unchanged Outlook data) from app-level fields
// - Populate locationDisplayNames for filtering/grouping in the app
// - Detect virtual meetings and set virtualMeetingUrl + virtualPlatform
// - Leave graphData.location.displayName unchanged (preserve source data)
//
// Run with: node migrate-populate-location-displaynames.js

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { isVirtualLocation, getVirtualPlatform } = require('./utils/locationUtils');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateLocationDisplayNames() {
  console.log('🚀 Starting migration: Populate locationDisplayNames from graphData\n');

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
    const eventsCollection = db.collection('templeEvents__Events');
    const locationsCollection = db.collection('templeEvents__Locations');

    // Get the Virtual Meeting location ID
    const virtualLocation = await locationsCollection.findOne({ name: 'Virtual Meeting' });
    if (!virtualLocation) {
      console.error('❌ Error: "Virtual Meeting" location not found in templeEvents__Locations');
      console.error('Please run: node create-virtual-location.js');
      process.exit(1);
    }
    console.log(`✅ Found "Virtual Meeting" location (ID: ${virtualLocation._id})\n`);

    // Step 1: Count total documents
    const totalDocs = await eventsCollection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    // Step 2: Analyze current state
    const stats = {
      total: totalDocs,
      hasLocationDisplayNames: await eventsCollection.countDocuments({
        locationDisplayNames: { $exists: true, $ne: '' }
      }),
      noLocationDisplayNames: await eventsCollection.countDocuments({
        $or: [
          { locationDisplayNames: { $exists: false } },
          { locationDisplayNames: '' }
        ]
      }),
      hasGraphLocation: await eventsCollection.countDocuments({
        'graphData.location.displayName': { $exists: true, $ne: '' }
      }),
      hasVirtualMeetingUrl: await eventsCollection.countDocuments({
        virtualMeetingUrl: { $exists: true, $ne: '' }
      })
    };

    console.log('📈 Current state:');
    console.log(`   - Total events: ${stats.total}`);
    console.log(`   - Has locationDisplayNames: ${stats.hasLocationDisplayNames}`);
    console.log(`   - Missing locationDisplayNames: ${stats.noLocationDisplayNames}`);
    console.log(`   - Has graphData.location: ${stats.hasGraphLocation}`);
    console.log(`   - Has virtualMeetingUrl: ${stats.hasVirtualMeetingUrl}\n`);

    // Step 3: Process all events
    console.log('🔄 Processing events...\n');
    const BATCH_SIZE = 50; // Lower batch size for Cosmos DB
    let processed = 0;
    let virtualMeetingsDetected = 0;
    let physicalLocationsSet = 0;
    let emptyLocations = 0;
    let errors = 0;

    // Find all events
    const events = await eventsCollection.find({}).toArray();
    console.log(`   Found ${events.length} events to process\n`);

    // Process in batches
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      const updates = [];

      for (const event of batch) {
        try {
          const locationDisplayName = event.graphData?.location?.displayName || '';
          const locationUniqueId = event.graphData?.location?.uniqueId || '';

          // Check both displayName and uniqueId for virtual meeting URLs
          let virtualUrl = null;
          if (isVirtualLocation(locationDisplayName)) {
            virtualUrl = locationDisplayName;
          } else if (isVirtualLocation(locationUniqueId)) {
            virtualUrl = locationUniqueId;
          }

          let updateDoc = {};

          if (virtualUrl) {
            // This is a virtual meeting
            updateDoc = {
              $set: {
                locationDisplayNames: 'Virtual Meeting',
                virtualMeetingUrl: virtualUrl,
                virtualPlatform: getVirtualPlatform(virtualUrl),
                locations: [virtualLocation._id],
                locationId: virtualLocation._id,
                updatedAt: new Date()
              }
            };
            virtualMeetingsDetected++;
          } else if (locationDisplayName) {
            // Physical location - just copy the displayName
            updateDoc = {
              $set: {
                locationDisplayNames: locationDisplayName,
                updatedAt: new Date()
              }
            };
            physicalLocationsSet++;
          } else {
            // No location data
            updateDoc = {
              $set: {
                locationDisplayNames: '',
                updatedAt: new Date()
              }
            };
            emptyLocations++;
          }

          updates.push({
            updateOne: {
              filter: { _id: event._id },
              update: updateDoc
            }
          });

        } catch (error) {
          console.error(`   ❌ Error processing event ${event._id}: ${error.message}`);
          errors++;
        }
      }

      // Execute batch update
      if (updates.length > 0) {
        try {
          await eventsCollection.bulkWrite(updates, { ordered: false });
          processed += updates.length;
          console.log(`   ✅ Processed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${processed}/${events.length} events`);
        } catch (error) {
          console.error(`   ❌ Error updating batch: ${error.message}`);
          errors += batch.length;
        }
      }

      // Small delay to avoid rate limiting
      if (i + BATCH_SIZE < events.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n✅ Migration completed!\n');
    console.log('📊 Summary:');
    console.log(`   - Total processed: ${processed}`);
    console.log(`   - Virtual meetings detected: ${virtualMeetingsDetected}`);
    console.log(`   - Physical locations set: ${physicalLocationsSet}`);
    console.log(`   - Empty locations: ${emptyLocations}`);
    console.log(`   - Errors: ${errors}\n`);

    // Step 4: Verify results
    const afterStats = {
      hasLocationDisplayNames: await eventsCollection.countDocuments({
        locationDisplayNames: { $exists: true, $ne: '' }
      }),
      hasVirtualMeetingUrl: await eventsCollection.countDocuments({
        virtualMeetingUrl: { $exists: true, $ne: '' }
      }),
      virtualMeetingLocations: await eventsCollection.countDocuments({
        locationDisplayNames: 'Virtual Meeting'
      })
    };

    console.log('📈 After migration:');
    console.log(`   - Events with locationDisplayNames: ${afterStats.hasLocationDisplayNames}`);
    console.log(`   - Events with virtualMeetingUrl: ${afterStats.hasVirtualMeetingUrl}`);
    console.log(`   - Events grouped as "Virtual Meeting": ${afterStats.virtualMeetingLocations}\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration
migrateLocationDisplayNames()
  .then(() => {
    console.log('✨ Migration script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  });

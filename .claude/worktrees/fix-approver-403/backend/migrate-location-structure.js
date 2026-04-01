/**
 * Migration Script: Location Structure Cleanup
 *
 * Purpose: Add new location fields to all events in templeEvents__Events
 * - Adds locations: [] (empty array, ready for future locationId assignments)
 * - Adds locationDisplayNames: string (preserves current location text)
 * - Preserves all existing graphData.location data
 *
 * This is Phase 1 of location refactoring - no breaking changes, just structure prep
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { MongoClient } = require('mongodb');
const { initializeLocationFields, extractLocationStrings } = require('./utils/locationUtils');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE_NAME || 'calendar';

// Validate environment variables
if (!MONGODB_URI) {
  console.error('❌ Error: MONGODB_URI or MONGODB_CONNECTION_STRING environment variable is not set');
  console.error('Please ensure .env file exists in backend directory with connection string defined');
  process.exit(1);
}

async function migrateLocationStructure() {
  console.log('🚀 Starting location structure migration...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Get total count
    const totalEvents = await eventsCollection.countDocuments();
    console.log(`📊 Total events to process: ${totalEvents}\n`);

    // Find events that need migration (missing new fields)
    const eventsToMigrate = await eventsCollection.find({
      $or: [
        { locations: { $exists: false } },
        { locationDisplayNames: { $exists: false } }
      ]
    }).toArray();

    console.log(`🔄 Events needing migration: ${eventsToMigrate.length}\n`);

    if (eventsToMigrate.length === 0) {
      console.log('✨ All events already have new location structure. Nothing to migrate.\n');
      return;
    }

    // Statistics
    let migrated = 0;
    let withLocations = 0;
    let withoutLocations = 0;
    let errors = 0;
    const locationStringsFound = new Set();

    console.log('Processing events...\n');

    // Process events in batches
    const batchSize = 100;
    for (let i = 0; i < eventsToMigrate.length; i += batchSize) {
      const batch = eventsToMigrate.slice(i, i + batchSize);
      const bulkOps = [];

      for (const event of batch) {
        try {
          // Initialize location fields
          const updatedEvent = initializeLocationFields({ ...event });

          // Extract location strings for reporting
          const locationStrings = extractLocationStrings(updatedEvent);
          if (locationStrings.length > 0) {
            withLocations++;
            locationStrings.forEach(str => locationStringsFound.add(str));
          } else {
            withoutLocations++;
          }

          // Prepare update operation
          bulkOps.push({
            updateOne: {
              filter: { _id: event._id },
              update: {
                $set: {
                  locations: updatedEvent.locations,
                  locationDisplayNames: updatedEvent.locationDisplayNames
                }
              }
            }
          });

          migrated++;

          // Progress indicator
          if (migrated % 50 === 0) {
            console.log(`   Processed ${migrated}/${eventsToMigrate.length} events...`);
          }
        } catch (error) {
          console.error(`❌ Error processing event ${event._id}:`, error.message);
          errors++;
        }
      }

      // Execute batch update
      if (bulkOps.length > 0) {
        await eventsCollection.bulkWrite(bulkOps);
      }
    }

    console.log('\n✅ Migration complete!\n');
    console.log('📈 Migration Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Total events processed: ${migrated}`);
    console.log(`   Events with locations: ${withLocations}`);
    console.log(`   Events without locations: ${withoutLocations}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Unique location strings found: ${locationStringsFound.size}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Show sample of location strings found
    if (locationStringsFound.size > 0) {
      console.log('📍 Sample location strings found (first 20):');
      const samples = Array.from(locationStringsFound).slice(0, 20);
      samples.forEach(str => console.log(`   - "${str}"`));
      if (locationStringsFound.size > 20) {
        console.log(`   ... and ${locationStringsFound.size - 20} more\n`);
      } else {
        console.log('');
      }
    }

    // Verification
    console.log('🔍 Verifying migration...');
    const verifyCount = await eventsCollection.countDocuments({
      locations: { $exists: true },
      locationDisplayNames: { $exists: true }
    });
    console.log(`✅ Events with new structure: ${verifyCount}/${totalEvents}\n`);

    if (verifyCount === totalEvents) {
      console.log('🎉 Migration successful! All events now have the new location structure.\n');
    } else {
      console.log(`⚠️  Warning: ${totalEvents - verifyCount} events still missing new structure.\n`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Database connection closed\n');
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateLocationStructure()
    .then(() => {
      console.log('✨ Migration script finished successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateLocationStructure };

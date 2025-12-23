// migrate-fix-location-codes.js
// Migration script to populate locations, locationCodes, and locationDisplayNames
// from rschedData.rsKey for events in templeEvents__Events collection
//
// This fixes events that have rsKey data but empty locations array
//
// Run with:
//   node migrate-fix-location-codes.js --dry-run  # Preview changes
//   node migrate-fix-location-codes.js             # Apply changes

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');

async function migrateLocationCodes() {
  console.log('🚀 Starting migration: Fix location codes in templeEvents__Events\n');
  if (DRY_RUN) {
    console.log('*** DRY RUN MODE - No changes will be made ***\n');
  }

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

    // Step 1: Build location lookup map by rsKey
    console.log('📊 Building location lookup map by rsKey...');
    const allLocations = await locationsCollection.find({ active: { $ne: false } }).toArray();
    const locationByRsKey = new Map();

    allLocations.forEach(loc => {
      if (loc.rsKey) {
        locationByRsKey.set(loc.rsKey.toString().trim(), {
          _id: loc._id,
          rsKey: loc.rsKey,
          displayName: loc.displayName || loc.name
        });
      }
    });

    console.log(`   Loaded ${allLocations.length} locations`);
    console.log(`   ${locationByRsKey.size} have rsKey values\n`);

    // Show available rsKeys for reference
    console.log('📍 Available rsKey values:');
    const rsKeys = Array.from(locationByRsKey.keys()).sort();
    console.log(`   ${rsKeys.join(', ')}\n`);

    // Step 2: Count documents needing migration
    const totalDocs = await eventsCollection.countDocuments({});
    const docsWithRsKey = await eventsCollection.countDocuments({
      'rschedData.rsKey': { $exists: true, $ne: null, $ne: '' }
    });
    const docsWithEmptyLocations = await eventsCollection.countDocuments({
      $or: [
        { locations: { $exists: false } },
        { locations: { $size: 0 } }
      ]
    });
    const docsWithoutLocationCodes = await eventsCollection.countDocuments({
      locationCodes: { $exists: false }
    });

    console.log('📈 Current status:');
    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   Documents with rschedData.rsKey: ${docsWithRsKey}`);
    console.log(`   Documents with empty/missing locations array: ${docsWithEmptyLocations}`);
    console.log(`   Documents without locationCodes field: ${docsWithoutLocationCodes}\n`);

    // Step 3: Find events that need migration
    // Events with rschedData.rsKey that need locations populated
    const eventsToMigrate = await eventsCollection.find({
      'rschedData.rsKey': { $exists: true, $ne: null, $ne: '' }
    }).toArray();

    console.log(`🔄 Processing ${eventsToMigrate.length} events with rsKey data...\n`);

    let updated = 0;
    let skipped = 0;
    let noMatch = 0;
    let errors = 0;
    const BATCH_SIZE = 50;
    const unmatchedKeys = new Set();
    const sampleUpdates = []; // Collect samples for dry-run output

    // Process in batches
    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);
      const bulkOps = [];

      for (const event of batch) {
        try {
          // Parse rsKey values (may be comma or semicolon-separated)
          const rsKeyValue = event.rschedData?.rsKey?.toString() || '';
          // Split by comma or semicolon, then trim and filter
          const keys = rsKeyValue.split(/[,;]/).map(k => k.trim()).filter(k => k);

          if (keys.length === 0) {
            skipped++;
            continue;
          }

          // Match keys to locations
          const matchedLocations = [];
          for (const key of keys) {
            if (locationByRsKey.has(key)) {
              matchedLocations.push(locationByRsKey.get(key));
            } else {
              unmatchedKeys.add(key);
            }
          }

          if (matchedLocations.length === 0) {
            noMatch++;
            continue;
          }

          // Build update fields
          const locationIds = matchedLocations.map(loc => loc._id);
          const locationCodes = matchedLocations.map(loc => loc.rsKey);
          const locationDisplayNames = matchedLocations.map(loc => loc.displayName).join('; ');

          // Collect samples for dry-run display
          if (DRY_RUN && sampleUpdates.length < 10) {
            sampleUpdates.push({
              eventId: event.eventId,
              subject: event.graphData?.subject || event.eventTitle || 'N/A',
              originalRsKey: rsKeyValue,
              parsedKeys: keys,
              matchedKeys: matchedLocations.map(l => l.rsKey),
              unmatchedKeys: keys.filter(k => !locationByRsKey.has(k)),
              newLocationIds: locationIds.map(id => id.toString()),
              newLocationCodes: locationCodes,
              newDisplayNames: locationDisplayNames,
              currentLocations: event.locations || [],
              currentDisplayNames: event.locationDisplayNames || ''
            });
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: event._id },
              update: {
                $set: {
                  locations: locationIds,
                  locationCodes: locationCodes,
                  locationDisplayNames: locationDisplayNames,
                  updatedAt: new Date()
                }
              }
            }
          });
        } catch (error) {
          console.error(`   Error processing event ${event.eventId}: ${error.message}`);
          errors++;
        }
      }

      // Execute batch update
      if (bulkOps.length > 0) {
        if (!DRY_RUN) {
          try {
            const result = await eventsCollection.bulkWrite(bulkOps, { ordered: false });
            updated += result.modifiedCount;
            console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: Updated ${result.modifiedCount} events`);
          } catch (error) {
            console.error(`   Batch error: ${error.message}`);
            errors++;
          }
        } else {
          updated += bulkOps.length;
          console.log(`   [DRY RUN] Batch ${Math.floor(i / BATCH_SIZE) + 1}: Would update ${bulkOps.length} events`);

          // Show sample of what would be updated
          if (i === 0 && batch.length > 0) {
            const sample = batch[0];
            const rsKeyValue = sample.rschedData?.rsKey?.toString() || '';
            const keys = rsKeyValue.split(';').map(k => k.trim()).filter(k => k);
            const matched = keys.filter(k => locationByRsKey.has(k));
            console.log(`   Sample event: ${sample.eventId}`);
            console.log(`     rsKey: "${rsKeyValue}"`);
            console.log(`     Matched: ${matched.length}/${keys.length} keys`);
            if (matched.length > 0) {
              const loc = locationByRsKey.get(matched[0]);
              console.log(`     First location: ${loc.displayName} (rsKey: ${loc.rsKey})`);
            }
          }
        }
      }

      // Add delay between batches to avoid rate limiting
      if (!DRY_RUN && i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Step 4: Show sample updates in dry-run mode
    if (DRY_RUN && sampleUpdates.length > 0) {
      console.log('\n📋 Sample of events that would be updated:\n');
      console.log('='.repeat(80));
      sampleUpdates.forEach((sample, idx) => {
        console.log(`\n[${idx + 1}] Event: ${sample.eventId}`);
        console.log(`    Subject: ${sample.subject}`);
        console.log(`    Original rsKey: "${sample.originalRsKey}"`);
        console.log(`    Parsed keys: [${sample.parsedKeys.join(', ')}]`);
        console.log(`    Matched: [${sample.matchedKeys.join(', ')}]`);
        if (sample.unmatchedKeys.length > 0) {
          console.log(`    Unmatched: [${sample.unmatchedKeys.join(', ')}]`);
        }
        console.log(`    ---`);
        console.log(`    BEFORE:`);
        console.log(`      locations: [${sample.currentLocations.length > 0 ? sample.currentLocations.join(', ') : '(empty)'}]`);
        console.log(`      locationDisplayNames: "${sample.currentDisplayNames || '(empty)'}"`);
        console.log(`    AFTER:`);
        console.log(`      locations: [${sample.newLocationIds.join(', ')}]`);
        console.log(`      locationCodes: [${sample.newLocationCodes.join(', ')}]`);
        console.log(`      locationDisplayNames: "${sample.newDisplayNames}"`);
      });
      console.log('\n' + '='.repeat(80));
    }

    // Step 5: Report unmatched rsKey values
    if (unmatchedKeys.size > 0) {
      console.log('\n⚠️  Unmatched rsKey values (not found in locations):');
      Array.from(unmatchedKeys).sort().forEach(key => {
        console.log(`   - "${key}"`);
      });
    }

    // Step 5: Verify migration results
    console.log('\n📊 Post-migration status:');
    const newStats = {
      withLocations: await eventsCollection.countDocuments({
        locations: { $exists: true, $not: { $size: 0 } }
      }),
      withLocationCodes: await eventsCollection.countDocuments({
        locationCodes: { $exists: true }
      }),
      emptyLocations: await eventsCollection.countDocuments({
        $or: [
          { locations: { $exists: false } },
          { locations: { $size: 0 } }
        ]
      })
    };

    if (!DRY_RUN) {
      console.log(`   - Events with locations array: ${newStats.withLocations}`);
      console.log(`   - Events with locationCodes: ${newStats.withLocationCodes}`);
      console.log(`   - Events with empty locations: ${newStats.emptyLocations}`);
    }

    // Summary
    console.log('\n📝 Migration Summary:');
    console.log(`   Events processed: ${eventsToMigrate.length}`);
    console.log(`   Events updated: ${updated}`);
    console.log(`   Events skipped (no rsKey): ${skipped}`);
    console.log(`   Events with no matching location: ${noMatch}`);
    console.log(`   Errors: ${errors}`);

    if (DRY_RUN) {
      console.log('\n*** DRY RUN COMPLETE - Run without --dry-run to apply changes ***\n');
    } else {
      console.log('\n✅ Migration completed successfully!\n');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
migrateLocationCodes()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

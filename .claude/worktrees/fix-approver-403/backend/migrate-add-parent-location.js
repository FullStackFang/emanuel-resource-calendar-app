// migrate-add-parent-location.js
// Migration script to add parentLocationId field and assign parent relationships
// Non-reservable locations will be assigned to similar reservable locations
//
// Run with: node migrate-add-parent-location.js

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const COLLECTION_NAME = 'templeEvents__Locations';
const BATCH_SIZE = 100; // Process in batches to avoid Cosmos DB rate limiting

// String similarity calculation (Levenshtein distance)
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 1.0;

  // Create matrix
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  const distance = matrix[len2][len1];
  return 1 - (distance / maxLen);
}

// Find best matching reservable location
function findBestParent(childLocation, reservableLocations) {
  const childName = childLocation.displayName || childLocation.name || '';
  const childOriginalText = childLocation.originalText || '';

  let bestMatch = null;
  let bestScore = 0;

  for (const reservable of reservableLocations) {
    const reservableName = reservable.displayName || reservable.name || '';

    // Check name similarity
    const nameScore = calculateSimilarity(childName, reservableName);

    // Check if original text contains reservable name
    const originalTextScore = childOriginalText.toLowerCase().includes(reservableName.toLowerCase()) ? 0.9 : 0;

    // Check aliases
    let aliasScore = 0;
    if (reservable.aliases && reservable.aliases.length > 0) {
      for (const alias of reservable.aliases) {
        const score = calculateSimilarity(childName, alias);
        aliasScore = Math.max(aliasScore, score);
      }
    }

    const maxScore = Math.max(nameScore, originalTextScore, aliasScore);

    if (maxScore > bestScore && maxScore >= 0.6) {
      bestScore = maxScore;
      bestMatch = {
        location: reservable,
        score: maxScore,
        matchType: maxScore === nameScore ? 'name' : (maxScore === originalTextScore ? 'originalText' : 'alias')
      };
    }
  }

  return bestMatch;
}

async function migrateAddParentLocation() {
  console.log('🚀 Starting migration: Add parentLocationId field\n');

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    console.error('Please ensure your .env file contains MONGODB_CONNECTION_STRING or MONGODB_URI');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   Collection: ${COLLECTION_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total locations in collection: ${totalDocs}\n`);

    // Step 2: Add parentLocationId: null to all locations that don't have it
    console.log('🔄 Step 1: Adding parentLocationId field to locations without it...');
    const addFieldResult = await collection.updateMany(
      { parentLocationId: { $exists: false } },
      { $set: { parentLocationId: null } }
    );
    console.log(`   ✅ Added parentLocationId to ${addFieldResult.modifiedCount} locations\n`);

    // Step 3: Get statistics
    const stats = {
      hasParent: await collection.countDocuments({ parentLocationId: { $ne: null } }),
      noParent: await collection.countDocuments({ parentLocationId: null }),
      reservable: await collection.countDocuments({ isReservable: true, active: { $ne: false }, status: { $ne: 'merged' } }),
      nonReservable: await collection.countDocuments({
        $or: [
          { isReservable: { $ne: true } },
          { isReservable: { $exists: false } }
        ],
        active: { $ne: false },
        status: { $ne: 'merged' },
        parentLocationId: null
      })
    };

    console.log('📈 Current distribution:');
    console.log(`   - Locations with parent: ${stats.hasParent}`);
    console.log(`   - Locations without parent: ${stats.noParent}`);
    console.log(`   - Reservable locations (potential parents): ${stats.reservable}`);
    console.log(`   - Non-reservable without parent (candidates): ${stats.nonReservable}\n`);

    // Step 4: Get all reservable locations (potential parents)
    console.log('🔄 Step 2: Loading reservable locations (potential parents)...');
    const reservableLocations = await collection.find({
      isReservable: true,
      active: { $ne: false },
      status: { $ne: 'merged' }
    }).toArray();
    console.log(`   ✅ Loaded ${reservableLocations.length} reservable locations\n`);

    // Step 5: Get all non-reservable locations (potential children)
    console.log('🔄 Step 3: Loading non-reservable locations (potential children)...');
    const nonReservableLocations = await collection.find({
      $or: [
        { isReservable: { $ne: true } },
        { isReservable: { $exists: false } }
      ],
      active: { $ne: false },
      status: { $ne: 'merged' },
      parentLocationId: null
    }).toArray();
    console.log(`   ✅ Loaded ${nonReservableLocations.length} non-reservable locations\n`);

    // Step 6: Find matches
    console.log('🔄 Step 4: Matching non-reservable locations to parents...');
    const assignments = [];

    for (const child of nonReservableLocations) {
      const bestMatch = findBestParent(child, reservableLocations);

      if (bestMatch) {
        assignments.push({
          childId: child._id,
          childName: child.displayName || child.name,
          parentId: bestMatch.location._id,
          parentName: bestMatch.location.displayName || bestMatch.location.name,
          score: bestMatch.score,
          matchType: bestMatch.matchType
        });
      }
    }

    console.log(`   ✅ Found ${assignments.length} potential parent-child relationships\n`);

    // Preview assignments
    if (assignments.length > 0) {
      console.log('📋 Preview of parent assignments (first 10):');
      assignments.slice(0, 10).forEach((assignment, idx) => {
        console.log(`   ${idx + 1}. "${assignment.childName}" → "${assignment.parentName}"`);
        console.log(`      Score: ${assignment.score.toFixed(2)} (${assignment.matchType})`);
      });

      if (assignments.length > 10) {
        console.log(`   ... and ${assignments.length - 10} more assignments`);
      }
      console.log('');
    }

    if (assignments.length === 0) {
      console.log('✅ No parent assignments needed. Migration complete.\n');
      return;
    }

    // Ask for confirmation
    console.log('⚠️  This will set parent relationships for non-reservable locations.');
    console.log('   Parent locations will be used for calendar grouping.');
    console.log('\n   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 7: Apply assignments in batches
    console.log('🔄 Step 5: Applying parent assignments in batches...');
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
      const batch = assignments.slice(i, i + BATCH_SIZE);

      // Process batch
      for (const assignment of batch) {
        try {
          await collection.updateOne(
            { _id: assignment.childId },
            { $set: { parentLocationId: assignment.parentId } }
          );
          successCount++;
        } catch (error) {
          console.error(`   ❌ Error assigning parent for ${assignment.childName}:`, error.message);
          errorCount++;
        }
      }

      console.log(`   Progress: ${successCount}/${assignments.length} assignments completed`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < assignments.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`\n✅ Parent assignment complete!`);
    console.log(`   Successfully assigned: ${successCount}`);
    console.log(`   Errors: ${errorCount}\n`);

    // Step 8: Verification
    console.log('📊 Post-migration distribution:');
    const newStats = {
      withParents: await collection.countDocuments({ parentLocationId: { $ne: null } }),
      withoutParents: await collection.countDocuments({ parentLocationId: null }),
      total: await collection.countDocuments({})
    };
    console.log(`   - Locations with parents: ${newStats.withParents}`);
    console.log(`   - Locations without parents (standalone): ${newStats.withoutParents}`);
    console.log(`   - Total locations: ${newStats.total}\n`);

    // Show sample of assigned locations
    console.log('📋 Sample of locations with parents (first 5):');
    const samples = await collection.find({ parentLocationId: { $ne: null } }).limit(5).toArray();

    for (const sample of samples) {
      const parent = await collection.findOne({ _id: sample.parentLocationId });
      console.log(`   "${sample.displayName || sample.name}" → "${parent ? (parent.displayName || parent.name) : 'NOT FOUND'}"`);
    }
    console.log('');

    // Summary
    console.log('📝 Migration Summary:');
    console.log(`   Total assignments attempted: ${assignments.length}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${errorCount}\n`);

    console.log('✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
migrateAddParentLocation()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

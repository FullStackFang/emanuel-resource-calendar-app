/**
 * Migration: Normalize all email fields to lowercase
 *
 * Cosmos DB queries using $regex for case-insensitive email matching are expensive
 * (full collection scans, ~20-50 RU each). This migration normalizes all stored
 * email fields to lowercase so queries can use exact match with indexes.
 *
 * Affected fields:
 *   Phase 1: templeEvents__Users.email
 *   Phase 2: templeEvents__Events.calendarOwner
 *   Phase 3: templeEvents__Events.createdByEmail
 *   Phase 4: templeEvents__Events.roomReservationData.requestedBy.email
 *
 * Usage:
 *   node migrate-normalize-emails.js --dry-run   # Preview changes
 *   node migrate-normalize-emails.js              # Apply changes
 *   node migrate-normalize-emails.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const usersCollection = db.collection('templeEvents__Users');
    const eventsCollection = db.collection('templeEvents__Events');

    console.log(`\n📋 Migration: Normalize emails to lowercase`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}`);
    console.log('');

    if (isVerify) {
      await verify(usersCollection, eventsCollection);
      return;
    }

    let totalUpdated = 0;

    // Phase 1: Users.email
    totalUpdated += await normalizeField(usersCollection, 'templeEvents__Users', 'email', isDryRun);

    // Phase 2: Events.calendarOwner
    totalUpdated += await normalizeField(eventsCollection, 'templeEvents__Events', 'calendarOwner', isDryRun);

    // Phase 3: Events.createdByEmail
    totalUpdated += await normalizeField(eventsCollection, 'templeEvents__Events', 'createdByEmail', isDryRun);

    // Phase 4: Events.roomReservationData.requestedBy.email
    totalUpdated += await normalizeNestedField(
      eventsCollection,
      'templeEvents__Events',
      'roomReservationData.requestedBy.email',
      isDryRun
    );

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Migration complete. Total documents updated: ${totalUpdated}`);
    if (isDryRun) {
      console.log('   (DRY RUN - no changes were made)');
    }
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Find and normalize a top-level field containing uppercase characters
 */
async function normalizeField(collection, collectionName, fieldPath, dryRun) {
  console.log(`\n--- Phase: ${collectionName}.${fieldPath} ---`);

  // Find documents where the field contains uppercase characters
  const query = {
    [fieldPath]: { $exists: true, $ne: null, $regex: /[A-Z]/ }
  };

  const docsToUpdate = await collection.find(query, { projection: { _id: 1, [fieldPath]: 1 } }).toArray();
  console.log(`   Found ${docsToUpdate.length} documents with uppercase in ${fieldPath}`);

  if (docsToUpdate.length === 0 || dryRun) {
    if (dryRun && docsToUpdate.length > 0) {
      // Show a sample
      const sample = docsToUpdate.slice(0, 5);
      for (const doc of sample) {
        const value = getNestedValue(doc, fieldPath);
        console.log(`   Sample: ${value} → ${value.toLowerCase()}`);
      }
      if (docsToUpdate.length > 5) {
        console.log(`   ... and ${docsToUpdate.length - 5} more`);
      }
    }
    return docsToUpdate.length;
  }

  let updated = 0;
  for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
    const batch = docsToUpdate.slice(i, i + BATCH_SIZE);

    // Must update individually since each doc has a different lowercase value
    for (const doc of batch) {
      const currentValue = getNestedValue(doc, fieldPath);
      if (currentValue && typeof currentValue === 'string') {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { [fieldPath]: currentValue.toLowerCase() } }
        );
        updated++;
      }
    }

    // Progress
    const processed = Math.min(i + BATCH_SIZE, docsToUpdate.length);
    const percent = Math.round((processed / docsToUpdate.length) * 100);
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToUpdate.length})`);

    // Rate limit delay between batches
    if (i + BATCH_SIZE < docsToUpdate.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n   ✅ Updated ${updated} documents`);
  return updated;
}

/**
 * Find and normalize a nested field (e.g., roomReservationData.requestedBy.email)
 */
async function normalizeNestedField(collection, collectionName, fieldPath, dryRun) {
  console.log(`\n--- Phase: ${collectionName}.${fieldPath} ---`);

  const query = {
    [fieldPath]: { $exists: true, $ne: null, $regex: /[A-Z]/ }
  };

  const docsToUpdate = await collection.find(query, { projection: { _id: 1, [fieldPath]: 1 } }).toArray();
  console.log(`   Found ${docsToUpdate.length} documents with uppercase in ${fieldPath}`);

  if (docsToUpdate.length === 0 || dryRun) {
    if (dryRun && docsToUpdate.length > 0) {
      const sample = docsToUpdate.slice(0, 5);
      for (const doc of sample) {
        const value = getNestedValue(doc, fieldPath);
        console.log(`   Sample: ${value} → ${value.toLowerCase()}`);
      }
      if (docsToUpdate.length > 5) {
        console.log(`   ... and ${docsToUpdate.length - 5} more`);
      }
    }
    return docsToUpdate.length;
  }

  let updated = 0;
  for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
    const batch = docsToUpdate.slice(i, i + BATCH_SIZE);

    for (const doc of batch) {
      const currentValue = getNestedValue(doc, fieldPath);
      if (currentValue && typeof currentValue === 'string') {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { [fieldPath]: currentValue.toLowerCase() } }
        );
        updated++;
      }
    }

    const processed = Math.min(i + BATCH_SIZE, docsToUpdate.length);
    const percent = Math.round((processed / docsToUpdate.length) * 100);
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToUpdate.length})`);

    if (i + BATCH_SIZE < docsToUpdate.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n   ✅ Updated ${updated} documents`);
  return updated;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Verify that no uppercase emails remain
 */
async function verify(usersCollection, eventsCollection) {
  console.log('🔍 Verifying email normalization...\n');

  const checks = [
    { collection: usersCollection, name: 'Users.email', field: 'email' },
    { collection: eventsCollection, name: 'Events.calendarOwner', field: 'calendarOwner' },
    { collection: eventsCollection, name: 'Events.createdByEmail', field: 'createdByEmail' },
    { collection: eventsCollection, name: 'Events.roomReservationData.requestedBy.email', field: 'roomReservationData.requestedBy.email' },
  ];

  let allClean = true;

  for (const check of checks) {
    const count = await check.collection.countDocuments({
      [check.field]: { $exists: true, $ne: null, $regex: /[A-Z]/ }
    });

    if (count > 0) {
      console.log(`   ❌ ${check.name}: ${count} documents still have uppercase`);
      allClean = false;
    } else {
      console.log(`   ✅ ${check.name}: all lowercase`);
    }
  }

  console.log('');
  if (allClean) {
    console.log('✅ All email fields are normalized to lowercase');
  } else {
    console.log('⚠️  Some fields still have uppercase — run migration without --dry-run');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });

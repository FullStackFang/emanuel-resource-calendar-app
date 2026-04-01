/**
 * Migration: Backfill rsKey on Locations
 *
 * Sets rsKey values on existing locations that are missing them.
 * rsKey is used by the CSV import script (import-rssched.js) to match events to rooms.
 *
 * Usage:
 *   node migrate-backfill-rskey.js --dry-run   # Preview changes
 *   node migrate-backfill-rskey.js              # Apply changes
 *   node migrate-backfill-rskey.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Locations';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

// Known locations and their rsKey values (matched by name)
const RSKEY_MAP = {
  'Archive': 'ARCHIVE',
  'Nursery School': 'NS',
  'Downtown': 'DT',
  'Lifelong Learning': 'LLL',
  'Religious School': 'RS',
  'Room 406 - Men\'s Club': '406',
  'Test Location': 'TEST'
};

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\n📋 Migration: Backfill rsKey on Locations`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    // Find locations that match our known names and are missing rsKey
    const names = Object.keys(RSKEY_MAP);
    const locations = await collection.find({
      name: { $in: names },
      $or: [
        { rsKey: null },
        { rsKey: { $exists: false } },
        { rsKey: '' }
      ]
    }).toArray();

    const totalLocations = await collection.countDocuments({});
    console.log(`   Total locations: ${totalLocations}`);
    console.log(`   Locations to update: ${locations.length}`);

    if (locations.length === 0) {
      console.log('\n✅ All known locations already have rsKey. Nothing to do.');
      return;
    }

    // Show what will be updated
    console.log(`\n   Updates to apply:`);
    for (const loc of locations) {
      const newKey = RSKEY_MAP[loc.name];
      console.log(`     - ${loc.name} (${loc._id}) → rsKey: '${newKey}'`);
    }

    if (isDryRun) {
      console.log(`\n🔍 DRY RUN — no changes made. Run without --dry-run to apply.`);
      return;
    }

    // Apply updates in batches
    let updated = 0;
    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
      const batch = locations.slice(i, i + BATCH_SIZE);

      for (const loc of batch) {
        const newKey = RSKEY_MAP[loc.name];
        await collection.updateOne(
          { _id: loc._id },
          { $set: { rsKey: newKey, updatedAt: new Date() } }
        );
        updated++;
      }

      const processed = Math.min(i + BATCH_SIZE, locations.length);
      const percent = Math.round((processed / locations.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${locations.length})`);

      if (i + BATCH_SIZE < locations.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n\n✅ Updated ${updated} locations with rsKey values.`);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function verify(collection) {
  const allLocations = await collection.find({}).sort({ name: 1 }).toArray();

  console.log(`   Total locations: ${allLocations.length}\n`);

  let withKey = 0;
  let withoutKey = 0;

  for (const loc of allLocations) {
    const hasKey = loc.rsKey && loc.rsKey.trim() !== '';
    const status = hasKey ? `✅ rsKey: '${loc.rsKey}'` : '❌ no rsKey';
    console.log(`   ${status.padEnd(25)} ${loc.name} (${loc._id})`);
    if (hasKey) withKey++;
    else withoutKey++;
  }

  console.log(`\n   Summary: ${withKey} with rsKey, ${withoutKey} without rsKey`);

  if (withoutKey === 0) {
    console.log('   ✅ All locations have rsKey values.');
  } else {
    console.log(`   ⚠️  ${withoutKey} locations still missing rsKey.`);
  }
}

main();

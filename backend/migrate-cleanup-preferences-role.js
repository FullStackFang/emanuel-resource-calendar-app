/**
 * Migration: Clean up legacy permission fields from preferences
 *
 * This removes legacy fields from user.preferences that are no longer used:
 * - preferences.role (now uses top-level role field)
 * - preferences.createEvents (now derived from role)
 * - preferences.editEvents (now derived from role)
 * - preferences.deleteEvents (now derived from role)
 * - preferences.isAdmin (now derived from role)
 *
 * Run with: node migrate-cleanup-preferences-role.js
 * Preview: node migrate-cleanup-preferences-role.js --dry-run
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

// Legacy fields to remove from preferences
const LEGACY_FIELDS = [
  'preferences.role',
  'preferences.createEvents',
  'preferences.editEvents',
  'preferences.deleteEvents',
  'preferences.isAdmin'
];

async function migrate() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    if (isDryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
    }

    const db = client.db(DB_NAME);
    const usersCollection = db.collection('templeEvents__Users');

    // Find all users with any legacy fields
    console.log('🔍 Finding users with legacy preference fields...');
    const usersWithLegacyFields = await usersCollection.find({
      $or: LEGACY_FIELDS.map(field => ({ [field]: { $exists: true } }))
    }).toArray();

    console.log(`📊 Found ${usersWithLegacyFields.length} users with legacy preference fields`);

    if (usersWithLegacyFields.length === 0) {
      console.log('✅ No cleanup needed');
      return;
    }

    // Show what will be cleaned up
    console.log('\n📋 Users to clean up:');
    for (const user of usersWithLegacyFields) {
      const legacyValues = [];
      if (user.preferences?.role !== undefined) legacyValues.push(`role="${user.preferences.role}"`);
      if (user.preferences?.createEvents !== undefined) legacyValues.push(`createEvents=${user.preferences.createEvents}`);
      if (user.preferences?.editEvents !== undefined) legacyValues.push(`editEvents=${user.preferences.editEvents}`);
      if (user.preferences?.deleteEvents !== undefined) legacyValues.push(`deleteEvents=${user.preferences.deleteEvents}`);
      if (user.preferences?.isAdmin !== undefined) legacyValues.push(`isAdmin=${user.preferences.isAdmin}`);

      console.log(`  - ${user.email}`);
      console.log(`    Legacy fields: ${legacyValues.join(', ')}`);
      console.log(`    Current role: "${user.role || 'not set'}"`);
    }

    if (isDryRun) {
      console.log('\n🔍 DRY RUN - Would have updated these users. Run without --dry-run to apply changes.');
      return;
    }

    // Build unset object for all legacy fields
    const unsetFields = {};
    for (const field of LEGACY_FIELDS) {
      unsetFields[field] = '';
    }

    // Remove all legacy fields from all users
    console.log('\n🔄 Removing legacy fields...');
    const result = await usersCollection.updateMany(
      { $or: LEGACY_FIELDS.map(field => ({ [field]: { $exists: true } })) },
      { $unset: unsetFields }
    );

    console.log(`✅ Updated ${result.modifiedCount} user documents`);
    console.log('✅ Successfully removed legacy permission fields from preferences');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

migrate();

/**
 * Migration script to convert legacy granular permissions to role-based system
 *
 * Mapping:
 * - isAdmin: true → role: 'admin'
 * - createEvents + editEvents + deleteEvents → role: 'approver'
 * - createEvents only → role: 'requester'
 * - Default → role: 'viewer'
 *
 * Usage: node migrate-user-roles.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

// Use same env vars as api-server.js
const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_CONNECTION_STRING environment variable is not set.');
  console.error('Make sure your .env file contains MONGODB_CONNECTION_STRING');
  process.exit(1);
}

// Helper to derive role from legacy permissions
function getRoleFromLegacyPermissions(preferences) {
  if (!preferences) return 'viewer';

  if (preferences.isAdmin) return 'admin';
  if (preferences.createEvents && preferences.editEvents && preferences.deleteEvents) return 'approver';
  if (preferences.createEvents || preferences.editEvents) return 'requester';
  return 'viewer';
}

async function migrateUserRoles() {
  console.log('Starting user role migration...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const usersCollection = db.collection('templeEvents__Users');

    // Find all users
    const users = await usersCollection.find({}).toArray();
    console.log(`Found ${users.length} users to migrate\n`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // Skip if user already has a role
      if (user.preferences?.role) {
        console.log(`SKIP: ${user.email} - already has role: ${user.preferences.role}`);
        skippedCount++;
        continue;
      }

      // Derive role from legacy permissions
      const role = getRoleFromLegacyPermissions(user.preferences);

      console.log(`MIGRATE: ${user.email}`);
      console.log(`  Legacy: createEvents=${user.preferences?.createEvents}, editEvents=${user.preferences?.editEvents}, deleteEvents=${user.preferences?.deleteEvents}, isAdmin=${user.preferences?.isAdmin}`);
      console.log(`  New role: ${role}`);

      // Update user with new role
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'preferences.role': role,
            updatedAt: new Date()
          }
        }
      );

      migratedCount++;
    }

    console.log('\n=== Migration Complete ===');
    console.log(`Migrated: ${migratedCount} users`);
    console.log(`Skipped: ${skippedCount} users (already had role)`);
    console.log(`Total: ${users.length} users`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run migration
migrateUserRoles();

#!/usr/bin/env node
/**
 * Migration Script: Permissions to Role Field
 *
 * This script migrates users from the old overlapping permission model
 * to the new single role-based system.
 *
 * OLD MODEL (multiple overlapping fields):
 * - user.isAdmin (boolean)
 * - user.roles (array) - partially implemented
 * - user.permissions.canViewAllReservations (boolean)
 * - user.permissions.canGenerateReservationTokens (boolean)
 * - user.preferences.createEvents/editEvents/deleteEvents/isAdmin (mostly dead code)
 *
 * NEW MODEL (single source of truth):
 * - user.role ('viewer' | 'requester' | 'approver' | 'admin')
 *
 * MIGRATION LOGIC:
 * 1. Skip users who already have a 'role' field
 * 2. @emanuelnyc.org email -> 'admin'
 * 3. isAdmin: true -> 'admin'
 * 4. permissions.canViewAllReservations: true -> 'approver'
 * 5. preferences.createEvents/editEvents: true -> 'requester'
 * 6. Default -> 'viewer'
 *
 * USAGE:
 *   node migrate-permissions-to-role.js --dry-run   # Preview changes
 *   node migrate-permissions-to-role.js             # Apply changes
 *
 * ROLLBACK:
 *   To roll back, run: db.templeEvents__Users.updateMany({}, { $unset: { role: "" } })
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME || 'emanuelnyc-services';
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN || '@emanuelnyc.org';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose') || args.includes('-v');

/**
 * Derive role from existing user data
 * @param {Object} user - User document from MongoDB
 * @returns {string} Derived role
 */
function deriveRole(user) {
  // 1. Skip users who already have a valid role field
  if (user.role && ['viewer', 'requester', 'approver', 'admin'].includes(user.role)) {
    return { role: user.role, reason: 'already has role' };
  }

  // 2. Domain-based admin
  if (user.email && typeof user.email === 'string' &&
      user.email.toLowerCase().endsWith(ADMIN_DOMAIN.toLowerCase())) {
    return { role: 'admin', reason: `email ends with ${ADMIN_DOMAIN}` };
  }

  // 3. Legacy isAdmin flag
  if (user.isAdmin === true) {
    return { role: 'admin', reason: 'isAdmin: true' };
  }

  // 4. Legacy preferences.isAdmin
  if (user.preferences?.isAdmin === true) {
    return { role: 'admin', reason: 'preferences.isAdmin: true' };
  }

  // 5. Legacy granular permissions -> approver
  if (user.permissions?.canViewAllReservations === true ||
      user.permissions?.canGenerateReservationTokens === true) {
    return { role: 'approver', reason: 'has approver-level permissions' };
  }

  // 6. Legacy create/edit permissions -> requester
  if (user.preferences?.createEvents === true ||
      user.preferences?.editEvents === true) {
    return { role: 'requester', reason: 'has create/edit permissions' };
  }

  // 7. Default to viewer
  return { role: 'viewer', reason: 'default (no legacy permissions)' };
}

async function migrate() {
  console.log('='.repeat(70));
  console.log('PERMISSIONS TO ROLE MIGRATION');
  console.log('='.repeat(70));
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log(`Admin domain: ${ADMIN_DOMAIN}`);
  console.log('');

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_CONNECTION_STRING not found in environment variables');
    console.error('Please check that backend/.env file exists and contains MONGODB_CONNECTION_STRING');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    console.log(`   Database: ${DB_NAME}`);

    const db = client.db(DB_NAME);
    const usersCollection = db.collection('templeEvents__Users');

    // Get all users
    const users = await usersCollection.find({}).toArray();
    console.log(`\nFound ${users.length} users to process\n`);

    const stats = {
      alreadyHasRole: 0,
      migratedToAdmin: 0,
      migratedToApprover: 0,
      migratedToRequester: 0,
      migratedToViewer: 0,
      errors: 0
    };

    const updates = [];

    for (const user of users) {
      const { role, reason } = deriveRole(user);

      if (reason === 'already has role') {
        stats.alreadyHasRole++;
        if (isVerbose) {
          console.log(`[SKIP] ${user.email || user._id}: already has role '${role}'`);
        }
        continue;
      }

      // Track stats
      if (role === 'admin') stats.migratedToAdmin++;
      else if (role === 'approver') stats.migratedToApprover++;
      else if (role === 'requester') stats.migratedToRequester++;
      else stats.migratedToViewer++;

      updates.push({
        _id: user._id,
        email: user.email,
        role,
        reason
      });

      console.log(`[UPDATE] ${user.email || user._id}: -> '${role}' (${reason})`);
    }

    console.log('\n📊 SUMMARY');
    console.log('═'.repeat(50));
    console.log(`   Already has role:      ${stats.alreadyHasRole}`);
    console.log(`   Migrate to admin:      ${stats.migratedToAdmin}`);
    console.log(`   Migrate to approver:   ${stats.migratedToApprover}`);
    console.log(`   Migrate to requester:  ${stats.migratedToRequester}`);
    console.log(`   Migrate to viewer:     ${stats.migratedToViewer}`);
    console.log(`   Total to update:       ${updates.length}`);
    console.log('═'.repeat(50));

    if (isDryRun) {
      console.log('\n⚠️  [DRY RUN] No changes made. Run without --dry-run to apply changes.');
    } else if (updates.length > 0) {
      console.log('\n🔄 Applying updates...');

      for (const update of updates) {
        try {
          await usersCollection.updateOne(
            { _id: update._id },
            { $set: { role: update.role, updatedAt: new Date() } }
          );
        } catch (err) {
          console.error(`   ❌ Failed to update ${update.email || update._id}: ${err.message}`);
          stats.errors++;
        }
      }

      console.log(`\n✅ Migration complete! ${updates.length - stats.errors} users updated.`);
      if (stats.errors > 0) {
        console.log(`   ⚠️  Errors: ${stats.errors}`);
      }
    } else {
      console.log('\n✅ No users need migration. Database is already up to date!');
    }

    console.log('\n💡 ROLLBACK COMMAND (if needed):');
    console.log('   db.templeEvents__Users.updateMany({}, { $unset: { role: "" } })');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

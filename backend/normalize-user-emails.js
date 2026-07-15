/**
 * Migration: normalize templeEvents__Users emails to lowercase.
 *
 * verifyToken always lowercases req.user.email from the JWT, so stored
 * mixed-case emails (e.g. 'Daniela.Guitelman@emanuelnyc.org') are missed by
 * case-sensitive findOne({ email }) lookups and the user's role is silently
 * dropped (production symptom: approver got 403 on attachment endpoints).
 *
 * The code fix (findRequestUser + sanitizeUserWrite normalization) makes
 * lookups resilient either way; this migration cleans the existing docs so
 * exact-match code paths (including the TEST_AUTH_BYPASS helper) also work.
 *
 * Usage:
 *   node normalize-user-emails.js --dry-run    # Preview changes
 *   node normalize-user-emails.js              # Apply changes
 *   node normalize-user-emails.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

const BATCH_SIZE = 100;

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const users = client.db(DB_NAME).collection('templeEvents__Users');

  console.log(`Database: ${DB_NAME}`);
  console.log(`Mode: ${VERIFY ? 'VERIFY' : DRY_RUN ? 'DRY RUN' : 'APPLY'}\n`);

  const mixedCase = await users
    .find({ email: { $regex: '[A-Z]' } })
    .project({ email: 1, displayName: 1, role: 1 })
    .toArray();

  console.log(`Users with mixed-case emails: ${mixedCase.length}`);

  if (VERIFY) {
    if (mixedCase.length === 0) {
      console.log('OK - all stored emails are lowercase.');
    } else {
      mixedCase.forEach((u) => console.log(`  REMAINING: ${u.email}`));
    }
    await client.close();
    return;
  }

  if (mixedCase.length === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  // Collision guard: skip any doc whose lowercased email already exists on a
  // DIFFERENT doc — merging duplicate accounts is a manual decision.
  const toUpdate = [];
  for (const u of mixedCase) {
    const lower = u.email.trim().toLowerCase();
    const collision = await users.findOne({ email: lower, _id: { $ne: u._id } });
    if (collision) {
      console.log(`  SKIP (collision): ${u.email} -> ${lower} already used by _id ${collision._id}`);
    } else {
      toUpdate.push({ _id: u._id, from: u.email, to: lower });
    }
  }

  if (DRY_RUN) {
    console.log(`\nWould update ${toUpdate.length} user(s):`);
    toUpdate.forEach((u) => console.log(`  ${u.from} -> ${u.to}`));
    await client.close();
    return;
  }

  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    for (const u of batch) {
      await users.updateOne({ _id: u._id }, { $set: { email: u.to } });
      updated++;
    }

    const processed = Math.min(i + BATCH_SIZE, toUpdate.length);
    const percent = Math.round((processed / toUpdate.length) * 100);
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${toUpdate.length})`);

    if (i + BATCH_SIZE < toUpdate.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const remaining = await users.countDocuments({ email: { $regex: '[A-Z]' } });
  console.log(`\n\nUpdated: ${updated}. Remaining mixed-case emails: ${remaining}`);
  await client.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

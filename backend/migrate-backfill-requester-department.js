/**
 * Migration: Backfill roomReservationData.requestedBy.department on app events.
 *
 * The unified editability rule (backend/utils/eventEditability.js) reads the
 * stored requestedBy.department only — no live creator lookup. This backfills
 * historical app events that have a requester email but no stored department,
 * from the creator's CURRENT profile department. rsched imports and recurring
 * child docs (occurrence/exception/addition) are skipped.
 *
 * Usage:
 *   node migrate-backfill-requester-department.js --dry-run
 *   node migrate-backfill-requester-department.js
 *   node migrate-backfill-requester-department.js --verify
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const USERS_COLLECTION = 'templeEvents__Users';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

function buildBackfillQuery() {
  return {
    source: { $ne: 'rsSched' },
    eventType: { $in: ['singleInstance', 'seriesMaster'] },
    'roomReservationData.requestedBy.email': { $exists: true, $nin: [null, ''] },
    $or: [
      { 'roomReservationData.requestedBy.department': { $exists: false } },
      { 'roomReservationData.requestedBy.department': '' },
      { 'roomReservationData.requestedBy.department': null },
    ],
  };
}

async function verify(events) {
  const remaining = await events.countDocuments(buildBackfillQuery());
  console.log(`   Remaining events missing stored department: ${remaining}`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const events = db.collection(COLLECTION);
    const users = db.collection(USERS_COLLECTION);

    console.log(`\n📋 Migration: Backfill requester department`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(events);
      return;
    }

    const docs = await events.find(buildBackfillQuery())
      .project({ _id: 1, 'roomReservationData.requestedBy.userId': 1, 'roomReservationData.requestedBy.email': 1 })
      .toArray();
    console.log(`   Candidates: ${docs.length}`);

    // Resolve each candidate's creator department from the user profile.
    const emails = [...new Set(docs.map(d => (d.roomReservationData?.requestedBy?.email || '').toLowerCase()).filter(Boolean))];
    const profiles = emails.length
      ? await users.find({ email: { $in: emails } }, { projection: { email: 1, department: 1 } }).toArray()
      : [];
    const deptByEmail = {};
    for (const p of profiles) deptByEmail[(p.email || '').toLowerCase()] = p.department || '';

    const updates = docs
      .map(d => ({ _id: d._id, dept: deptByEmail[(d.roomReservationData?.requestedBy?.email || '').toLowerCase()] || '' }))
      .filter(u => u.dept); // only write when we actually resolved a department

    console.log(`   Resolvable (creator has a department): ${updates.length}`);

    if (isDryRun) {
      console.log('   DRY RUN — no writes. Sample:');
      updates.slice(0, 10).forEach(u => console.log(`     ${u._id} -> "${u.dept}"`));
      return;
    }

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      // Per-doc value differs, so issue one update per doc within the batch.
      await Promise.all(batch.map(u => events.updateOne(
        { _id: u._id },
        { $set: { 'roomReservationData.requestedBy.department': u.dept } }
      )));

      const processed = Math.min(i + BATCH_SIZE, updates.length);
      const percent = Math.round((processed / Math.max(updates.length, 1)) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${updates.length})`);

      if (i + BATCH_SIZE < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(`\n   Done. Updated ${updates.length} events.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildBackfillQuery };

/**
 * Migration: Rename "approved" status to "published"
 *
 * Updates:
 * 1. status: 'approved' → 'published' on all event documents
 * 2. Renames approvedAt → publishedAt, approvedBy → publishedBy
 * 3. Updates statusHistory[].status entries from 'approved' to 'published'
 * 4. Updates previousStatus field from 'approved' to 'published'
 *
 * Does NOT touch:
 * - pendingEditRequest.status values
 * - templeEvents__Locations documents
 *
 * Usage:
 *   node migrate-approved-to-published.js --dry-run    # Preview changes
 *   node migrate-approved-to-published.js              # Apply changes
 *   node migrate-approved-to-published.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERIFY = args.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    if (VERIFY) {
      await verify(collection);
    } else {
      await migrate(collection);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function verify(collection) {
  console.log('\n🔍 Verifying migration status...\n');

  const approvedCount = await collection.countDocuments({ status: 'approved' });
  const publishedCount = await collection.countDocuments({ status: 'published' });
  const approvedAtCount = await collection.countDocuments({ approvedAt: { $exists: true } });
  const publishedAtCount = await collection.countDocuments({ publishedAt: { $exists: true } });
  const approvedByCount = await collection.countDocuments({ approvedBy: { $exists: true } });
  const publishedByCount = await collection.countDocuments({ publishedBy: { $exists: true } });
  const previousStatusApproved = await collection.countDocuments({ previousStatus: 'approved' });
  const previousStatusPublished = await collection.countDocuments({ previousStatus: 'published' });

  // Check statusHistory entries
  const historyApproved = await collection.countDocuments({
    'statusHistory.status': 'approved'
  });
  const historyPublished = await collection.countDocuments({
    'statusHistory.status': 'published'
  });

  console.log('   Status field:');
  console.log(`     status: 'approved'  → ${approvedCount} documents ${approvedCount === 0 ? '✅' : '⚠️  (needs migration)'}`);
  console.log(`     status: 'published' → ${publishedCount} documents`);
  console.log();
  console.log('   Field names:');
  console.log(`     approvedAt  → ${approvedAtCount} documents ${approvedAtCount === 0 ? '✅' : '⚠️  (needs migration)'}`);
  console.log(`     publishedAt → ${publishedAtCount} documents`);
  console.log(`     approvedBy  → ${approvedByCount} documents ${approvedByCount === 0 ? '✅' : '⚠️  (needs migration)'}`);
  console.log(`     publishedBy → ${publishedByCount} documents`);
  console.log();
  console.log('   previousStatus field:');
  console.log(`     previousStatus: 'approved'  → ${previousStatusApproved} documents ${previousStatusApproved === 0 ? '✅' : '⚠️  (needs migration)'}`);
  console.log(`     previousStatus: 'published' → ${previousStatusPublished} documents`);
  console.log();
  console.log('   statusHistory entries:');
  console.log(`     Documents with statusHistory[].status='approved'  → ${historyApproved} ${historyApproved === 0 ? '✅' : '⚠️  (needs migration)'}`);
  console.log(`     Documents with statusHistory[].status='published' → ${historyPublished}`);

  const needsMigration = approvedCount > 0 || approvedAtCount > 0 || approvedByCount > 0 || previousStatusApproved > 0 || historyApproved > 0;
  console.log(`\n   ${needsMigration ? '⚠️  Migration needed' : '✅ Migration complete — no "approved" remnants found'}\n`);
}

async function migrate(collection) {
  console.log(`\n${DRY_RUN ? '🏃 DRY RUN' : '🚀 LIVE RUN'} — Renaming "approved" → "published"\n`);

  // Step 1: Update status field
  const approvedDocs = await collection.find({ status: 'approved' }).toArray();
  console.log(`   Step 1: Found ${approvedDocs.length} documents with status: 'approved'`);

  if (approvedDocs.length > 0 && !DRY_RUN) {
    for (let i = 0; i < approvedDocs.length; i += BATCH_SIZE) {
      const batch = approvedDocs.slice(i, i + BATCH_SIZE);
      await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $set: { status: 'published' } }
      );
      const processed = Math.min(i + BATCH_SIZE, approvedDocs.length);
      const percent = Math.round((processed / approvedDocs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${approvedDocs.length})`);
      if (i + BATCH_SIZE < approvedDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(' ✅');
  }

  // Step 2: Rename approvedAt → publishedAt
  const approvedAtDocs = await collection.find({ approvedAt: { $exists: true } }).toArray();
  console.log(`   Step 2: Found ${approvedAtDocs.length} documents with approvedAt field`);

  if (approvedAtDocs.length > 0 && !DRY_RUN) {
    for (let i = 0; i < approvedAtDocs.length; i += BATCH_SIZE) {
      const batch = approvedAtDocs.slice(i, i + BATCH_SIZE);
      await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $rename: { approvedAt: 'publishedAt' } }
      );
      const processed = Math.min(i + BATCH_SIZE, approvedAtDocs.length);
      const percent = Math.round((processed / approvedAtDocs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${approvedAtDocs.length})`);
      if (i + BATCH_SIZE < approvedAtDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(' ✅');
  }

  // Step 3: Rename approvedBy → publishedBy
  const approvedByDocs = await collection.find({ approvedBy: { $exists: true } }).toArray();
  console.log(`   Step 3: Found ${approvedByDocs.length} documents with approvedBy field`);

  if (approvedByDocs.length > 0 && !DRY_RUN) {
    for (let i = 0; i < approvedByDocs.length; i += BATCH_SIZE) {
      const batch = approvedByDocs.slice(i, i + BATCH_SIZE);
      await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $rename: { approvedBy: 'publishedBy' } }
      );
      const processed = Math.min(i + BATCH_SIZE, approvedByDocs.length);
      const percent = Math.round((processed / approvedByDocs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${approvedByDocs.length})`);
      if (i + BATCH_SIZE < approvedByDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(' ✅');
  }

  // Step 4: Update previousStatus field
  const prevStatusDocs = await collection.find({ previousStatus: 'approved' }).toArray();
  console.log(`   Step 4: Found ${prevStatusDocs.length} documents with previousStatus: 'approved'`);

  if (prevStatusDocs.length > 0 && !DRY_RUN) {
    for (let i = 0; i < prevStatusDocs.length; i += BATCH_SIZE) {
      const batch = prevStatusDocs.slice(i, i + BATCH_SIZE);
      await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $set: { previousStatus: 'published' } }
      );
      const processed = Math.min(i + BATCH_SIZE, prevStatusDocs.length);
      const percent = Math.round((processed / prevStatusDocs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${prevStatusDocs.length})`);
      if (i + BATCH_SIZE < prevStatusDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(' ✅');
  }

  // Step 5: Update statusHistory[].status entries (per-document iteration needed for array elements)
  const historyDocs = await collection.find({ 'statusHistory.status': 'approved' }).toArray();
  console.log(`   Step 5: Found ${historyDocs.length} documents with statusHistory entries containing 'approved'`);

  if (historyDocs.length > 0 && !DRY_RUN) {
    for (let i = 0; i < historyDocs.length; i += BATCH_SIZE) {
      const batch = historyDocs.slice(i, i + BATCH_SIZE);

      for (const doc of batch) {
        const updatedHistory = doc.statusHistory.map(entry => {
          if (entry.status === 'approved') {
            return { ...entry, status: 'published' };
          }
          return entry;
        });
        await collection.updateOne(
          { _id: doc._id },
          { $set: { statusHistory: updatedHistory } }
        );
      }

      const processed = Math.min(i + BATCH_SIZE, historyDocs.length);
      const percent = Math.round((processed / historyDocs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${historyDocs.length})`);
      if (i + BATCH_SIZE < historyDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(' ✅');
  }

  console.log(`\n   ${DRY_RUN ? '🏃 Dry run complete — no changes made. Remove --dry-run to apply.' : '✅ Migration complete!'}\n`);
}

main();

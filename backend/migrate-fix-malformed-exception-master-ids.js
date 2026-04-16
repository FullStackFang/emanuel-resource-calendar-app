// migrate-fix-malformed-exception-master-ids.js
//
// Repairs exception/addition documents whose seriesMasterEventId was incorrectly
// set to a date-suffixed value (Bug B, pre-fix data).
//
// Bug B (commit fdaf574 fixed): when a user re-edited an already-materialized
// exception occurrence, the backend used exception.eventId as if it were a
// master eventId. This produced new docs with:
//   - seriesMasterEventId = "<UUID>-<date>"   (corrupt — should be "<UUID>")
//   - eventId             = "<UUID>-<date>-<date>" (double-suffix)
//
// This script finds those corrupted docs and repairs them in-place:
//   1. Strip trailing -YYYY-MM-DD (and -add-YYYY-MM-DD) suffixes repeatedly
//      until the ID is stable.
//   2. Verify a seriesMaster document exists with that exact eventId.
//   3. If a correctly-keyed sibling exception already exists for the same
//      (masterUUID, occurrenceDate), soft-delete the malformed duplicate
//      (preserves the well-keyed sibling; originals stashed for 30-day rollback).
//   4. Otherwise, rewrite seriesMasterEventId and eventId to clean values.
//      eventId is rebuilt from the stored occurrenceDate field (canonical)
//      to avoid compounding corruption.
//
// Originals stashed in _migrated_originalSeriesMasterEventId and
// _migrated_originalEventId for 30-day rollback.
//
// Run with:
//   node migrate-fix-malformed-exception-master-ids.js --dry-run
//   node migrate-fix-malformed-exception-master-ids.js
//   node migrate-fix-malformed-exception-master-ids.js --verify

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { EVENT_TYPE, EXCEPTION_TYPES } = require('./utils/exceptionDocumentService');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'emanuelnyc';
const BATCH_SIZE = 100;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerify = args.includes('--verify');

// Match trailing "-YYYY-MM-DD" or "-add-YYYY-MM-DD" suffix.
// UUID-safe: UUIDs use 4-group/2-group/2-group hex segments, not decimal digits.
const SUFFIX_RE = /(-add)?-\d{4}-\d{2}-\d{2}$/;

function stripDateSuffixes(id) {
  if (!id) return id;
  let prev;
  let cur = id;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(SUFFIX_RE, '');
  }
  return cur;
}

function buildCorrectEventId(masterUuid, eventType, occurrenceDate) {
  const suffix = eventType === EVENT_TYPE.ADDITION ? '-add-' : '-';
  return `${masterUuid}${suffix}${occurrenceDate}`;
}

async function migrate() {
  const mode = isDryRun ? 'DRY RUN' : (isVerify ? 'VERIFY' : 'APPLY');
  console.log(`\n===============================================`);
  console.log(`  Migration: Fix Malformed seriesMasterEventId`);
  console.log(`  Mode: ${mode}`);
  console.log(`===============================================\n`);

  if (!MONGODB_URI) {
    console.error('Error: MONGODB_CONNECTION_STRING or MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 30)}...`);
  console.log(`   Batch Size: ${BATCH_SIZE}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // --- VERIFY MODE ---
    if (isVerify) {
      const liveCorrupt = await collection.countDocuments({
        eventType: { $in: EXCEPTION_TYPES },
        seriesMasterEventId: { $regex: SUFFIX_RE.source },
        isDeleted: { $ne: true },
      });
      const softDeletedCorrupt = await collection.countDocuments({
        eventType: { $in: EXCEPTION_TYPES },
        seriesMasterEventId: { $regex: SUFFIX_RE.source },
        isDeleted: true,
      });
      const migratedMarkers = await collection.countDocuments({
        _migrated_originalSeriesMasterEventId: { $exists: true },
      });

      console.log('--- Verification ---\n');
      console.log(`   Live corrupt exception/addition docs:        ${liveCorrupt}`);
      console.log(`   Soft-deleted corrupt exception/addition docs: ${softDeletedCorrupt}`);
      console.log(`   Docs with _migrated_* markers (fixed/dup):   ${migratedMarkers}`);
      console.log('');
      if (liveCorrupt === 0) {
        console.log('PASS: no live malformed seriesMasterEventId remain.');
      } else {
        console.log('FAIL: live malformed docs still present. Re-run without --verify.');
      }
      return;
    }

    // --- GATHER STATE ---
    const malformed = await collection.find({
      eventType: { $in: EXCEPTION_TYPES },
      seriesMasterEventId: { $regex: SUFFIX_RE.source },
    }).toArray();

    console.log('--- Current State ---\n');
    console.log(`   Malformed exception/addition docs found: ${malformed.length}\n`);

    if (malformed.length === 0) {
      console.log('No malformed documents. Migration not needed.\n');
      return;
    }

    let fixed = 0;
    let conflictDuplicates = 0;
    let missingMaster = 0;
    let skipped = 0;

    for (let i = 0; i < malformed.length; i += BATCH_SIZE) {
      const batch = malformed.slice(i, i + BATCH_SIZE);

      // Batch-fetch masters for the whole batch in one query (avoids N+1 findOne).
      const batchMasterUuids = [...new Set(
        batch.map(d => stripDateSuffixes(d.seriesMasterEventId)).filter(Boolean)
      )];
      const batchMasters = await collection.find(
        { eventId: { $in: batchMasterUuids }, eventType: EVENT_TYPE.SERIES_MASTER },
        { projection: { _id: 1, eventId: 1 } }
      ).toArray();
      const masterByEventId = new Map(batchMasters.map(m => [m.eventId, m]));

      for (const doc of batch) {
        const correctMasterUuid = stripDateSuffixes(doc.seriesMasterEventId);

        if (!correctMasterUuid || correctMasterUuid === doc.seriesMasterEventId) {
          skipped++;
          if (isDryRun) {
            console.log(`  [SKIP] ${doc._id}: strip yielded no change (${doc.seriesMasterEventId})`);
          }
          continue;
        }

        const master = masterByEventId.get(correctMasterUuid);
        if (!master) {
          missingMaster++;
          if (isDryRun) {
            console.log(`  [SKIP] Master ${correctMasterUuid} not found for doc ${doc._id}`);
          }
          continue;
        }

        if (!doc.occurrenceDate) {
          skipped++;
          if (isDryRun) {
            console.log(`  [SKIP] Doc ${doc._id} has no occurrenceDate — cannot rebuild eventId`);
          }
          continue;
        }

        const correctEventId = buildCorrectEventId(correctMasterUuid, doc.eventType, doc.occurrenceDate);

        // Check for correctly-keyed sibling
        const sibling = await collection.findOne(
          {
            seriesMasterEventId: correctMasterUuid,
            occurrenceDate: doc.occurrenceDate,
            eventType: { $in: EXCEPTION_TYPES },
            isDeleted: { $ne: true },
            _id: { $ne: doc._id },
          },
          { projection: { _id: 1, eventId: 1, overrides: 1 } }
        );

        if (sibling) {
          conflictDuplicates++;
          if (isDryRun) {
            console.log(
              `  [CONFLICT] Dup: ${doc._id} (malformed) vs sibling ${sibling._id} (clean: ${sibling.eventId})`
            );
          } else {
            // Soft-delete the malformed duplicate; stash originals for rollback.
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  isDeleted: true,
                  status: 'deleted',
                  deletedAt: new Date(),
                  deletedBy: 'migration',
                  _migrated_reason: 'Duplicate of correctly-keyed sibling from Bug B',
                  _migrated_siblingId: sibling._id,
                  _migrated_originalSeriesMasterEventId: doc.seriesMasterEventId,
                  _migrated_originalEventId: doc.eventId,
                },
                $inc: { _version: 1 },
              }
            );
          }
          continue;
        }

        if (isDryRun) {
          console.log(
            `  [FIX] ${doc._id}: seriesMasterEventId ${doc.seriesMasterEventId} -> ${correctMasterUuid}; ` +
            `eventId ${doc.eventId} -> ${correctEventId}`
          );
        } else {
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                seriesMasterEventId: correctMasterUuid,
                eventId: correctEventId,
                _migrated_originalSeriesMasterEventId: doc.seriesMasterEventId,
                _migrated_originalEventId: doc.eventId,
              },
              $inc: { _version: 1 },
            }
          );
        }
        fixed++;
      }

      const processed = Math.min(i + BATCH_SIZE, malformed.length);
      const percent = Math.round((processed / malformed.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${malformed.length})`);

      if (i + BATCH_SIZE < malformed.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n\n--- Summary ---\n');
    console.log(`   Fixed:                ${fixed}`);
    console.log(`   Duplicates soft-deleted: ${conflictDuplicates}`);
    console.log(`   Missing master (skipped): ${missingMaster}`);
    console.log(`   Other skips:          ${skipped}`);
    console.log('');
    if (isDryRun) {
      console.log('Dry-run complete. Run without --dry-run to apply.');
    } else {
      console.log('Migration complete. Run with --verify to confirm.');
    }
  } finally {
    await client.close();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

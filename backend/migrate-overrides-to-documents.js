// migrate-overrides-to-documents.js
// Migration script to convert occurrenceOverrides arrays on series masters
// into separate exception/addition documents in templeEvents__Events.
//
// This is part of the recurring events architecture redesign:
// - Old model: overrides stored in arrays on the series master document
// - New model: each modified occurrence is its own document (exception-as-document)
//
// Run with:
//   node migrate-overrides-to-documents.js --dry-run    # Preview changes
//   node migrate-overrides-to-documents.js              # Apply changes
//   node migrate-overrides-to-documents.js --verify     # Verify results

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { mergeDefaultsWithOverrides, EVENT_TYPE } = require('./utils/exceptionDocumentService');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const BATCH_SIZE = 50;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerify = args.includes('--verify');

async function migrate() {
  const mode = isDryRun ? 'DRY RUN' : (isVerify ? 'VERIFY' : 'APPLY');
  console.log(`\n===============================================`);
  console.log(`  Migration: Overrides Array -> Exception Documents`);
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
      await verifyMigration(collection);
      return;
    }

    // --- GATHER STATISTICS ---
    console.log('--- Current State ---\n');

    const totalDocs = await collection.countDocuments({});
    const mastersWithOverrides = await collection.countDocuments({
      eventType: 'seriesMaster',
      occurrenceOverrides: { $exists: true, $not: { $size: 0 } }
    });
    const mastersWithAdditions = await collection.countDocuments({
      eventType: 'seriesMaster',
      'recurrence.additions': { $exists: true, $not: { $size: 0 } }
    });
    const existingExceptionDocs = await collection.countDocuments({
      eventType: { $in: [EVENT_TYPE.EXCEPTION, EVENT_TYPE.ADDITION] }
    });

    console.log(`Total documents: ${totalDocs}`);
    console.log(`Series masters with occurrenceOverrides: ${mastersWithOverrides}`);
    console.log(`Series masters with recurrence.additions: ${mastersWithAdditions}`);
    console.log(`Existing exception/addition documents: ${existingExceptionDocs}`);

    if (mastersWithOverrides === 0 && mastersWithAdditions === 0) {
      console.log('\nNothing to migrate. All overrides already converted or none exist.');
      return;
    }

    // --- PHASE 1: Create exception documents from occurrenceOverrides ---
    console.log('\n--- Phase 1: Create Exception Documents from Overrides ---\n');

    const mastersToMigrate = await collection.find({
      eventType: 'seriesMaster',
      $or: [
        { occurrenceOverrides: { $exists: true, $not: { $size: 0 } } },
        { 'recurrence.additions': { $exists: true, $not: { $size: 0 } } }
      ]
    }).toArray();

    let exceptionsCreated = 0;
    let additionsCreated = 0;
    let skippedExisting = 0;

    for (let i = 0; i < mastersToMigrate.length; i += BATCH_SIZE) {
      const batch = mastersToMigrate.slice(i, i + BATCH_SIZE);

      // Batch existence check — one query per batch instead of N+1 per override
      const batchEventIds = batch.map(m => m.eventId);
      const alreadyMigrated = await collection.find({
        seriesMasterEventId: { $in: batchEventIds },
        eventType: { $in: [EVENT_TYPE.EXCEPTION, EVENT_TYPE.ADDITION] }
      }, { projection: { seriesMasterEventId: 1, occurrenceDate: 1 } }).toArray();
      const migratedSet = new Set(
        alreadyMigrated.map(d => `${d.seriesMasterEventId}|${d.occurrenceDate}`)
      );

      for (const master of batch) {
        const overrides = master.occurrenceOverrides || [];
        const additions = master.recurrence?.additions || [];
        const exceptionEventIds = master.exceptionEventIds || [];

        const additionDateSet = new Set(additions);

        for (const override of overrides) {
          if (!override.occurrenceDate) continue;

          if (migratedSet.has(`${master.eventId}|${override.occurrenceDate}`)) {
            skippedExisting++;
            continue;
          }

          // Determine if this is an addition or a regular exception
          const isAddition = additionDateSet.has(override.occurrenceDate);
          const eventType = isAddition ? EVENT_TYPE.ADDITION : EVENT_TYPE.EXCEPTION;
          const eventIdSuffix = isAddition ? `-add-${override.occurrenceDate}` : `-${override.occurrenceDate}`;

          // Build override data (strip occurrenceDate from fields)
          const overrideData = {};
          for (const [k, v] of Object.entries(override)) {
            if (k !== 'occurrenceDate') overrideData[k] = v;
          }

          // Look up Graph event ID from exceptionEventIds
          const graphEntry = exceptionEventIds.find(e => e.date === override.occurrenceDate);

          const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(
            master, overrideData, override.occurrenceDate
          );

          const doc = {
            _id: new ObjectId(),
            eventId: `${master.eventId}${eventIdSuffix}`,
            eventType,
            seriesMasterEventId: master.eventId,
            occurrenceDate: override.occurrenceDate,
            overrides: overrideData,
            ...effectiveFields,
            calendarData: effectiveCalendarData,
            userId: master.userId,
            calendarOwner: master.calendarOwner,
            calendarId: master.calendarId,
            status: master.status,
            isDeleted: master.isDeleted || false,
            roomReservationData: master.roomReservationData || null,
            graphEventId: graphEntry?.graphId || null,
            graphData: null,
            _version: 1,
            statusHistory: [{
              status: master.status,
              changedAt: new Date(),
              changedBy: 'migration',
              reason: `Migrated from occurrenceOverrides array (${eventType})`
            }],
            createdAt: new Date(),
            createdBy: 'migration',
            lastModifiedDateTime: new Date(),
            lastModifiedBy: 'migration',
          };

          if (isDryRun) {
            console.log(`   [DRY RUN] Would create ${eventType} doc: ${doc.eventId} (date: ${override.occurrenceDate})`);
          } else {
            await collection.insertOne(doc);
          }

          if (isAddition) additionsCreated++;
          else exceptionsCreated++;
        }

        // Process additions that don't have overrides (standalone addition dates)
        for (const addDate of additions) {
          // Skip if we already created a doc for this date from the overrides loop
          const alreadyHandled = overrides.some(o => o.occurrenceDate === addDate);
          if (alreadyHandled) continue;

          if (migratedSet.has(`${master.eventId}|${addDate}`)) {
            skippedExisting++;
            continue;
          }

          const graphEntry = exceptionEventIds.find(e => e.date === addDate);
          const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(master, {}, addDate);

          const doc = {
            _id: new ObjectId(),
            eventId: `${master.eventId}-add-${addDate}`,
            eventType: EVENT_TYPE.ADDITION,
            seriesMasterEventId: master.eventId,
            occurrenceDate: addDate,
            overrides: {},
            ...effectiveFields,
            calendarData: effectiveCalendarData,
            userId: master.userId,
            calendarOwner: master.calendarOwner,
            calendarId: master.calendarId,
            status: master.status,
            isDeleted: master.isDeleted || false,
            roomReservationData: master.roomReservationData || null,
            graphEventId: graphEntry?.graphId || null,
            graphData: null,
            _version: 1,
            statusHistory: [{
              status: master.status,
              changedAt: new Date(),
              changedBy: 'migration',
              reason: 'Migrated from recurrence.additions array'
            }],
            createdAt: new Date(),
            createdBy: 'migration',
            lastModifiedDateTime: new Date(),
            lastModifiedBy: 'migration',
          };

          if (isDryRun) {
            console.log(`   [DRY RUN] Would create addition doc: ${doc.eventId} (date: ${addDate})`);
          } else {
            await collection.insertOne(doc);
          }
          additionsCreated++;
        }
      }

      // Progress bar
      const processed = Math.min(i + BATCH_SIZE, mastersToMigrate.length);
      const percent = Math.round((processed / mastersToMigrate.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${mastersToMigrate.length} masters)`);

      // Rate limit delay between batches
      if (i + BATCH_SIZE < mastersToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n');
    console.log(`Exception documents created: ${exceptionsCreated}`);
    console.log(`Addition documents created: ${additionsCreated}`);
    console.log(`Skipped (already exist): ${skippedExisting}`);

    // --- PHASE 2: Clean master documents (backup arrays first) ---
    if (!isDryRun) {
      console.log('\n--- Phase 2: Clean Master Documents ---\n');

      let cleaned = 0;
      for (let i = 0; i < mastersToMigrate.length; i += BATCH_SIZE) {
        const batch = mastersToMigrate.slice(i, i + BATCH_SIZE);
        const batchIds = batch.map(m => m._id);

        await collection.updateMany(
          { _id: { $in: batchIds } },
          {
            $rename: {
              occurrenceOverrides: '_migrated_occurrenceOverrides',
              'calendarData.occurrenceOverrides': '_migrated_calendarData_occurrenceOverrides',
              exceptionEventIds: '_migrated_exceptionEventIds',
            }
          }
        );
        cleaned += batch.length;

        const processed = Math.min(i + BATCH_SIZE, mastersToMigrate.length);
        const percent = Math.round((processed / mastersToMigrate.length) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${mastersToMigrate.length} masters cleaned)`);

        if (i + BATCH_SIZE < mastersToMigrate.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`\n   Masters cleaned: ${cleaned}`);
      console.log('   Old arrays moved to _migrated_* fields (retained for 30-day rollback window)');
    }

    // --- SUMMARY ---
    console.log('\n--- Migration Summary ---\n');
    console.log(`Mode: ${mode}`);
    console.log(`Masters processed: ${mastersToMigrate.length}`);
    console.log(`Exception docs created: ${exceptionsCreated}`);
    console.log(`Addition docs created: ${additionsCreated}`);
    console.log(`Skipped (already exist): ${skippedExisting}`);
    if (!isDryRun) {
      console.log('\nRun with --verify to confirm migration completeness.');
    }

  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

async function verifyMigration(collection) {
  console.log('--- Verification ---\n');

  // Check for any remaining un-migrated overrides
  const unmigrated = await collection.countDocuments({
    eventType: 'seriesMaster',
    occurrenceOverrides: { $exists: true, $not: { $size: 0 } }
  });
  const migratedBackup = await collection.countDocuments({
    eventType: 'seriesMaster',
    _migrated_occurrenceOverrides: { $exists: true }
  });
  const exceptionDocs = await collection.countDocuments({
    eventType: { $in: [EVENT_TYPE.EXCEPTION, EVENT_TYPE.ADDITION] }
  });
  const exceptionDocsWithGraphId = await collection.countDocuments({
    eventType: { $in: [EVENT_TYPE.EXCEPTION, EVENT_TYPE.ADDITION] },
    graphEventId: { $ne: null }
  });

  console.log(`Un-migrated masters (still have occurrenceOverrides): ${unmigrated}`);
  console.log(`Migrated masters (have _migrated_* backup): ${migratedBackup}`);
  console.log(`Exception/addition documents: ${exceptionDocs}`);
  console.log(`  - With graphEventId: ${exceptionDocsWithGraphId}`);
  console.log(`  - Without graphEventId: ${exceptionDocs - exceptionDocsWithGraphId}`);

  if (unmigrated === 0) {
    console.log('\n   Migration complete. All overrides converted to documents.');
  } else {
    console.log(`\n   WARNING: ${unmigrated} masters still have un-migrated overrides.`);
    console.log('   Re-run the migration script to process remaining masters.');
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

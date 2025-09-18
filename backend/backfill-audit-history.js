#!/usr/bin/env node

/**
 * Backfill Audit History Script
 *
 * Creates audit history records for existing events in templeEvents__Events
 * that don't have corresponding audit records in templeEvents__EventAuditHistory.
 *
 * Usage:
 *   node backfill-audit-history.js [--dry-run]
 *
 * Options:
 *   --dry-run    Preview what would be done without making changes
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Configuration
const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'templeEvents';
const BATCH_SIZE = 100;

let client;
let db;
let unifiedEventsCollection;
let eventAuditHistoryCollection;

// Command line arguments
const isDryRun = process.argv.includes('--dry-run');

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);

    unifiedEventsCollection = db.collection('templeEvents__Events');
    eventAuditHistoryCollection = db.collection('templeEvents__EventAuditHistory');

    console.log('Connected to MongoDB successfully');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

/**
 * Find events that don't have audit records
 */
async function findEventsWithoutAuditRecords() {
  console.log('Finding events without audit records...');

  // Use aggregation to find events that don't have audit records
  const eventsWithoutAudit = await unifiedEventsCollection.aggregate([
    {
      $lookup: {
        from: 'templeEvents__EventAuditHistory',
        localField: 'eventId',
        foreignField: 'eventId',
        as: 'auditRecords'
      }
    },
    {
      $match: {
        'auditRecords': { $size: 0 }
      }
    },
    {
      $project: {
        eventId: 1,
        'graphData.createdDateTime': 1,
        'graphData.lastModifiedDateTime': 1,
        'internalData.importedAt': 1,
        'internalData.lastModifiedAt': 1,
        'internalData.lastModifiedBy': 1,
        'sourceMetadata.importedAt': 1,
        'sourceMetadata.importedBy': 1,
        createdAt: 1,
        updatedAt: 1
      }
    }
  ]).toArray();

  console.log(`Found ${eventsWithoutAudit.length} events without audit records`);
  return eventsWithoutAudit;
}

/**
 * Determine the best creation date for an event
 */
function determineCreationDate(event) {
  // Priority order for determining creation date
  const candidates = [
    { source: 'graphData.createdDateTime', date: event.graphData?.createdDateTime },
    { source: 'internalData.importedAt', date: event.internalData?.importedAt },
    { source: 'sourceMetadata.importedAt', date: event.sourceMetadata?.importedAt },
    { source: 'internalData.lastModifiedAt', date: event.internalData?.lastModifiedAt },
    { source: 'graphData.lastModifiedDateTime', date: event.graphData?.lastModifiedDateTime },
    { source: 'createdAt', date: event.createdAt },
    { source: 'updatedAt', date: event.updatedAt }
  ];

  // Find the first valid date
  for (const candidate of candidates) {
    if (candidate.date) {
      try {
        const date = new Date(candidate.date);
        if (!isNaN(date.getTime())) {
          return { date, source: candidate.source };
        }
      } catch (error) {
        // Invalid date, continue to next candidate
      }
    }
  }

  // Fallback to current date
  return { date: new Date(), source: 'fallback-current' };
}

/**
 * Determine the best user ID for the audit record
 */
function determineUserId(event) {
  // Try to find who created/imported the event
  const candidates = [
    event.internalData?.lastModifiedBy,
    event.sourceMetadata?.importedBy,
    event.graphData?.organizer?.emailAddress?.address
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return 'system'; // Default fallback
}

/**
 * Create audit record for an event
 */
async function createAuditRecord(event, creationInfo, userId) {
  const auditEntry = {
    eventId: event.eventId,
    userId: userId,
    changeType: 'create',
    source: 'Retroactive Audit Backfill',
    timestamp: creationInfo.date,
    metadata: {
      userAgent: 'Backfill Script',
      ipAddress: 'localhost',
      reason: 'Retroactive audit record creation',
      originalDateSource: creationInfo.source,
      backfillDate: new Date()
    }
  };

  if (!isDryRun) {
    await eventAuditHistoryCollection.insertOne(auditEntry);
  }

  return auditEntry;
}

/**
 * Process events in batches
 */
async function processEvents(events) {
  let processedCount = 0;
  let createdCount = 0;
  let errorCount = 0;
  const errors = [];

  console.log(`\n${isDryRun ? '[DRY RUN] ' : ''}Processing ${events.length} events...`);

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);

    for (const event of batch) {
      try {
        processedCount++;

        // Determine creation date and user
        const creationInfo = determineCreationDate(event);
        const userId = determineUserId(event);

        // Create audit record
        const auditEntry = await createAuditRecord(event, creationInfo, userId);
        createdCount++;

        // Progress logging
        if (processedCount % 50 === 0 || processedCount === events.length) {
          console.log(`${isDryRun ? '[DRY RUN] ' : ''}Progress: ${processedCount}/${events.length} events processed`);
        }

        // Sample logging for first few events
        if (processedCount <= 5) {
          console.log(`  Event ${event.eventId}: ${creationInfo.source} -> ${creationInfo.date.toISOString()} (user: ${userId})`);
        }

      } catch (error) {
        errorCount++;
        const errorInfo = {
          eventId: event.eventId,
          error: error.message
        };
        errors.push(errorInfo);
        console.error(`Error processing event ${event.eventId}:`, error.message);
      }
    }
  }

  return { processedCount, createdCount, errorCount, errors };
}

/**
 * Verify results
 */
async function verifyResults() {
  if (isDryRun) {
    console.log('\n[DRY RUN] Skipping verification (no changes were made)');
    return;
  }

  console.log('\nVerifying results...');

  const totalEvents = await unifiedEventsCollection.countDocuments();
  const totalAuditRecords = await eventAuditHistoryCollection.countDocuments({ changeType: 'create' });
  const eventsWithoutAudit = await unifiedEventsCollection.aggregate([
    {
      $lookup: {
        from: 'templeEvents__EventAuditHistory',
        localField: 'eventId',
        foreignField: 'eventId',
        as: 'auditRecords'
      }
    },
    {
      $match: {
        'auditRecords': { $size: 0 }
      }
    },
    { $count: 'count' }
  ]).toArray();

  const remainingWithoutAudit = eventsWithoutAudit.length > 0 ? eventsWithoutAudit[0].count : 0;

  console.log(`Total events: ${totalEvents}`);
  console.log(`Total 'create' audit records: ${totalAuditRecords}`);
  console.log(`Events still without audit records: ${remainingWithoutAudit}`);
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('=== Backfill Audit History Script ===');
    console.log(`Mode: ${isDryRun ? 'DRY RUN (preview only)' : 'LIVE (will make changes)'}`);
    console.log(`Database: ${DB_NAME}`);
    console.log('');

    // Connect to database
    await connectToDatabase();

    // Find events without audit records
    const eventsWithoutAudit = await findEventsWithoutAuditRecords();

    if (eventsWithoutAudit.length === 0) {
      console.log('✅ All events already have audit records. Nothing to do.');
      return;
    }

    // Process events
    const results = await processEvents(eventsWithoutAudit);

    // Display results
    console.log('\n=== RESULTS ===');
    console.log(`${isDryRun ? '[DRY RUN] ' : ''}Processed: ${results.processedCount} events`);
    console.log(`${isDryRun ? '[DRY RUN] ' : ''}Created: ${results.createdCount} audit records`);
    console.log(`Errors: ${results.errorCount}`);

    if (results.errors.length > 0) {
      console.log('\nErrors encountered:');
      results.errors.forEach(error => {
        console.log(`  ${error.eventId}: ${error.error}`);
      });
    }

    // Verify results (only for live runs)
    await verifyResults();

    if (isDryRun) {
      console.log('\n💡 This was a dry run. To actually create the audit records, run:');
      console.log('   node backfill-audit-history.js');
    } else {
      console.log('\n✅ Audit history backfill completed successfully!');
    }

  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
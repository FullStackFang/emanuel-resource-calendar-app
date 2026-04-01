/**
 * Migration: Add status and statusHistory to all templeEvents__Events
 *
 * Phase 1a of data structure cleanup
 *
 * This migration:
 * 1. Adds `status` field to events that don't have one (Graph-synced events)
 * 2. Adds `statusHistory` array to track state changes
 * 3. Preserves existing status for events that have it (room reservations)
 *
 * Safe to run multiple times (idempotent)
 *
 * Usage:
 *   node migrate-add-status-tracking.js --dry-run    # Preview changes
 *   node migrate-add-status-tracking.js              # Apply changes
 *   node migrate-add-status-tracking.js --verify     # Verify migration
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERIFY_ONLY = args.includes('--verify');

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI environment variable is required');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');
    const auditCollection = db.collection('templeEvents__EventAuditHistory');

    if (VERIFY_ONLY) {
      await verifyMigration(eventsCollection);
      return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(DRY_RUN ? 'DRY RUN MODE - No changes will be made' : 'APPLYING MIGRATION');
    console.log(`${'='.repeat(60)}\n`);

    // Get counts before migration
    const totalEvents = await eventsCollection.countDocuments();
    const eventsWithStatus = await eventsCollection.countDocuments({ status: { $exists: true } });
    const eventsWithoutStatus = await eventsCollection.countDocuments({ status: { $exists: false } });
    const eventsWithStatusHistory = await eventsCollection.countDocuments({ statusHistory: { $exists: true } });
    const eventsWithPendingEditRequest = await eventsCollection.countDocuments({
      'pendingEditRequest.status': 'pending'
    });

    console.log('Current state:');
    console.log(`  Total events: ${totalEvents}`);
    console.log(`  Events with status: ${eventsWithStatus}`);
    console.log(`  Events without status: ${eventsWithoutStatus}`);
    console.log(`  Events with statusHistory: ${eventsWithStatusHistory}`);
    console.log(`  Events with pending edit requests: ${eventsWithPendingEditRequest}`);
    console.log('');

    // Step 1: Add status to events without it (Graph-synced events)
    console.log('Step 1: Adding status to events without status field...');
    const eventsNeedingStatus = await eventsCollection.find({
      status: { $exists: false }
    }).toArray();

    let statusAddedCount = 0;
    for (const event of eventsNeedingStatus) {
      // Determine appropriate status
      let status = 'published'; // Default for Graph-synced events

      // Check if there's a pending edit request
      if (event.pendingEditRequest?.status === 'pending') {
        status = 'published_edit';
      }

      const initialHistory = {
        status: 'published',
        changedAt: event.syncedAt || event.createdAt || new Date(),
        changedBy: event.createdBy || 'system',
        changedByEmail: event.createdByEmail || 'system@migration',
        reason: 'Initial status from migration (Graph-synced event)'
      };

      // If currently in published_edit, add that transition
      const statusHistory = [initialHistory];
      if (status === 'published_edit') {
        statusHistory.push({
          status: 'published_edit',
          changedAt: event.pendingEditRequest?.requestedBy?.requestedAt || new Date(),
          changedBy: event.pendingEditRequest?.requestedBy?.userId || 'unknown',
          changedByEmail: event.pendingEditRequest?.requestedBy?.email || 'unknown',
          reason: 'Edit request submitted'
        });
      }

      if (!DRY_RUN) {
        await eventsCollection.updateOne(
          { _id: event._id },
          {
            $set: {
              status,
              statusHistory
            }
          }
        );
      }
      statusAddedCount++;

      if (statusAddedCount <= 3) {
        console.log(`  [${DRY_RUN ? 'WOULD ADD' : 'ADDED'}] ${event.eventTitle || event.graphData?.subject || 'Untitled'} -> status: ${status}`);
      }
    }
    if (statusAddedCount > 3) {
      console.log(`  ... and ${statusAddedCount - 3} more events`);
    }
    console.log(`  Total: ${statusAddedCount} events ${DRY_RUN ? 'would get' : 'got'} status field\n`);

    // Step 2: Add statusHistory to events that have status but no history
    console.log('Step 2: Adding statusHistory to events with status but no history...');
    const eventsNeedingHistory = await eventsCollection.find({
      status: { $exists: true },
      statusHistory: { $exists: false }
    }).toArray();

    let historyAddedCount = 0;
    for (const event of eventsNeedingHistory) {
      // Try to reconstruct history from audit logs
      const auditLogs = await auditCollection.find({
        $or: [
          { eventId: event.eventId },
          { reservationId: event._id }
        ]
      }).sort({ timestamp: 1 }).toArray();

      const statusHistory = [];

      // Add initial creation entry
      const createdAt = event.roomReservationData?.submittedAt || event.createdAt || new Date();
      const createdBy = event.roomReservationData?.requestedBy?.userId || event.createdBy || 'unknown';
      const createdByEmail = event.roomReservationData?.requestedBy?.email || event.createdByEmail || 'unknown';

      // Determine initial status based on event type
      let initialStatus = 'pending';
      if (!event.roomReservationData) {
        initialStatus = 'published'; // Graph event
      } else if (event.status === 'draft') {
        initialStatus = 'draft';
      }

      statusHistory.push({
        status: initialStatus,
        changedAt: createdAt,
        changedBy: createdBy,
        changedByEmail: createdByEmail,
        reason: initialStatus === 'draft' ? 'Draft created' :
                initialStatus === 'published' ? 'Published to Graph' :
                'Submitted for approval'
      });

      // Process audit logs to build history
      for (const log of auditLogs) {
        let newStatus = null;
        let reason = '';

        switch (log.action) {
          case 'approved':
          case 'reservation-approved':
            newStatus = 'approved';
            reason = 'Approved by admin';
            break;
          case 'published':
          case 'published-to-graph':
            newStatus = 'published';
            reason = 'Published to Graph calendar';
            break;
          case 'rejected':
          case 'reservation-rejected':
            newStatus = 'rejected';
            reason = log.metadata?.rejectionReason || 'Rejected by admin';
            break;
          case 'cancelled':
          case 'reservation-cancelled':
            newStatus = 'cancelled';
            reason = log.metadata?.cancelReason || 'Cancelled';
            break;
          case 'edit-request-submitted':
            newStatus = 'published_edit';
            reason = log.metadata?.changeReason || 'Edit request submitted';
            break;
          case 'edit-request-approved':
            newStatus = 'published';
            reason = 'Edit request approved';
            break;
          case 'edit-request-rejected':
          case 'edit-request-cancelled':
            newStatus = 'published';
            reason = log.action === 'edit-request-rejected' ? 'Edit request rejected' : 'Edit request cancelled';
            break;
        }

        if (newStatus && statusHistory[statusHistory.length - 1]?.status !== newStatus) {
          statusHistory.push({
            status: newStatus,
            changedAt: log.timestamp,
            changedBy: log.performedBy || 'unknown',
            changedByEmail: log.performedByEmail || 'unknown',
            reason
          });
        }
      }

      // If current status doesn't match last history entry, add correction
      const lastHistoryStatus = statusHistory[statusHistory.length - 1]?.status;
      if (event.status && lastHistoryStatus !== event.status) {
        // Check for pending edit request
        if (event.status === 'published' && event.pendingEditRequest?.status === 'pending') {
          statusHistory.push({
            status: 'published_edit',
            changedAt: event.pendingEditRequest?.requestedBy?.requestedAt || new Date(),
            changedBy: event.pendingEditRequest?.requestedBy?.userId || 'unknown',
            changedByEmail: event.pendingEditRequest?.requestedBy?.email || 'unknown',
            reason: 'Edit request pending'
          });
          // Also fix the status field
          if (!DRY_RUN) {
            await eventsCollection.updateOne(
              { _id: event._id },
              { $set: { status: 'published_edit' } }
            );
          }
        } else {
          statusHistory.push({
            status: event.status,
            changedAt: event.actionDate || new Date(),
            changedBy: 'migration',
            changedByEmail: 'system@migration',
            reason: 'Status reconciled during migration'
          });
        }
      }

      if (!DRY_RUN) {
        await eventsCollection.updateOne(
          { _id: event._id },
          { $set: { statusHistory } }
        );
      }
      historyAddedCount++;

      if (historyAddedCount <= 3) {
        console.log(`  [${DRY_RUN ? 'WOULD ADD' : 'ADDED'}] ${event.eventTitle || 'Untitled'} -> ${statusHistory.length} history entries`);
      }
    }
    if (historyAddedCount > 3) {
      console.log(`  ... and ${historyAddedCount - 3} more events`);
    }
    console.log(`  Total: ${historyAddedCount} events ${DRY_RUN ? 'would get' : 'got'} statusHistory\n`);

    // Step 3: Fix events with pending edit requests that have wrong status
    console.log('Step 3: Fixing status for events with pending edit requests...');
    const eventsWithWrongStatus = await eventsCollection.find({
      'pendingEditRequest.status': 'pending',
      status: { $ne: 'published_edit' }
    }).toArray();

    let fixedCount = 0;
    for (const event of eventsWithWrongStatus) {
      if (!DRY_RUN) {
        await eventsCollection.updateOne(
          { _id: event._id },
          {
            $set: { status: 'published_edit' },
            $push: {
              statusHistory: {
                status: 'published_edit',
                changedAt: event.pendingEditRequest?.requestedBy?.requestedAt || new Date(),
                changedBy: event.pendingEditRequest?.requestedBy?.userId || 'migration',
                changedByEmail: event.pendingEditRequest?.requestedBy?.email || 'system@migration',
                reason: 'Edit request pending (fixed during migration)'
              }
            }
          }
        );
      }
      fixedCount++;
      console.log(`  [${DRY_RUN ? 'WOULD FIX' : 'FIXED'}] ${event.eventTitle || 'Untitled'}: ${event.status} -> published_edit`);
    }
    console.log(`  Total: ${fixedCount} events ${DRY_RUN ? 'would be' : 'were'} fixed\n`);

    // Step 4: Clean up resolved pendingEditRequest objects
    console.log('Step 4: Cleaning up resolved pendingEditRequest objects...');
    const eventsWithResolvedEditRequests = await eventsCollection.find({
      pendingEditRequest: { $exists: true },
      'pendingEditRequest.status': { $in: ['approved', 'rejected', 'cancelled'] }
    }).toArray();

    let cleanedCount = 0;
    for (const event of eventsWithResolvedEditRequests) {
      if (!DRY_RUN) {
        // Move to resolvedEditRequests array for history, then remove pendingEditRequest
        await eventsCollection.updateOne(
          { _id: event._id },
          {
            $push: {
              resolvedEditRequests: event.pendingEditRequest
            },
            $unset: { pendingEditRequest: '' }
          }
        );
      }
      cleanedCount++;
      console.log(`  [${DRY_RUN ? 'WOULD CLEAN' : 'CLEANED'}] ${event.eventTitle || 'Untitled'}: moved ${event.pendingEditRequest.status} edit request to history`);
    }
    console.log(`  Total: ${cleanedCount} events ${DRY_RUN ? 'would be' : 'were'} cleaned\n`);

    // Final verification
    console.log(`${'='.repeat(60)}`);
    console.log('VERIFICATION');
    console.log(`${'='.repeat(60)}\n`);
    await verifyMigration(eventsCollection);

    if (DRY_RUN) {
      console.log('\n*** DRY RUN COMPLETE - No changes were made ***');
      console.log('Run without --dry-run to apply changes');
    } else {
      console.log('\n*** MIGRATION COMPLETE ***');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

async function verifyMigration(eventsCollection) {
  const totalEvents = await eventsCollection.countDocuments();
  const eventsWithStatus = await eventsCollection.countDocuments({ status: { $exists: true } });
  const eventsWithoutStatus = await eventsCollection.countDocuments({ status: { $exists: false } });
  const eventsWithStatusHistory = await eventsCollection.countDocuments({ statusHistory: { $exists: true } });
  const eventsWithoutStatusHistory = await eventsCollection.countDocuments({ statusHistory: { $exists: false } });
  const eventsWithPendingEdit = await eventsCollection.countDocuments({ status: 'published_edit' });
  const eventsWithPendingEditRequest = await eventsCollection.countDocuments({
    'pendingEditRequest.status': 'pending'
  });
  const eventsWithResolvedEditRequests = await eventsCollection.countDocuments({
    pendingEditRequest: { $exists: true },
    'pendingEditRequest.status': { $in: ['approved', 'rejected', 'cancelled'] }
  });

  // Status distribution
  const statusDistribution = await eventsCollection.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log('Verification Results:');
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Events with status: ${eventsWithStatus} (${(eventsWithStatus/totalEvents*100).toFixed(1)}%)`);
  console.log(`  Events without status: ${eventsWithoutStatus}`);
  console.log(`  Events with statusHistory: ${eventsWithStatusHistory} (${(eventsWithStatusHistory/totalEvents*100).toFixed(1)}%)`);
  console.log(`  Events without statusHistory: ${eventsWithoutStatusHistory}`);
  console.log(`  Events with status=published_edit: ${eventsWithPendingEdit}`);
  console.log(`  Events with pendingEditRequest.status=pending: ${eventsWithPendingEditRequest}`);
  console.log(`  Events with resolved pendingEditRequest (needs cleanup): ${eventsWithResolvedEditRequests}`);
  console.log('');
  console.log('  Status distribution:');
  for (const { _id, count } of statusDistribution) {
    console.log(`    ${_id || '(null)'}: ${count}`);
  }

  // Validation checks
  const issues = [];

  if (eventsWithoutStatus > 0) {
    issues.push(`${eventsWithoutStatus} events missing status field`);
  }

  if (eventsWithoutStatusHistory > 0) {
    issues.push(`${eventsWithoutStatusHistory} events missing statusHistory field`);
  }

  if (eventsWithPendingEdit !== eventsWithPendingEditRequest) {
    issues.push(`Mismatch: ${eventsWithPendingEdit} events have status=published_edit but ${eventsWithPendingEditRequest} have pending edit requests`);
  }

  if (eventsWithResolvedEditRequests > 0) {
    issues.push(`${eventsWithResolvedEditRequests} events have resolved pendingEditRequest that should be cleaned up`);
  }

  console.log('');
  if (issues.length === 0) {
    console.log('  ✓ All validation checks passed!');
  } else {
    console.log('  ✗ Validation issues found:');
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
  }
}

main();

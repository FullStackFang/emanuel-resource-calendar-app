// Database migration script for adding resubmission fields to existing reservations
// Run this script once to migrate existing data

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/templeevents';
const DB_NAME = process.env.DB_NAME || 'templeEvents';

async function migrateReservations() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    const db = client.db(DB_NAME);
    const roomReservationsCollection = db.collection('templeEvents__RoomReservations');
    
    // Step 1: Add new fields to all reservations that don't have them
    console.log('Step 1: Adding new fields to existing reservations...');
    const updateResult = await roomReservationsCollection.updateMany(
      {
        // Only update documents that don't have the new fields
        $or: [
          { currentRevision: { $exists: false } },
          { resubmissionAllowed: { $exists: false } },
          { communicationHistory: { $exists: false } }
        ]
      },
      {
        $set: {
          currentRevision: 1,
          resubmissionAllowed: true,
          communicationHistory: []
        }
      }
    );
    console.log(`Updated ${updateResult.modifiedCount} reservations with new fields`);
    
    // Step 2: Convert existing rejectionReason to communication history
    console.log('Step 2: Converting existing rejection reasons to communication history...');
    const rejectedReservations = await roomReservationsCollection.find({
      status: 'rejected',
      rejectionReason: { $exists: true, $ne: '' },
      'communicationHistory.type': { $ne: 'rejection' } // Don't convert if already done
    }).toArray();
    
    console.log(`Found ${rejectedReservations.length} rejected reservations to convert`);
    
    for (const reservation of rejectedReservations) {
      // Create initial submission entry if not exists
      const submissionEntry = {
        timestamp: reservation.submittedAt || new Date('2024-01-01'),
        type: 'submission',
        author: reservation.requesterId || 'unknown',
        authorName: reservation.requesterName || 'Unknown User',
        message: 'Initial reservation submission (migrated)',
        revisionNumber: 1,
        reservationSnapshot: {
          eventTitle: reservation.eventTitle,
          eventDescription: reservation.eventDescription || '',
          startDateTime: reservation.startDateTime,
          endDateTime: reservation.endDateTime,
          attendeeCount: reservation.attendeeCount || 0,
          requestedRooms: reservation.requestedRooms || [],
          requiredFeatures: reservation.requiredFeatures || [],
          specialRequirements: reservation.specialRequirements || '',
          priority: reservation.priority || 'medium',
          contactEmail: reservation.contactEmail || null,
          department: reservation.department || '',
          phone: reservation.phone || ''
        }
      };
      
      // Create rejection entry from existing rejectionReason
      const rejectionEntry = {
        timestamp: reservation.actionDate || new Date('2024-01-02'),
        type: 'rejection',
        author: reservation.actionBy || 'admin',
        authorName: reservation.actionByEmail || 'Admin',
        message: reservation.rejectionReason,
        revisionNumber: 1,
        reservationSnapshot: null
      };
      
      // Update the reservation with communication history
      await roomReservationsCollection.updateOne(
        { _id: reservation._id },
        {
          $set: {
            communicationHistory: [submissionEntry, rejectionEntry]
          }
        }
      );
    }
    
    console.log(`Converted ${rejectedReservations.length} rejection reasons to communication history`);
    
    // Step 3: Add initial submission entries for approved reservations
    console.log('Step 3: Adding initial submission entries for approved reservations...');
    const approvedReservations = await roomReservationsCollection.find({
      status: 'approved',
      communicationHistory: { $size: 0 } // Empty communication history
    }).toArray();
    
    console.log(`Found ${approvedReservations.length} approved reservations to add submission entries`);
    
    for (const reservation of approvedReservations) {
      const submissionEntry = {
        timestamp: reservation.submittedAt || new Date('2024-01-01'),
        type: 'submission',
        author: reservation.requesterId || 'unknown',
        authorName: reservation.requesterName || 'Unknown User',
        message: 'Initial reservation submission (migrated)',
        revisionNumber: 1,
        reservationSnapshot: {
          eventTitle: reservation.eventTitle,
          eventDescription: reservation.eventDescription || '',
          startDateTime: reservation.startDateTime,
          endDateTime: reservation.endDateTime,
          attendeeCount: reservation.attendeeCount || 0,
          requestedRooms: reservation.requestedRooms || [],
          requiredFeatures: reservation.requiredFeatures || [],
          specialRequirements: reservation.specialRequirements || '',
          priority: reservation.priority || 'medium',
          contactEmail: reservation.contactEmail || null,
          department: reservation.department || '',
          phone: reservation.phone || ''
        }
      };
      
      const approvalEntry = {
        timestamp: reservation.actionDate || new Date('2024-01-02'),
        type: 'approval',
        author: reservation.actionBy || 'admin',
        authorName: reservation.actionByEmail || 'Admin',
        message: reservation.actionNotes || 'Reservation approved (migrated)',
        revisionNumber: 1,
        reservationSnapshot: null
      };
      
      await roomReservationsCollection.updateOne(
        { _id: reservation._id },
        {
          $set: {
            communicationHistory: [submissionEntry, approvalEntry]
          }
        }
      );
    }
    
    console.log(`Added submission/approval entries for ${approvedReservations.length} approved reservations`);
    
    // Step 4: Add initial submission entries for pending reservations
    console.log('Step 4: Adding initial submission entries for pending reservations...');
    const pendingReservations = await roomReservationsCollection.find({
      status: 'pending',
      communicationHistory: { $size: 0 } // Empty communication history
    }).toArray();
    
    console.log(`Found ${pendingReservations.length} pending reservations to add submission entries`);
    
    for (const reservation of pendingReservations) {
      const submissionEntry = {
        timestamp: reservation.submittedAt || new Date(),
        type: 'submission',
        author: reservation.requesterId || 'unknown',
        authorName: reservation.requesterName || 'Unknown User',
        message: 'Initial reservation submission (migrated)',
        revisionNumber: 1,
        reservationSnapshot: {
          eventTitle: reservation.eventTitle,
          eventDescription: reservation.eventDescription || '',
          startDateTime: reservation.startDateTime,
          endDateTime: reservation.endDateTime,
          attendeeCount: reservation.attendeeCount || 0,
          requestedRooms: reservation.requestedRooms || [],
          requiredFeatures: reservation.requiredFeatures || [],
          specialRequirements: reservation.specialRequirements || '',
          priority: reservation.priority || 'medium',
          contactEmail: reservation.contactEmail || null,
          department: reservation.department || '',
          phone: reservation.phone || ''
        }
      };
      
      await roomReservationsCollection.updateOne(
        { _id: reservation._id },
        {
          $push: {
            communicationHistory: submissionEntry
          }
        }
      );
    }
    
    console.log(`Added submission entries for ${pendingReservations.length} pending reservations`);
    
    // Step 5: Verification - count final state
    console.log('Step 5: Verifying migration results...');
    const totalReservations = await roomReservationsCollection.countDocuments();
    const migratedReservations = await roomReservationsCollection.countDocuments({
      currentRevision: { $exists: true },
      resubmissionAllowed: { $exists: true },
      communicationHistory: { $exists: true, $ne: [] }
    });
    
    console.log(`Migration completed successfully!`);
    console.log(`Total reservations: ${totalReservations}`);
    console.log(`Successfully migrated: ${migratedReservations}`);
    console.log(`Remaining unmigrated: ${totalReservations - migratedReservations}`);
    
    if (totalReservations === migratedReservations) {
      console.log('✅ All reservations have been successfully migrated');
    } else {
      console.log('⚠️ Some reservations may need manual attention');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('Database connection closed');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  console.log('Starting room reservation migration...');
  migrateReservations()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateReservations };
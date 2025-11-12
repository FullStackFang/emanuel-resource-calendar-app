// migrate-remove-location-field.js
// Migration script to remove the redundant 'location' field from templeEvents__InternalEvents collection
// This field is redundant with 'locationDisplayNames' and should be removed

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'templeEventsDB';
const COLLECTION_NAME = 'templeEvents__InternalEvents';

async function migrateRemoveLocationField() {
  console.log('🚀 Starting migration: Remove redundant location field');
  console.log(`📦 Database: ${DB_NAME}`);
  console.log(`📊 Collection: ${COLLECTION_NAME}`);
  console.log('');

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Count documents with location field
    const countWithLocation = await collection.countDocuments({
      location: { $exists: true }
    });
    console.log(`📊 Found ${countWithLocation} documents with 'location' field`);

    if (countWithLocation === 0) {
      console.log('✅ No documents to migrate. Migration complete.');
      return;
    }

    // Preview some documents before migration
    console.log('\n📋 Preview of documents to be migrated:');
    const sampleDocs = await collection.find({
      location: { $exists: true }
    }).limit(5).toArray();

    sampleDocs.forEach((doc, idx) => {
      console.log(`\n  ${idx + 1}. Event ID: ${doc._id}`);
      console.log(`     Subject: ${doc.graphData?.subject || doc.eventTitle || 'N/A'}`);
      console.log(`     location (WILL BE REMOVED): "${doc.location || ''}"`);
      console.log(`     locationDisplayNames (KEEPING): "${doc.locationDisplayNames || ''}"`);
      console.log(`     locations array: ${JSON.stringify(doc.locations || [])}`);
    });

    // Ask for confirmation
    console.log('\n⚠️  This will permanently remove the "location" field from all documents.');
    console.log('   The "locationDisplayNames" and "locations" fields will be preserved.');
    console.log('\n   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Perform the migration using $unset
    console.log('\n🔄 Removing location field from all documents...');
    const result = await collection.updateMany(
      { location: { $exists: true } },
      { $unset: { location: "" } }
    );

    console.log(`\n✅ Migration complete!`);
    console.log(`   Matched: ${result.matchedCount} documents`);
    console.log(`   Modified: ${result.modifiedCount} documents`);

    // Verify the migration
    const remainingWithLocation = await collection.countDocuments({
      location: { $exists: true }
    });
    console.log(`\n🔍 Verification: ${remainingWithLocation} documents still have 'location' field`);

    if (remainingWithLocation === 0) {
      console.log('✅ All location fields successfully removed!');
    } else {
      console.log('⚠️  Some documents still have location field. Manual review recommended.');
    }

    // Show sample of migrated documents
    console.log('\n📋 Sample of migrated documents:');
    const migratedSamples = await collection.find({
      locationDisplayNames: { $exists: true }
    }).limit(3).toArray();

    migratedSamples.forEach((doc, idx) => {
      console.log(`\n  ${idx + 1}. Event ID: ${doc._id}`);
      console.log(`     Subject: ${doc.graphData?.subject || doc.eventTitle || 'N/A'}`);
      console.log(`     locationDisplayNames: "${doc.locationDisplayNames || ''}"`);
      console.log(`     locations array: ${JSON.stringify(doc.locations || [])}`);
      console.log(`     Has location field: ${doc.hasOwnProperty('location')}`);
    });

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run migration
migrateRemoveLocationField()
  .then(() => {
    console.log('\n✅ Migration script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });

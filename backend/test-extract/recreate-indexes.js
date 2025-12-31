/**
 * Script to drop and recreate unified event indexes
 * Run with: node recreate-indexes.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

async function recreateIndexes() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // First, list existing indexes
    console.log('\n📋 Current indexes:');
    const existingIndexes = await collection.indexes();
    existingIndexes.forEach(index => {
      console.log(`   - ${index.name}`);
    });

    // Drop all indexes except _id
    console.log('\n🗑️  Dropping existing indexes...');
    for (const index of existingIndexes) {
      if (index.name !== '_id_') {
        try {
          await collection.dropIndex(index.name);
          console.log(`   ✅ Dropped: ${index.name}`);
        } catch (err) {
          console.log(`   ⚠️  Could not drop ${index.name}: ${err.message}`);
        }
      }
    }

    // Recreate indexes
    console.log('\n🔨 Creating new indexes...');

    // Index 1: Composite unique on userId + calendarId + eventId
    await collection.createIndex(
      {
        userId: 1,
        calendarId: 1,
        eventId: 1
      },
      {
        name: "userId_calendarId_eventId_unique",
        unique: true,
        background: true
      }
    );
    console.log('   ✅ Created: userId_calendarId_eventId_unique');

    // Index 2: Composite unique on userId + graphData.id
    await collection.createIndex(
      {
        userId: 1,
        'graphData.id': 1
      },
      {
        name: "userId_graphId_unique",
        unique: true,
        background: true
      }
    );
    console.log('   ✅ Created: userId_graphId_unique');

    // Index 3: Date range queries
    await collection.createIndex(
      {
        userId: 1,
        calendarId: 1,
        'graphData.start.dateTime': 1
      },
      {
        name: "userId_calendarId_startTime",
        background: true
      }
    );
    console.log('   ✅ Created: userId_calendarId_startTime');

    // Index 4: Change detection
    await collection.createIndex(
      {
        userId: 1,
        eventId: 1,
        etag: 1
      },
      {
        name: "userId_eventId_etag",
        background: true
      }
    );
    console.log('   ✅ Created: userId_eventId_etag');

    // Index 5: Deleted events (sparse)
    await collection.createIndex(
      {
        userId: 1,
        isDeleted: 1
      },
      {
        name: "userId_isDeleted",
        sparse: true,
        background: true
      }
    );
    console.log('   ✅ Created: userId_isDeleted');

    // Index 6: Multi-calendar queries
    await collection.createIndex(
      {
        userId: 1,
        sourceCalendars: 1
      },
      {
        name: "userId_sourceCalendars",
        background: true
      }
    );
    console.log('   ✅ Created: userId_sourceCalendars');

    console.log('\n' + '='.repeat(60));
    console.log('✅ Index Recreation Complete!');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error recreating indexes:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run the recreation
recreateIndexes()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

/**
 * Diagnostic script to find duplicate events
 *
 * These duplicates have:
 * - Same subject, start time, end time, calendarId
 * - Different eventId (rssched-* vs UUID)
 * - graphData.id = calendarId (incorrect - sync bug)
 *
 * Run with: node diagnose-duplicates.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

async function diagnose() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // DIAGNOSTIC 1: Find events where graphData.id = calendarId (the bug symptom)
    console.log('🔍 DIAGNOSTIC 1: Events where graphData.id === calendarId (sync bug)');
    console.log('=' .repeat(70));

    const buggedEvents = await collection.aggregate([
      {
        $match: {
          'graphData.id': { $exists: true },
          $expr: { $eq: ['$graphData.id', '$calendarId'] }
        }
      },
      {
        $group: {
          _id: '$calendarId',
          count: { $sum: 1 },
          sample: { $first: { eventId: '$eventId', subject: '$graphData.subject' } }
        }
      }
    ]).toArray();

    if (buggedEvents.length > 0) {
      console.log(`\n⚠️  Found ${buggedEvents.reduce((sum, b) => sum + b.count, 0)} events with graphData.id = calendarId\n`);
      buggedEvents.forEach(b => {
        console.log(`   Calendar: ${b._id.substring(0, 50)}...`);
        console.log(`   Count: ${b.count}`);
        console.log(`   Sample: "${b.sample.subject}" (eventId: ${b.sample.eventId})`);
        console.log('');
      });
    } else {
      console.log('✅ No events with graphData.id = calendarId bug found\n');
    }

    // DIAGNOSTIC 2: Find semantic duplicates (same subject + start + calendarId, different eventId)
    console.log('\n🔍 DIAGNOSTIC 2: Semantic duplicates (same subject/time, different eventId)');
    console.log('=' .repeat(70));

    const semanticDuplicates = await collection.aggregate([
      {
        $match: {
          'graphData.subject': { $exists: true },
          'graphData.start.dateTime': { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            calendarId: '$calendarId',
            subject: '$graphData.subject',
            startDateTime: '$graphData.start.dateTime'
          },
          count: { $sum: 1 },
          eventIds: { $push: '$eventId' },
          graphIds: { $push: '$graphData.id' },
          sources: { $push: '$source' },
          hasRsSched: { $max: { $cond: [{ $regexMatch: { input: '$eventId', regex: /^rssched-/ } }, 1, 0] } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      { $sort: { '_id.subject': 1 } },
      { $limit: 20 }
    ]).toArray();

    if (semanticDuplicates.length > 0) {
      console.log(`\n⚠️  Found ${semanticDuplicates.length} sets of semantic duplicates (showing first 20)\n`);
      semanticDuplicates.forEach((dup, i) => {
        console.log(`${i + 1}. "${dup._id.subject}"`);
        console.log(`   Start: ${dup._id.startDateTime}`);
        console.log(`   Count: ${dup.count} copies`);
        console.log(`   Has rsSched: ${dup.hasRsSched === 1 ? 'YES' : 'NO'}`);
        console.log(`   EventIds:`);
        dup.eventIds.forEach((eid, j) => {
          const type = eid.startsWith('rssched-') ? '(rsSched)' : '(UUID)';
          const graphId = dup.graphIds[j];
          const graphIdMatch = graphId === dup._id.calendarId ? '⚠️ =calendarId' : '✅ unique';
          console.log(`     - ${eid} ${type}`);
          console.log(`       graphData.id: ${graphId?.substring(0, 40)}... ${graphIdMatch}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ No semantic duplicates found\n');
    }

    // DIAGNOSTIC 3: Summary statistics
    console.log('\n📊 SUMMARY STATISTICS');
    console.log('=' .repeat(70));

    const stats = await collection.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          rsSched: { $sum: { $cond: [{ $regexMatch: { input: '$eventId', regex: /^rssched-/ } }, 1, 0] } },
          uuid: { $sum: { $cond: [{ $not: { $regexMatch: { input: '$eventId', regex: /^rssched-/ } } }, 1, 0] } },
          withGraphId: { $sum: { $cond: [{ $and: [{ $ne: ['$graphData.id', null] }, { $ne: ['$graphData.id', '$calendarId'] }] }, 1, 0] } },
          buggedGraphId: { $sum: { $cond: [{ $eq: ['$graphData.id', '$calendarId'] }, 1, 0] } }
        }
      }
    ]).toArray();

    if (stats.length > 0) {
      const s = stats[0];
      console.log(`\nTotal events: ${s.total}`);
      console.log(`rsSched events: ${s.rsSched}`);
      console.log(`UUID events: ${s.uuid}`);
      console.log(`Events with valid graphData.id: ${s.withGraphId}`);
      console.log(`Events with BUGGED graphData.id (= calendarId): ${s.buggedGraphId}`);
    }

    console.log('\n' + '=' .repeat(70));
    console.log('Diagnosis complete. Review the output above to identify issues.');
    console.log('=' .repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run the diagnosis
diagnose()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

// migrate-csv-to-graph.js
// One-time migration to link CSV-imported events to Graph API events
//
// This script finds CSV-imported events that don't have real Graph API IDs
// and attempts to match them with events in Outlook calendars.
//
// Matching criteria (ALL must match):
// - calendarId: Same calendar
// - subject: Case-insensitive exact match
// - startDateTime: Exact match (rounded to minute)
// - endDateTime: Exact match (rounded to minute)
//
// Run with: node migrate-csv-to-graph.js
// Optional: node migrate-csv-to-graph.js --dry-run (preview only)
// Optional: node migrate-csv-to-graph.js --limit 50 (process only 50 records)
// Combined: node migrate-csv-to-graph.js --dry-run --limit 10

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { PublicClientApplication } = require('@azure/msal-node');

// Config from authConfig.js
const APP_ID = 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = 'fcc71126-2b16-4653-b639-0f1ef8332302';

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

const BATCH_SIZE = 50;  // Process 50 events at a time
const DELAY_BETWEEN_BATCHES = 2000;  // 2 seconds between batches

// MSAL configuration for device code flow
const msalConfig = {
  auth: {
    clientId: APP_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`
  }
};

const scopes = ['Calendars.Read', 'Calendars.Read.Shared'];

/**
 * Get Graph API token using device code flow
 * User will be prompted to go to https://microsoft.com/devicelogin and enter a code
 */
async function getGraphToken() {
  const pca = new PublicClientApplication(msalConfig);

  const deviceCodeRequest = {
    scopes: scopes,
    deviceCodeCallback: (response) => {
      console.log('\n🔐 Authentication Required');
      console.log('━'.repeat(50));
      console.log(response.message);
      console.log('━'.repeat(50));
    }
  };

  try {
    const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    console.log('\n✅ Authentication successful!\n');
    return response.accessToken;
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    throw error;
  }
}

/**
 * Fetch events from Graph API for a specific calendar and time range
 */
async function fetchGraphEvents(graphToken, calendarId, startDate, endDate) {
  const calendarPath = calendarId === 'primary'
    ? '/me/calendar/calendarView'
    : `/me/calendars/${calendarId}/calendarView`;

  // Fetch all fields to match app-created events structure
  const url = `https://graph.microsoft.com/v1.0${calendarPath}?` +
    `startDateTime=${encodeURIComponent(startDate)}` +
    `&endDateTime=${encodeURIComponent(endDate)}` +
    `&$select=id,subject,start,end,location,categories,importance,sensitivity,isAllDay,seriesMasterId,showAs,type,onlineMeetingUrl,responseStatus,body,recurrence,attendees,organizer,onlineMeeting&$top=100`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${graphToken}` }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API error ${response.status}: ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  return data.value || [];
}

/**
 * Normalize datetime to UTC milliseconds for comparison
 * Rounds to nearest minute to handle slight variations
 */
function normalizeToUtcMs(dateTimeValue) {
  if (!dateTimeValue) return null;

  let dateStr = dateTimeValue;
  // Handle strings without timezone - assume UTC
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.includes('+')) {
    dateStr = dateStr + 'Z';
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  // Round to nearest minute (ignore seconds/ms)
  date.setSeconds(0, 0);
  return date.getTime();
}

/**
 * Main migration function
 */
async function migrate() {
  const dryRun = process.argv.includes('--dry-run');

  // Parse --limit argument
  let limit = null;
  const limitIndex = process.argv.indexOf('--limit');
  if (limitIndex !== -1 && process.argv[limitIndex + 1]) {
    limit = parseInt(process.argv[limitIndex + 1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('❌ Error: --limit must be a positive number');
      process.exit(1);
    }
  }

  console.log('🚀 CSV-to-Graph Migration Script');
  console.log('━'.repeat(50));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) {
    console.log(`Limit: ${limit} records`);
  }
  console.log(`Database: ${DB_NAME}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log('━'.repeat(50));

  // Validate environment
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  // Step 1: Get Graph token via device code flow
  const graphToken = await getGraphToken();

  // Step 2: Connect to MongoDB
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(DB_NAME);
  const collection = db.collection('templeEvents__Events');

  try {
    // Step 3: Find CSV-imported events that need linking
    // Look for Resource Scheduler imports that don't have a real Graph ID
    let csvEvents = await collection.find({
      source: 'Resource Scheduler Import',
      $or: [
        { 'graphData.id': { $exists: false } },
        { 'graphData.id': null }
      ]
    }).toArray();

    const totalFound = csvEvents.length;

    // Apply limit if specified
    if (limit && csvEvents.length > limit) {
      csvEvents = csvEvents.slice(0, limit);
      console.log(`📊 Found ${totalFound} CSV events, processing ${limit} (limited)\n`);
    } else {
      console.log(`📊 Found ${csvEvents.length} CSV events to process\n`);
    }

    if (csvEvents.length === 0) {
      console.log('✅ No CSV events need migration!');
      return;
    }

    const results = {
      total: csvEvents.length,
      matched: 0,
      updated: 0,
      noMatch: 0,
      errors: 0,
      details: []
    };

    // Step 4: Process in batches
    for (let i = 0; i < csvEvents.length; i += BATCH_SIZE) {
      const batch = csvEvents.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(csvEvents.length / BATCH_SIZE);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} events)`);

      for (const event of batch) {
        try {
          const title = event.eventTitle || event.graphData?.subject;
          const startISO = event.startDateTime;
          const endISO = event.endDateTime;
          const calendarId = event.calendarId;

          if (!title || !startISO || !endISO) {
            console.log(`   ⚠️  Skip: Missing data - ${event.eventId}`);
            results.errors++;
            results.details.push({
              eventId: event.eventId,
              title: title || '(no title)',
              action: 'skipped',
              reason: 'Missing title, startDateTime, or endDateTime'
            });
            continue;
          }

          if (!calendarId) {
            console.log(`   ⚠️  Skip: No calendarId - "${title}"`);
            results.errors++;
            results.details.push({
              eventId: event.eventId,
              title: title,
              action: 'skipped',
              reason: 'Missing calendarId'
            });
            continue;
          }

          // Query Graph API for matching events (with 1 minute buffer)
          const searchStart = new Date(startISO);
          const searchEnd = new Date(endISO);
          searchStart.setMinutes(searchStart.getMinutes() - 1);
          searchEnd.setMinutes(searchEnd.getMinutes() + 1);

          const graphEvents = await fetchGraphEvents(
            graphToken,
            calendarId,
            searchStart.toISOString(),
            searchEnd.toISOString()
          );

          // Match by subject + startTime + endTime (all must match)
          const csvStartMs = normalizeToUtcMs(startISO);
          const csvEndMs = normalizeToUtcMs(endISO);

          const match = graphEvents.find(ge => {
            // Subject must match (case-insensitive)
            if (!ge.subject || ge.subject.toLowerCase() !== title.toLowerCase()) {
              return false;
            }

            // Start time must match
            const graphStartMs = normalizeToUtcMs(ge.start?.dateTime);
            if (csvStartMs !== graphStartMs) {
              return false;
            }

            // End time must match
            const graphEndMs = normalizeToUtcMs(ge.end?.dateTime);
            if (csvEndMs !== graphEndMs) {
              return false;
            }

            return true;
          });

          if (match) {
            results.matched++;
            const shortId = match.id.length > 30 ? match.id.substring(0, 30) + '...' : match.id;
            console.log(`   ✅ Match: "${title}" → ${shortId}`);

            if (!dryRun) {
              // Replace entire graphData with full Graph API response
              // This ensures structure matches app-created events
              const fullGraphData = {
                id: match.id,
                subject: match.subject,
                start: match.start,
                end: match.end,
                location: match.location,
                categories: match.categories || [],
                importance: match.importance,
                sensitivity: match.sensitivity,
                isAllDay: match.isAllDay,
                seriesMasterId: match.seriesMasterId,
                showAs: match.showAs,
                type: match.type,
                onlineMeetingUrl: match.onlineMeetingUrl,
                responseStatus: match.responseStatus,
                body: match.body,
                recurrence: match.recurrence,
                attendees: match.attendees || [],
                organizer: match.organizer,
                onlineMeeting: match.onlineMeeting
              };

              await collection.updateOne(
                { _id: event._id },
                {
                  $set: {
                    graphData: fullGraphData,
                    lastSyncedAt: new Date()
                  }
                }
              );
              results.updated++;
            }

            results.details.push({
              eventId: event.eventId,
              title: title,
              action: dryRun ? 'would_update' : 'updated',
              graphId: match.id
            });
          } else {
            results.noMatch++;
            console.log(`   ⏭️  No match: "${title}" (${graphEvents.length} candidates in time window)`);

            results.details.push({
              eventId: event.eventId,
              title: title,
              startDateTime: startISO,
              calendarId: calendarId,
              action: 'no_match',
              reason: `No matching Graph event (${graphEvents.length} candidates checked)`
            });
          }
        } catch (eventError) {
          results.errors++;
          console.log(`   ❌ Error: ${eventError.message}`);

          results.details.push({
            eventId: event.eventId,
            action: 'error',
            reason: eventError.message
          });
        }
      }

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < csvEvents.length) {
        console.log(`   ⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
    }

    // Step 5: Summary
    console.log('\n' + '━'.repeat(50));
    console.log('📝 Migration Summary');
    console.log('━'.repeat(50));
    if (limit && totalFound > limit) {
      console.log(`   Total CSV events found: ${totalFound}`);
      console.log(`   Processed (limited): ${results.total}`);
    } else {
      console.log(`   Total CSV events: ${results.total}`);
    }
    console.log(`   Matched to Graph: ${results.matched}`);
    console.log(`   Updated in DB: ${results.updated}`);
    console.log(`   No match found: ${results.noMatch}`);
    console.log(`   Errors/Skipped: ${results.errors}`);
    console.log('━'.repeat(50));

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes were made');
      console.log('Run without --dry-run to apply changes');
    } else {
      console.log('\n✅ Migration complete!');
    }

    // Show unmatched events for review
    const unmatched = results.details.filter(d => d.action === 'no_match');
    if (unmatched.length > 0 && unmatched.length <= 20) {
      console.log('\n📋 Unmatched events (kept in database):');
      unmatched.forEach(e => {
        console.log(`   - "${e.title}" @ ${e.startDateTime}`);
      });
    } else if (unmatched.length > 20) {
      console.log(`\n📋 ${unmatched.length} events had no match (kept in database)`);
    }

  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

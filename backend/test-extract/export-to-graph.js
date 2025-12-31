/**
 * MongoDB to Microsoft Graph API Export Script
 * Exports events from templeEvents__Events to Microsoft 365 Calendar
 *
 * IMPORTANT: This script uses DELEGATED token (user token from browser session)
 * NOT application token. Extract your Graph token from browser DevTools after logging in.
 *
 * Run with: node export-to-graph.js <calendarName> [options]
 *
 * Examples:
 *   node export-to-graph.js "templesandbox@emanuelnyc.org" --limit=1 --dry-run
 *   node export-to-graph.js "templesandbox@emanuelnyc.org" --limit=1
 *   node export-to-graph.js "templesandbox@emanuelnyc.org" --batch-size=20 --delay=1000
 *   node export-to-graph.js "templesandbox@emanuelnyc.org" --start-date=2025-01-01 --end-date=2025-12-31
 *
 * Options:
 *   --limit=N              Limit number of events to export (useful for testing)
 *   --batch-size=N         Events per batch (default: 20, max: 20 for Graph API)
 *   --delay=N              Milliseconds to wait between batches (default: 500)
 *   --start-date=YYYY-MM-DD Only export events after this date
 *   --end-date=YYYY-MM-DD   Only export events before this date
 *   --dry-run              Show what would be exported without creating events
 *   --access-token=TOKEN   Delegated Graph token (or set GRAPH_ACCESS_TOKEN env var)
 *
 * Getting a Delegated Token:
 *   1. Log into your app (https://localhost:5173)
 *   2. Open DevTools Console
 *   3. Find MSAL token in sessionStorage
 *   4. Copy token and add to .env: GRAPH_ACCESS_TOKEN=your_token_here
 */

const fs = require('fs');
const { MongoClient } = require('mongodb');
// fetch is built-in to Node.js v18+, no import needed
require('dotenv').config();

// Get command-line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('❌ Error: Missing required calendar name');
  console.log('\nUsage: node export-to-graph.js <calendarName> [options]');
  console.log('\nExamples:');
  console.log('  node export-to-graph.js "templesandbox@emanuelnyc.org" --limit=1 --dry-run');
  console.log('  node export-to-graph.js "templesandbox@emanuelnyc.org" --limit=1');
  console.log('  node export-to-graph.js "templesandbox@emanuelnyc.org" --batch-size=20 --delay=1000');
  console.log('  node export-to-graph.js "templesandbox@emanuelnyc.org" --start-date=2025-01-01');
  console.log('\nOptions:');
  console.log('  --limit=N              Limit number of events (for testing)');
  console.log('  --batch-size=N         Events per batch (default: 20, max: 20)');
  console.log('  --delay=N              Milliseconds between batches (default: 500)');
  console.log('  --start-date=YYYY-MM-DD Only export events after this date');
  console.log('  --end-date=YYYY-MM-DD   Only export events before this date');
  console.log('  --dry-run              Preview without creating events');
  console.log('  --access-token=TOKEN   Delegated Graph API token');
  process.exit(1);
}

const TARGET_CALENDAR_NAME = args[0];

// Parse limit
let LIMIT = null;
const limitArg = args.find(arg => arg.startsWith('--limit='));
if (limitArg) {
  const parsedLimit = parseInt(limitArg.split('=')[1]);
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    console.error('❌ Error: Invalid limit. Must be a positive integer.');
    process.exit(1);
  }
  LIMIT = parsedLimit;
  console.log(`Limiting to ${LIMIT} event(s) for testing`);
}

// Parse batch size
let BATCH_SIZE = 20;
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
if (batchSizeArg) {
  const parsedSize = parseInt(batchSizeArg.split('=')[1]);
  if (isNaN(parsedSize) || parsedSize < 1) {
    console.error('❌ Error: Invalid batch size. Must be a positive integer.');
    process.exit(1);
  }
  if (parsedSize > 20) {
    console.error('❌ Error: Batch size too large. Maximum is 20 for Graph API batch requests.');
    process.exit(1);
  }
  BATCH_SIZE = parsedSize;
  console.log(`Using batch size: ${BATCH_SIZE} events per batch`);
}

// Parse delay
let DELAY_BETWEEN_BATCHES = 500;
const delayArg = args.find(arg => arg.startsWith('--delay='));
if (delayArg) {
  const parsedDelay = parseInt(delayArg.split('=')[1]);
  if (isNaN(parsedDelay) || parsedDelay < 0) {
    console.error('❌ Error: Invalid delay. Must be a non-negative integer (milliseconds).');
    process.exit(1);
  }
  DELAY_BETWEEN_BATCHES = parsedDelay;
  console.log(`Using delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
}

// Parse date range
let START_DATE = null;
let END_DATE = null;
const startDateArg = args.find(arg => arg.startsWith('--start-date='));
if (startDateArg) {
  START_DATE = new Date(startDateArg.split('=')[1]);
  if (isNaN(START_DATE.getTime())) {
    console.error('❌ Error: Invalid start date. Use format: YYYY-MM-DD');
    process.exit(1);
  }
  console.log(`Start date filter: ${START_DATE.toISOString().split('T')[0]}`);
}

const endDateArg = args.find(arg => arg.startsWith('--end-date='));
if (endDateArg) {
  END_DATE = new Date(endDateArg.split('=')[1]);
  END_DATE.setHours(23, 59, 59, 999); // End of day
  if (isNaN(END_DATE.getTime())) {
    console.error('❌ Error: Invalid end date. Use format: YYYY-MM-DD');
    process.exit(1);
  }
  console.log(`End date filter: ${END_DATE.toISOString().split('T')[0]}`);
}

// Parse dry-run flag
const DRY_RUN = args.includes('--dry-run');
if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE: No events will be created in Graph API');
}

// Parse skip-duplicates flag
const SKIP_DUPLICATES = !args.includes('--no-skip-duplicates');

// Parse access token
let GRAPH_ACCESS_TOKEN = process.env.GRAPH_ACCESS_TOKEN;
const tokenArg = args.find(arg => arg.startsWith('--access-token='));
if (tokenArg) {
  GRAPH_ACCESS_TOKEN = tokenArg.split('=')[1];
}

// Load calendar config
const path = require('path');
const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
let calendarConfig = {};

try {
  calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
} catch (error) {
  console.error('❌ Error: Could not read calendar-config.json');
  console.log('\nPlease create backend/calendar-config.json with your calendar mappings');
  process.exit(1);
}

// MongoDB configuration
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

// Helper function to sleep/delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transform MongoDB event to Graph API format
 */
function transformToGraphFormat(mongoEvent) {
  const isAllDay = mongoEvent.graphData?.isAllDay || false;

  // For all-day events, Graph API requires times at midnight (00:00:00)
  let startData = mongoEvent.graphData?.start || { dateTime: new Date().toISOString(), timeZone: 'UTC' };
  let endData = mongoEvent.graphData?.end || { dateTime: new Date().toISOString(), timeZone: 'UTC' };

  if (isAllDay) {
    // Extract date only (YYYY-MM-DD) and set time to midnight
    const startDate = new Date(startData.dateTime).toISOString().split('T')[0];
    const endDate = new Date(endData.dateTime).toISOString().split('T')[0];

    startData = {
      dateTime: `${startDate}T00:00:00`,
      timeZone: startData.timeZone || 'UTC'
    };

    endData = {
      dateTime: `${endDate}T00:00:00`,
      timeZone: endData.timeZone || 'UTC'
    };
  }

  const graphEvent = {
    subject: mongoEvent.graphData?.subject || 'Untitled Event',
    start: startData,
    end: endData,
    isAllDay: isAllDay,
    showAs: mongoEvent.graphData?.showAs || 'busy',
    importance: mongoEvent.graphData?.importance || 'normal',
    sensitivity: mongoEvent.graphData?.sensitivity || 'normal'
  };

  // Optional fields
  if (mongoEvent.graphData?.location) {
    graphEvent.location = mongoEvent.graphData.location;
  }

  if (mongoEvent.graphData?.categories && mongoEvent.graphData.categories.length > 0) {
    graphEvent.categories = mongoEvent.graphData.categories;
  }

  if (mongoEvent.graphData?.bodyPreview || mongoEvent.graphData?.body) {
    graphEvent.body = {
      contentType: 'HTML',
      content: mongoEvent.graphData?.body?.content || mongoEvent.graphData?.bodyPreview || ''
    };
  }

  return graphEvent;
}

/**
 * Build a matching key from event attributes (subject, start time, location, categories)
 * Used for duplicate detection based on event content rather than IDs
 */
function buildMatchingKey(eventData) {
  if (!eventData) return null;

  const subject = (eventData.subject || '').trim().toLowerCase();

  // For all-day events, only match on date (not time) due to timezone handling
  let startTime = eventData.start?.dateTime || '';
  if (startTime) {
    // Strip decimals and timezone first
    startTime = startTime.split('.')[0].replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');

    // For all-day events, use only the date portion (YYYY-MM-DD)
    if (eventData.isAllDay === true) {
      startTime = startTime.split('T')[0];
    }
  }

  const location = (eventData.location?.displayName || '').trim().toLowerCase();
  const categories = (eventData.categories || []).map(c => c.toLowerCase()).sort().join('|');

  // Create composite key: subject|||startTime|||location|||categories
  return `${subject}|||${startTime}|||${location}|||${categories}`;
}

/**
 * Find existing events in calendar by attribute matching
 * Returns a Map of mongoEventId -> graphEventId for events that already exist
 */
async function findExistingEventsByAttributes(calendarId, mongoEvents, token) {
  if (mongoEvents.length === 0) {
    return new Map();
  }

  try {
    const matches = new Map(); // mongoEventId -> graphEventId

    // Fetch all calendar events with relevant fields for matching
    const baseUrl = `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`;
    const params = new URLSearchParams({
      '$select': 'id,subject,start,end,location,categories,isAllDay',
      '$top': '999'
    });

    let nextLink = `${baseUrl}?${params}`;
    let pageCount = 0;
    let totalEventsChecked = 0;

    // Build a map of matching keys from calendar events
    const calendarEventMap = new Map(); // matchingKey -> graphEventId

    // Follow pagination links to get ALL events
    while (nextLink) {
      pageCount++;

      const response = await fetch(nextLink, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'outlook.body-content-type="text"'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (pageCount === 1) {
          console.warn(`⚠️  Warning: Could not query existing events (${response.status}). Will proceed without attribute matching.`);
          console.warn(`   Error details: ${errorText.substring(0, 200)}`);
        }
        break;
      }

      const data = await response.json();

      // Build matching keys from calendar events
      if (data.value && Array.isArray(data.value)) {
        totalEventsChecked += data.value.length;

        data.value.forEach(event => {
          const key = buildMatchingKey(event);
          if (key && event.id) {
            calendarEventMap.set(key, event.id);
          }
        });
      }

      // Check for next page
      nextLink = data['@odata.nextLink'] || null;

      // Show progress for large calendars
      if (pageCount > 1 && pageCount % 5 === 0) {
        console.log(`   ... checked ${totalEventsChecked} calendar events`);
      }
    }

    if (pageCount > 1) {
      console.log(`   Checked ${totalEventsChecked} calendar events across ${pageCount} pages`);
    }

    // Now match mongo events against calendar events
    mongoEvents.forEach(mongoEvent => {
      const key = buildMatchingKey(mongoEvent.graphData);
      if (key && calendarEventMap.has(key)) {
        matches.set(mongoEvent.eventId, calendarEventMap.get(key));
      }
    });

    return matches;
  } catch (error) {
    console.warn(`⚠️  Warning: Error checking for existing events:`, error.message);
    return new Map();
  }
}

/**
 * Main export function
 *
 * Duplicate detection strategy:
 * 1. MongoDB query filters out events that already have graphData.id (already synced)
 * 2. For remaining events, check calendar for attribute matches (name, time, location, categories)
 * 3. For matches found: Update MongoDB with Graph ID (don't create duplicate)
 * 4. For non-matches: Export to calendar
 * 5. After creating events, save Graph IDs back to MongoDB
 */
async function exportToGraph() {
  console.log('Starting MongoDB to Graph API export...');
  console.log('Calendar:', TARGET_CALENDAR_NAME);
  if (START_DATE) console.log('Start date:', START_DATE.toISOString().split('T')[0]);
  if (END_DATE) console.log('End date:', END_DATE.toISOString().split('T')[0]);
  console.log('Batch size:', BATCH_SIZE, 'events');
  console.log('Delay:', DELAY_BETWEEN_BATCHES + 'ms');
  console.log('');

  // Look up calendar ID from config
  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];

  if (!TARGET_CALENDAR_ID) {
    console.error(`\n❌ Error: Calendar "${TARGET_CALENDAR_NAME}" not found in calendar-config.json`);
    console.log('\nAvailable calendars in config:');
    Object.keys(calendarConfig)
      .filter(key => !key.startsWith('_'))
      .forEach(name => console.log(`  - ${name}`));
    process.exit(1);
  }

  console.log(`✓ Found calendar ID: ${TARGET_CALENDAR_ID.substring(0, 20)}...`);

  // Check for Graph API access token
  if (!GRAPH_ACCESS_TOKEN && !DRY_RUN) {
    console.error('❌ Error: No Graph API access token provided');
    console.log('\nPlease provide an access token using one of these methods:');
    console.log('  1. Set GRAPH_ACCESS_TOKEN environment variable in .env');
    console.log('  2. Pass --access-token=YOUR_TOKEN as a command-line argument');
    console.log('\nTo get a token:');
    console.log('  - Use Azure Portal to generate a token for Microsoft Graph API');
    console.log('  - Or run in --dry-run mode to preview without authentication');
    process.exit(1);
  }

  // Connect to MongoDB
  if (!MONGODB_CONNECTION_STRING) {
    console.error('❌ Error: MONGODB_CONNECTION_STRING not found in .env file');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_CONNECTION_STRING);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Build query
    const query = {
      userId: USER_ID,
      calendarId: TARGET_CALENDAR_ID,
      isDeleted: { $ne: true },
      // Only export events that don't have a Graph ID yet (not already synced)
      'graphData.id': { $exists: false }
    };

    // Add date filters if specified
    if (START_DATE || END_DATE) {
      query['graphData.start.dateTime'] = {};
      if (START_DATE) {
        query['graphData.start.dateTime'].$gte = START_DATE.toISOString();
      }
      if (END_DATE) {
        query['graphData.start.dateTime'].$lte = END_DATE.toISOString();
      }
    }

    // Query events
    let queryBuilder = collection
      .find(query)
      .sort({ 'graphData.start.dateTime': 1 });

    // Apply limit if specified
    if (LIMIT) {
      queryBuilder = queryBuilder.limit(LIMIT);
    }

    const events = await queryBuilder.toArray();

    console.log(`Found ${events.length} events without Graph IDs\n`);

    if (events.length === 0) {
      console.log('✅ No new events to export. All events already have Graph IDs (already synced).');
      return;
    }

    // Check calendar for attribute matches (heal existing data)
    console.log('🔍 Checking calendar for matching events (by name, time, location, categories)...');
    const attributeMatches = await findExistingEventsByAttributes(TARGET_CALENDAR_ID, events, GRAPH_ACCESS_TOKEN);

    if (attributeMatches.size > 0) {
      console.log(`   Found ${attributeMatches.size} matching events already in calendar`);
      console.log(`   Updating MongoDB with Graph IDs (healing data)...\n`);

      // Update MongoDB with Graph IDs for matched events
      const bulkOps = [];
      for (const [mongoEventId, graphEventId] of attributeMatches) {
        bulkOps.push({
          updateOne: {
            filter: { eventId: mongoEventId, userId: USER_ID },
            update: {
              $set: {
                'graphData.id': graphEventId,
                'sourceMetadata.graphEventId': graphEventId,
                'sourceMetadata.syncStatus': 'synced',
                'sourceMetadata.syncedAt': new Date(),
                'sourceMetadata.syncMethod': 'attribute-match'
              }
            }
          }
        });
      }

      if (bulkOps.length > 0) {
        await collection.bulkWrite(bulkOps);
        console.log(`   ✅ Updated ${bulkOps.length} MongoDB records with Graph IDs\n`);
      }
    } else {
      console.log(`   No matching events found in calendar\n`);
    }

    // Filter out events that were matched (don't export duplicates)
    const eventsToExport = events.filter(event => !attributeMatches.has(event.eventId));

    if (eventsToExport.length === 0) {
      console.log('✅ All events already exist in calendar. No new events to create.');
      return;
    }

    console.log(`📤 Exporting ${eventsToExport.length} new events to calendar...\n`);

    // Process in batches
    const totalBatches = Math.ceil(eventsToExport.length / BATCH_SIZE);
    let totalExported = 0;
    let totalFailed = 0;
    const batchErrors = [];
    const startTime = Date.now();

    for (let i = 0; i < eventsToExport.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = eventsToExport.slice(i, i + BATCH_SIZE);
      const batchStart = i + 1;
      const batchEnd = Math.min(i + BATCH_SIZE, eventsToExport.length);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (events ${batchStart}-${batchEnd})...`);

      if (DRY_RUN) {
        // Dry run - just show what would be exported
        batch.forEach((event, idx) => {
          console.log(`   ${batchStart + idx}. ${event.graphData?.subject || 'Untitled'} (${event.eventId})`);
        });
        totalExported += batch.length;
        console.log(`   📊 Progress: ${totalExported}/${eventsToExport.length} events (${Math.round(totalExported/eventsToExport.length*100)}%)`);
        continue;
      }

      // Transform to Graph API format
      const graphEvents = batch.map(transformToGraphFormat);

      // Build batch request using delegated token (/me endpoint)
      const baseUrl = `/me/calendars/${TARGET_CALENDAR_ID}/events`;

      const batchRequest = {
        requests: graphEvents.map((event, idx) => ({
          id: String(idx + 1),
          method: 'POST',
          url: baseUrl,
          headers: {
            'Content-Type': 'application/json'
          },
          body: event
        }))
      };

      // Retry logic
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let retryDelay = 1000;
      let batchSuccess = false;

      while (retryCount <= MAX_RETRIES && !batchSuccess) {
        try {
          const batchStartTime = Date.now();
          const graphResponse = await fetch('https://graph.microsoft.com/v1.0/$batch', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GRAPH_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(batchRequest)
          });

          const batchDuration = Date.now() - batchStartTime;

          if (!graphResponse.ok) {
            const errorText = await graphResponse.text();
            throw new Error(`Graph API request failed: ${graphResponse.status} ${graphResponse.statusText} - ${errorText}`);
          }

          const batchResult = await graphResponse.json();

          // Process responses and save Graph IDs back to MongoDB
          let successCount = 0;
          let failCount = 0;
          const graphIdUpdates = []; // Track updates to save back to MongoDB

          if (batchResult.responses) {
            batchResult.responses.forEach((response, idx) => {
              if (response.status >= 200 && response.status < 300) {
                successCount++;

                // Extract Graph event ID from response
                const graphEventId = response.body?.id;
                const mongoEvent = batch[idx];

                if (graphEventId && mongoEvent) {
                  graphIdUpdates.push({
                    mongoEventId: mongoEvent.eventId,
                    graphEventId: graphEventId
                  });
                }
              } else {
                failCount++;
                console.log(`   ⚠️  Event ${batchStart + idx} failed: ${response.status} - ${JSON.stringify(response.body)}`);
              }
            });
          }

          // Save Graph IDs back to MongoDB
          if (graphIdUpdates.length > 0) {
            try {
              const bulkOps = graphIdUpdates.map(update => ({
                updateOne: {
                  filter: { eventId: update.mongoEventId, userId: USER_ID },
                  update: {
                    $set: {
                      'graphData.id': update.graphEventId,
                      'sourceMetadata.graphEventId': update.graphEventId,
                      'sourceMetadata.syncStatus': 'synced',
                      'sourceMetadata.syncedAt': new Date()
                    }
                  }
                }
              }));

              await collection.bulkWrite(bulkOps);
            } catch (error) {
              console.log(`   ⚠️  Warning: Failed to save Graph IDs to MongoDB: ${error.message}`);
            }
          }

          totalExported += successCount;
          totalFailed += failCount;

          console.log(`   ✅ Exported ${successCount} events in ${batchDuration}ms`);
          if (failCount > 0) {
            console.log(`   ❌ Failed: ${failCount} events`);
          }
          console.log(`   📊 Progress: ${totalExported}/${eventsToExport.length} events (${Math.round(totalExported/eventsToExport.length*100)}%)`);
          batchSuccess = true;

        } catch (error) {
          // Detect rate limiting (429 status)
          const isRateLimitError = error.message.includes('429') ||
                                   error.message.includes('rate') ||
                                   error.message.includes('throttl');

          if (isRateLimitError && retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`   ⚠️  RATE LIMIT HIT: Graph API throttled this batch`);
            console.log(`   🔄 Retry ${retryCount}/${MAX_RETRIES} after ${retryDelay}ms...`);
            await sleep(retryDelay);
            retryDelay *= 2;
            continue;
          }

          // Max retries reached or different error
          batchErrors.push({
            batch: batchNum,
            range: `${batchStart}-${batchEnd}`,
            error: error.message
          });

          totalFailed += batch.length;
          console.log(`   ❌ Batch ${batchNum} failed: ${error.message}`);
          batchSuccess = true; // Exit retry loop
        }
      }

      // Add delay between batches
      if (DELAY_BETWEEN_BATCHES > 0 && i + BATCH_SIZE < events.length) {
        console.log(`   ⏱️  Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }

    const totalDuration = Date.now() - startTime;
    const avgPerEvent = eventsToExport.length > 0 ? Math.round(totalDuration / eventsToExport.length) : 0;

    console.log('\n' + '='.repeat(60));
    console.log('📋 EXPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Events without Graph IDs: ${events.length}`);
    console.log(`Matched in calendar:      ${attributeMatches.size} (healed)`);
    console.log(`New events created:       ${totalExported} ✅`);
    console.log(`Failed:                   ${totalFailed} ❌`);
    console.log(`Total batches:           ${totalBatches}`);
    console.log(`Batch size:              ${BATCH_SIZE}`);
    console.log(`Total time:              ${(totalDuration/1000).toFixed(2)}s`);
    console.log(`Avg time per event:      ${avgPerEvent}ms`);
    console.log('='.repeat(60));

    if (batchErrors.length > 0) {
      console.log('\n⚠️  BATCH ERRORS:');
      batchErrors.forEach(err => {
        console.log(`   Batch ${err.batch} (events ${err.range}): ${err.error}`);
      });
    }

    if (totalExported > 0) {
      console.log(`\n✅ SUCCESS! Exported ${totalExported} events to Microsoft 365 Calendar`);
    }

    if (totalFailed > 0) {
      console.log(`\n⚠️  WARNING: ${totalFailed} events failed to export. Check errors above.`);
    }

  } catch (error) {
    console.error('❌ Error during export:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the export
exportToGraph().catch(console.error);

/**
 * Resource Scheduler (rsSched) Import Script
 *
 * Imports events from Resource Scheduler CSV export with proper location matching.
 * Matches locationCode from CSV to rsKey in templeEvents__Locations.
 *
 * Usage:
 *   node import-rssched.js <calendarName> --file=<filename.csv> [options]
 *
 * Options:
 *   --file=<name>       CSV file in csv-imports folder (required)
 *   --clear             Clear all existing events before import
 *   --dry-run           Preview import without making changes
 *   --batch-size=N      Records per batch (default: 500)
 *   --delay=N           Milliseconds between batches (default: 0)
 *
 * Examples:
 *   node import-rssched.js "Temple Emanu-El Sandbox" --file=rssched-export.csv --dry-run
 *   node import-rssched.js "Temple Emanu-El Sandbox" --file=rssched-export.csv --clear
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

// Parse command-line arguments
const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const TARGET_CALENDAR_NAME = args.find(a => !a.startsWith('--'));
const CSV_FILE = getArg('file');
const CLEAR_EVENTS = hasFlag('clear');
const DRY_RUN = hasFlag('dry-run');
const TEST_MODE = hasFlag('test');
const TEST_LIMIT = parseInt(getArg('test-limit') || '10');
const CLEAR_TEST = hasFlag('clear-test');
const BATCH_SIZE = parseInt(getArg('batch-size') || '500');
const DELAY_MS = parseInt(getArg('delay') || '0');

// Publish to Outlook options
const PUBLISH = hasFlag('publish');
const PUBLISH_ONLY = hasFlag('publish-only');
const UNPUBLISH = hasFlag('unpublish');
const GRAPH_BATCH_SIZE = Math.min(parseInt(getArg('graph-batch-size') || '20'), 20); // Max 20 for Graph API
const GRAPH_DELAY_MS = parseInt(getArg('graph-delay') || '500');
const GRAPH_ACCESS_TOKEN = getArg('access-token') || process.env.GRAPH_ACCESS_TOKEN;
const PUBLISH_LIMIT = parseInt(getArg('publish-limit') || '0'); // 0 = no limit

if (!TARGET_CALENDAR_NAME || (!CSV_FILE && !CLEAR_TEST && !CLEAR_EVENTS && !PUBLISH_ONLY && !UNPUBLISH)) {
  console.log('Usage: node import-rssched.js <calendarName> --file=<filename.csv> [options]');
  console.log('\nOptions:');
  console.log('  --file=<name>       CSV file in csv-imports folder');
  console.log('  --clear             Clear all events for this calendar (standalone or before import)');
  console.log('  --dry-run           Preview import without making changes');
  console.log('  --test              Test mode: import limited records with isTest=true marker');
  console.log('  --test-limit=N      Number of test records to import (default: 10)');
  console.log('  --clear-test        Clear only test records (no import needed)');
  console.log('  --batch-size=N      Records per MongoDB batch (default: 500)');
  console.log('  --delay=N           Milliseconds between MongoDB batches (default: 0)');
  console.log('\nPublish to Outlook:');
  console.log('  --publish           Publish events to Outlook after MongoDB import');
  console.log('  --publish-only      Publish existing MongoDB events (no CSV import)');
  console.log('  --unpublish         Delete published events from Outlook (keeps MongoDB)');
  console.log('  --publish-limit=N   Limit how many events to publish (for incremental testing)');
  console.log('  --access-token=T    Graph API token (or set GRAPH_ACCESS_TOKEN env var)');
  console.log('  --graph-batch-size=N Events per Graph batch (default: 20, max: 20)');
  console.log('  --graph-delay=N     Milliseconds between Graph batches (default: 500)');
  console.log('\nExamples:');
  console.log('  node import-rssched.js "Calendar" --file=data.csv --test      # Import 10 test records');
  console.log('  node import-rssched.js "Calendar" --clear-test                 # Clear test records');
  console.log('  node import-rssched.js "Calendar" --file=data.csv --clear     # Full import');
  console.log('  node import-rssched.js "Calendar" --file=data.csv --publish   # Import + publish to Outlook');
  console.log('  node import-rssched.js "Calendar" --publish-only              # Publish existing events');
  process.exit(1);
}

const CSV_IMPORT_FOLDER = path.join(__dirname, 'csv-imports');
const CSV_FILE_PATH = CSV_FILE ? path.join(CSV_IMPORT_FOLDER, CSV_FILE) : null;
const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'templeEventsDB';

// Default user ID for imports
const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearCalendarEvents() {
  console.log('=== CLEARING ALL EVENTS FOR CALENDAR ===\n');

  // Load calendar config
  let calendarConfig;
  try {
    calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];
  if (!TARGET_CALENDAR_ID) {
    console.error(`Error: Calendar "${TARGET_CALENDAR_NAME}" not found in config`);
    process.exit(1);
  }

  console.log(`Target Calendar: ${TARGET_CALENDAR_NAME}`);

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    const query = { calendarId: TARGET_CALENDAR_ID };
    const count = await eventsCollection.countDocuments(query);
    console.log(`Found ${count} events for ${TARGET_CALENDAR_NAME}`);

    if (count > 0 && !DRY_RUN) {
      // Delete in batches to avoid rate limiting
      const DELETE_BATCH_SIZE = 100;
      let totalDeleted = 0;

      while (true) {
        // Get batch of IDs to delete
        const batch = await eventsCollection.find(query).limit(DELETE_BATCH_SIZE).project({ _id: 1 }).toArray();
        if (batch.length === 0) break;

        const ids = batch.map(doc => doc._id);

        try {
          const result = await eventsCollection.deleteMany({ _id: { $in: ids } });
          totalDeleted += result.deletedCount;
          console.log(`  Deleted batch: ${result.deletedCount} (total: ${totalDeleted}/${count})`);
        } catch (error) {
          if (error.code === 16500) {
            console.log('  Rate limit hit, waiting 1s...');
            await sleep(1000);
            continue;
          }
          throw error;
        }

        await sleep(100); // Small delay between batches
      }

      console.log(`\nDeleted ${totalDeleted} events total`);
    } else if (DRY_RUN) {
      console.log('[DRY RUN] Would delete all events for this calendar');
    }
  } finally {
    await client.close();
  }
}

async function clearTestRecords() {
  console.log('=== CLEARING TEST RECORDS ===\n');

  // Load calendar config
  let calendarConfig;
  try {
    calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];
  if (!TARGET_CALENDAR_ID) {
    console.error(`Error: Calendar "${TARGET_CALENDAR_NAME}" not found in config`);
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    const query = { calendarId: TARGET_CALENDAR_ID, isTest: true };
    const count = await eventsCollection.countDocuments(query);
    console.log(`Found ${count} test records for ${TARGET_CALENDAR_NAME}`);

    if (count > 0 && !DRY_RUN) {
      const result = await eventsCollection.deleteMany(query);
      console.log(`Deleted ${result.deletedCount} test records`);
    } else if (DRY_RUN) {
      console.log('[DRY RUN] Would delete test records');
    }
  } finally {
    await client.close();
  }
}

async function publishExistingEvents() {
  console.log('=== PUBLISHING EXISTING EVENTS ===\n');

  if (!GRAPH_ACCESS_TOKEN) {
    console.error('Error: No Graph API token provided.');
    console.log('Set GRAPH_ACCESS_TOKEN in .env or use --access-token=TOKEN');
    process.exit(1);
  }

  // Load calendar config
  let calendarConfig;
  try {
    calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];
  if (!TARGET_CALENDAR_ID) {
    console.error(`Error: Calendar "${TARGET_CALENDAR_NAME}" not found in config`);
    process.exit(1);
  }

  console.log(`Target Calendar: ${TARGET_CALENDAR_NAME}`);

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Query for unpublished events (no graphData.id)
    const query = {
      calendarId: TARGET_CALENDAR_ID,
      'graphData.id': { $exists: false }
    };

    // Add test filter if in test mode
    if (TEST_MODE) {
      query.isTest = true;
    }

    // Query with optional limit
    let cursor = eventsCollection.find(query);
    if (PUBLISH_LIMIT > 0) {
      cursor = cursor.limit(PUBLISH_LIMIT);
    }
    const events = await cursor.toArray();

    const totalUnpublished = await eventsCollection.countDocuments(query);
    if (PUBLISH_LIMIT > 0 && totalUnpublished > PUBLISH_LIMIT) {
      console.log(`Found ${totalUnpublished} unpublished events, limiting to ${PUBLISH_LIMIT}\n`);
    } else {
      console.log(`Found ${events.length} unpublished events\n`);
    }

    if (events.length === 0) {
      console.log('No events to publish');
      return;
    }

    if (DRY_RUN) {
      console.log('[DRY RUN] Would publish these events');
      return;
    }

    await publishToOutlook(events, TARGET_CALENDAR_ID, eventsCollection);

  } finally {
    await client.close();
  }
}

async function unpublishEvents() {
  console.log('=== UNPUBLISHING EVENTS FROM OUTLOOK ===\n');

  if (!GRAPH_ACCESS_TOKEN) {
    console.error('Error: No Graph API token provided.');
    console.log('Set GRAPH_ACCESS_TOKEN in .env or use --access-token=TOKEN');
    process.exit(1);
  }

  // Load calendar config
  let calendarConfig;
  try {
    calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];
  if (!TARGET_CALENDAR_ID) {
    console.error(`Error: Calendar "${TARGET_CALENDAR_NAME}" not found in config`);
    process.exit(1);
  }

  console.log(`Target Calendar: ${TARGET_CALENDAR_NAME}`);

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Query for published events (have graphData.id)
    const query = {
      calendarId: TARGET_CALENDAR_ID,
      'graphData.id': { $exists: true, $ne: null }
    };

    // Add test filter if in test mode
    if (TEST_MODE) {
      query.isTest = true;
    }

    const events = await eventsCollection.find(query).toArray();
    console.log(`Found ${events.length} published events to delete from Outlook\n`);

    if (events.length === 0) {
      console.log('No events to unpublish');
      return;
    }

    if (DRY_RUN) {
      console.log('[DRY RUN] Would delete these events from Outlook');
      return;
    }

    // Delete from Outlook in batches
    const totalBatches = Math.ceil(events.length / GRAPH_BATCH_SIZE);
    let totalDeleted = 0;
    let totalFailed = 0;

    console.log(`Deleting in ${totalBatches} batches...\n`);

    for (let i = 0; i < events.length; i += GRAPH_BATCH_SIZE) {
      const batchNum = Math.floor(i / GRAPH_BATCH_SIZE) + 1;
      const batch = events.slice(i, i + GRAPH_BATCH_SIZE);

      // Build batch delete request
      const batchRequests = batch.map((event, idx) => ({
        id: String(idx + 1),
        method: 'DELETE',
        url: `/me/calendars/${TARGET_CALENDAR_ID}/events/${event.graphData.id}`
      }));

      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GRAPH_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ requests: batchRequests })
        });

        if (!response.ok) {
          throw new Error(`Graph API error: ${response.status}`);
        }

        const result = await response.json();
        let batchDeleted = 0;
        let batchFailed = 0;

        // Process responses and clear graphData.id from MongoDB
        for (let idx = 0; idx < result.responses.length; idx++) {
          const res = result.responses[idx];
          if (res.status >= 200 && res.status < 300 || res.status === 404) {
            // 404 means already deleted, still count as success
            batchDeleted++;
            const event = batch[idx];
            await eventsCollection.updateOne(
              { eventId: event.eventId },
              { $unset: { 'graphData.id': '', publishedAt: '' } }
            );
          } else {
            batchFailed++;
          }
        }

        totalDeleted += batchDeleted;
        totalFailed += batchFailed;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batchDeleted} deleted, ${batchFailed} failed`);

      } catch (error) {
        console.error(`  Batch ${batchNum}: Failed - ${error.message}`);
        totalFailed += batch.length;
      }

      // Delay between batches
      if (i + GRAPH_BATCH_SIZE < events.length) {
        await sleep(GRAPH_DELAY_MS);
      }
    }

    console.log('\n' + '─'.repeat(50));
    console.log(`UNPUBLISH COMPLETE: ${totalDeleted} deleted, ${totalFailed} failed`);

  } finally {
    await client.close();
  }
}

async function publishToOutlook(events, calendarId, eventsCollection, calendarEmail = null) {
  console.log('\n=== PUBLISHING TO OUTLOOK ===\n');

  if (!GRAPH_ACCESS_TOKEN) {
    console.error('Error: No Graph API token provided.');
    console.log('Either:');
    console.log('  1. Set GRAPH_ACCESS_TOKEN in .env file');
    console.log('  2. Use --access-token=YOUR_TOKEN');
    console.log('\nTo get a token:');
    console.log('  1. Log into the app in browser');
    console.log('  2. Open DevTools > Application > Session Storage');
    console.log('  3. Find the access token for graph.microsoft.com');
    return { published: 0, failed: 0, skipped: 0 };
  }

  // Filter out already-published events (those with graphData.id)
  const unpublishedEvents = events.filter(e => !e.graphData?.id);
  const skippedCount = events.length - unpublishedEvents.length;

  if (skippedCount > 0) {
    console.log(`Skipping ${skippedCount} already published events`);
  }

  if (unpublishedEvents.length === 0) {
    console.log('No new events to publish');
    return { published: 0, failed: 0, skipped: skippedCount };
  }

  console.log(`Publishing ${unpublishedEvents.length} events to Outlook`);
  console.log(`Batch size: ${GRAPH_BATCH_SIZE}, Delay: ${GRAPH_DELAY_MS}ms`);

  const totalBatches = Math.ceil(unpublishedEvents.length / GRAPH_BATCH_SIZE);
  console.log(`Total batches: ${totalBatches}`);
  console.log(`Estimated time: ~${Math.ceil(totalBatches * GRAPH_DELAY_MS / 1000 / 60)} minutes\n`);

  let totalPublished = 0;
  let totalFailed = 0;
  const MAX_RETRIES = 3;

  for (let i = 0; i < unpublishedEvents.length; i += GRAPH_BATCH_SIZE) {
    const batchNum = Math.floor(i / GRAPH_BATCH_SIZE) + 1;
    const batch = unpublishedEvents.slice(i, i + GRAPH_BATCH_SIZE);

    // Build Graph API batch request
    const batchRequests = batch.map((event, idx) => {
      const isAllDay = event.graphData.isAllDay || false;

      // For all-day events, Graph API requires date-only format (YYYY-MM-DD)
      let start, end;
      if (isAllDay) {
        // Extract date portion only
        const startDate = event.graphData.start.dateTime.split('T')[0];
        const endDate = event.graphData.end.dateTime.split('T')[0];
        start = { dateTime: startDate, timeZone: event.graphData.start.timeZone || 'UTC' };
        end = { dateTime: endDate, timeZone: event.graphData.end.timeZone || 'UTC' };
      } else {
        start = event.graphData.start;
        end = event.graphData.end;
      }

      // Use default calendar endpoint - more reliable than specific calendarId
      return {
        id: String(idx + 1),
        method: 'POST',
        url: `/me/calendar/events`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          subject: event.graphData.subject,
          start,
          end,
          location: event.graphData.location,
          body: {
            contentType: 'text',
            content: event.graphData.bodyPreview || ''
          },
          categories: event.graphData.categories || [],
          isAllDay,
          showAs: event.graphData.showAs || 'busy',
          importance: event.graphData.importance || 'normal'
        }
      };
    });

    // Retry logic
    let retryCount = 0;
    let retryDelay = 1000;
    let batchSuccess = false;

    while (retryCount <= MAX_RETRIES && !batchSuccess) {
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GRAPH_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ requests: batchRequests })
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 || response.status === 503) {
            throw new Error(`Rate limit: ${response.status}`);
          }
          throw new Error(`Graph API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        let batchPublished = 0;
        let batchFailed = 0;

        // Process responses and save Graph IDs to MongoDB
        for (const res of result.responses) {
          // Match response to original request by id
          const idx = parseInt(res.id) - 1;
          const event = batch[idx];

          if (res.status >= 200 && res.status < 300) {
            batchPublished++;
            // Save Graph event ID back to MongoDB (in graphData.id)
            const graphEventId = res.body?.id;
            if (graphEventId && eventsCollection) {
              try {
                await eventsCollection.updateOne(
                  { eventId: event.eventId },
                  { $set: { 'graphData.id': graphEventId, publishedAt: new Date() } }
                );
              } catch (updateError) {
                console.error(`    Update error for ${event.eventId}: ${updateError.message}`);
              }
            }
          } else {
            batchFailed++;
            // Log the error for debugging
            const event = batch[idx];
            console.error(`    Failed: ${event.graphData?.subject || event.eventId}`);
            console.error(`      Status: ${res.status} - ${res.body?.error?.message || JSON.stringify(res.body?.error || res.body)}`);
          }
        }

        totalPublished += batchPublished;
        totalFailed += batchFailed;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batchPublished} published, ${batchFailed} failed (total: ${totalPublished}/${unpublishedEvents.length})`);
        batchSuccess = true;

      } catch (error) {
        const isRateLimit = error.message.includes('429') ||
                           error.message.includes('Rate limit') ||
                           error.message.includes('throttl');

        if (isRateLimit && retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`  Batch ${batchNum}: Rate limit hit, retry ${retryCount}/${MAX_RETRIES} after ${retryDelay}ms...`);
          await sleep(retryDelay);
          retryDelay *= 2; // Exponential backoff
          continue;
        }

        console.error(`  Batch ${batchNum}: Failed - ${error.message}`);
        totalFailed += batch.length;
        batchSuccess = true; // Exit retry loop
      }
    }

    // Delay between batches
    if (i + GRAPH_BATCH_SIZE < unpublishedEvents.length) {
      await sleep(GRAPH_DELAY_MS);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`PUBLISH COMPLETE: ${totalPublished} published, ${totalFailed} failed, ${skippedCount} skipped`);

  return { published: totalPublished, failed: totalFailed, skipped: skippedCount };
}

async function importRsSched() {
  console.log('=== RESOURCE SCHEDULER IMPORT ===\n');

  if (DRY_RUN) {
    console.log('*** DRY RUN MODE - No changes will be made ***\n');
  }
  if (TEST_MODE) {
    console.log(`*** TEST MODE - Importing only ${TEST_LIMIT} records ***\n`);
  }
  if (PUBLISH) {
    console.log('*** PUBLISH MODE - Will publish to Outlook after MongoDB import ***\n');
    if (!GRAPH_ACCESS_TOKEN) {
      console.warn('Warning: No Graph API token provided. Publishing will fail.');
      console.log('Set GRAPH_ACCESS_TOKEN in .env or use --access-token=TOKEN\n');
    }
  }

  // Handle --clear-test as standalone operation
  if (CLEAR_TEST && !CSV_FILE) {
    await clearTestRecords();
    return;
  }

  // Handle --clear as standalone operation (clear all events for calendar)
  if (CLEAR_EVENTS && !CSV_FILE) {
    await clearCalendarEvents();
    return;
  }

  // Handle --publish-only (publish existing MongoDB events)
  if (PUBLISH_ONLY) {
    await publishExistingEvents();
    return;
  }

  // Handle --unpublish (delete from Outlook, keep in MongoDB)
  if (UNPUBLISH) {
    await unpublishEvents();
    return;
  }

  // Validate CSV file exists
  if (!CSV_FILE_PATH || !fs.existsSync(CSV_FILE_PATH)) {
    console.error(`Error: CSV file not found: ${CSV_FILE_PATH}`);
    process.exit(1);
  }
  console.log(`CSV File: ${CSV_FILE_PATH}`);

  // Load calendar config
  let calendarConfig;
  try {
    calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];
  if (!TARGET_CALENDAR_ID) {
    console.error(`Error: Calendar "${TARGET_CALENDAR_NAME}" not found in config`);
    console.log('\nAvailable calendars:');
    Object.keys(calendarConfig).filter(k => !k.startsWith('_')).forEach(name => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }
  console.log(`Target Calendar: ${TARGET_CALENDAR_NAME}`);
  console.log(`Calendar ID: ${TARGET_CALENDAR_ID.substring(0, 30)}...`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');
    const locationsCollection = db.collection('templeEvents__Locations');

    // Build location lookup map: rsKey -> location ObjectId and displayName
    const locations = await locationsCollection.find({ active: { $ne: false } }).toArray();
    const locationByRsKey = new Map();

    for (const loc of locations) {
      if (loc.rsKey) {
        locationByRsKey.set(loc.rsKey.toString(), {
          _id: loc._id,
          displayName: loc.displayName || loc.name
        });
      }
    }
    console.log(`Loaded ${locations.length} locations (${locationByRsKey.size} with rsKey)\n`);

    // Clear existing events for target calendar only
    if (CLEAR_EVENTS) {
      const existingCount = await eventsCollection.countDocuments({ calendarId: TARGET_CALENDAR_ID });
      console.log(`Clearing ${existingCount} events for ${TARGET_CALENDAR_NAME}...`);

      if (!DRY_RUN) {
        await eventsCollection.deleteMany({ calendarId: TARGET_CALENDAR_ID });
        console.log('Events cleared.\n');
      } else {
        console.log('[DRY RUN] Would clear events.\n');
      }
    }

    // Read and parse CSV (strip BOM if present)
    console.log('Reading CSV file...');
    const rows = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv({
          mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim()
        }))
        .on('data', row => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Parsed ${rows.length} rows from CSV\n`);

    // In test mode, limit to TEST_LIMIT records
    const rowsToProcess = TEST_MODE ? rows.slice(0, TEST_LIMIT) : rows;
    if (TEST_MODE) {
      console.log(`Test mode: processing ${rowsToProcess.length} of ${rows.length} rows\n`);
    }

    // Process rows into events
    const events = [];
    let locationMatched = 0;
    let locationUnmatched = 0;
    let deletedSkipped = 0;
    const unmatchedLocationCodes = new Set();

    for (const row of rowsToProcess) {
      // Skip deleted events
      if (row.Deleted === '1' || row.Deleted === 1 || row.Deleted === true) {
        deletedSkipped++;
        continue;
      }

      // Parse dates
      const startDateTime = new Date(row.StartDateTime);
      const endDateTime = new Date(row.EndDateTime);

      // Extract local time strings (HH:MM format) - use CSV values if available, otherwise extract from Date
      const startTimeStr = row.StartTime ||
        `${String(startDateTime.getHours()).padStart(2, '0')}:${String(startDateTime.getMinutes()).padStart(2, '0')}`;
      const endTimeStr = row.EndTime ||
        `${String(endDateTime.getHours()).padStart(2, '0')}:${String(endDateTime.getMinutes()).padStart(2, '0')}`;

      // Extract date strings (YYYY-MM-DD format)
      const startDateStr = row.StartDate || startDateTime.toISOString().split('T')[0];
      const endDateStr = row.EndDate || endDateTime.toISOString().split('T')[0];

      // Format as local datetime (no Z suffix) for graphData and top-level fields
      const startDateTimeLocal = `${startDateStr}T${startTimeStr}`;
      const endDateTimeLocal = `${endDateStr}T${endTimeStr}`;

      // Match location by rsKey from CSV -> rsKey in locations collection
      let locationIds = [];
      let locationDisplayNames = '';
      let locationCodes = [];
      const rsKey = row.rsKey || row.RsKey || row.locationCode || row.LocationCode;

      if (rsKey) {
        // rsKey might be semicolon-separated for multiple locations
        const keys = rsKey.toString().split(';').map(k => k.trim()).filter(k => k);
        const matchedLocs = [];

        for (const key of keys) {
          if (locationByRsKey.has(key)) {
            const loc = locationByRsKey.get(key);
            matchedLocs.push(loc);
          } else {
            unmatchedLocationCodes.add(key);
          }
        }

        if (matchedLocs.length > 0) {
          locationIds = matchedLocs.map(l => l._id);
          locationDisplayNames = matchedLocs.map(l => l.displayName).join('; ');
          locationCodes = matchedLocs.map(l => l.rsKey);
          locationMatched++;
        } else {
          locationUnmatched++;
        }
      } else {
        locationUnmatched++;
      }

      // Generate unique eventId
      const eventId = row.rsId
        ? `rssched-${row.rsId}`
        : `rssched-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Build the event document
      const event = {
        eventId: eventId,
        userId: IMPORT_USER_ID,
        source: 'rsSched',
        isDeleted: false,
        ...(TEST_MODE && { isTest: true }),

        // Top-level fields for quick access
        locations: locationIds,
        locationDisplayNames: locationDisplayNames,
        locationCodes: locationCodes,

        // Top-level time fields (for UI/forms compatibility)
        eventTitle: row.Subject || '',
        eventDescription: row.Description || '',
        startDateTime: startDateTimeLocal,
        endDateTime: endDateTimeLocal,
        startDate: startDateStr,
        startTime: startTimeStr,
        endDate: endDateStr,
        endTime: endTimeStr,
        // Default setupTime and doorOpenTime to event start (rsSched doesn't have these)
        setupTime: startTimeStr,
        doorOpenTime: startTimeStr,
        // Default doorCloseTime to event end
        doorCloseTime: endTimeStr,
        // Leave teardownTime empty (can be set manually later)
        teardownTime: '',
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        isAllDayEvent: row.AllDayEvent === '1' || row.AllDayEvent === 1,

        // Store all rsSched data in dedicated object
        rschedData: {
          rsId: row.rsId ? parseInt(row.rsId) : null,
          subject: row.Subject || '',
          startDate: row.StartDate || '',
          startTime: row.StartTime || '',
          startDateTime: row.StartDateTime || '',
          endDate: row.EndDate || '',
          endTime: row.EndTime || '',
          endDateTime: row.EndDateTime || '',
          allDayEvent: row.AllDayEvent === '1' || row.AllDayEvent === 1,
          location: row.Location || '',
          rsKey: rsKey || '',
          description: row.Description || '',
          categories: row.Categories || '',
          eventCode: row.EventCode || '',
          requesterId: row.RequesterID || row.RequesterId || '',
          requesterName: row.RequesterName || '',
          requesterEmail: row.RequesterEmail || '',
          isRecurring: row.IsRecurring === '1' || row.IsRecurring === 1,
          recurType: row.RecurType || '',
          recurNotes: row.RecurNotes || '',
          importedAt: new Date()
        },

        // Graph-compatible structure for UI compatibility
        graphData: {
          subject: row.Subject || '',
          start: {
            dateTime: startDateTimeLocal,
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: endDateTimeLocal,
            timeZone: 'America/New_York'
          },
          location: row.Location ? {
            displayName: row.Location,
            locationType: 'default'
          } : undefined,
          categories: row.Categories ? [row.Categories] : [],
          bodyPreview: row.Description || '',
          isAllDay: row.AllDayEvent === '1' || row.AllDayEvent === 1,
          importance: 'normal',
          showAs: 'busy',
          sensitivity: 'normal',
          organizer: {
            emailAddress: {
              name: row.RequesterName || 'Resource Scheduler Import',
              address: row.RequesterEmail || 'import@rssched.local'
            }
          },
          attendees: [],
          extensions: [],
          singleValueExtendedProperties: []
        },

        // Internal enrichment data
        internalData: {
          mecCategories: [],
          setupMinutes: 0,
          teardownMinutes: 0,
          registrationNotes: '',
          assignedTo: '',
          staffAssignments: [],
          internalNotes: '',
          setupStatus: 'pending',
          estimatedCost: null,
          actualCost: null,
          customFields: {},
          createRegistrationEvent: null,
          isRegistrationEvent: false,
          linkedMainEventId: null
        },

        // Metadata
        lastModifiedDateTime: new Date(),
        lastSyncedAt: new Date(),
        calendarId: TARGET_CALENDAR_ID,
        calendarName: TARGET_CALENDAR_NAME,
        sourceCalendars: [{
          calendarId: TARGET_CALENDAR_ID,
          calendarName: TARGET_CALENDAR_NAME,
          role: 'primary'
        }],
        cachedAt: new Date(),
        lastAccessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      events.push(event);
    }

    console.log('PROCESSING SUMMARY:');
    console.log(`  Total rows: ${rows.length}`);
    console.log(`  Deleted (skipped): ${deletedSkipped}`);
    console.log(`  Events to import: ${events.length}`);
    console.log(`  Location matched: ${locationMatched}`);
    console.log(`  Location unmatched: ${locationUnmatched}`);

    if (unmatchedLocationCodes.size > 0) {
      console.log(`\nUnmatched location codes (${unmatchedLocationCodes.size}):`);
      [...unmatchedLocationCodes].slice(0, 20).forEach(code => {
        console.log(`  - ${code}`);
      });
      if (unmatchedLocationCodes.size > 20) {
        console.log(`  ... and ${unmatchedLocationCodes.size - 20} more`);
      }
    }

    if (DRY_RUN) {
      console.log('\n[DRY RUN] Would insert events. Sample event:');
      if (events.length > 0) {
        const sample = events[0];
        console.log(JSON.stringify({
          eventId: sample.eventId,
          isTest: sample.isTest,
          locations: sample.locations.map(id => id.toString()),
          locationDisplayNames: sample.locationDisplayNames,
          rschedData: sample.rschedData,
          'graphData.subject': sample.graphData.subject
        }, null, 2));
      }
      console.log('\n[DRY RUN] Complete. Run without --dry-run to import.');
      return;
    }

    // Insert events in batches
    console.log(`\nInserting ${events.length} events (batch size: ${BATCH_SIZE})...\n`);

    let totalInserted = 0;
    const totalBatches = Math.ceil(events.length / BATCH_SIZE);

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = events.slice(i, i + BATCH_SIZE);

      try {
        const result = await eventsCollection.insertMany(batch, { ordered: false });
        totalInserted += result.insertedCount;
        console.log(`  Batch ${batchNum}/${totalBatches}: Inserted ${result.insertedCount} events`);
      } catch (error) {
        const insertedCount = error.result?.insertedCount || 0;
        totalInserted += insertedCount;
        console.log(`  Batch ${batchNum}/${totalBatches}: Partial - ${insertedCount} inserted, some failed`);

        if (error.code === 16500 || error.message.includes('Request rate is large')) {
          console.log('    Rate limit hit - consider using --delay=500');
        }
      }

      if (DELAY_MS > 0 && i + BATCH_SIZE < events.length) {
        await sleep(DELAY_MS);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('IMPORT COMPLETE');
    console.log('='.repeat(50));
    console.log(`Events imported: ${totalInserted}`);
    console.log(`Locations matched: ${locationMatched}`);

    // Publish to Outlook if requested
    if (PUBLISH && totalInserted > 0) {
      await publishToOutlook(events, TARGET_CALENDAR_ID, eventsCollection);
    }

  } finally {
    await client.close();
  }
}

importRsSched().catch(console.error);

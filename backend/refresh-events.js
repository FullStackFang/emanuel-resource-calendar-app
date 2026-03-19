/**
 * Refresh Events from Resource Scheduler (rsSched)
 *
 * Single script for the full lifecycle of refreshing rsSched events:
 *   Phase 1 (clean)   - Delete rsSched events from Graph + MongoDB for a given year
 *   Phase 2 (import)  - Parse CSV and create MongoDB documents with full modern schema
 *   Phase 3 (publish) - Create Graph events via app-only auth, save IDs back to MongoDB
 *
 * Usage:
 *   node refresh-events.js <calendarOwner> --file=<csv> --year=<YYYY> [options]
 *
 * Options:
 *   --file=<name>           CSV file in csv-imports/ folder (required for import phase)
 *   --year=<YYYY>           Year to scope operations (required)
 *   --dry-run               Preview all phases without making changes
 *   --phase=clean|import|publish  Run only the specified phase
 *   --batch-size=N          MongoDB batch size (default: 100)
 *   --graph-batch-size=N    Graph API batch size (default: 4, max: 20)
 *   --graph-delay=N         Milliseconds between Graph batches (default: 500)
 *
 * Examples:
 *   node refresh-events.js templeeventssandbox@emanuelnyc.org --file=2026.csv --year=2026 --dry-run
 *   node refresh-events.js templeeventssandbox@emanuelnyc.org --file=2026.csv --year=2026
 *   node refresh-events.js templeeventssandbox@emanuelnyc.org --year=2026 --phase=publish
 *   node refresh-events.js templeevents@emanuelnyc.org --file=2026.csv --year=2026
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const graphApiService = require('./services/graphApiService');

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const CALENDAR_OWNER = args.find(a => !a.startsWith('--'));
const CSV_FILE = getArg('file');
const YEAR = getArg('year') ? parseInt(getArg('year'), 10) : null;
const DRY_RUN = hasFlag('dry-run');
const PHASE = getArg('phase'); // clean | import | publish | null (all)
const BATCH_SIZE = parseInt(getArg('batch-size') || '100', 10);
const GRAPH_BATCH_SIZE = Math.min(parseInt(getArg('graph-batch-size') || '4', 10), 20);
const GRAPH_DELAY_MS = parseInt(getArg('graph-delay') || '500', 10);

// ─── Calendar Config Lookup ──────────────────────────────────────────────────

const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');

function lookupCalendarId(calendarOwner) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch {
    console.error('Error: Could not read calendar-config.json');
    process.exit(1);
  }

  // Case-insensitive lookup
  const ownerLower = calendarOwner.toLowerCase();
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_') || typeof value !== 'string') continue;
    if (key.toLowerCase() === ownerLower) {
      return value;
    }
  }

  // Not found — list available calendars
  console.error(`Error: Calendar owner "${calendarOwner}" not found in calendar-config.json\n`);
  console.log('Available calendars:');
  for (const key of Object.keys(config)) {
    if (!key.startsWith('_') && typeof config[key] === 'string') {
      console.log(`  - ${key}`);
    }
  }
  process.exit(1);
}

// ─── Validation ──────────────────────────────────────────────────────────────

function printUsage() {
  console.log('Usage: node refresh-events.js <calendarOwner> --file=<csv> --year=<YYYY> [options]\n');
  console.log('Options:');
  console.log('  --file=<name>           CSV file in csv-imports/ folder');
  console.log('  --year=<YYYY>           Year to scope operations (required)');
  console.log('  --dry-run               Preview without making changes');
  console.log('  --phase=clean|import|publish  Run only one phase');
  console.log('  --batch-size=N          MongoDB batch size (default: 100)');
  console.log('  --graph-batch-size=N    Graph API batch size (default: 4, max: 20)');
  console.log('  --graph-delay=N         ms between Graph batches (default: 500)');
  console.log('\nExamples:');
  console.log('  node refresh-events.js templeeventssandbox@emanuelnyc.org --file=2026.csv --year=2026 --dry-run');
  console.log('  node refresh-events.js templeeventssandbox@emanuelnyc.org --file=2026.csv --year=2026');
  console.log('  node refresh-events.js templeeventssandbox@emanuelnyc.org --year=2026 --phase=publish');
}

if (!CALENDAR_OWNER || !YEAR) {
  printUsage();
  process.exit(1);
}

if (PHASE && !['clean', 'import', 'publish'].includes(PHASE)) {
  console.error(`Error: Invalid --phase="${PHASE}". Must be clean, import, or publish.`);
  process.exit(1);
}

const runClean = !PHASE || PHASE === 'clean';
const runImport = !PHASE || PHASE === 'import';
const runPublish = !PHASE || PHASE === 'publish';

if (runImport && !CSV_FILE) {
  console.error('Error: --file is required for the import phase.');
  printUsage();
  process.exit(1);
}

const CALENDAR_ID = lookupCalendarId(CALENDAR_OWNER);
const YEAR_START = `${YEAR}-01-01`;
const YEAR_END = `${YEAR + 1}-01-01`;

const CSV_IMPORT_FOLDER = path.join(__dirname, 'csv-imports');
const CSV_FILE_PATH = CSV_FILE ? path.join(CSV_IMPORT_FOLDER, CSV_FILE) : null;

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'templeEventsDB';

const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

const RSSCHED_SOURCES = ['rsSched', 'Resource Scheduler Import'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Phase 1: CLEAN ──────────────────────────────────────────────────────────

async function phaseClean(db) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: CLEAN');
  console.log('='.repeat(60));

  const eventsCollection = db.collection('templeEvents__Events');

  const query = {
    calendarOwner: CALENDAR_OWNER.toLowerCase(),
    source: { $in: RSSCHED_SOURCES },
    startDateTime: { $gte: YEAR_START, $lt: YEAR_END }
  };

  const events = await eventsCollection.find(query).toArray();
  const withGraphId = events.filter(e => e.graphData?.id);
  const withoutGraphId = events.length - withGraphId.length;

  console.log(`\nFound ${events.length} rsSched events in ${YEAR}`);
  console.log(`  With Graph ID (need Outlook deletion): ${withGraphId.length}`);
  console.log(`  Without Graph ID (MongoDB only):       ${withoutGraphId}`);

  if (events.length === 0) {
    console.log('\nNothing to clean.');
    return { graphDeleted: 0, mongoDeleted: 0 };
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would delete:');
    console.log(`  - ${withGraphId.length} events from Outlook`);
    console.log(`  - ${events.length} documents from MongoDB`);
    return { graphDeleted: 0, mongoDeleted: 0 };
  }

  // Delete from Graph API (batched)
  let graphDeleted = 0;
  let graphFailed = 0;

  if (withGraphId.length > 0) {
    console.log(`\nDeleting ${withGraphId.length} events from Outlook...`);
    const totalBatches = Math.ceil(withGraphId.length / GRAPH_BATCH_SIZE);

    for (let i = 0; i < withGraphId.length; i += GRAPH_BATCH_SIZE) {
      const batchNum = Math.floor(i / GRAPH_BATCH_SIZE) + 1;
      const batch = withGraphId.slice(i, i + GRAPH_BATCH_SIZE);

      const requests = batch.map((event, idx) => ({
        id: String(idx + 1),
        method: 'DELETE',
        url: `/users/${encodeURIComponent(CALENDAR_OWNER)}/calendars/${CALENDAR_ID}/events/${event.graphData.id}`
      }));

      try {
        const result = await graphApiService.batchRequest(requests);
        let batchOk = 0;
        let batchFail = 0;

        for (const res of (result.responses || [])) {
          if (res.status >= 200 && res.status < 300 || res.status === 404) {
            batchOk++;
          } else {
            batchFail++;
          }
        }

        graphDeleted += batchOk;
        graphFailed += batchFail;
        process.stdout.write(`  Batch ${batchNum}/${totalBatches}: ${batchOk} deleted, ${batchFail} failed (total: ${graphDeleted}/${withGraphId.length})\n`);
      } catch (error) {
        console.error(`  Batch ${batchNum}: Error - ${error.message}`);
        graphFailed += batch.length;
      }

      if (i + GRAPH_BATCH_SIZE < withGraphId.length) {
        await sleep(GRAPH_DELAY_MS);
      }
    }
  }

  // Delete from MongoDB (batched)
  console.log(`\nDeleting ${events.length} documents from MongoDB...`);
  const ids = events.map(e => e._id);
  let mongoDeleted = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);

    let retries = 0;
    while (retries <= 3) {
      try {
        const result = await eventsCollection.deleteMany({ _id: { $in: batchIds } });
        mongoDeleted += result.deletedCount;
        break;
      } catch (error) {
        if (error.code === 16500 && retries < 3) {
          retries++;
          console.log(`  Rate limit hit, retry ${retries}/3...`);
          await sleep(1000 * retries);
          continue;
        }
        throw error;
      }
    }
  }

  console.log(`\nClean complete: ${graphDeleted} Graph events deleted, ${mongoDeleted} MongoDB docs deleted`);
  if (graphFailed > 0) {
    console.log(`  Graph failures: ${graphFailed}`);
  }

  return { graphDeleted, mongoDeleted, graphFailed };
}

// ─── Phase 2: IMPORT ─────────────────────────────────────────────────────────

async function phaseImport(db) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: IMPORT');
  console.log('='.repeat(60));

  // Validate CSV file
  if (!CSV_FILE_PATH || !fs.existsSync(CSV_FILE_PATH)) {
    console.error(`Error: CSV file not found: ${CSV_FILE_PATH}`);
    process.exit(1);
  }
  console.log(`\nCSV file: ${CSV_FILE_PATH}`);

  const eventsCollection = db.collection('templeEvents__Events');
  const locationsCollection = db.collection('templeEvents__Locations');

  // Build location lookup: rsKey -> { _id, displayName }
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
  console.log(`Loaded ${locations.length} locations (${locationByRsKey.size} with rsKey)`);

  // Parse CSV
  console.log('Parsing CSV...');
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
  console.log(`Parsed ${rows.length} rows`);

  // Transform rows to event documents
  const events = [];
  let locationMatched = 0;
  let locationUnmatched = 0;
  let deletedSkipped = 0;
  const unmatchedCodes = new Set();
  const now = new Date();

  for (const row of rows) {
    // Skip deleted
    if (row.Deleted === '1' || row.Deleted === 1 || row.Deleted === true) {
      deletedSkipped++;
      continue;
    }

    // Parse dates
    const startDateTime = new Date(row.StartDateTime);
    const endDateTime = new Date(row.EndDateTime);

    const startTimeStr = row.StartTime ||
      `${String(startDateTime.getHours()).padStart(2, '0')}:${String(startDateTime.getMinutes()).padStart(2, '0')}`;
    const endTimeStr = row.EndTime ||
      `${String(endDateTime.getHours()).padStart(2, '0')}:${String(endDateTime.getMinutes()).padStart(2, '0')}`;
    const startDateStr = row.StartDate || startDateTime.toISOString().split('T')[0];
    const endDateStr = row.EndDate || endDateTime.toISOString().split('T')[0];
    const startDateTimeLocal = `${startDateStr}T${startTimeStr}`;
    const endDateTimeLocal = `${endDateStr}T${endTimeStr}`;

    // Location matching
    let locationIds = [];
    let locationDisplayNames = '';
    let locationCodes = [];
    const rsKey = row.rsKey || row.RsKey || row.locationCode || row.LocationCode;

    if (rsKey) {
      const keys = rsKey.toString().split(';').map(k => k.trim()).filter(k => k);
      const matchedLocs = [];

      for (const key of keys) {
        if (locationByRsKey.has(key)) {
          matchedLocs.push(locationByRsKey.get(key));
        } else {
          unmatchedCodes.add(key);
        }
      }

      if (matchedLocs.length > 0) {
        locationIds = matchedLocs.map(l => l._id);
        locationDisplayNames = matchedLocs.map(l => l.displayName).join('; ');
        locationCodes = keys;
        locationMatched++;
      } else {
        locationUnmatched++;
      }
    } else {
      locationUnmatched++;
    }

    const eventId = row.rsId
      ? `rssched-${row.rsId}`
      : `rssched-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const isAllDay = row.AllDayEvent === '1' || row.AllDayEvent === 1;

    events.push({
      eventId,
      userId: IMPORT_USER_ID,
      source: 'rsSched',
      createdSource: 'rssched-import',
      isDeleted: false,

      // Status & workflow
      status: 'published',
      calendarOwner: CALENDAR_OWNER.toLowerCase(),
      calendarId: CALENDAR_ID,
      _version: 1,
      statusHistory: [{
        status: 'published',
        changedAt: now,
        changedBy: 'rssched-import',
        changedByEmail: 'rssched-import@system',
        reason: 'rsSched import'
      }],
      publishedAt: now,
      publishedBy: 'rssched-import@system',
      eventType: 'singleInstance',

      // Top-level fields
      eventTitle: row.Subject || '',
      eventDescription: row.Description || '',
      startDateTime: startDateTimeLocal,
      endDateTime: endDateTimeLocal,
      startDate: startDateStr,
      startTime: startTimeStr,
      endDate: endDateStr,
      endTime: endTimeStr,
      setupTime: startTimeStr,
      doorOpenTime: startTimeStr,
      doorCloseTime: endTimeStr,
      teardownTime: '',
      setupTimeMinutes: 0,
      teardownTimeMinutes: 0,
      isAllDayEvent: isAllDay,

      // Locations
      locations: locationIds,
      locationDisplayNames,
      locationCodes,

      // Graph data — populated in publish phase
      graphData: null,

      // Raw rsSched data
      rschedData: {
        rsId: row.rsId ? parseInt(row.rsId) : null,
        subject: row.Subject || '',
        startDate: row.StartDate || '',
        startTime: row.StartTime || '',
        startDateTime: row.StartDateTime || '',
        endDate: row.EndDate || '',
        endTime: row.EndTime || '',
        endDateTime: row.EndDateTime || '',
        allDayEvent: isAllDay,
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
        importedAt: now
      },

      // Enrichment defaults
      calendarData: {
        categories: [],
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        registrationNotes: '',
        assignedTo: '',
        staffAssignments: [],
        eventNotes: '',
        setupStatus: 'pending',
        estimatedCost: null,
        actualCost: null,
        customFields: {},
        createRegistrationEvent: null,
        isRegistrationEvent: false,
        linkedMainEventId: null
      },

      // Metadata
      calendarName: CALENDAR_OWNER,
      sourceCalendars: [{
        calendarId: CALENDAR_ID,
        calendarName: CALENDAR_OWNER,
        role: 'primary'
      }],
      lastModifiedDateTime: now,
      lastSyncedAt: now,
      cachedAt: now,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  // Summary
  console.log('\nParsing summary:');
  console.log(`  Total rows:        ${rows.length}`);
  console.log(`  Deleted (skipped): ${deletedSkipped}`);
  console.log(`  Events to import:  ${events.length}`);
  console.log(`  Location matched:  ${locationMatched}`);
  console.log(`  Location unmatched:${locationUnmatched}`);

  if (unmatchedCodes.size > 0) {
    console.log(`\n  Unmatched location codes (${unmatchedCodes.size}):`);
    [...unmatchedCodes].slice(0, 20).forEach(code => console.log(`    - ${code}`));
    if (unmatchedCodes.size > 20) console.log(`    ... and ${unmatchedCodes.size - 20} more`);
  }

  if (events.length === 0) {
    console.log('\nNo events to import.');
    return { imported: 0 };
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would insert events. Sample document:');
    const sample = events[0];
    console.log(JSON.stringify({
      eventId: sample.eventId,
      source: sample.source,
      status: sample.status,
      calendarOwner: sample.calendarOwner,
      _version: sample._version,
      eventTitle: sample.eventTitle,
      startDateTime: sample.startDateTime,
      endDateTime: sample.endDateTime,
      locations: sample.locations.map(id => id.toString()),
      locationDisplayNames: sample.locationDisplayNames,
      graphData: sample.graphData,
      eventType: sample.eventType,
      createdSource: sample.createdSource
    }, null, 2));
    return { imported: 0 };
  }

  // Insert in batches
  console.log(`\nInserting ${events.length} events (batch size: ${BATCH_SIZE})...`);
  let totalInserted = 0;
  const totalBatches = Math.ceil(events.length / BATCH_SIZE);

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = events.slice(i, i + BATCH_SIZE);

    let retries = 0;
    while (retries <= 3) {
      try {
        const result = await eventsCollection.insertMany(batch, { ordered: false });
        totalInserted += result.insertedCount;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${result.insertedCount} inserted (total: ${totalInserted}/${events.length})`);
        break;
      } catch (error) {
        if (error.code === 16500 && retries < 3) {
          retries++;
          console.log(`  Rate limit hit, retry ${retries}/3...`);
          await sleep(1000 * retries);
          continue;
        }
        // insertMany ordered:false still inserts valid docs
        const inserted = error.result?.insertedCount || 0;
        totalInserted += inserted;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${inserted} inserted, some failed - ${error.message}`);
        break;
      }
    }
  }

  console.log(`\nImport complete: ${totalInserted} events inserted`);
  return { imported: totalInserted };
}

// ─── Phase 3: PUBLISH ────────────────────────────────────────────────────────

async function phasePublish(db) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: PUBLISH');
  console.log('='.repeat(60));

  const eventsCollection = db.collection('templeEvents__Events');

  const query = {
    calendarOwner: CALENDAR_OWNER.toLowerCase(),
    source: 'rsSched',
    startDateTime: { $gte: YEAR_START, $lt: YEAR_END },
    $or: [
      { graphData: null },
      { 'graphData.id': { $exists: false } }
    ]
  };

  const events = await eventsCollection.find(query).toArray();
  console.log(`\nFound ${events.length} unpublished rsSched events in ${YEAR}`);

  if (events.length === 0) {
    console.log('Nothing to publish.');
    return { published: 0, failed: 0 };
  }

  // Estimated time
  const totalBatches = Math.ceil(events.length / GRAPH_BATCH_SIZE);
  const estimatedMs = totalBatches * GRAPH_DELAY_MS;
  console.log(`Batch size: ${GRAPH_BATCH_SIZE}, Delay: ${GRAPH_DELAY_MS}ms`);
  console.log(`Estimated time: ~${Math.max(1, Math.ceil(estimatedMs / 1000 / 60))} minutes\n`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would publish ${events.length} events to Outlook`);
    return { published: 0, failed: 0 };
  }

  let totalPublished = 0;
  let totalFailed = 0;

  for (let i = 0; i < events.length; i += GRAPH_BATCH_SIZE) {
    const batchNum = Math.floor(i / GRAPH_BATCH_SIZE) + 1;
    const batch = events.slice(i, i + GRAPH_BATCH_SIZE);

    // Build Graph event payloads
    const requests = batch.map((event, idx) => {
      const isAllDay = event.isAllDayEvent || false;

      let start, end;
      if (isAllDay) {
        start = { dateTime: event.startDate, timeZone: 'Eastern Standard Time' };
        end = { dateTime: event.endDate, timeZone: 'Eastern Standard Time' };
      } else {
        start = { dateTime: event.startDateTime, timeZone: 'Eastern Standard Time' };
        end = { dateTime: event.endDateTime, timeZone: 'Eastern Standard Time' };
      }

      return {
        id: String(idx + 1),
        method: 'POST',
        url: `/users/${encodeURIComponent(CALENDAR_OWNER)}/calendars/${CALENDAR_ID}/events`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          subject: event.eventTitle || 'Untitled Event',
          start,
          end,
          isAllDay,
          showAs: 'busy',
          importance: 'normal',
          body: {
            contentType: 'text',
            content: event.eventDescription || ''
          },
          ...(event.locationDisplayNames && {
            location: {
              displayName: event.locationDisplayNames,
              locationType: 'default'
            }
          })
        }
      };
    });

    // Retry logic for the batch
    let retries = 0;
    let retryDelay = 1000;
    let batchDone = false;

    while (retries <= 3 && !batchDone) {
      try {
        const result = await graphApiService.batchRequest(requests);
        let batchPublished = 0;
        let batchFailed = 0;

        for (const res of (result.responses || [])) {
          const idx = parseInt(res.id) - 1;
          const event = batch[idx];

          if (res.status >= 200 && res.status < 300) {
            batchPublished++;
            const graphEventId = res.body?.id;
            if (graphEventId) {
              try {
                await eventsCollection.updateOne(
                  { _id: event._id },
                  {
                    $set: {
                      'graphData.id': graphEventId,
                      'graphData.iCalUId': res.body?.iCalUId || null,
                      'graphData.webLink': res.body?.webLink || null
                    }
                  }
                );
              } catch (updateErr) {
                console.error(`    MongoDB update failed for ${event.eventId}: ${updateErr.message}`);
              }
            }
          } else if (res.status === 429) {
            // Individual throttle within batch
            throw new Error('429 in batch response');
          } else {
            batchFailed++;
            console.error(`    Failed: "${event.eventTitle}" - ${res.status}: ${res.body?.error?.message || JSON.stringify(res.body?.error)}`);
          }
        }

        totalPublished += batchPublished;
        totalFailed += batchFailed;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batchPublished} published, ${batchFailed} failed (total: ${totalPublished}/${events.length})`);
        batchDone = true;

      } catch (error) {
        const isRateLimit = error.message.includes('429') || error.message.includes('throttl');
        if (isRateLimit && retries < 3) {
          retries++;
          console.log(`  Batch ${batchNum}: Rate limit, retry ${retries}/3 after ${retryDelay}ms...`);
          await sleep(retryDelay);
          retryDelay *= 2;
          continue;
        }
        console.error(`  Batch ${batchNum}: Error - ${error.message}`);
        totalFailed += batch.length;
        batchDone = true;
      }
    }

    if (i + GRAPH_BATCH_SIZE < events.length) {
      await sleep(GRAPH_DELAY_MS);
    }
  }

  console.log(`\nPublish complete: ${totalPublished} published, ${totalFailed} failed`);
  return { published: totalPublished, failed: totalFailed };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('REFRESH RSSCHED EVENTS');
  console.log('='.repeat(60));
  console.log(`Calendar owner: ${CALENDAR_OWNER}`);
  console.log(`Calendar ID:    ${CALENDAR_ID.substring(0, 30)}...`);
  console.log(`Year:           ${YEAR}`);
  console.log(`Phases:         ${PHASE || 'all (clean -> import -> publish)'}`);
  if (CSV_FILE) console.log(`CSV file:       ${CSV_FILE}`);
  if (DRY_RUN) console.log('Mode:           DRY RUN');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('\nConnected to MongoDB');

    const db = client.db(DB_NAME);

    const results = {};

    if (runClean) {
      results.clean = await phaseClean(db);
    }

    if (runImport) {
      results.import = await phaseImport(db);
    }

    if (runPublish) {
      results.publish = await phasePublish(db);
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    if (results.clean) {
      console.log(`  Clean:   ${results.clean.graphDeleted} Graph + ${results.clean.mongoDeleted} MongoDB deleted${results.clean.graphFailed ? ` (${results.clean.graphFailed} Graph failures)` : ''}`);
    }
    if (results.import) {
      console.log(`  Import:  ${results.import.imported} events inserted`);
    }
    if (results.publish) {
      console.log(`  Publish: ${results.publish.published} published${results.publish.failed ? `, ${results.publish.failed} failed` : ''}`);
    }

    if (DRY_RUN) {
      console.log('\n[DRY RUN] No changes were made. Run without --dry-run to apply.');
    }

    console.log('='.repeat(60));

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

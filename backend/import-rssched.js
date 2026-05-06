/**
 * Resource Scheduler (rsSched) Import — CLI wrapper.
 *
 * This file is a thin shim around backend/services/rschedImportService.js.
 * The service is the single source of truth for parsing, location resolution,
 * the upsert algorithm, and Graph publishing — used by both this CLI and the
 * admin panel endpoints in api-server.js.
 *
 * Auth note: this CLI uses graphApiService (app-only auth, env-driven)
 * for all Outlook publishing. The legacy delegated-token / GRAPH_ACCESS_TOKEN
 * paste workflow is gone — set GRAPH_CLIENT_SECRET in .env instead.
 *
 * Usage:
 *   node import-rssched.js <calendarOwnerEmail> --file=<filename.csv> [options]
 *
 * Options:
 *   --file=<name>            CSV file in csv-imports folder (required for import)
 *   --dry-run                Parse + match locations, print summary, do not write
 *   --test                   Mark imported staging rows with --test flag (legacy: just renames the session)
 *   --test-limit=N           Number of test records to process (default: 10)
 *   --from=YYYY-MM-DD        Date range start for import session metadata (default: today)
 *   --to=YYYY-MM-DD          Date range end (default: from + 90 days)
 *   --batch-size=N           Records per Mongo insert batch (default: 100)
 *   --commit                 After upload, also auto-commit the session (else stays in staging)
 *   --publish                After commit, also publish to Outlook via app-only Graph
 *   --calendar-id=<id>       Override calendar ID (else looks up by owner in calendar-config.json)
 *
 *   --clear                  Delete all rsSched events for the target calendar (no CSV needed)
 *   --clear-test             Delete only events with isTest=true marker
 *   --discard-session=<id>   Delete all staging rows for a given sessionId
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const rschedImportService = require('./services/rschedImportService');
let graphApiService;
try {
  graphApiService = require('./services/graphApiService');
} catch (_) {
  graphApiService = null; // Allow dry runs without Graph creds.
}

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));

function getArg(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const TARGET_OWNER = positional[0] || null;
const CSV_FILE = getArg('file');
const DRY_RUN = hasFlag('dry-run');
const TEST_MODE = hasFlag('test');
const TEST_LIMIT = parseInt(getArg('test-limit') || '10', 10);
const CLEAR = hasFlag('clear');
const CLEAR_TEST = hasFlag('clear-test');
const COMMIT = hasFlag('commit');
const PUBLISH = hasFlag('publish');
const FROM_DATE = getArg('from') || todayIso();
const TO_DATE = getArg('to') || addDaysIso(FROM_DATE, 90);
const BATCH_SIZE = parseInt(getArg('batch-size') || '100', 10);
const CALENDAR_ID_OVERRIDE = getArg('calendar-id');
const DISCARD_SESSION = getArg('discard-session');

const CSV_IMPORT_FOLDER = path.join(__dirname, 'csv-imports');
const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';
const IMPORT_USER_EMAIL = 'rsched-import-cli@emanuelnyc.org';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function usage(code = 1) {
  console.log(
    `Usage: node import-rssched.js <calendarOwnerEmail> --file=<csv> [options]\n` +
      `\nCommon flags:\n` +
      `  --file=<name>           CSV under backend/csv-imports/\n` +
      `  --dry-run               Parse + match locations, print summary, do not write\n` +
      `  --from=YYYY-MM-DD       Date range start (default: today)\n` +
      `  --to=YYYY-MM-DD         Date range end (default: from + 90 days)\n` +
      `  --commit                Auto-commit session after upload\n` +
      `  --publish               Auto-publish to Outlook after commit (app-only Graph)\n` +
      `  --batch-size=N          Mongo insert batch size (default: 100)\n` +
      `  --test                  Mark session for test purposes (no behavioral change)\n` +
      `  --test-limit=N          Limit rows processed in test mode (default: 10)\n` +
      `\nMaintenance:\n` +
      `  --clear                 Delete all rsSched events for the calendar\n` +
      `  --clear-test            Delete events with isTest=true\n` +
      `  --discard-session=ID    Delete all staging rows for sessionId\n`,
  );
  process.exit(code);
}

function loadCalendarConfig() {
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('Could not read calendar-config.json:', err.message);
    process.exit(1);
  }
}

async function clearAllRschedEvents(db, owner) {
  const events = db.collection(rschedImportService.EVENTS_COLLECTION);
  const filter = { source: rschedImportService.RSCHED_SOURCE, calendarOwner: owner.toLowerCase() };
  const count = await events.countDocuments(filter);
  console.log(`Found ${count} rsSched events for ${owner}`);
  if (count === 0 || DRY_RUN) {
    if (DRY_RUN) console.log('[DRY RUN] Would delete all rsSched events');
    return;
  }

  const ids = await events.find(filter).project({ _id: 1 }).toArray();
  let total = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).map((d) => d._id);
    const result = await events.deleteMany({ _id: { $in: batch } });
    total += result.deletedCount;
    process.stdout.write(`\r   [Progress] ${total}/${count}`);
    if (i + BATCH_SIZE < ids.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  process.stdout.write('\n');
  console.log(`Deleted ${total} events`);
}

async function clearTestEvents(db, owner) {
  const events = db.collection(rschedImportService.EVENTS_COLLECTION);
  const filter = {
    source: rschedImportService.RSCHED_SOURCE,
    calendarOwner: owner.toLowerCase(),
    isTest: true,
  };
  const count = await events.countDocuments(filter);
  console.log(`Found ${count} test rsSched events for ${owner}`);
  if (count === 0 || DRY_RUN) {
    if (DRY_RUN) console.log('[DRY RUN] Would delete test rsSched events');
    return;
  }
  const result = await events.deleteMany(filter);
  console.log(`Deleted ${result.deletedCount} test events`);
}

async function discardStagingSession(db, sessionId) {
  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const result = await staging.deleteMany({ sessionId });
  console.log(`Deleted ${result.deletedCount} staging rows for session ${sessionId}`);
}

async function importCsv(db, owner, calendarConfig) {
  if (!CSV_FILE) usage();

  const csvPath = path.join(CSV_IMPORT_FOLDER, CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const calendarId = CALENDAR_ID_OVERRIDE || calendarConfig[owner];
  if (!calendarId) {
    console.error(`No calendarId found for ${owner} in calendar-config.json`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(csvPath);
  console.log(`Parsing ${csvPath}...`);
  const { rows: parsed, parseErrors } = await rschedImportService.parseCsv(buffer);
  console.log(`Parsed ${parsed.length} rows (${parseErrors.length} errors)`);

  const rowsToProcess = TEST_MODE ? parsed.slice(0, TEST_LIMIT) : parsed;
  if (TEST_MODE) console.log(`Test mode: limiting to ${rowsToProcess.length} rows`);

  const locationsCol = db.collection(rschedImportService.LOCATIONS_COLLECTION);
  const { rows: resolved, unmatchedKeys } = await rschedImportService.resolveLocations(
    rowsToProcess,
    locationsCol,
  );

  const breakdown = resolved.reduce((acc, r) => {
    acc[r.locationStatus] = (acc[r.locationStatus] || 0) + 1;
    return acc;
  }, {});
  console.log('Location match breakdown:', breakdown);
  if (unmatchedKeys.size > 0) {
    console.log(`Unmatched rsKeys (${unmatchedKeys.size}):`, [...unmatchedKeys].slice(0, 20));
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] Stopping before staging write.');
    return null;
  }

  const sessionId = `cli-${TEST_MODE ? 'test-' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ctx = {
    sessionId,
    uploadedBy: IMPORT_USER_ID,
    uploadedAt: new Date(),
    calendarOwner: owner.toLowerCase(),
    calendarId,
    csvFilename: CSV_FILE,
    dateRangeStart: FROM_DATE,
    dateRangeEnd: TO_DATE,
  };

  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const stagingDocs = resolved.map((r) => rschedImportService.buildStagingDoc(r, ctx));

  for (let i = 0; i < stagingDocs.length; i += BATCH_SIZE) {
    const batch = stagingDocs.slice(i, i + BATCH_SIZE);
    await staging.insertMany(batch, { ordered: false });
    const done = Math.min(i + BATCH_SIZE, stagingDocs.length);
    process.stdout.write(`\r   [Staging] ${Math.round((done / stagingDocs.length) * 100)}% (${done}/${stagingDocs.length})`);
    if (i + BATCH_SIZE < stagingDocs.length) await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write('\n');
  console.log(`Staged ${stagingDocs.length} rows under sessionId=${sessionId}`);
  return { sessionId, calendarOwner: owner.toLowerCase(), calendarId, stagedCount: stagingDocs.length };
}

async function commitSession(db, sessionInfo) {
  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const eligible = await staging
    .find({
      sessionId: sessionInfo.sessionId,
      status: { $nin: [rschedImportService.STAGING_STATUS.SKIPPED] },
    })
    .toArray();

  console.log(`Committing ${eligible.length} rows...`);
  const ctx = {
    sessionId: sessionInfo.sessionId,
    calendarOwner: sessionInfo.calendarOwner,
    calendarId: sessionInfo.calendarId,
    importUserId: IMPORT_USER_ID,
    importUserEmail: IMPORT_USER_EMAIL,
  };

  const counters = { applied: 0, noOp: 0, humanEditConflicts: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < eligible.length; i++) {
    const row = eligible[i];
    const outcome = await rschedImportService.applyStagingRow(db, row, ctx);
    const update = { appliedEventId: outcome.eventId, appliedAt: new Date(), applyError: outcome.error || null };
    switch (outcome.outcome) {
      case rschedImportService.APPLY_OUTCOME.INSERTED:
      case rschedImportService.APPLY_OUTCOME.UPDATED:
        counters.applied++;
        update.status = rschedImportService.STAGING_STATUS.APPLIED;
        break;
      case rschedImportService.APPLY_OUTCOME.NO_OP:
        counters.noOp++;
        update.status = rschedImportService.STAGING_STATUS.APPLIED;
        break;
      case rschedImportService.APPLY_OUTCOME.SKIPPED:
        counters.skipped++;
        break;
      case rschedImportService.APPLY_OUTCOME.HUMAN_EDIT_CONFLICT:
        counters.humanEditConflicts++;
        update.status = rschedImportService.STAGING_STATUS.HUMAN_EDIT_CONFLICT;
        update.conflictDetails = outcome.conflictDetails || null;
        break;
      default:
        counters.failed++;
        update.status = rschedImportService.STAGING_STATUS.FAILED;
        break;
    }
    await staging.updateOne({ _id: row._id }, { $set: update });
    if ((i + 1) % 50 === 0 || i + 1 === eligible.length) {
      const pct = Math.round(((i + 1) / eligible.length) * 100);
      process.stdout.write(`\r   [Commit] ${pct}% (${i + 1}/${eligible.length})`);
    }
  }
  process.stdout.write('\n');
  console.log('Commit summary:', counters);
  return counters;
}

async function publishSession(db, sessionInfo) {
  if (!graphApiService) {
    console.error('graphApiService not loaded — set GRAPH_CLIENT_SECRET in .env');
    return;
  }
  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const events = db.collection(rschedImportService.EVENTS_COLLECTION);
  const rows = await staging
    .find({ sessionId: sessionInfo.sessionId, status: rschedImportService.STAGING_STATUS.APPLIED })
    .toArray();

  console.log(`Publishing ${rows.length} events to Outlook (app-only Graph)...`);
  const counters = { published: 0, updated: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.appliedEventId) {
      counters.skipped++;
      continue;
    }
    const eventDoc = await events.findOne({ eventId: row.appliedEventId });
    if (!eventDoc) {
      counters.skipped++;
      continue;
    }
    const result = await rschedImportService.publishOrUpdateOutlookEvent(db, eventDoc, {
      graphApiService,
    });
    if (result.outcome === 'published') counters.published++;
    else if (result.outcome === 'updated') counters.updated++;
    else if (result.outcome === 'skipped') counters.skipped++;
    else counters.failed++;

    if ((i + 1) % 20 === 0 || i + 1 === rows.length) {
      const pct = Math.round(((i + 1) / rows.length) * 100);
      process.stdout.write(`\r   [Publish] ${pct}% (${i + 1}/${rows.length})`);
    }
    // Light pacing to avoid Graph throttling.
    if (i + 1 < rows.length) await new Promise((r) => setTimeout(r, 100));
  }
  process.stdout.write('\n');
  console.log('Publish summary:', counters);
}

async function main() {
  if (!TARGET_OWNER && !DISCARD_SESSION) usage();

  if (!MONGODB_URI) {
    console.error('MONGODB_CONNECTION_STRING not set in .env');
    process.exit(1);
  }

  const calendarConfig = TARGET_OWNER ? loadCalendarConfig() : null;
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    if (DISCARD_SESSION) {
      await discardStagingSession(db, DISCARD_SESSION);
      return;
    }

    if (CLEAR_TEST) {
      await clearTestEvents(db, TARGET_OWNER);
      return;
    }
    if (CLEAR && !CSV_FILE) {
      await clearAllRschedEvents(db, TARGET_OWNER);
      return;
    }

    if (CLEAR && CSV_FILE) {
      await clearAllRschedEvents(db, TARGET_OWNER);
    }

    const sessionInfo = await importCsv(db, TARGET_OWNER, calendarConfig);
    if (!sessionInfo) return; // dry run

    if (COMMIT || PUBLISH) {
      await commitSession(db, sessionInfo);
    }
    if (PUBLISH) {
      await publishSession(db, sessionInfo);
    } else if (sessionInfo) {
      console.log(`\nSession ${sessionInfo.sessionId} staged.`);
      console.log('Review in admin panel at /admin/rsched-import or commit with --commit');
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

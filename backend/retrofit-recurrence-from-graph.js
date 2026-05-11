'use strict';

/**
 * Retrofit recurring-event metadata from Outlook Graph into MongoDB.
 *
 * Problem: CSV-imported events have no recurrence columns, so events that
 * exist in Outlook as part of a recurring series land in Mongo without
 * `eventType: 'seriesMaster'`, `recurrence`, or `seriesMasterId`. This script
 * walks every recurring series visible in Outlook for a date window and
 * patches the corresponding Mongo docs by `graphData.id`.
 *
 * Two-pass: /calendarView returns occurrences (with seriesMasterId pointers
 * but null recurrence). We collect unique master IDs, then GET each master
 * individually to obtain the full recurrence pattern.
 *
 * Update-only: no creates, no deletes. Series masters only (children are
 * out of scope; per-occurrence overrides are handled by recurrenceOrphanCleanup.js).
 *
 * Usage:
 *   node retrofit-recurrence-from-graph.js \
 *     --owner=<email> \
 *     --from=YYYY-MM-DD \
 *     --to=YYYY-MM-DD \
 *     [--dry-run | --commit] \
 *     [--limit=N]
 *
 * Defaults to --dry-run unless --commit is passed.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const graphApiService = require('./services/graphApiService');
const { conditionalUpdate } = require('./utils/concurrencyUtils');
const { recurrenceEquals } = require('./utils/recurrenceCompare');
const {
  fetchGraphCalendarView,
  isGraphEventRecurring,
} = require('./utils/graphRecurrenceFetch');

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const OWNER = (getArg('owner') || '').toLowerCase();
const FROM = getArg('from');
const TO = getArg('to');
const LIMIT_RAW = getArg('limit');
const LIMIT = LIMIT_RAW ? parseInt(LIMIT_RAW, 10) : null;
const COMMIT = hasFlag('commit');
const DRY_RUN = !COMMIT;

function usage(code = 1) {
  console.log(
    'Usage: node retrofit-recurrence-from-graph.js \\\n' +
    '         --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD \\\n' +
    '         [--dry-run | --commit] [--limit=N]\n' +
    '\n' +
    'Defaults to --dry-run unless --commit is passed.\n' +
    '--limit caps the number of series masters processed (useful for first --commit run).\n',
  );
  process.exit(code);
}

if (!OWNER || !FROM || !TO) usage();
if (LIMIT_RAW && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  console.error(`Invalid --limit value: ${LIMIT_RAW}`);
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
if (!MONGODB_URI) {
  console.error('MONGODB_CONNECTION_STRING not set in .env');
  process.exit(1);
}

const FROM_ISO = `${FROM}T00:00:00Z`;
const TO_ISO = `${TO}T23:59:59Z`;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;
const GRAPH_FETCH_DELAY_MS = 50; // small jitter between master fetches

// ─── Calendar config ────────────────────────────────────────────────────────

const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
function loadCalendarConfig() {
  return JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
}
function resolveCalendarId(owner, cfg) {
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && k.toLowerCase() === owner) return v;
  }
  return null;
}

// ─── Recurrence normalizer (Graph → internal clean shape) ───────────────────

// Inverse of backend/utils/recurrenceGraphMapping.js#buildGraphRecurrence.
// Implemented inline here so this CLI script does NOT modify any utility
// file loaded by the running api-server. If/when the delta-sync write path
// is also cleaned up, promote this into recurrenceGraphMapping.js.

// Reverse of graphTypeMap in recurrenceGraphMapping.js
const REVERSE_GRAPH_TYPE_MAP = {
  absoluteMonthly: 'monthly',
  absoluteYearly: 'yearly',
};

// Reverse of tzMap in recurrenceGraphMapping.js
const REVERSE_TZ_MAP = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
};

/**
 * Convert a Graph recurrence object into the clean internal shape used by
 * the rest of the app (matches UI/unified-form output).
 *
 * Strips Graph defaults that pollute the internal shape:
 *   - pattern.month === 0
 *   - pattern.dayOfMonth === 0
 *   - pattern.index === 'first' (kept only for relative-monthly/yearly)
 *   - range.numberOfOccurrences === 0 (kept only when range.type === 'numbered')
 *   - range.recurrenceTimeZone (dropped; UI uses event timezone)
 *
 * Initializes additions: [] and exclusions: [] (Graph has no concept of these).
 *
 * @param {Object|null} graphRecurrence
 * @param {string} [eventTimezone] - Reserved for future use
 * @returns {Object|null} Clean internal recurrence
 */
function normalizeGraphRecurrence(graphRecurrence, eventTimezone) {
  if (!graphRecurrence || !graphRecurrence.pattern || !graphRecurrence.range) {
    return null;
  }

  const gp = graphRecurrence.pattern;
  const gr = graphRecurrence.range;

  // ── Pattern ──
  const rawType = gp.type || 'weekly';
  const pattern = {
    type: REVERSE_GRAPH_TYPE_MAP[rawType] || rawType,
    interval: gp.interval || 1,
  };

  if (Array.isArray(gp.daysOfWeek) && gp.daysOfWeek.length > 0) {
    pattern.daysOfWeek = [...gp.daysOfWeek];
  }
  if (gp.dayOfMonth && gp.dayOfMonth !== 0) {
    pattern.dayOfMonth = gp.dayOfMonth;
  }
  if (gp.month && gp.month !== 0) {
    pattern.month = gp.month;
  }
  // index is only meaningful for relative-monthly / relative-yearly patterns.
  // Graph fills in 'first' as a default for daily/weekly; drop that noise.
  const isRelative = pattern.type === 'relativeMonthly' || pattern.type === 'relativeYearly';
  if (gp.index && (isRelative || (gp.index !== 'first'))) {
    pattern.index = gp.index;
  }
  // firstDayOfWeek: preserve whenever Graph returns it, regardless of pattern
  // type. The UI/form keeps this field on all patterns (the existing internal
  // shape includes it on daily patterns — see user's reference doc); only the
  // outbound buildGraphRecurrence strips it for non-weekly. Round-tripping
  // through Mongo should preserve what Graph returns.
  if (gp.firstDayOfWeek) {
    pattern.firstDayOfWeek = gp.firstDayOfWeek;
  }

  // ── Range ──
  const range = {
    type: gr.type || 'noEnd',
    startDate: gr.startDate,
  };

  if (gr.type === 'endDate' && gr.endDate) {
    range.endDate = gr.endDate;
  }
  if (gr.type === 'numbered' && gr.numberOfOccurrences && gr.numberOfOccurrences !== 0) {
    range.numberOfOccurrences = gr.numberOfOccurrences;
  }
  // recurrenceTimeZone: drop if it's a Windows TZ string (we don't need it
  // in the internal shape — UI derives display tz from the event's tz).
  // If it's an unrecognized non-Windows string, preserve it as IANA.
  if (gr.recurrenceTimeZone && !REVERSE_TZ_MAP[gr.recurrenceTimeZone]) {
    range.recurrenceTimeZone = gr.recurrenceTimeZone;
  }

  return {
    pattern,
    range,
    additions: [],
    exclusions: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressBar(label, current, total) {
  const width = 30;
  const pct = total > 0 ? current / total : 1;
  const filled = Math.round(width * pct);
  const bar = '#'.repeat(filled) + ' '.repeat(width - filled);
  const percent = Math.round(pct * 100);
  process.stdout.write(`\r${label} [${bar}] ${percent}% (${current}/${total})`);
}

function pad(s, n) {
  const str = String(s ?? '');
  return str + ' '.repeat(Math.max(0, n - str.length));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('────────────────────────────────────────────────────────────');
  console.log(` Retrofit Recurrence from Graph (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'})`);
  console.log(`   Owner:  ${OWNER}`);
  console.log(`   Window: ${FROM} → ${TO}`);
  if (LIMIT) console.log(`   Limit:  ${LIMIT} series masters`);
  console.log('────────────────────────────────────────────────────────────');

  const cfg = loadCalendarConfig();
  const calendarIdHint = resolveCalendarId(OWNER, cfg);

  // ── Phase 1: Discovery ────────────────────────────────────────────────────
  console.log('\nPhase 1: Fetching /calendarView for recurring occurrences...');
  const { events: calendarViewEvents, calendarUsed } =
    await fetchGraphCalendarView(OWNER, calendarIdHint, FROM_ISO, TO_ISO);
  console.log(`   Done. Fetched ${calendarViewEvents.length} events (calendar: ${calendarUsed})`);

  const seriesMasterIdSet = new Set();
  let recurringOccurrenceCount = 0;
  for (const g of calendarViewEvents) {
    if (!isGraphEventRecurring(g)) continue;
    recurringOccurrenceCount++;
    if (g.seriesMasterId) {
      seriesMasterIdSet.add(g.seriesMasterId);
    } else if (g.type === 'seriesMaster' && g.id) {
      // /calendarView usually expands these, but be defensive.
      seriesMasterIdSet.add(g.id);
    }
  }
  console.log(`   Recurring occurrences in window: ${recurringOccurrenceCount}`);
  console.log(`   Distinct series masters: ${seriesMasterIdSet.size}`);

  // Apply --limit cap.
  let seriesMasterIds = Array.from(seriesMasterIdSet);
  if (LIMIT && seriesMasterIds.length > LIMIT) {
    console.log(`   Applying --limit=${LIMIT}: processing first ${LIMIT} of ${seriesMasterIds.length} masters`);
    seriesMasterIds = seriesMasterIds.slice(0, LIMIT);
  }

  if (seriesMasterIds.length === 0) {
    console.log('\nNo recurring series found in window. Nothing to do.');
    return;
  }

  // ── Phase 2: Fetch each master ────────────────────────────────────────────
  console.log(`\nPhase 2: Fetching ${seriesMasterIds.length} series masters from Graph...`);
  const graphMasters = []; // { id, master }
  const graphFetchErrors = [];
  for (let i = 0; i < seriesMasterIds.length; i++) {
    const id = seriesMasterIds[i];
    try {
      // calendarId is null → uses the user's default calendar, matching where
      // calendarView fetched these IDs from.
      const master = await graphApiService.getEvent(OWNER, null, id, {
        select: 'id,subject,start,end,iCalUId,seriesMasterId,type,recurrence,originalStartTimeZone,originalEndTimeZone',
      });
      graphMasters.push({ id, master });
    } catch (err) {
      graphFetchErrors.push({ id, error: err.message });
    }
    progressBar('   ', i + 1, seriesMasterIds.length);
    if (GRAPH_FETCH_DELAY_MS > 0 && i + 1 < seriesMasterIds.length) {
      await sleep(GRAPH_FETCH_DELAY_MS);
    }
  }
  process.stdout.write('\n');
  if (graphFetchErrors.length > 0) {
    console.log(`   Errors fetching ${graphFetchErrors.length} master(s):`);
    for (const e of graphFetchErrors.slice(0, 5)) {
      console.log(`     ${e.id.slice(0, 30)}...: ${e.error}`);
    }
    if (graphFetchErrors.length > 5) console.log(`     ...and ${graphFetchErrors.length - 5} more`);
  }
  console.log(`   Successfully fetched ${graphMasters.length} of ${seriesMasterIds.length} masters`);

  // ── Phase 3: Match + classify ─────────────────────────────────────────────
  console.log('\nPhase 3: Matching against MongoDB and classifying...');
  const client = new MongoClient(MONGODB_URI);
  const counts = {
    matchedInMongo: 0,
    wouldUpdate: 0,
    noChange: 0,
    skippedUserRecurrence: 0,
    skippedNotInMongo: 0,
    skippedDeleted: 0,
    writeErrors: 0,
    written: 0,
  };
  const sampleSkippedNotInMongo = [];
  const sampleSkippedUserRecurrence = [];
  const sampleWouldUpdate = [];
  const writeQueue = []; // docs to write in --commit mode

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');

    for (let i = 0; i < graphMasters.length; i++) {
      const { id, master } = graphMasters[i];
      progressBar('   ', i + 1, graphMasters.length);

      // Match by graphData.id (with belt-and-suspenders seriesMasterId match).
      const doc = await events.findOne({
        $or: [
          { 'graphData.id': id },
          { 'graphData.seriesMasterId': id },
        ],
        status: { $ne: 'deleted' },
      });

      if (!doc) {
        counts.skippedNotInMongo++;
        if (sampleSkippedNotInMongo.length < 5) {
          sampleSkippedNotInMongo.push({
            graphSubject: master.subject,
            graphStart: master.start?.dateTime,
            graphId: id,
          });
        }
        continue;
      }

      counts.matchedInMongo++;

      // Build the normalized internal recurrence.
      const eventTz = master.originalStartTimeZone || 'Eastern Standard Time';
      const normalized = normalizeGraphRecurrence(master.recurrence, eventTz);

      if (!normalized) {
        // Master returned with no recurrence object — shouldn't happen but
        // counts as a skip rather than a write of null.
        counts.skippedNotInMongo++;
        continue;
      }

      const existingRecurrence =
        (doc.recurrence && doc.recurrence.pattern) ? doc.recurrence :
        (doc.calendarData?.recurrence && doc.calendarData.recurrence.pattern) ? doc.calendarData.recurrence :
        null;

      const hasExistingPattern = existingRecurrence != null;
      const recurrenceEqual = recurrenceEquals(existingRecurrence, normalized);

      // Classification:
      //   - existing pattern AND not equal to normalized → user-customized (or
      //     delta-synced raw shape); preserve
      //   - existing pattern AND equal AND eventType already 'seriesMaster' AND
      //     seriesMasterId null → no-op (idempotent re-run)
      //   - otherwise → write
      if (hasExistingPattern && !recurrenceEqual) {
        counts.skippedUserRecurrence++;
        if (sampleSkippedUserRecurrence.length < 5) {
          sampleSkippedUserRecurrence.push({
            eventTitle: doc.eventTitle || doc.calendarData?.eventTitle,
            graphSubject: master.subject,
            mongoEventId: doc.eventId,
          });
        }
        continue;
      }

      const correctEventType = doc.eventType === 'seriesMaster';
      const correctSeriesMasterId = doc.seriesMasterId == null;
      if (hasExistingPattern && recurrenceEqual && correctEventType && correctSeriesMasterId) {
        counts.noChange++;
        continue;
      }

      counts.wouldUpdate++;
      writeQueue.push({ doc, normalized });
      if (sampleWouldUpdate.length < 5) {
        sampleWouldUpdate.push({
          eventTitle: doc.eventTitle || doc.calendarData?.eventTitle,
          mongoEventId: doc.eventId,
          mongoVersion: doc._version,
          currentEventType: doc.eventType || '(none)',
          currentHasRecurrence: !!existingRecurrence,
        });
      }
    }
    process.stdout.write('\n');

    // ── Phase 4: Writes (commit only) ──────────────────────────────────────
    if (COMMIT && writeQueue.length > 0) {
      console.log(`\nPhase 4: Writing ${writeQueue.length} updates in batches of ${BATCH_SIZE}...`);
      for (let i = 0; i < writeQueue.length; i += BATCH_SIZE) {
        const batch = writeQueue.slice(i, i + BATCH_SIZE);
        for (const { doc, normalized } of batch) {
          try {
            await conditionalUpdate(
              events,
              { _id: doc._id },
              {
                $set: {
                  eventType: 'seriesMaster',
                  seriesMasterId: null,
                  recurrence: normalized,
                  'calendarData.recurrence': normalized,
                },
              },
              {
                expectedVersion: doc._version != null ? doc._version : null,
                modifiedBy: 'retrofit-recurrence-from-graph',
              },
            );
            counts.written++;
          } catch (err) {
            counts.writeErrors++;
            if (counts.writeErrors <= 5) {
              console.log(`\n   Write error on eventId=${doc.eventId}: ${err.message}`);
            }
          }
        }
        const processed = Math.min(i + BATCH_SIZE, writeQueue.length);
        progressBar('   ', processed, writeQueue.length);
        if (i + BATCH_SIZE < writeQueue.length && BATCH_DELAY_MS > 0) {
          await sleep(BATCH_DELAY_MS);
        }
      }
      process.stdout.write('\n');
    }
  } finally {
    await client.close();
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(' Summary');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Recurring occurrences in Graph window:  ${recurringOccurrenceCount}`);
  console.log(`  Distinct series masters discovered:     ${seriesMasterIdSet.size}`);
  console.log(`  Masters processed (after --limit):      ${seriesMasterIds.length}`);
  console.log(`  Masters successfully fetched:           ${graphMasters.length}`);
  console.log(`  Graph fetch errors:                     ${graphFetchErrors.length}`);
  console.log('');
  console.log(`  Matched in MongoDB by graphData.id:     ${counts.matchedInMongo}`);
  console.log(`  ${COMMIT ? 'Updated' : 'Would update'} (missing/stale metadata): ${COMMIT ? counts.written : counts.wouldUpdate}`);
  console.log(`  No change (already correct):            ${counts.noChange}`);
  console.log(`  Skipped (user-defined recurrence):      ${counts.skippedUserRecurrence}`);
  console.log(`  Skipped (not found in MongoDB):         ${counts.skippedNotInMongo}`);
  if (COMMIT) {
    console.log(`  Write errors (OCC conflicts, etc.):     ${counts.writeErrors}`);
  }
  console.log('');

  if (sampleSkippedNotInMongo.length > 0) {
    console.log('Sample: skipped (not found in MongoDB)');
    for (const s of sampleSkippedNotInMongo) {
      console.log(`  ${pad(s.graphSubject || '(no subject)', 40)} ${pad(s.graphStart || '', 22)} id=...${s.graphId.slice(-12)}`);
    }
    console.log('');
  }
  if (sampleSkippedUserRecurrence.length > 0) {
    console.log('Sample: skipped (existing pattern differs — preserving)');
    for (const s of sampleSkippedUserRecurrence) {
      console.log(`  ${pad(s.eventTitle || '(no title)', 40)} mongoEventId=${s.mongoEventId}`);
    }
    console.log('');
  }
  if (sampleWouldUpdate.length > 0) {
    console.log(`Sample: ${COMMIT ? 'updated' : 'would update'}`);
    for (const s of sampleWouldUpdate) {
      console.log(`  ${pad(s.eventTitle || '(no title)', 40)} v=${s.mongoVersion} eventType=${s.currentEventType} hasRecurrence=${s.currentHasRecurrence}`);
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('DRY-RUN: no writes performed. Re-run with --commit to apply.');
  } else {
    console.log('COMMIT complete.');
  }
}

main().catch((err) => {
  console.error('\nRetrofit failed:', err);
  process.exit(1);
});

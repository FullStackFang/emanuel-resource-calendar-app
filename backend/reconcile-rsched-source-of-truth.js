/**
 * Phase 2 of the one-off Rsched reconciliation: write Mongo.
 *
 * Makes Mongo match the CSV within a [from, to] window for a single
 * calendarOwner. Runs three passes in order:
 *
 *   1. ADOPT — for each CSV row whose canonical eventId is not already in
 *      Mongo, search for a unique non-rsSched doc with the same title +
 *      start (±1 min) + end (±1 min) and at least one shared location.
 *      If exactly one candidate matches, rename its eventId to
 *      rssched-{rsId}, set source='rsSched', rschedData={...}, and reset
 *      lastModifiedBy to the import bot so the staging apply pass can
 *      overwrite material fields without tripping the human-edit detector.
 *
 *   2. STAGE + COMMIT — uses the existing rschedImportService flow
 *      (buildStagingDoc → applyStagingRow). Inserts CSV rows that have
 *      no Mongo match; updates rows that match by eventId (including
 *      the docs we just adopted).
 *
 *   3. SOFT-DELETE ORPHANS — sets status='deleted', isDeleted=true on:
 *        a) source='rsSched' docs in scope whose rsId is not in the CSV
 *        b) any doc in scope whose createdByEmail is one of the three
 *           known test users (regardless of source)
 *
 * Runs Phase 1's analysis first and prints what each pass would do.
 * With --dry-run, prints the plan and exits before any writes.
 *
 * Usage:
 *   node reconcile-rsched-source-of-truth.js \
 *     --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD \
 *     [--file=<csv>] [--dry-run] [--no-soft-delete]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const rschedImportService = require('./services/rschedImportService');
const { conditionalUpdate } = require('./utils/concurrencyUtils');
const { ensureCsvHeader } = require('./utils/rschedCsvShim');
const {
  getStartDateTime,
  getEndDateTime,
  getEventTitle,
  getLocationIdStrings,
  startDateTimeOrFilter,
} = require('./utils/eventFieldAccessors');

const DEFAULT_CSV = 'rsched_all_asof_5_8_2026.csv';

const TEST_USER_EMAILS = [
  'testuser1@emanuelnyc.org',
  'stephen.fang@emanuelnyc.org',
  'rrogers@emanuelnyc.org',
];

const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';
const IMPORT_USER_EMAIL = 'rsched-import-cli@emanuelnyc.org';

const TIME_TOLERANCE_MINUTES = 1;
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 1000;

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
const CSV_FILE = getArg('file') || DEFAULT_CSV;
const DRY_RUN = hasFlag('dry-run');
const NO_SOFT_DELETE = hasFlag('no-soft-delete');

function usage(code = 1) {
  console.log(
    'Usage: node reconcile-rsched-source-of-truth.js \\\n' +
      '         --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD \\\n' +
      '         [--file=<csv>] [--dry-run] [--no-soft-delete]\n' +
      `\nDefault --file is ${DEFAULT_CSV}.\n` +
      '\n--dry-run prints the plan without writing anything.\n' +
      '--no-soft-delete skips Pass 3 only.\n',
  );
  process.exit(code);
}

if (!OWNER || !FROM || !TO) usage();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
if (!MONGODB_URI) {
  console.error('MONGODB_CONNECTION_STRING not set in .env');
  process.exit(1);
}

const FROM_STR = `${FROM}T00:00:00`;
const TO_STR = `${TO}T23:59:59`;

const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
function loadCalendarConfig() {
  return JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
}
function resolveCalendarId(owner, cfg) {
  // calendar-config.json is keyed by canonical-case email; lower-case it
  // to match what the API server stores on docs.
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && k.toLowerCase() === owner) return v;
  }
  return null;
}

// ── Content-key helpers (must match audit-rsched-reconcile.js exactly so
// "what audit promised" and "what reconcile does" stay in lockstep) ──────

function normalizeTitle(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function minuteKey(dt) {
  return dt && typeof dt === 'string' ? dt.slice(0, 16) : '';
}
function addMinutesToMinuteKey(mk, deltaMin) {
  // mk = 'YYYY-MM-DDTHH:MM'. Parse, shift, re-emit.
  if (!mk) return '';
  // Treat as local time — no Z, no tz math beyond minute arithmetic.
  const [datePart, timePart] = mk.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, m] = timePart.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, m + deltaMin);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T` +
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  );
}

function contentKey(title, startDt, endDt, sMinuteShift = 0, eMinuteShift = 0) {
  const t = normalizeTitle(title);
  if (!t) return null;
  const s = addMinutesToMinuteKey(minuteKey(startDt), sMinuteShift);
  const e = addMinutesToMinuteKey(minuteKey(endDt), eMinuteShift);
  return `${t}|${s}|${e}`;
}

function pad(s, n) {
  const str = String(s);
  return str + ' '.repeat(Math.max(0, n - str.length));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printProgress(label, done, total) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  process.stdout.write(`\r   [${label}] ${pct}% (${done}/${total})`);
}

// ────────────────────────────────────────────────────────────────────────
//  Pass 1: Adoption analysis (always runs) + write (unless --dry-run)
// ────────────────────────────────────────────────────────────────────────

/**
 * Build the adoption plan: which CSV rows would adopt which Mongo doc.
 *
 * Loads non-rsSched, in-scope, non-deleted docs into memory once and
 * keys them by content. For each CSV row whose canonical eventId is
 * NOT already present in Mongo (rsSched bucket), scan a ±tolerance
 * window for content+location matches.
 */
async function buildAdoptionPlan(db, eventsCollection, csvRowsResolved) {
  // Older rsSched docs lack top-level startDateTime — query both fields.
  const existingRsSchedIds = new Set();
  const existingRsCursor = eventsCollection
    .find(
      {
        calendarOwner: OWNER,
        isDeleted: { $ne: true },
        $or: startDateTimeOrFilter(FROM_STR, TO_STR),
        source: 'rsSched',
      },
      { projection: { eventId: 1 } },
    )
    .batchSize(500);
  for await (const e of existingRsCursor) existingRsSchedIds.add(e.eventId);

  // Load non-rsSched in-scope docs with both top-level AND calendarData
  // fallback fields in the projection — accessors fall back through these.
  const nonRschedDocs = [];
  const nonRschedCursor = eventsCollection
    .find(
      {
        calendarOwner: OWNER,
        isDeleted: { $ne: true },
        $or: startDateTimeOrFilter(FROM_STR, TO_STR),
        source: { $ne: 'rsSched' },
      },
      {
        projection: {
          _id: 1,
          eventId: 1,
          eventTitle: 1,
          startDateTime: 1,
          endDateTime: 1,
          locations: 1,
          'calendarData.eventTitle': 1,
          'calendarData.startDateTime': 1,
          'calendarData.endDateTime': 1,
          'calendarData.locations': 1,
          'graphData.subject': 1,
          'graphData.start.dateTime': 1,
          'graphData.end.dateTime': 1,
          _version: 1,
          status: 1,
          createdByEmail: 1,
        },
      },
    )
    .batchSize(500);
  for await (const ev of nonRschedCursor) nonRschedDocs.push(ev);

  // Index by content key derived through accessors so older docs index too.
  const byContentKey = new Map();
  for (const ev of nonRschedDocs) {
    const ck = contentKey(getEventTitle(ev), getStartDateTime(ev), getEndDateTime(ev));
    if (!ck) continue;
    if (!byContentKey.has(ck)) byContentKey.set(ck, []);
    byContentKey.get(ck).push(ev);
  }

  // Build the plan.
  const adoptionPlan = []; // { csvRow, mongoDoc }
  const ambiguous = [];    // { csvRow, candidates }
  const noMatch = [];      // CSV rows that will go to the create path

  for (const row of csvRowsResolved) {
    const canonId = `rssched-${row.rsId}`;
    if (existingRsSchedIds.has(canonId)) continue; // pure update path, not adoption

    // Probe content keys in the tolerance window.
    const matched = new Map(); // _id -> doc (dedupe across probe keys)
    for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
      for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
        const ck = contentKey(row.eventTitle, row.startDateTime, row.endDateTime, ds, de);
        if (!ck) continue;
        const docs = byContentKey.get(ck);
        if (!docs) continue;
        for (const d of docs) matched.set(String(d._id), d);
      }
    }

    // Narrow by location overlap. row.locations is set by resolveLocations:
    // an array of { _id, displayName } (see rschedImportService).
    const csvLocIds = new Set(
      (row.locations || [])
        .map((l) => (l && l._id ? String(l._id) : null))
        .filter(Boolean),
    );
    const finalCandidates = [];
    for (const d of matched.values()) {
      // If the CSV row has no resolved locations (note-only or unmatched
      // rsKey), fall back to title+time match alone — no location filter.
      if (csvLocIds.size === 0) {
        finalCandidates.push(d);
        continue;
      }
      // Accessor pulls top-level OR calendarData locations (older docs).
      const docLocIds = getLocationIdStrings(d);
      const hasOverlap = docLocIds.some((l) => csvLocIds.has(l));
      if (hasOverlap) finalCandidates.push(d);
    }

    if (finalCandidates.length === 1) {
      adoptionPlan.push({ row, mongoDoc: finalCandidates[0] });
    } else if (finalCandidates.length > 1) {
      ambiguous.push({ row, candidates: finalCandidates });
    } else {
      noMatch.push(row);
    }
  }

  return {
    existingRsSchedIds,
    adoptionPlan,
    ambiguous,
    noMatch,
    nonRschedTotal: nonRschedDocs.length,
  };
}

async function applyAdoption(db, plan, sessionId) {
  const events = db.collection('templeEvents__Events');
  const audit = db.collection('templeEvents__EventAuditHistory');
  const now = new Date();

  let applied = 0;
  let failed = 0;

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = plan.slice(i, i + BATCH_SIZE);
    for (const { row, mongoDoc } of batch) {
      const newEventId = `rssched-${row.rsId}`;
      try {
        // Atomic adoption write. Rename eventId so the apply pass finds
        // it; reset lastModifiedBy so the human-edit gate is clear; tag
        // source and rschedData so future imports recognize it. Push a
        // statusHistory entry for audit. NOT a status change.
        await conditionalUpdate(
          events,
          { _id: mongoDoc._id },
          {
            $set: {
              eventId: newEventId,
              source: 'rsSched',
              'rschedData.rsId': row.rsId,
              'rschedData.rowNumber': row.rowNumber,
              'rschedData.rsKey': row.rsKeyRaw,
              'rschedData.importSessionId': sessionId,
              'rschedData.importedAt': now,
              'rschedData.adoptedFromEventId': mongoDoc.eventId,
            },
            $push: {
              statusHistory: {
                status: mongoDoc.status || 'published',
                changedAt: now,
                changedBy: IMPORT_USER_ID,
                reason: 'rsched-reconcile adopted by content match',
              },
            },
          },
          { expectedVersion: mongoDoc._version ?? null, modifiedBy: IMPORT_USER_ID },
        );
        await audit.insertOne({
          eventId: newEventId,
          userId: IMPORT_USER_ID,
          changeType: 'rsched-import-update',
          source: 'rsSched Import',
          timestamp: now,
          metadata: {
            importSessionId: sessionId,
            rsId: row.rsId,
            adoption: { previousEventId: mongoDoc.eventId },
          },
        });
        applied++;
      } catch (err) {
        failed++;
        console.warn(
          `\n   adopt failed for rsId=${row.rsId} (_id=${mongoDoc._id}): ${err.message}`,
        );
      }
    }
    printProgress('Adopt', Math.min(i + BATCH_SIZE, plan.length), plan.length);
    if (i + BATCH_SIZE < plan.length) await sleep(BATCH_PAUSE_MS);
  }
  process.stdout.write('\n');
  return { applied, failed };
}

// ────────────────────────────────────────────────────────────────────────
//  Pass 2: Stage + commit (delegates to rschedImportService)
// ────────────────────────────────────────────────────────────────────────

async function stageRows(db, sessionId, calendarId, resolvedRows) {
  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const ctx = {
    sessionId,
    uploadedBy: IMPORT_USER_ID,
    uploadedAt: new Date(),
    calendarOwner: OWNER,
    calendarId,
    csvFilename: CSV_FILE,
    dateRangeStart: FROM,
    dateRangeEnd: TO,
  };
  const docs = resolvedRows.map((r) => rschedImportService.buildStagingDoc(r, ctx));

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await staging.insertMany(batch, { ordered: false });
    printProgress('Stage', Math.min(i + BATCH_SIZE, docs.length), docs.length);
    if (i + BATCH_SIZE < docs.length) await sleep(BATCH_PAUSE_MS);
  }
  process.stdout.write('\n');
  return docs.length;
}

async function commitSession(db, sessionId, calendarId) {
  const staging = db.collection(rschedImportService.STAGING_COLLECTION);
  const eligible = await staging
    .find({
      sessionId,
      status: { $nin: [rschedImportService.STAGING_STATUS.SKIPPED] },
    })
    .toArray();

  const counters = {
    inserted: 0,
    updated: 0,
    noOp: 0,
    humanEditConflicts: 0,
    failed: 0,
    skipped: 0,
  };
  const ctx = {
    sessionId,
    calendarOwner: OWNER,
    calendarId,
    importUserId: IMPORT_USER_ID,
    importUserEmail: IMPORT_USER_EMAIL,
  };
  for (let i = 0; i < eligible.length; i++) {
    const row = eligible[i];
    const outcome = await rschedImportService.applyStagingRow(db, row, ctx);
    const update = {
      appliedEventId: outcome.eventId,
      appliedAt: new Date(),
      applyError: outcome.error || null,
    };
    switch (outcome.outcome) {
      case rschedImportService.APPLY_OUTCOME.INSERTED:
        counters.inserted++;
        update.status = rschedImportService.STAGING_STATUS.APPLIED;
        break;
      case rschedImportService.APPLY_OUTCOME.UPDATED:
        counters.updated++;
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
      printProgress('Commit', i + 1, eligible.length);
    }
  }
  process.stdout.write('\n');
  return counters;
}

// ────────────────────────────────────────────────────────────────────────
//  Pass 3: Soft-delete orphans + test-user docs
// ────────────────────────────────────────────────────────────────────────

async function buildSoftDeletePlan(db, csvRsIds) {
  const events = db.collection('templeEvents__Events');

  const inScope = {
    calendarOwner: OWNER,
    isDeleted: { $ne: true },
    $or: startDateTimeOrFilter(FROM_STR, TO_STR),
  };

  // rsSched orphans: source='rsSched' AND rsId not in CSV.
  const rsSchedOrphans = [];
  const rsCursor = events
    .find(
      { ...inScope, source: 'rsSched' },
      {
        projection: {
          _id: 1,
          eventId: 1,
          _version: 1,
          status: 1,
          'rschedData.rsId': 1,
          eventTitle: 1,
          startDateTime: 1,
        },
      },
    )
    .batchSize(500);
  for await (const e of rsCursor) {
    const rsId = e.rschedData?.rsId;
    if (rsId != null && !csvRsIds.has(Number(rsId))) {
      rsSchedOrphans.push(e);
    }
  }

  // Test-user docs: createdByEmail in list (case-insensitive).
  // Use regex to push the case-folding into Mongo.
  const emailRegex = new RegExp(
    `^(${TEST_USER_EMAILS.map((e) => e.replace(/[.\\]/g, '\\$&')).join('|')})$`,
    'i',
  );
  const testUserDocs = [];
  const tuCursor = events
    .find(
      { ...inScope, createdByEmail: { $regex: emailRegex } },
      {
        projection: {
          _id: 1,
          eventId: 1,
          _version: 1,
          status: 1,
          source: 1,
          createdByEmail: 1,
          eventTitle: 1,
          startDateTime: 1,
        },
      },
    )
    .batchSize(500);
  for await (const e of tuCursor) testUserDocs.push(e);

  // Dedupe (a doc could conceivably appear in both buckets; soft-delete
  // it once, with the orphan reason taking precedence).
  const byId = new Map();
  for (const e of rsSchedOrphans) byId.set(String(e._id), { doc: e, reason: 'rsSched orphan (rsId not in CSV)' });
  for (const e of testUserDocs) {
    const key = String(e._id);
    if (!byId.has(key)) byId.set(key, { doc: e, reason: `test-user created (${e.createdByEmail})` });
  }
  return Array.from(byId.values());
}

async function applySoftDelete(db, plan) {
  const events = db.collection('templeEvents__Events');
  const now = new Date();

  let applied = 0;
  let failed = 0;

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = plan.slice(i, i + BATCH_SIZE);
    for (const { doc, reason } of batch) {
      try {
        await conditionalUpdate(
          events,
          { _id: doc._id },
          {
            $set: {
              status: 'deleted',
              isDeleted: true,
            },
            $push: {
              statusHistory: {
                status: 'deleted',
                changedAt: now,
                changedBy: 'reconcile-script',
                reason: `rsched-reconcile: ${reason}`,
              },
            },
          },
          { expectedVersion: doc._version ?? null, modifiedBy: 'reconcile-script' },
        );
        applied++;
      } catch (err) {
        failed++;
        console.warn(`\n   soft-delete failed for _id=${doc._id}: ${err.message}`);
      }
    }
    printProgress('SoftDelete', Math.min(i + BATCH_SIZE, plan.length), plan.length);
    if (i + BATCH_SIZE < plan.length) await sleep(BATCH_PAUSE_MS);
  }
  process.stdout.write('\n');
  return { applied, failed };
}

// ────────────────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.join(__dirname, 'csv-imports', CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  // Calendar id for the staging context.
  const cfg = loadCalendarConfig();
  const calendarId = resolveCalendarId(OWNER, cfg);
  if (!calendarId) {
    console.error(`No calendarId for ${OWNER} in calendar-config.json`);
    process.exit(1);
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log(' Rsched reconcile (Mongo as source of truth)');
  console.log(`   owner:    ${OWNER}`);
  console.log(`   window:   ${FROM} → ${TO}`);
  console.log(`   csv:      ${CSV_FILE}`);
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   soft-del: ${NO_SOFT_DELETE ? 'SKIPPED' : 'enabled'}`);
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('Parsing CSV...');
  const rawBuffer = fs.readFileSync(csvPath);
  const { buffer, headerInjected, headerNormalized } = ensureCsvHeader(rawBuffer);
  if (headerInjected) console.log('  CSV had no header row — injected canonical header in memory.');
  if (headerNormalized) console.log('  Header column aliases normalized (e.g. LocationCode → rsKey).');
  const { rows: parsed, parseErrors } = await rschedImportService.parseCsv(buffer);
  console.log(`  parsed ${parsed.length} rows (${parseErrors.length} parse errors)`);

  const inScope = parsed.filter(
    (r) => r.startDateTime >= FROM_STR && r.startDateTime <= TO_STR,
  );
  console.log(`  in scope: ${inScope.length}`);
  const csvRsIds = new Set(inScope.map((r) => Number(r.rsId)));

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');
    const locations = db.collection('templeEvents__Locations');

    // Resolve locations on in-scope rows once (needed for adoption's
    // location-overlap filter and for the staging build).
    console.log('Resolving locations...');
    const { rows: resolved } = await rschedImportService.resolveLocations(inScope, locations);
    const locBreakdown = resolved.reduce((acc, r) => {
      acc[r.locationStatus] = (acc[r.locationStatus] || 0) + 1;
      return acc;
    }, {});
    console.log('  location match breakdown:', locBreakdown);

    // PASS 1 — Adoption plan
    console.log('\nBuilding adoption plan...');
    const plan1 = await buildAdoptionPlan(db, events, resolved);
    console.log(`  existing rsSched in scope:      ${plan1.existingRsSchedIds.size}`);
    console.log(`  non-rsSched in scope:           ${plan1.nonRschedTotal}`);
    console.log(`  CSV rows w/ adopt candidate:    ${plan1.adoptionPlan.length}`);
    console.log(`  CSV rows w/ ambiguous match:    ${plan1.ambiguous.length}`);
    console.log(`  CSV rows w/ no Mongo match:     ${plan1.noMatch.length}`);

    // PASS 3 — Soft-delete plan (build now; print summary; apply at the end)
    const plan3 = NO_SOFT_DELETE ? [] : await buildSoftDeletePlan(db, csvRsIds);
    if (!NO_SOFT_DELETE) {
      console.log(`\nSoft-delete plan:                  ${plan3.length}`);
      const rsschedReasons = plan3.filter((p) => p.reason.startsWith('rsSched orphan')).length;
      const testUserReasons = plan3.length - rsschedReasons;
      console.log(`  rsSched orphans:                ${rsschedReasons}`);
      console.log(`  test-user docs:                 ${testUserReasons}`);
    }

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] No writes. Re-run without --dry-run to apply.');
      return;
    }

    // ── WRITES BEGIN ──
    const sessionId = `reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`\nSession id: ${sessionId}`);

    // Pass 1 apply
    if (plan1.adoptionPlan.length > 0) {
      console.log('\nApplying adoption...');
      const r1 = await applyAdoption(db, plan1.adoptionPlan, sessionId);
      console.log(`  adopted: ${r1.applied}  failed: ${r1.failed}`);
    } else {
      console.log('\nNo events to adopt.');
    }

    // Pass 2 stage + commit
    console.log('\nStaging CSV rows...');
    await stageRows(db, sessionId, calendarId, resolved);

    console.log('Committing staged rows...');
    const counters = await commitSession(db, sessionId, calendarId);
    console.log('  commit:', counters);

    // Pass 3 soft-delete
    if (!NO_SOFT_DELETE && plan3.length > 0) {
      console.log('\nApplying soft-delete...');
      const r3 = await applySoftDelete(db, plan3);
      console.log(`  soft-deleted: ${r3.applied}  failed: ${r3.failed}`);
    }

    console.log('\nReconcile complete.');
    console.log('Next: node link-mongo-to-graph.js with the same --owner/--from/--to.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});

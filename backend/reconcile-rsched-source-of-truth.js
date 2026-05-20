/**
 * Phase 2 of the Rsched reconciliation — make Mongo match CSV (content-as-primary-key).
 *
 * Algorithm summary (matches audit-rsched-reconcile.js exactly):
 *   1. Parse CSV + resolve locations.
 *   2. Load all in-scope Mongo docs for calendarOwner.
 *   3. Build content-key index (title + start minute + end minute).
 *   4. For each CSV row: probe ±1 min combinations. Tie-break multi-match by
 *      location overlap, then by rsId equality.
 *      - 0 matches → CREATE
 *      - 1 match  → UPDATE (refresh fields + relink rsId if different)
 *      - >1       → AMBIGUOUS (apply rsId tie-break; if still >1, skip)
 *   5. Fetch Outlook calendarView for the same window.
 *   6. Classify unmatched Mongo docs into A/B/C/D/E (per audit).
 *   7. --dry-run prints plan and exits.
 *   8. Apply: update matched, insert new, soft-delete A/C/D, refresh B.
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
const graphApiService = require('./services/graphApiService');
const { conditionalUpdate } = require('./utils/concurrencyUtils');
const { retryWithBackoff } = require('./utils/retryWithBackoff');
const { ensureCsvHeader } = require('./utils/rschedCsvShim');
const {
  getStartDateTime,
  getEndDateTime,
  getEventTitle,
  getLocationIdStrings,
  startDateTimeOrFilter,
} = require('./utils/eventFieldAccessors');

const DEFAULT_CSV = 'rsched_all_asof_5_8_2026.csv';
const TIME_TOLERANCE_MINUTES = 1;
const BATCH_SIZE = 25;       // lowered from 100: keeps per-second Cosmos RU bursts
                             // (and the retryWithBackoff circuit breaker) calm on
                             // low-RU containers. Re-runs are idempotent, so a
                             // smaller batch only costs wall-clock time.
const BATCH_PAUSE_MS = 1000;

// Per-row retry policy for Cosmos 429s (Error 16500). retryWithBackoff honors the
// server's RetryAfterMs and is bounded (maxAttempts), so a throttled write waits
// the exact recommended delay instead of being skipped — and can't retry forever.
const RETRY_OPTS = {
  maxAttempts: 8,
  initialDelayMs: 500,
  onRetry: ({ attempt, delay, error, maxAttempts }) =>
    console.warn(`   [429 backoff] attempt ${attempt}/${maxAttempts}, waiting ${delay}ms — ${String(error.message).split(';')[0]}`),
};
const CALENDAR_TIMEZONE = 'Eastern Standard Time';

const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';
const IMPORT_USER_EMAIL = 'rsched-import-cli@emanuelnyc.org';

const TEST_USER_EMAILS = new Set([
  'testuser1@emanuelnyc.org',
  'test.user1@emanuelnyc.org',
  'stephen.fang@emanuelnyc.org',
  'rrogers@emanuelnyc.org',
]);
const TEST_USER_PATTERN = /^test\.?user\d+@emanuelnyc\.org$/i;
function isTestUserEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase();
  if (TEST_USER_EMAILS.has(e)) return true;
  if (TEST_USER_PATTERN.test(e)) return true;
  if (e.endsWith('@test.com')) return true;
  return false;
}

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
const PUBLISH = hasFlag('publish');
const LINK = hasFlag('link');
const CHUNK_BY = (getArg('chunk-by') || '').toLowerCase() || null; // 'month' | 'week' | null
if (CHUNK_BY && CHUNK_BY !== 'month' && CHUNK_BY !== 'week') {
  console.error(`Invalid --chunk-by value: ${CHUNK_BY}. Use 'month' or 'week'.`);
  process.exit(1);
}

function usage(code = 1) {
  console.log(
    'Usage: node reconcile-rsched-source-of-truth.js \\\n' +
      '         --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD \\\n' +
      '         [--file=<csv>] [--dry-run] [--no-soft-delete] [--link] [--publish] [--chunk-by=month|week]\n' +
      `\nDefault --file is ${DEFAULT_CSV}.\n` +
      '\n--dry-run        prints the plan without writing.\n' +
      '--no-soft-delete skips the soft-delete pass for buckets A/C/D.\n' +
      '--link           after Mongo writes, find existing Outlook events by content match\n' +
      '                 (title + start ±1 min + end ±1 min) and populate graphData.id +\n' +
      '                 calendarId on each touched doc. Does NOT create or modify Outlook.\n' +
      '--publish        after the link pass (if also set), push inserts (create new Outlook\n' +
      '                 events for any still-unlinked docs) and material-changed updates.\n' +
      '--chunk-by=month split the --from..--to range into per-month chunks and process each\n' +
      '                 sequentially (recommended for windows > 1 month to avoid Graph throttling).\n' +
      '                 Use "week" for 7-day chunks. Per-chunk failure does NOT abort the loop.\n',
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
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && k.toLowerCase() === owner) return v;
  }
  return null;
}

// Content-key helpers — MUST stay in sync with audit-rsched-reconcile.js.
function minuteKey(dt) {
  return dt && typeof dt === 'string' ? dt.slice(0, 16) : '';
}
function addMinutesToMinuteKey(mk, deltaMin) {
  if (!mk) return '';
  const [datePart, timePart] = mk.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, m] = timePart.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, m + deltaMin);
  const pad2 = (n) => String(n).padStart(2, '0');
  return (
    `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T` +
    `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
  );
}
function normalizeTitle(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function contentKey(title, startDt, endDt, sShift = 0, eShift = 0) {
  const t = normalizeTitle(title);
  if (!t) return null;
  const s = addMinutesToMinuteKey(minuteKey(startDt), sShift);
  const e = addMinutesToMinuteKey(minuteKey(endDt), eShift);
  return `${t}|${s}|${e}`;
}

function pad(s, n) {
  const str = String(s ?? '');
  return str + ' '.repeat(Math.max(0, n - str.length));
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function printProgress(label, done, total) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  process.stdout.write(`\r   [${label}] ${pct}% (${done}/${total})`);
}

// Fetch the real id of the user's DEFAULT calendar. This is the value we
// use as `calendarId` on every reconciled doc — it's unique per owner (so
// the (userId, calendarId, eventId) composite unique index doesn't trip),
// it's the actual store where templeeventssandbox/templeevents events live
// (we verified via calendarView earlier), and Graph URLs built with it work.
async function fetchDefaultCalendarId(owner) {
  const path = `/users/${encodeURIComponent(owner)}/calendar?$select=id,name`;
  const data = await graphApiService.graphRequest(path);
  return data?.id || null;
}

async function fetchGraphCalendarView(owner, calendarIdHint, fromIso, toIso) {
  const headers = { Prefer: `outlook.timezone="${CALENDAR_TIMEZONE}"` };
  const basePath = `/users/${encodeURIComponent(owner)}`;
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $top: '250',
    $select: 'id,subject,start,end,iCalUId,seriesMasterId,type,recurrence,isCancelled,body,location,locations,categories,organizer',
  });
  const candidates = [{ label: 'default', path: `${basePath}/calendar/calendarView` }];
  if (calendarIdHint) {
    candidates.push({ label: 'config-id', path: `${basePath}/calendars/${calendarIdHint}/calendarView` });
  }
  let lastErr = null;
  for (const c of candidates) {
    try {
      let nextLink = `${c.path}?${params}`;
      let all = [];
      while (nextLink) {
        const data = await graphApiService.graphRequest(nextLink, { headers });
        all = all.concat(data.value || []);
        nextLink = data['@odata.nextLink'] || null;
      }
      if (all.length > 0 || c.label === 'default') {
        return { events: all, calendarUsed: c.label };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { events: [], calendarUsed: 'none' };
}

function isGraphEventRecurring(g) {
  if (!g) return false;
  if (g.seriesMasterId) return true;
  if (g.type === 'occurrence' || g.type === 'seriesMaster' || g.type === 'exception') return true;
  if (g.recurrence) return true;
  return false;
}

// ── Match CSV row → Mongo doc ─────────────────────────────────────────────
function findMatchForCsvRow(row, byContentKey) {
  const matched = new Map();
  for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
    for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
      const ck = contentKey(row.eventTitle, row.startDateTime, row.endDateTime, ds, de);
      if (!ck) continue;
      const docs = byContentKey.get(ck);
      if (!docs) continue;
      for (const d of docs) matched.set(String(d._id), d);
    }
  }
  let candidates = Array.from(matched.values());

  // Tie-break 1: location overlap.
  if (candidates.length > 1) {
    const csvLocIds = new Set(
      (row.locationIds || row.locations || [])
        .map((l) => (l && l._id ? String(l._id) : l && l.$oid ? String(l.$oid) : typeof l === 'string' ? l : null))
        .filter(Boolean),
    );
    if (csvLocIds.size > 0) {
      const narrowed = candidates.filter((d) => {
        const docLocs = getLocationIdStrings(d);
        return docLocs.some((l) => csvLocIds.has(l));
      });
      if (narrowed.length > 0) candidates = narrowed;
    }
  }

  // Tie-break 2: rsId equality. Handles the Religious School duplicates case.
  if (candidates.length > 1) {
    const exactRsId = candidates.filter(
      (d) => Number(d.rschedData?.rsId) === Number(row.rsId),
    );
    if (exactRsId.length === 1) candidates = exactRsId;
  }

  return candidates;
}

// ── Apply UPDATE: refresh a matched doc with CSV data ─────────────────────
async function applyUpdate(eventsCollection, csvRow, mongoDoc, sessionId, opts = {}) {
  const newEventId = `rssched-${csvRow.rsId}`;
  const now = new Date();
  const reasonSuffix = opts.rsIdReused
    ? ' (rsId-reuse: existing doc had a different date — moved here)'
    : '';
  const targetCalendarId = opts.targetCalendarId || null;
  const locationIds = (csvRow.locationIds || [])
    .map((id) => {
      try { return new ObjectId(String(id)); } catch (_) { return null; }
    })
    .filter(Boolean);

  // Build the field set we want to refresh. Keep graphData, _id,
  // createdAt, createdBy intact. Update top-level AND calendarData.
  // calendarId comes from the real default-calendar lookup at startup —
  // different per owner so the composite unique index (userId, calendarId,
  // eventId) doesn't collide across owners, AND Graph URLs built with it
  // hit the actual store where the events live.
  const $set = {
    eventId: newEventId,
    source: 'rsSched',
    isDeleted: false,
    calendarId: targetCalendarId,
    eventTitle: csvRow.eventTitle,
    eventDescription: csvRow.eventDescription || '',
    startDateTime: csvRow.startDateTime,
    endDateTime: csvRow.endDateTime,
    startDate: csvRow.startDate,
    endDate: csvRow.endDate,
    startTime: csvRow.startTime,
    endTime: csvRow.endTime,
    isAllDayEvent: !!csvRow.isAllDay,
    locations: locationIds,
    locationDisplayNames: csvRow.locationDisplayNames || '',
    categories: csvRow.categories || [],
    'calendarData.eventTitle': csvRow.eventTitle,
    'calendarData.eventDescription': csvRow.eventDescription || '',
    'calendarData.startDateTime': csvRow.startDateTime,
    'calendarData.endDateTime': csvRow.endDateTime,
    'calendarData.startDate': csvRow.startDate,
    'calendarData.endDate': csvRow.endDate,
    'calendarData.startTime': csvRow.startTime,
    'calendarData.endTime': csvRow.endTime,
    'calendarData.isAllDay': !!csvRow.isAllDay,
    'calendarData.locations': locationIds,
    'calendarData.locationDisplayNames': csvRow.locationDisplayNames || '',
    'calendarData.categories': csvRow.categories || [],
    // Reservation times default to the event start/end so room conflicts
    // and door-open/close logic have non-empty values to work from.
    'calendarData.reservationStartTime': csvRow.startTime,
    'calendarData.reservationEndTime': csvRow.endTime,
    'calendarData.setupTime': csvRow.startTime,
    'calendarData.doorOpenTime': csvRow.startTime,
    'calendarData.doorCloseTime': csvRow.endTime,
    'rschedData.rsId': csvRow.rsId,
    'rschedData.rowNumber': csvRow.rowNumber,
    'rschedData.rsKey': csvRow.rsKeyRaw || '',
    'rschedData.importSessionId': sessionId,
    'rschedData.importedAt': now,
  };
  // Reset lastModifiedBy so future runs aren't blocked by the human-edit gate.
  const $push = {
    statusHistory: {
      status: mongoDoc.status || 'published',
      changedAt: now,
      changedBy: IMPORT_USER_ID,
      reason: `rsched-reconcile content-match update${reasonSuffix}`,
    },
  };

  // Skip OCC (expectedVersion: null). Reconcile is the single authoritative
  // writer during its run; the 409 errors we'd otherwise hit come from our
  // OWN earlier writes within the same run (e.g. duplicate-content CSV rows
  // pointing at the same Mongo doc), not from genuine concurrent user edits.
  await conditionalUpdate(
    eventsCollection,
    { _id: mongoDoc._id },
    { $set, $push },
    { expectedVersion: null, modifiedBy: IMPORT_USER_ID },
  );
}

// ── Apply INSERT: create a new doc from a CSV row ─────────────────────────
// Returns { outcome: 'inserted' | 'updated-collision', doc }.
// If a Mongo doc with the same eventId already exists (rsId-reuse), this
// routes to applyUpdate on that doc instead of insertOne — which would
// otherwise hit E11000 against the unique index on eventId.
async function applyInsert(eventsCollection, csvRow, sessionId, calendarId) {
  const newEventId = `rssched-${csvRow.rsId}`;
  // Scope by calendarOwner — the same rssched-{rsId} eventId can legitimately
  // exist on multiple calendars (e.g. sandbox and production both processed
  // the same Rsched row). Without this scope, a production run finds the
  // sandbox doc, treats it as a collision, and skips inserting the prod doc.
  const collision = await eventsCollection.findOne(
    { eventId: newEventId, calendarOwner: OWNER },
    { projection: { _id: 1, _version: 1, status: 1, graphData: 1, eventId: 1 } },
  );
  if (collision) {
    await applyUpdate(eventsCollection, csvRow, collision, sessionId, { rsIdReused: true, targetCalendarId: calendarId });
    // Re-fetch the just-updated doc so the publish pass can act on the
    // current state (with the new content from CSV).
    const updated = await eventsCollection.findOne({ _id: collision._id });
    return { outcome: 'updated-collision', doc: updated };
  }

  // Normal insert path.
  const stagingRow = {
    rsId: csvRow.rsId,
    rowNumber: csvRow.rowNumber,
    rawCsv: csvRow.rawCsv,
    eventTitle: csvRow.eventTitle,
    eventDescription: csvRow.eventDescription || '',
    categories: csvRow.categories || [],
    startDate: csvRow.startDate,
    endDate: csvRow.endDate,
    startTime: csvRow.startTime,
    endTime: csvRow.endTime,
    startDateTime: csvRow.startDateTime,
    endDateTime: csvRow.endDateTime,
    isAllDay: !!csvRow.isAllDay,
    locationIds: csvRow.locationIds || [],
    locationDisplayNames: csvRow.locationDisplayNames || '',
    rsKey: csvRow.rsKeyRaw || '',
    requesterEmail: csvRow.requesterEmail || '',
    requesterName: csvRow.requesterName || '',
    calendarOwner: OWNER,
    calendarId,
  };
  const doc = rschedImportService.buildEventDocFromStaging(stagingRow, {
    calendarOwner: OWNER,
    calendarId,
    importUserId: IMPORT_USER_ID,
    importUserEmail: IMPORT_USER_EMAIL,
    sessionId,
  });
  // calendarId is set by buildEventDocFromStaging from the ctx we passed in
  // — which is the real default-calendar id for this owner. Keep it intact;
  // it's the working value for both the unique index and Graph URLs.

  // buildEventDocFromStaging populates numeric reservation*Minutes fields
  // but NOT the string time fields that legacy docs use for display and
  // for the room-conflict checker. Fill in defaults = event start/end.
  if (doc.calendarData) {
    doc.calendarData.reservationStartTime = csvRow.startTime;
    doc.calendarData.reservationEndTime = csvRow.endTime;
    doc.calendarData.setupTime = csvRow.startTime;
    doc.calendarData.doorOpenTime = csvRow.startTime;
    doc.calendarData.doorCloseTime = csvRow.endTime;
  }

  await eventsCollection.insertOne(doc);
  return { outcome: 'inserted', doc };
}

// ── Material-change detector for the publish pass ─────────────────────────
// Compares the current Mongo doc's authoritative fields against the cached
// graphData. If any of (subject, start.dateTime, end.dateTime, location
// displayName) differ, we need to push to Outlook. Otherwise the cached
// graphData already matches what's in Mongo and we can skip the Graph call.
function hasMaterialChangeVsGraph(doc) {
  const g = doc.graphData;
  if (!g) return true; // no cache → must publish
  const docTitle = (getEventTitle(doc) || '').trim();
  const gTitle = (g.subject || '').trim();
  if (docTitle !== gTitle) return true;
  const docStart = getStartDateTime(doc);
  const gStart = g.start?.dateTime;
  if ((docStart || '').slice(0, 16) !== (gStart || '').slice(0, 16)) return true;
  const docEnd = getEndDateTime(doc);
  const gEnd = g.end?.dateTime;
  if ((docEnd || '').slice(0, 16) !== (gEnd || '').slice(0, 16)) return true;
  const docLocDisp = (doc.locationDisplayNames || doc.calendarData?.locationDisplayNames || '').trim();
  const gLocDisp = (g.location?.displayName || '').trim();
  if (docLocDisp !== gLocDisp) return true;
  return false;
}

// ── Apply SOFT-DELETE ─────────────────────────────────────────────────────
async function applySoftDelete(eventsCollection, doc, reason) {
  const now = new Date();
  // Skip OCC — same reasoning as applyUpdate. Reconcile owns these writes.
  await conditionalUpdate(
    eventsCollection,
    { _id: doc._id },
    {
      $set: { status: 'deleted', isDeleted: true },
      $push: {
        statusHistory: {
          status: 'deleted',
          changedAt: now,
          changedBy: 'reconcile-script',
          reason: `rsched-reconcile: ${reason}`,
        },
      },
    },
    { expectedVersion: null, modifiedBy: 'reconcile-script' },
  );
}

// ── Apply Bucket B REFRESH (graphData from Outlook) ───────────────────────
async function applyRefreshFromOutlook(eventsCollection, doc, graphEvent) {
  await conditionalUpdate(
    eventsCollection,
    { _id: doc._id },
    {
      $set: {
        graphData: graphEvent,
        eventTitle: graphEvent.subject,
        startDateTime: graphEvent.start?.dateTime,
        endDateTime: graphEvent.end?.dateTime,
        'calendarData.eventTitle': graphEvent.subject,
        'calendarData.startDateTime': graphEvent.start?.dateTime,
        'calendarData.endDateTime': graphEvent.end?.dateTime,
        lastSyncedAt: new Date(),
      },
    },
    { expectedVersion: doc._version ?? null, modifiedBy: 'reconcile-script' },
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
// ── Chunking helpers ──────────────────────────────────────────────────────
// Walk consecutive [from, to] windows between two YYYY-MM-DD dates,
// splitting on calendar months or 7-day weeks. Both boundaries inclusive.
function ymdToParts(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}
function partsToYmd({ y, m, d }) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}
function lastDayOfMonth(y, m) {
  // m is 1-12. Use Date(y, m, 0) — JS Date months are 0-11; passing m gives
  // first day of next month; day 0 rolls back to last day of given month.
  return new Date(y, m, 0).getDate();
}
function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`); // noon UTC to avoid DST edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function computeChunks(fromYmd, toYmd, unit) {
  const out = [];
  if (unit === 'month') {
    let cursor = fromYmd;
    while (cursor <= toYmd) {
      const { y, m } = ymdToParts(cursor);
      const endOfMonth = partsToYmd({ y, m, d: lastDayOfMonth(y, m) });
      const chunkTo = endOfMonth < toYmd ? endOfMonth : toYmd;
      out.push({ from: cursor, to: chunkTo });
      if (chunkTo === toYmd) break;
      cursor = addDaysYmd(chunkTo, 1);
    }
  } else if (unit === 'week') {
    let cursor = fromYmd;
    while (cursor <= toYmd) {
      const candidate = addDaysYmd(cursor, 6);
      const chunkTo = candidate < toYmd ? candidate : toYmd;
      out.push({ from: cursor, to: chunkTo });
      if (chunkTo === toYmd) break;
      cursor = addDaysYmd(chunkTo, 1);
    }
  } else {
    out.push({ from: fromYmd, to: toYmd });
  }
  return out;
}
function printAggregateSummary(chunkResults) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(` Aggregate summary across ${chunkResults.length} chunk(s)`);
  console.log('════════════════════════════════════════════════════════════');
  let totalInserted = 0, totalUpdated = 0, totalSoftDeleted = 0, totalLinked = 0, totalPublishedNew = 0, totalPublishedUpdate = 0;
  const failed = [];
  for (const r of chunkResults) {
    if (r.error) {
      failed.push(r.chunk);
      console.log(`  ${r.chunk.from} → ${r.chunk.to}: FAILED — ${r.error}`);
      continue;
    }
    const s = r.summary || {};
    totalInserted += s.inserted || 0;
    totalUpdated += s.updated || 0;
    totalSoftDeleted += s.softDeleted || 0;
    totalLinked += s.linked || 0;
    totalPublishedNew += s.publishedNew || 0;
    totalPublishedUpdate += s.publishedUpdate || 0;
    console.log(`  ${r.chunk.from} → ${r.chunk.to}: inserted=${s.inserted || 0} updated=${s.updated || 0} soft-deleted=${s.softDeleted || 0} linked=${s.linked || 0} published-new=${s.publishedNew || 0} published-update=${s.publishedUpdate || 0}`);
  }
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  TOTAL: inserted=${totalInserted} updated=${totalUpdated} soft-deleted=${totalSoftDeleted} linked=${totalLinked} published-new=${totalPublishedNew} published-update=${totalPublishedUpdate}`);
  if (failed.length > 0) {
    console.log(`\n  ${failed.length} chunk(s) failed — re-run individually:`);
    for (const c of failed) {
      console.log(`    --from=${c.from} --to=${c.to}`);
    }
  }
  console.log('════════════════════════════════════════════════════════════\n');
}

async function main() {
  const csvPath = path.join(__dirname, 'csv-imports', CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  // Resolve calendarId. The calendar-config.json value 404s on Graph for
  // templeeventssandbox — fetch the real default-calendar id at startup
  // and use that. Falls back to config'd value if the Graph lookup fails.
  let calendarId = null;
  try {
    calendarId = await fetchDefaultCalendarId(OWNER);
    if (calendarId) console.log(`Resolved default calendar id for ${OWNER}: ${calendarId.slice(0, 24)}...`);
  } catch (err) {
    console.warn(`Failed to fetch default calendar id: ${err.message}`);
  }
  if (!calendarId) {
    const cfg = loadCalendarConfig();
    calendarId = resolveCalendarId(OWNER, cfg);
    if (calendarId) console.log(`Falling back to calendar-config.json value: ${calendarId.slice(0, 24)}...`);
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log(' Rsched reconcile (content-as-primary-key)');
  console.log(`   owner:    ${OWNER}`);
  console.log(`   window:   ${FROM} → ${TO}`);
  console.log(`   csv:      ${CSV_FILE}`);
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   soft-del: ${NO_SOFT_DELETE ? 'SKIPPED' : 'enabled'}`);
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('Parsing CSV...');
  const rawBuffer = fs.readFileSync(csvPath);
  const { buffer, headerInjected, headerNormalized } = ensureCsvHeader(rawBuffer);
  if (headerInjected) console.log('  CSV had no header row — injected canonical header.');
  if (headerNormalized) console.log('  Header column aliases normalized.');
  const { rows: parsed, parseErrors } = await rschedImportService.parseCsv(buffer);
  console.log(`  parsed ${parsed.length} rows (${parseErrors.length} parse errors)`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');
    const locations = db.collection('templeEvents__Locations');

    // ── Compute chunks ──────────────────────────────────────────────
    const chunks = computeChunks(FROM, TO, CHUNK_BY);
    if (chunks.length > 1) {
      console.log(`\nChunking by ${CHUNK_BY}: ${chunks.length} chunks total.`);
    }
    const chunkResults = [];

    for (let __ci = 0; __ci < chunks.length; __ci++) {
      const __chunk = chunks[__ci];
      const windowFrom = __chunk.from;
      const windowTo = __chunk.to;
      const windowFromStr = `${windowFrom}T00:00:00`;
      const windowToStr = `${windowTo}T23:59:59`;
      const summary = { inserted: 0, updated: 0, softDeleted: 0, linked: 0, publishedNew: 0, publishedUpdate: 0 };

      if (chunks.length > 1) {
        console.log(`\n══════ Chunk ${__ci + 1}/${chunks.length}: ${windowFrom} → ${windowTo} ══════`);
      }

      try {
        const inScope = parsed.filter(
          (r) => r.startDateTime >= windowFromStr && r.startDateTime <= windowToStr,
        );
        console.log(`  CSV rows in chunk: ${inScope.length}`);

        console.log('Resolving CSV locations...');
        const { rows: resolved } = await rschedImportService.resolveLocations(inScope, locations);

    console.log('Loading Mongo docs in scope...');
    const mongoDocs = await events
      .find(
        {
          calendarOwner: OWNER,
          isDeleted: { $ne: true },
          $or: startDateTimeOrFilter(windowFromStr, windowToStr),
        },
        {
          projection: {
            _id: 1, eventId: 1, _version: 1, source: 1, status: 1,
            createdBy: 1, createdByEmail: 1,
            'graphData.id': 1, 'graphData.start.dateTime': 1, 'graphData.end.dateTime': 1, 'graphData.subject': 1,
            'rschedData.rsId': 1,
            eventTitle: 1, startDateTime: 1, endDateTime: 1, locations: 1,
            'calendarData.eventTitle': 1, 'calendarData.startDateTime': 1, 'calendarData.endDateTime': 1, 'calendarData.locations': 1,
          },
        },
      )
      .batchSize(500)
      .toArray();
    console.log(`  ${mongoDocs.length} Mongo docs in scope`);

    // Build content-key index on Mongo docs.
    const byContentKey = new Map();
    for (const ev of mongoDocs) {
      const ck = contentKey(getEventTitle(ev), getStartDateTime(ev), getEndDateTime(ev));
      if (!ck) continue;
      if (!byContentKey.has(ck)) byContentKey.set(ck, []);
      byContentKey.get(ck).push(ev);
    }

    // Match CSV → Mongo.
    const matchedMongoIds = new Set();
    const plan = { create: [], update: [], ambiguous: [] };
    for (const row of resolved) {
      const candidates = findMatchForCsvRow(row, byContentKey);
      if (candidates.length === 0) plan.create.push(row);
      else if (candidates.length === 1) {
        plan.update.push({ row, doc: candidates[0] });
        matchedMongoIds.add(String(candidates[0]._id));
      } else {
        plan.ambiguous.push({ row, candidates });
      }
    }

    // Walk unmatched Mongo docs.
    const nonTestUnmatched = [];
    const bucketA = [];
    for (const ev of mongoDocs) {
      if (matchedMongoIds.has(String(ev._id))) continue;
      if (isTestUserEmail(ev.createdByEmail)) bucketA.push(ev);
      else nonTestUnmatched.push(ev);
    }

    // Outlook fetch — needed for bucket classification of unmatched docs
    // AND for the --link pass (when set) to find existing Outlook events
    // even when nothing is unmatched on the Mongo side.
    let graphEvents = [];
    let graphCalendarUsed = null;
    let graphFetchError = null;
    if (nonTestUnmatched.length > 0 || LINK) {
      try {
        console.log(`Fetching Outlook calendarView...`);
        const result = await fetchGraphCalendarView(OWNER, calendarId, `${windowFrom}T00:00:00Z`, `${windowTo}T23:59:59Z`);
        graphEvents = result.events;
        graphCalendarUsed = result.calendarUsed;
        console.log(`  ${graphEvents.length} Outlook events fetched (calendar=${graphCalendarUsed})`);
      } catch (err) {
        graphFetchError = err.message;
        console.warn(`  Outlook fetch failed: ${err.message}`);
      }
    }
    const graphById = new Map();
    const graphByContentKey = new Map();
    for (const g of graphEvents) {
      if (g.id) graphById.set(g.id, g);
      const ck = contentKey(g.subject, g.start?.dateTime, g.end?.dateTime);
      if (ck) {
        if (!graphByContentKey.has(ck)) graphByContentKey.set(ck, []);
        graphByContentKey.get(ck).push(g);
      }
    }

    // Classify non-test unmatched.
    const bucketB = []; // protect + refresh
    const bucketC = []; // soft-delete
    const bucketD = []; // soft-delete
    const bucketE = []; // protect
    for (const ev of nonTestUnmatched) {
      const gid = ev.graphData?.id;
      let matchedGraph = null;
      if (gid && graphById.has(gid)) matchedGraph = graphById.get(gid);
      else {
        for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
          for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
            const ck = contentKey(getEventTitle(ev), getStartDateTime(ev), getEndDateTime(ev), ds, de);
            if (!ck) continue;
            const hits = graphByContentKey.get(ck);
            if (hits && hits.length === 1) { matchedGraph = hits[0]; break; }
          }
          if (matchedGraph) break;
        }
      }
      if (matchedGraph) {
        if (isGraphEventRecurring(matchedGraph)) bucketB.push({ doc: ev, graph: matchedGraph });
        else bucketC.push({ doc: ev, graph: matchedGraph });
      } else if (gid) bucketD.push(ev);
      else bucketE.push(ev);
    }

    // ── Plan summary ──
    console.log('\n────────────────────────────────────────────────────────────');
    console.log(' Reconcile plan');
    console.log('────────────────────────────────────────────────────────────');
    console.log(`   CREATE new Mongo docs:           ${plan.create.length}`);
    console.log(`   UPDATE matched docs:             ${plan.update.length}`);
    console.log(`   AMBIGUOUS (skip):                ${plan.ambiguous.length}`);
    console.log(`   ── unmatched-from-CSV ──`);
    console.log(`   A: test-user        soft-delete  ${bucketA.length}${NO_SOFT_DELETE ? ' [SKIPPED]' : ''}`);
    console.log(`   B: recurring        protect+refresh ${bucketB.length}`);
    console.log(`   C: single-outlook   soft-delete  ${bucketC.length}${NO_SOFT_DELETE ? ' [SKIPPED]' : ''}`);
    console.log(`   D: outlook-deleted  soft-delete  ${bucketD.length}${NO_SOFT_DELETE ? ' [SKIPPED]' : ''}`);
    console.log(`   E: uncertain        protect      ${bucketE.length}`);
    console.log('────────────────────────────────────────────────────────────');

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] No writes. Re-run without --dry-run to apply.');
      return;
    }

    // ── Apply ──
    const sessionId = `reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`\nSession id: ${sessionId}\n`);

    // UPDATE
    if (plan.update.length > 0) {
      console.log('Applying updates...');
      let done = 0, failed = 0;
      for (let i = 0; i < plan.update.length; i += BATCH_SIZE) {
        const batch = plan.update.slice(i, i + BATCH_SIZE);
        for (const { row, doc } of batch) {
          try { await retryWithBackoff(() => applyUpdate(events, row, doc, sessionId, { targetCalendarId: calendarId }), RETRY_OPTS); done++; }
          catch (err) { failed++; console.warn(`\n   update failed _id=${doc._id}: ${err.message}`); }
        }
        printProgress('Update', Math.min(i + BATCH_SIZE, plan.update.length), plan.update.length);
        if (i + BATCH_SIZE < plan.update.length) await sleep(BATCH_PAUSE_MS);
      }
      process.stdout.write(`\n   updated: ${done}  failed: ${failed}\n`);
    }

    // INSERT (with eventId-collision fallback to UPDATE).
    // Track the _ids touched by either INSERT or UPDATE so the publish
    // pass below can act on the resulting docs.
    const touchedIds = new Set();
    for (const { doc } of plan.update) touchedIds.add(String(doc._id));

    if (plan.create.length > 0) {
      console.log('Applying inserts...');
      let inserted = 0, collisionsRedirected = 0, failed = 0;
      for (let i = 0; i < plan.create.length; i += BATCH_SIZE) {
        const batch = plan.create.slice(i, i + BATCH_SIZE);
        for (const row of batch) {
          try {
            const r = await retryWithBackoff(() => applyInsert(events, row, sessionId, calendarId), RETRY_OPTS);
            if (r.outcome === 'inserted') inserted++;
            else if (r.outcome === 'updated-collision') collisionsRedirected++;
            if (r.doc?._id) touchedIds.add(String(r.doc._id));
          } catch (err) {
            failed++;
            console.warn(`\n   insert failed rsId=${row.rsId}: ${err.message}`);
          }
        }
        printProgress('Insert', Math.min(i + BATCH_SIZE, plan.create.length), plan.create.length);
        if (i + BATCH_SIZE < plan.create.length) await sleep(BATCH_PAUSE_MS);
      }
      process.stdout.write(`\n   inserted: ${inserted}  rsId-collisions routed to update: ${collisionsRedirected}  failed: ${failed}\n`);
    }

    // SOFT-DELETE A, C, D
    if (!NO_SOFT_DELETE) {
      // Exclude docs that were touched by UPDATE or INSERT-collision routing.
      // Those docs were repurposed (their content/rsId/eventId reflect a new
      // CSV row) and should NOT be soft-deleted even if they were in the
      // initial bucket classification.
      const isTouched = (doc) => touchedIds.has(String(doc._id));
      const sdPlan = [
        ...bucketA.filter((doc) => !isTouched(doc)).map((doc) => ({ doc, reason: `test-user (${doc.createdByEmail || 'unknown'})` })),
        ...bucketC.filter((x) => !isTouched(x.doc)).map((x) => ({ doc: x.doc, reason: 'single in Outlook, not in CSV' })),
        ...bucketD.filter((doc) => !isTouched(doc)).map((doc) => ({ doc, reason: 'had graphId, Outlook returned nothing' })),
      ];
      const skippedCount = bucketA.length + bucketC.length + bucketD.length - sdPlan.length;
      if (skippedCount > 0) {
        console.log(`Soft-delete: skipped ${skippedCount} docs that were repurposed by UPDATE/INSERT-collision routing.`);
      }
      if (sdPlan.length > 0) {
        console.log('Applying soft-deletes...');
        let done = 0, failed = 0;
        for (let i = 0; i < sdPlan.length; i += BATCH_SIZE) {
          const batch = sdPlan.slice(i, i + BATCH_SIZE);
          for (const { doc, reason } of batch) {
            try { await retryWithBackoff(() => applySoftDelete(events, doc, reason), RETRY_OPTS); done++; }
            catch (err) { failed++; console.warn(`\n   soft-delete failed _id=${doc._id}: ${err.message}`); }
          }
          printProgress('SoftDelete', Math.min(i + BATCH_SIZE, sdPlan.length), sdPlan.length);
          if (i + BATCH_SIZE < sdPlan.length) await sleep(BATCH_PAUSE_MS);
        }
        process.stdout.write(`\n   soft-deleted: ${done}  failed: ${failed}\n`);
      }
    }

    // REFRESH B
    if (bucketB.length > 0) {
      console.log('Refreshing Bucket B (recurring) from Outlook...');
      let done = 0, failed = 0;
      for (let i = 0; i < bucketB.length; i += BATCH_SIZE) {
        const batch = bucketB.slice(i, i + BATCH_SIZE);
        for (const { doc, graph } of batch) {
          try { await retryWithBackoff(() => applyRefreshFromOutlook(events, doc, graph), RETRY_OPTS); done++; }
          catch (err) { failed++; console.warn(`\n   refresh failed _id=${doc._id}: ${err.message}`); }
        }
        printProgress('Refresh', Math.min(i + BATCH_SIZE, bucketB.length), bucketB.length);
        if (i + BATCH_SIZE < bucketB.length) await sleep(BATCH_PAUSE_MS);
      }
      process.stdout.write(`\n   refreshed: ${done}  failed: ${failed}\n`);
    }

    // ── LINK PASS (only if --link) ──
    // For each touched doc that still lacks graphData.id, content-match
    // against the already-fetched Outlook calendarView. Single match →
    // write graphData (which includes .id) and calendarId. Zero/multi →
    // leave alone; --publish (if also set) will create a new Outlook event
    // for the zero-match cases.
    if (LINK && touchedIds.size > 0) {
      console.log(`\nLink pass: scanning ${touchedIds.size} touched docs for Outlook matches...`);
      const touchedIdObjs = Array.from(touchedIds).map((id) => {
        try { return new ObjectId(id); } catch (_) { return null; }
      }).filter(Boolean);
      const touchedDocs = await events.find({ _id: { $in: touchedIdObjs } }).toArray();
      const unlinked = touchedDocs.filter((d) => !d.graphData?.id);
      console.log(`  ${unlinked.length} of ${touchedDocs.length} touched docs need linking`);

      let linked = 0;
      let orphan = 0;
      let ambiguous = 0;
      let linkFailed = 0;
      const now = new Date();
      for (let i = 0; i < unlinked.length; i += BATCH_SIZE) {
        const batch = unlinked.slice(i, i + BATCH_SIZE);
        for (const doc of batch) {
          const docTitle = getEventTitle(doc);
          const docStart = getStartDateTime(doc);
          const docEnd = getEndDateTime(doc);
          const matched = new Map();
          for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
            for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
              const ck = contentKey(docTitle, docStart, docEnd, ds, de);
              if (!ck) continue;
              const hits = graphByContentKey.get(ck);
              if (!hits) continue;
              for (const g of hits) matched.set(g.id, g);
            }
          }
          const candidates = Array.from(matched.values());
          if (candidates.length === 1) {
            try {
              await conditionalUpdate(
                events,
                { _id: doc._id },
                {
                  $set: {
                    graphData: candidates[0],
                    calendarId,
                    lastSyncedAt: now,
                  },
                },
                { expectedVersion: doc._version ?? null, modifiedBy: 'reconcile-link' },
              );
              linked++;
            } catch (err) {
              linkFailed++;
              console.warn(`\n   link failed _id=${doc._id}: ${err.message}`);
            }
          } else if (candidates.length > 1) {
            ambiguous++;
          } else {
            orphan++;
          }
        }
        printProgress('Link', Math.min(i + BATCH_SIZE, unlinked.length), unlinked.length);
        if (i + BATCH_SIZE < unlinked.length) await sleep(BATCH_PAUSE_MS);
      }
      if (unlinked.length > 0) process.stdout.write('\n');
      console.log(`   linked: ${linked}  orphan (no Outlook match): ${orphan}  ambiguous (multi-match): ${ambiguous}  failed: ${linkFailed}`);
      if (orphan > 0 && PUBLISH) {
        console.log(`   ${orphan} orphan docs will be created in Outlook by the publish pass below.`);
      } else if (orphan > 0) {
        console.log(`   ${orphan} orphan docs are not in Outlook — pass --publish to create them.`);
      }
    }

    // ── PUBLISH PASS (only if --publish) ──
    if (PUBLISH && touchedIds.size > 0) {
      console.log(`\nPublishing to Outlook (${touchedIds.size} docs touched)...`);
      const touchedDocs = await events
        .find(
          { _id: { $in: Array.from(touchedIds).map((id) => {
            try { return new ObjectId(id); } catch (_) { return null; }
          }).filter(Boolean) } },
        )
        .toArray();

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let pubFailed = 0;
      for (let i = 0; i < touchedDocs.length; i += BATCH_SIZE) {
        const batch = touchedDocs.slice(i, i + BATCH_SIZE);
        for (const doc of batch) {
          const hadGraphId = !!doc.graphData?.id;
          // Skip update-push if no material change vs cached graphData.
          if (hadGraphId && !hasMaterialChangeVsGraph(doc)) {
            skipped++;
            continue;
          }
          try {
            // Force calendarId=null so the Graph URL hits the default calendar
            // (templeeventssandbox events demonstrably live there, NOT in the
            // calendar pointed at by calendar-config.json).
            const docForPublish = { ...doc, calendarId: null };
            const r = await rschedImportService.publishOrUpdateOutlookEvent(db, docForPublish, {
              graphApiService,
            });
            if (r.outcome === 'published') created++;
            else if (r.outcome === 'updated') updated++;
            else if (r.outcome === 'skipped') skipped++;
            else if (r.outcome === 'failed') {
              pubFailed++;
              console.warn(`\n   publish failed _id=${doc._id} (${doc.eventId}): ${r.error}`);
            }
          } catch (err) {
            pubFailed++;
            console.warn(`\n   publish threw _id=${doc._id}: ${err.message}`);
          }
        }
        printProgress('Publish', Math.min(i + BATCH_SIZE, touchedDocs.length), touchedDocs.length);
        // Light Graph throttle between batches.
        if (i + BATCH_SIZE < touchedDocs.length) await sleep(500);
      }
      process.stdout.write(`\n   published-new: ${created}  updated-existing: ${updated}  skipped (no change): ${skipped}  failed: ${pubFailed}\n`);
    } else if (PUBLISH) {
      console.log('\nPublish pass: nothing touched (0 inserts, 0 updates) — skipping Graph calls.');
    } else {
      console.log('\nPublish pass skipped (no --publish flag). Mongo and Outlook may be out of sync; pass --publish to push.');
    }

        // End of per-chunk success path.
        chunkResults.push({ chunk: __chunk, summary });
      } catch (err) {
        console.error(`  CHUNK FAILED: ${err.message}`);
        chunkResults.push({ chunk: __chunk, error: err.message });
        // Don't abort the loop — proceed to next chunk.
      }
    } // end for-loop over chunks

    if (chunks.length > 1) {
      printAggregateSummary(chunkResults);
    }

    console.log('\nReconcile complete. Re-run audit to verify idempotency.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});

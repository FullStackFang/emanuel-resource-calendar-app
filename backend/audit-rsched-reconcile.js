/**
 * Phase 1 of the one-off Rsched reconciliation: read-only audit.
 *
 * Algorithm (CONTENT-AS-PRIMARY-KEY):
 *
 * Rsched re-issues rsIds between exports — same real-world event can have
 * rsId=A in one export and rsId=B in another. So we cannot trust rsId as
 * the match key. Instead:
 *
 *   1. For each CSV row in scope, find Mongo docs in scope (ANY source)
 *      that match by title + start (±1 min) + end (±1 min). Tie-break
 *      multi-matches by location overlap. Classify:
 *        - zero match    → would-create
 *        - single match  → would-update (with rsId relink if rsId differs)
 *        - multi match   → would-flag for human review
 *   2. Every Mongo doc in scope that was NOT matched by any CSV row is a
 *      candidate for soft-delete. Sub-categorize for reporting:
 *        - test-user created (testuser1, stephen.fang, rrogers, *@test.com)
 *        - unmatched-from-CSV (everything else)
 *
 * Read-only. Run this first; review the numbers; only then run
 * reconcile-rsched-source-of-truth.js.
 *
 * Usage:
 *   node audit-rsched-reconcile.js --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD [--file=<csv>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const fsPath = require('path');
const rschedImportService = require('./services/rschedImportService');
const graphApiService = require('./services/graphApiService');
const { ensureCsvHeader } = require('./utils/rschedCsvShim');
const {
  getStartDateTime,
  getEndDateTime,
  getEventTitle,
  getLocationIdStrings,
  startDateTimeOrFilter,
} = require('./utils/eventFieldAccessors');

const CALENDAR_TIMEZONE = 'Eastern Standard Time';
const CALENDAR_CONFIG_PATH = fsPath.join(__dirname, 'calendar-config.json');
function loadCalendarConfig() {
  return JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
}
function resolveCalendarId(owner, cfg) {
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && k.toLowerCase() === owner) return v;
  }
  return null;
}

async function fetchGraphCalendarView(owner, calendarIdHint, fromIso, toIso) {
  const headers = { Prefer: `outlook.timezone="${CALENDAR_TIMEZONE}"` };
  const basePath = `/users/${encodeURIComponent(owner)}`;
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $top: '250',
    $select:
      'id,subject,start,end,iCalUId,seriesMasterId,type,recurrence,isCancelled',
  });

  // Stored events' graphData.id encodes a different mailbox/store prefix
  // than the calendarId in calendar-config.json, which means the events
  // live in the user's *default* calendar, not the specific calendar the
  // config points at. Try default first; fall back to the config'd id.
  const candidates = [
    { label: 'default', path: `${basePath}/calendar/calendarView` },
  ];
  if (calendarIdHint) {
    candidates.push({
      label: 'config-id',
      path: `${basePath}/calendars/${calendarIdHint}/calendarView`,
    });
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
  if (g.type === 'occurrence') return true;
  if (g.type === 'seriesMaster') return true;
  if (g.type === 'exception') return true;
  if (g.recurrence) return true;
  return false;
}

const DEFAULT_CSV = 'rsched_all_asof_5_8_2026.csv';
const TIME_TOLERANCE_MINUTES = 1;

const TEST_USER_EMAILS = new Set([
  'testuser1@emanuelnyc.org',
  'test.user1@emanuelnyc.org',
  'stephen.fang@emanuelnyc.org',
  'rrogers@emanuelnyc.org',
]);
// Pattern catches the test.user{N} family with optional dot — both
// testuser1@... and test.user1@... and any number variant.
const TEST_USER_PATTERN = /^test\.?user\d+@emanuelnyc\.org$/i;
function isTestUserEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase();
  if (TEST_USER_EMAILS.has(e)) return true;
  if (TEST_USER_PATTERN.test(e)) return true;
  // E2E test artifacts use @test.com domain. Catch them by suffix.
  if (e.endsWith('@test.com')) return true;
  return false;
}

const args = process.argv.slice(2);
function getArg(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

const OWNER = (getArg('owner') || '').toLowerCase();
const FROM = getArg('from');
const TO = getArg('to');
const CSV_FILE = getArg('file') || DEFAULT_CSV;

function usage(code = 1) {
  console.log(
    'Usage: node audit-rsched-reconcile.js --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD [--file=<csv>]\n' +
      `\nDefault --file is ${DEFAULT_CSV}.\n` +
      '\nNothing is written. Run reconcile-rsched-source-of-truth.js to act on this audit.\n',
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

// Resolve locations (CSV row -> ObjectIds) to use as a tie-breaker.
// We only need the locations collection so the resolveLocations call works.
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

async function main() {
  // ── CSV side ────────────────────────────────────────────────────────────
  const csvPath = path.join(__dirname, 'csv-imports', CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  console.log(`Reading CSV ${csvPath}...`);
  const rawBuffer = fs.readFileSync(csvPath);
  const { buffer, headerInjected, headerNormalized } = ensureCsvHeader(rawBuffer);
  if (headerInjected) console.log('  CSV had no header row — injected canonical header in memory.');
  if (headerNormalized) console.log('  Header column aliases normalized (e.g. LocationCode → rsKey).');
  const { rows: csvAllRows, parseErrors } = await rschedImportService.parseCsv(buffer);
  console.log(`  parsed ${csvAllRows.length} rows (${parseErrors.length} parse errors)`);

  const inScope = csvAllRows.filter(
    (r) => r.startDateTime >= FROM_STR && r.startDateTime <= TO_STR,
  );
  console.log(`  in scope ${FROM} → ${TO}: ${inScope.length}`);

  // ── Mongo side ──────────────────────────────────────────────────────────
  const client = new MongoClient(MONGODB_URI);
  let summary;
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');
    const locations = db.collection('templeEvents__Locations');

    // Resolve locations on CSV rows so we have ObjectIds for tie-breaking.
    console.log('Resolving CSV locations against templeEvents__Locations...');
    const { rows: csvResolved, unmatchedKeys } = await rschedImportService.resolveLocations(
      inScope,
      locations,
    );

    // Aggregate location resolution stats.
    const locStatus = { matched: 0, partial: 0, unmatched: 0, note_only: 0, missing: 0 };
    const unmatchedKeyExample = new Map(); // rsKey -> sample event title
    for (const r of csvResolved) {
      locStatus[r.locationStatus] = (locStatus[r.locationStatus] || 0) + 1;
      if (r.locationStatus === 'unmatched' || r.locationStatus === 'partial') {
        for (const k of r.rsKeys || []) {
          if (unmatchedKeys.has(k) && !unmatchedKeyExample.has(k)) {
            unmatchedKeyExample.set(k, r.eventTitle);
          }
        }
      }
    }
    console.log(`  matched:     ${locStatus.matched}`);
    console.log(`  partial:     ${locStatus.partial}`);
    console.log(`  unmatched:   ${locStatus.unmatched}`);
    console.log(`  note_only:   ${locStatus.note_only}`);
    console.log(`  missing:     ${locStatus.missing}`);
    if (unmatchedKeyExample.size > 0) {
      console.log(`  unique unmatched rsKeys: ${unmatchedKeys.size}`);
      const head = [...unmatchedKeyExample.entries()].slice(0, 20);
      for (const [k, title] of head) {
        console.log(`    rsKey="${k}"  example: ${title}`);
      }
    }

    // Load ALL non-deleted in-scope Mongo docs (any source).
    const mongoFilter = {
      calendarOwner: OWNER,
      isDeleted: { $ne: true },
      $or: startDateTimeOrFilter(FROM_STR, TO_STR),
    };
    console.log(`Scanning Mongo (${DB_NAME}.templeEvents__Events) for owner=${OWNER}...`);

    const mongoDocs = [];
    const cursor = events
      .find(mongoFilter, {
        projection: {
          _id: 1,
          eventId: 1,
          source: 1,
          createdBy: 1,
          createdByEmail: 1,
          'graphData.id': 1,
          'graphData.start.dateTime': 1,
          'graphData.end.dateTime': 1,
          'graphData.subject': 1,
          'rschedData.rsId': 1,
          eventTitle: 1,
          startDateTime: 1,
          endDateTime: 1,
          locations: 1,
          'calendarData.eventTitle': 1,
          'calendarData.startDateTime': 1,
          'calendarData.endDateTime': 1,
          'calendarData.locations': 1,
          status: 1,
        },
      })
      .batchSize(500);
    for await (const ev of cursor) mongoDocs.push(ev);

    // Build content-key index on all Mongo docs.
    const byContentKey = new Map(); // ck -> [doc, doc, ...]
    for (const ev of mongoDocs) {
      const ck = contentKey(getEventTitle(ev), getStartDateTime(ev), getEndDateTime(ev));
      if (!ck) continue;
      if (!byContentKey.has(ck)) byContentKey.set(ck, []);
      byContentKey.get(ck).push(ev);
    }

    // Per-CSV-row match.
    let willCreate = 0;
    let willUpdate = 0;
    let willRelinkRsId = 0; // subset of willUpdate where rsId differs
    let willAmbiguous = 0;
    const matchedMongoIds = new Set();
    const ambiguousSamples = [];
    for (const row of csvResolved) {
      // Probe ±tolerance combinations.
      const matched = new Map(); // _id -> doc
      for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
        for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
          const ck = contentKey(row.eventTitle, row.startDateTime, row.endDateTime, ds, de);
          if (!ck) continue;
          const hits = byContentKey.get(ck);
          if (!hits) continue;
          for (const d of hits) matched.set(String(d._id), d);
        }
      }

      let candidates = Array.from(matched.values());

      // Tie-break by location overlap when multiple match.
      if (candidates.length > 1) {
        const csvLocIds = new Set(
          (row.locations || [])
            .map((l) => (l && l._id ? String(l._id) : null))
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

      if (candidates.length === 0) {
        willCreate++;
      } else if (candidates.length === 1) {
        willUpdate++;
        matchedMongoIds.add(String(candidates[0]._id));
        const existingRsId = candidates[0].rschedData?.rsId;
        if (existingRsId == null || Number(existingRsId) !== Number(row.rsId)) {
          willRelinkRsId++;
        }
      } else {
        willAmbiguous++;
        if (ambiguousSamples.length < 20) {
          ambiguousSamples.push({
            csvTitle: row.eventTitle,
            csvStart: row.startDateTime,
            csvRsId: row.rsId,
            candidates: candidates.map((d) => ({
              eventId: d.eventId,
              title: getEventTitle(d),
              start: getStartDateTime(d),
              source: d.source || '-',
              rsId: d.rschedData?.rsId,
            })),
          });
        }
      }
    }

    // Walk Mongo docs once to get top-line counts and split test-user vs
    // non-test-user. The non-test-user unmatched set then gets the Outlook
    // classification pass below.
    let total = 0;
    let bySourceRsSched = 0;
    let bySourceOther = 0;
    let missingGraphId = 0;
    const SAMPLE_CAP = 20;

    const bucketA_testUser = [];        // unmatched, created by test users → soft-delete
    const nonTestUserUnmatched = [];    // candidates for Outlook classification

    for (const ev of mongoDocs) {
      total++;
      if (ev.source === 'rsSched') bySourceRsSched++;
      else bySourceOther++;
      if (!ev.graphData || !ev.graphData.id) missingGraphId++;

      if (matchedMongoIds.has(String(ev._id))) continue;

      if (isTestUserEmail(ev.createdByEmail)) {
        bucketA_testUser.push(ev);
      } else {
        nonTestUserUnmatched.push(ev);
      }
    }

    // Outlook calendarView for the window — used to classify the unmatched
    // non-test-user docs into B/C/D/E.
    const cfg = loadCalendarConfig();
    const calendarId = resolveCalendarId(OWNER, cfg);
    let graphEvents = [];
    let graphFetchError = null;
    let graphCalendarUsed = null;
    if (nonTestUserUnmatched.length > 0) {
      try {
        console.log(`\nFetching Outlook calendarView for ${FROM} → ${TO}...`);
        const graphFrom = `${FROM}T00:00:00Z`;
        const graphTo = `${TO}T23:59:59Z`;
        const result = await fetchGraphCalendarView(OWNER, calendarId, graphFrom, graphTo);
        graphEvents = result.events;
        graphCalendarUsed = result.calendarUsed;
        console.log(`  fetched ${graphEvents.length} Outlook events (calendar: ${graphCalendarUsed})`);
      } catch (err) {
        graphFetchError = err.message;
        console.warn(`  Outlook fetch failed: ${err.message}`);
      }
    }

    // Indexes for the Outlook side.
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

    // Classify each non-test-user unmatched doc.
    const bucketB_recurringProtect = [];  // protect, refresh from Outlook
    const bucketC_singleOutlook = [];     // single in Outlook, soft-delete
    const bucketD_outlookMissing = [];    // had graphData.id but Outlook returned nothing
    const bucketE_uncertain = [];         // no graphData.id and no content-match

    for (const ev of nonTestUserUnmatched) {
      const gid = ev.graphData?.id;
      let matchedGraph = null;
      let foundVia = null;
      if (gid && graphById.has(gid)) {
        matchedGraph = graphById.get(gid);
        foundVia = 'graphData.id';
      } else {
        // Try content match against Outlook.
        const docTitle = getEventTitle(ev);
        const docStart = getStartDateTime(ev);
        const docEnd = getEndDateTime(ev);
        for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
          for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
            const ck = contentKey(docTitle, docStart, docEnd, ds, de);
            if (!ck) continue;
            const hits = graphByContentKey.get(ck);
            if (hits && hits.length === 1) {
              matchedGraph = hits[0];
              foundVia = 'content-match';
              break;
            }
          }
          if (matchedGraph) break;
        }
      }

      if (matchedGraph) {
        if (isGraphEventRecurring(matchedGraph)) {
          bucketB_recurringProtect.push({ ev, graph: matchedGraph, foundVia });
        } else {
          bucketC_singleOutlook.push({ ev, graph: matchedGraph, foundVia });
        }
      } else if (gid) {
        // Had a graphData.id but Outlook didn't return that event.
        bucketD_outlookMissing.push(ev);
      } else {
        bucketE_uncertain.push(ev);
      }
    }

    // Build samples for each bucket.
    function sample(arr, cap = SAMPLE_CAP) {
      return arr.slice(0, cap).map((x) => {
        const ev = x.ev || x;
        const g = x.graph;
        return {
          eventId: ev.eventId,
          title: getEventTitle(ev),
          start: getStartDateTime(ev),
          source: ev.source || '-',
          createdByEmail: ev.createdByEmail || '-',
          rsId: ev.rschedData?.rsId ?? null,
          foundVia: x.foundVia || null,
          graphType: g?.type || null,
          graphSeriesMasterId: g?.seriesMasterId || null,
          graphSubject: g?.subject || null,
          graphStart: g?.start?.dateTime || null,
        };
      });
    }
    const unmatchedTestUserSamples = sample(bucketA_testUser);
    const recurringProtectSamples = sample(bucketB_recurringProtect);
    const singleOutlookSamples = sample(bucketC_singleOutlook);
    const outlookMissingSamples = sample(bucketD_outlookMissing);
    const uncertainSamples = sample(bucketE_uncertain);

    const unmatchedTestUser = bucketA_testUser.length;
    const recurringProtect = bucketB_recurringProtect.length;
    const singleOutlook = bucketC_singleOutlook.length;
    const outlookMissing = bucketD_outlookMissing.length;
    const uncertain = bucketE_uncertain.length;
    const unmatchedOther = recurringProtect + singleOutlook + outlookMissing + uncertain;

    summary = {
      total,
      bySourceRsSched,
      bySourceOther,
      missingGraphId,
      willCreate,
      willUpdate,
      willRelinkRsId,
      willAmbiguous,
      unmatchedTestUser,
      recurringProtect,
      singleOutlook,
      outlookMissing,
      uncertain,
      unmatchedOther,
      ambiguousSamples,
      unmatchedTestUserSamples,
      recurringProtectSamples,
      singleOutlookSamples,
      outlookMissingSamples,
      uncertainSamples,
      graphFetched: graphEvents.length,
      graphCalendarUsed,
      graphFetchError,
    };
  } finally {
    await client.close();
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(` Rsched reconcile audit (content-as-primary-key)`);
  console.log(`   owner:  ${OWNER}`);
  console.log(`   window: ${FROM} → ${TO}`);
  console.log(`   csv:    ${CSV_FILE}`);
  console.log(`   match tolerance: ±${TIME_TOLERANCE_MINUTES} minute(s)`);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`CSV rows in scope:                       ${inScope.length}`);
  console.log('');
  console.log(`Mongo non-deleted in scope:              ${summary.total}`);
  console.log(`   source = rsSched:                     ${summary.bySourceRsSched}`);
  console.log(`   source = other:                       ${summary.bySourceOther}`);
  console.log(`   missing graphData.id:                 ${summary.missingGraphId}`);
  console.log('');
  console.log(`Outlook calendarView: ${summary.graphFetched} events fetched (calendar=${summary.graphCalendarUsed || 'n/a'})${summary.graphFetchError ? ` (ERROR: ${summary.graphFetchError})` : ''}`);
  console.log('');
  console.log('Projected reconcile actions:');
  console.log(`   would-create new doc:                            ${summary.willCreate}`);
  console.log(`   would-update existing doc:                       ${summary.willUpdate}`);
  console.log(`     of which would relink rsId:                    ${summary.willRelinkRsId}`);
  console.log(`   would-flag multi-match for review:               ${summary.willAmbiguous}`);
  console.log('  ── unmatched-from-CSV Mongo docs ──');
  console.log(`   bucket A: test-user docs        → soft-delete    ${summary.unmatchedTestUser}`);
  console.log(`   bucket B: recurring in Outlook  → PROTECT+refresh ${summary.recurringProtect}`);
  console.log(`   bucket C: single in Outlook     → soft-delete    ${summary.singleOutlook}`);
  console.log(`   bucket D: had graphId, gone     → soft-delete    ${summary.outlookMissing}`);
  console.log(`   bucket E: uncertain (no link)   → PROTECT        ${summary.uncertain}`);
  const totalSoftDelete = summary.unmatchedTestUser + summary.singleOutlook + summary.outlookMissing;
  const totalProtected = summary.recurringProtect + summary.uncertain;
  console.log('  ──');
  console.log(`   TOTAL would-soft-delete:                         ${totalSoftDelete}`);
  console.log(`   TOTAL would-protect:                             ${totalProtected}`);
  console.log('');
  console.log('Sanity check: create + update + ambiguous should equal CSV-in-scope.');
  const csvAccounted = summary.willCreate + summary.willUpdate + summary.willAmbiguous;
  console.log(`   ${csvAccounted} accounted for, ${inScope.length} CSV in scope, diff = ${inScope.length - csvAccounted}`);
  const mongoAccounted = summary.willUpdate + summary.unmatchedTestUser + summary.unmatchedOther;
  console.log('Sanity check: update + (all unmatched buckets) should equal Mongo-in-scope.');
  console.log(`   ${mongoAccounted} accounted for, ${summary.total} Mongo in scope, diff = ${summary.total - mongoAccounted}`);
  console.log('────────────────────────────────────────────────────────────');

  if (summary.ambiguousSamples.length > 0) {
    console.log(`\nAmbiguous CSV rows (showing ${summary.ambiguousSamples.length} of ${summary.willAmbiguous}):`);
    for (const s of summary.ambiguousSamples) {
      console.log(`  CSV: ${pad(s.csvTitle, 36)} ${pad(s.csvStart, 22)} rsId=${s.csvRsId}`);
      for (const c of s.candidates) {
        console.log(`     ← ${pad(c.title, 36)} ${pad(c.start, 22)} src=${pad(c.source, 12)} rsId=${c.rsId}`);
      }
    }
  }
  function dumpSamples(label, samples, total, showGraph) {
    if (samples.length === 0) return;
    console.log(`\n${label} (showing ${samples.length} of ${total}):`);
    for (const s of samples) {
      if (showGraph) {
        const recur = s.graphType === 'occurrence' ? `occ→${(s.graphSeriesMasterId || '').slice(0, 14)}…` : (s.graphType || '-');
        console.log(
          `  ${pad(s.title, 36)} ${pad(s.start, 22)} → outlook=${pad(recur, 24)} via=${s.foundVia}`,
        );
      } else {
        console.log(
          `  ${pad(s.title, 36)} ${pad(s.start, 22)} src=${pad(s.source, 10)} rsId=${s.rsId ?? '-'} by=${s.createdByEmail}`,
        );
      }
    }
  }
  dumpSamples('Bucket A: test-user docs (would soft-delete)', summary.unmatchedTestUserSamples, summary.unmatchedTestUser, false);
  dumpSamples('Bucket B: recurring in Outlook (would protect + refresh)', summary.recurringProtectSamples, summary.recurringProtect, true);
  dumpSamples('Bucket C: single event in Outlook (would soft-delete)', summary.singleOutlookSamples, summary.singleOutlook, true);
  dumpSamples('Bucket D: had graphId, Outlook returned nothing (would soft-delete)', summary.outlookMissingSamples, summary.outlookMissing, false);
  dumpSamples('Bucket E: no graphId, no Outlook content match (would PROTECT)', summary.uncertainSamples, summary.uncertain, false);
  console.log('\nNo writes performed. Re-run with the reconcile script when ready.\n');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

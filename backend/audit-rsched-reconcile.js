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

const rschedImportService = require('./services/rschedImportService');
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

const TEST_USER_EMAILS = new Set([
  'testuser1@emanuelnyc.org',
  'stephen.fang@emanuelnyc.org',
  'rrogers@emanuelnyc.org',
]);
function isTestUserEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase();
  if (TEST_USER_EMAILS.has(e)) return true;
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

    // Walk Mongo docs and classify unmatched ones.
    let total = 0;
    let bySourceRsSched = 0;
    let bySourceOther = 0;
    let missingGraphId = 0;
    let unmatchedTestUser = 0;
    let unmatchedOther = 0;
    const unmatchedTestUserSamples = [];
    const unmatchedOtherSamples = [];
    const SAMPLE_CAP = 20;

    for (const ev of mongoDocs) {
      total++;
      if (ev.source === 'rsSched') bySourceRsSched++;
      else bySourceOther++;
      if (!ev.graphData || !ev.graphData.id) missingGraphId++;

      if (matchedMongoIds.has(String(ev._id))) continue;

      // Unmatched: soft-delete candidate.
      if (isTestUserEmail(ev.createdByEmail)) {
        unmatchedTestUser++;
        if (unmatchedTestUserSamples.length < SAMPLE_CAP) {
          unmatchedTestUserSamples.push({
            eventId: ev.eventId,
            title: getEventTitle(ev),
            start: getStartDateTime(ev),
            source: ev.source || '-',
            createdByEmail: ev.createdByEmail || '-',
            rsId: ev.rschedData?.rsId ?? null,
          });
        }
      } else {
        unmatchedOther++;
        if (unmatchedOtherSamples.length < SAMPLE_CAP) {
          unmatchedOtherSamples.push({
            eventId: ev.eventId,
            title: getEventTitle(ev),
            start: getStartDateTime(ev),
            source: ev.source || '-',
            createdByEmail: ev.createdByEmail || '-',
            rsId: ev.rschedData?.rsId ?? null,
          });
        }
      }
    }

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
      unmatchedOther,
      ambiguousSamples,
      unmatchedTestUserSamples,
      unmatchedOtherSamples,
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
  console.log('Projected reconcile actions:');
  console.log(`   would-create new doc:                 ${summary.willCreate}`);
  console.log(`   would-update existing doc:            ${summary.willUpdate}`);
  console.log(`     of which would relink rsId:         ${summary.willRelinkRsId}`);
  console.log(`   would-flag multi-match for review:    ${summary.willAmbiguous}`);
  console.log(`   would-soft-delete (test users):       ${summary.unmatchedTestUser}`);
  console.log(`   would-soft-delete (unmatched-CSV):    ${summary.unmatchedOther}`);
  console.log('');
  console.log('Sanity check: create + update + ambiguous should equal CSV-in-scope.');
  const csvAccounted = summary.willCreate + summary.willUpdate + summary.willAmbiguous;
  console.log(`   ${csvAccounted} accounted for, ${inScope.length} CSV in scope, diff = ${inScope.length - csvAccounted}`);
  const totalSoftDelete = summary.unmatchedTestUser + summary.unmatchedOther;
  console.log('Sanity check: update + soft-deletes should equal Mongo-in-scope.');
  console.log(`   ${summary.willUpdate + totalSoftDelete} accounted for, ${summary.total} Mongo in scope, diff = ${summary.total - summary.willUpdate - totalSoftDelete}`);
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
  if (summary.unmatchedTestUserSamples.length > 0) {
    console.log(`\nSample unmatched test-user docs (showing ${summary.unmatchedTestUserSamples.length} of ${summary.unmatchedTestUser}):`);
    for (const s of summary.unmatchedTestUserSamples) {
      console.log(
        `  ${pad(s.title, 40)} ${pad(s.start, 22)} src=${pad(s.source, 12)} by=${s.createdByEmail}`,
      );
    }
  }
  if (summary.unmatchedOtherSamples.length > 0) {
    console.log(`\nSample unmatched-from-CSV docs (showing ${summary.unmatchedOtherSamples.length} of ${summary.unmatchedOther}):`);
    for (const s of summary.unmatchedOtherSamples) {
      console.log(
        `  ${pad(s.title, 40)} ${pad(s.start, 22)} src=${pad(s.source, 12)} rsId=${s.rsId ?? '-'} by=${s.createdByEmail}`,
      );
    }
  }
  console.log('\nNo writes performed. Re-run with the reconcile script when ready.\n');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

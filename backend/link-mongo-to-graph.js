/**
 * Phase 3 of the one-off Rsched reconciliation: populate graphData.id on
 * Mongo events that have lost (or never had) the link to their Outlook
 * counterpart. This is the gate the edit-to-Graph sync path checks
 * (api-server.js:23607,:23863) — set this field and admin saves will
 * round-trip changes to Outlook with no further code changes.
 *
 * For each kept Mongo event in scope missing graphData.id:
 *   1. Pull Outlook events for the same window via getCalendarEvents.
 *      Request Eastern-time results via Prefer header so the times
 *      align with Mongo's stored local-time strings without JS tz math.
 *   2. Match by title + start (±1 min) + end (±1 min).
 *   3. Single match → write graphData = full event payload, including
 *      graphData.id.
 *      Zero match → log to link-orphans.csv.
 *      Multi match → log to link-ambiguous.csv.
 *
 * Read-only against Graph. One Mongo write per matched doc.
 *
 * Usage:
 *   node link-mongo-to-graph.js \
 *     --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD \
 *     [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const graphApiService = require('./services/graphApiService');
const { conditionalUpdate } = require('./utils/concurrencyUtils');
const {
  getStartDateTime,
  getEndDateTime,
  getEventTitle,
  startDateTimeOrFilter,
} = require('./utils/eventFieldAccessors');

const TIME_TOLERANCE_MINUTES = 1;
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 1000;
const CALENDAR_TIMEZONE = 'Eastern Standard Time'; // Graph's name; covers EST + EDT.

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
const DRY_RUN = hasFlag('dry-run');

function usage(code = 1) {
  console.log(
    'Usage: node link-mongo-to-graph.js --owner=<email> --from=YYYY-MM-DD --to=YYYY-MM-DD [--dry-run]\n',
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

function normalizeTitle(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function minuteKey(dt) {
  return dt && typeof dt === 'string' ? dt.slice(0, 16) : '';
}
function addMinutesToMinuteKey(mk, deltaMin) {
  if (!mk) return '';
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
function contentKey(title, startDt, endDt, sShift = 0, eShift = 0) {
  const t = normalizeTitle(title);
  if (!t) return null;
  const s = addMinutesToMinuteKey(minuteKey(startDt), sShift);
  const e = addMinutesToMinuteKey(minuteKey(endDt), eShift);
  return `${t}|${s}|${e}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printProgress(label, done, total) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  process.stdout.write(`\r   [${label}] ${pct}% (${done}/${total})`);
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function fetchGraphCalendarView(owner, calendarId, fromIso, toIso) {
  // Use graphRequest directly so we can set a Prefer header. Graph's
  // calendarView returns event times in the requested time zone, which
  // saves us doing DST-aware UTC→Eastern math in JS.
  const headers = { Prefer: `outlook.timezone="${CALENDAR_TIMEZONE}"` };
  const basePath = `/users/${encodeURIComponent(owner)}`;
  const calendarPath = calendarId
    ? `${basePath}/calendars/${calendarId}/calendarView`
    : `${basePath}/calendar/calendarView`;
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $top: '250',
    $select: 'id,subject,start,end,iCalUId,seriesMasterId,type,recurrence,isCancelled',
  });

  let nextLink = `${calendarPath}?${params}`;
  let all = [];
  while (nextLink) {
    const data = await graphApiService.graphRequest(nextLink, { headers });
    all = all.concat(data.value || []);
    nextLink = data['@odata.nextLink'] || null;
  }
  return all;
}

async function main() {
  const cfg = loadCalendarConfig();
  const calendarId = resolveCalendarId(OWNER, cfg);
  if (!calendarId) {
    console.error(`No calendarId for ${OWNER} in calendar-config.json`);
    process.exit(1);
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log(' Mongo → Graph link repair (populate graphData.id)');
  console.log(`   owner:   ${OWNER}`);
  console.log(`   window:  ${FROM} → ${TO}`);
  console.log(`   dry-run: ${DRY_RUN}`);
  console.log('────────────────────────────────────────────────────────────\n');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');

    // 1) Find Mongo events in scope that lack graphData.id. Use $and to
    // combine date-range OR (top-level vs calendarData.startDateTime) with
    // the graphData-missing OR. Older rsSched docs that pre-date the
    // top-level convention are caught by the second branch of the date OR.
    const mongoNeedsLink = await events
      .find(
        {
          calendarOwner: OWNER,
          isDeleted: { $ne: true },
          $and: [
            { $or: startDateTimeOrFilter(FROM_STR, TO_STR) },
            {
              $or: [
                { graphData: { $exists: false } },
                { graphData: null },
                { 'graphData.id': { $exists: false } },
                { 'graphData.id': null },
                { 'graphData.id': '' },
              ],
            },
          ],
        },
        {
          projection: {
            _id: 1,
            eventId: 1,
            _version: 1,
            eventTitle: 1,
            startDateTime: 1,
            endDateTime: 1,
            'calendarData.eventTitle': 1,
            'calendarData.startDateTime': 1,
            'calendarData.endDateTime': 1,
            source: 1,
            'rschedData.rsId': 1,
          },
        },
      )
      .batchSize(500)
      .toArray();
    console.log(`Mongo events needing link: ${mongoNeedsLink.length}`);

    if (mongoNeedsLink.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // 2) Pull Graph events in the same window.
    // calendarView wants Z-suffixed ISO datetimes. Use UTC midnight of
    // each boundary (close enough — content-match later filters by exact
    // local time anyway).
    const graphFromIso = `${FROM}T00:00:00Z`;
    const graphToIso = `${TO}T23:59:59Z`;
    console.log(`Fetching Graph events ${graphFromIso} → ${graphToIso}...`);
    const graphEvents = await fetchGraphCalendarView(
      OWNER,
      calendarId,
      graphFromIso,
      graphToIso,
    );
    console.log(`  fetched ${graphEvents.length} Graph events`);

    // Index Graph events by content key (title|startMinute|endMinute).
    // Graph returned times in CALENDAR_TIMEZONE (via Prefer header), so
    // the minute-key prefix should align with Mongo's local time strings.
    const byContentKey = new Map();
    for (const g of graphEvents) {
      const gStart = g.start?.dateTime;
      const gEnd = g.end?.dateTime;
      if (!gStart || !gEnd) continue;
      const ck = contentKey(g.subject, gStart, gEnd);
      if (!ck) continue;
      if (!byContentKey.has(ck)) byContentKey.set(ck, []);
      byContentKey.get(ck).push(g);
    }

    // 3) Build the match plan.
    const willLink = []; // { doc, graphEvent }
    const orphans = []; // Mongo events with no Graph match
    const ambiguous = []; // Mongo events with >1 Graph match

    for (const doc of mongoNeedsLink) {
      // Resolve title/start/end through accessors so older docs match too.
      const docTitle = getEventTitle(doc);
      const docStart = getStartDateTime(doc);
      const docEnd = getEndDateTime(doc);
      const matched = new Map(); // by graph event id
      for (let ds = -TIME_TOLERANCE_MINUTES; ds <= TIME_TOLERANCE_MINUTES; ds++) {
        for (let de = -TIME_TOLERANCE_MINUTES; de <= TIME_TOLERANCE_MINUTES; de++) {
          const ck = contentKey(docTitle, docStart, docEnd, ds, de);
          if (!ck) continue;
          const hits = byContentKey.get(ck);
          if (!hits) continue;
          for (const g of hits) matched.set(g.id, g);
        }
      }
      const list = Array.from(matched.values());
      if (list.length === 1) willLink.push({ doc, graphEvent: list[0] });
      else if (list.length > 1) ambiguous.push({ doc, candidates: list });
      else orphans.push(doc);
    }

    console.log('\nMatch plan:');
    console.log(`  single match (would-link):    ${willLink.length}`);
    console.log(`  zero match (would-log):       ${orphans.length}`);
    console.log(`  multi match (would-log):      ${ambiguous.length}`);

    // 4) Always emit the diagnostic CSVs.
    const stamp = `${OWNER.replace(/[^a-z0-9]+/gi, '_')}_${FROM}_${TO}_${Date.now()}`;
    const orphanPath = path.join(__dirname, `link-orphans-${stamp}.csv`);
    const ambiguousPath = path.join(__dirname, `link-ambiguous-${stamp}.csv`);
    {
      const lines = ['eventId,_id,eventTitle,startDateTime,endDateTime,source,rsId'];
      for (const d of orphans) {
        lines.push(
          [
            csvEscape(d.eventId),
            csvEscape(d._id),
            csvEscape(getEventTitle(d)),
            csvEscape(getStartDateTime(d)),
            csvEscape(getEndDateTime(d)),
            csvEscape(d.source),
            csvEscape(d.rschedData?.rsId ?? ''),
          ].join(','),
        );
      }
      fs.writeFileSync(orphanPath, lines.join('\n') + '\n');
      console.log(`\nOrphans written to ${orphanPath}`);
    }
    {
      const lines = [
        'mongoEventId,mongo_id,mongoTitle,mongoStart,candidateGraphId,candidateSubject,candidateStart',
      ];
      for (const { doc, candidates } of ambiguous) {
        for (const g of candidates) {
          lines.push(
            [
              csvEscape(doc.eventId),
              csvEscape(doc._id),
              csvEscape(getEventTitle(doc)),
              csvEscape(getStartDateTime(doc)),
              csvEscape(g.id),
              csvEscape(g.subject),
              csvEscape(g.start?.dateTime),
            ].join(','),
          );
        }
      }
      fs.writeFileSync(ambiguousPath, lines.join('\n') + '\n');
      console.log(`Ambiguous written to ${ambiguousPath}`);
    }

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] No Mongo writes. Re-run without --dry-run to apply links.');
      return;
    }

    // 5) Apply links.
    console.log('\nApplying links...');
    let linked = 0;
    let failed = 0;
    for (let i = 0; i < willLink.length; i += BATCH_SIZE) {
      const batch = willLink.slice(i, i + BATCH_SIZE);
      for (const { doc, graphEvent } of batch) {
        try {
          // graphEvent already contains .id, so just set the whole object.
          // No statusHistory push — this is metadata, not a state change,
          // and a fake status entry would corrupt the restore-walk logic.
          await conditionalUpdate(
            events,
            { _id: doc._id },
            {
              $set: {
                graphData: graphEvent,
                lastSyncedAt: new Date(),
              },
            },
            { expectedVersion: doc._version ?? null, modifiedBy: 'link-mongo-to-graph' },
          );
          linked++;
        } catch (err) {
          failed++;
          console.warn(`\n   link failed for _id=${doc._id}: ${err.message}`);
        }
      }
      printProgress('Link', Math.min(i + BATCH_SIZE, willLink.length), willLink.length);
      if (i + BATCH_SIZE < willLink.length) await sleep(BATCH_PAUSE_MS);
    }
    process.stdout.write('\n');
    console.log(`  linked: ${linked}  failed: ${failed}`);
    console.log('\nDone. Run Phase 4 smoke test (admin save, verify Outlook update).');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Link failed:', err);
  process.exit(1);
});

'use strict';
/**
 * One-off read-only audit: compare templeevents@emanuelnyc.org published
 * events in Mongo vs the live Graph calendar over a date window.
 *
 * Usage:
 *   node audit-templeevents-window.js [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *
 * Defaults: 2026-05-11 .. 2026-05-25 inclusive (NYC local).
 */

const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const graphApiService = require('./services/graphApiService');
const { fetchGraphCalendarView } = require('./utils/graphRecurrenceFetch');
const { expandRecurringOccurrencesInWindow } = require('./utils/recurrenceExpansion');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=', 2))
);
const FROM_DATE = args.from || '2026-05-11';
const TO_DATE = args.to || '2026-05-25';
const OWNER = 'templeevents@emanuelnyc.org';
const CALENDAR_ID =
  require('./calendar-config.json')['TempleEvents@emanuelnyc.org'];

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';

const TIME_TOLERANCE_MIN = 2;
const TOL_MS = TIME_TOLERANCE_MIN * 60 * 1000;

const windowStart = new Date(`${FROM_DATE}T00:00:00`);
const windowEndExclusive = new Date(`${TO_DATE}T00:00:00`);
windowEndExclusive.setDate(windowEndExclusive.getDate() + 1);
const windowEndIso = `${TO_DATE}T23:59:59`;
const windowStartIso = `${FROM_DATE}T00:00:00`;

const fmt = (d) => (d instanceof Date ? d.toISOString().replace('Z', '') : String(d));
const stripZ = (s) => (typeof s === 'string' ? s.replace(/Z$/, '') : s);
const normTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const toMillis = (s) => new Date(stripZ(s) + (String(s).match(/[+-]\d{2}:?\d{2}$/) ? '' : 'Z')).getTime();

async function loadMongoOccurrences(db) {
  const coll = db.collection(COLLECTION);
  // Pull all published, non-deleted, owner-matching docs that overlap the window.
  const baseQuery = {
    calendarOwner: { $regex: `^${OWNER}$`, $options: 'i' },
    status: 'published',
    isDeleted: { $ne: true },
  };
  // Overlap: startDateTime < windowEndExclusive AND endDateTime > windowStart
  // Stored as local-time ISO strings without Z; string compare works lexicographically.
  const windowEndStr = windowEndExclusive.toISOString().slice(0, 19);
  const windowStartStr = windowStart.toISOString().slice(0, 19);

  const overlapQuery = {
    ...baseQuery,
    $or: [
      // Non-master events overlapping the window
      {
        eventType: { $in: [null, 'singleInstance', 'exception', 'addition'] },
        startDateTime: { $lt: windowEndStr },
        endDateTime: { $gt: windowStartStr },
      },
      // Series masters whose recurrence range *could* overlap the window
      {
        eventType: 'seriesMaster',
      },
    ],
  };
  const docs = await coll.find(overlapQuery).toArray();

  const masters = docs.filter((d) => d.eventType === 'seriesMaster');
  const exceptions = docs.filter((d) => d.eventType === 'exception');
  const additions = docs.filter((d) => d.eventType === 'addition');
  const singles = docs.filter(
    (d) => !d.eventType || d.eventType === 'singleInstance',
  );

  // Build exceptionDate index per master so master expansion skips dates that
  // have a separate exception document supplying the override.
  const exceptionDatesByMaster = new Map();
  for (const ex of exceptions) {
    const key = String(ex.seriesMasterId || ex.seriesMasterEventId || '');
    if (!key) continue;
    const date = (ex.startDateTime || '').slice(0, 10);
    if (!exceptionDatesByMaster.has(key)) exceptionDatesByMaster.set(key, new Set());
    exceptionDatesByMaster.get(key).add(date);
  }

  const out = [];
  for (const d of singles) {
    out.push({
      source: 'single',
      title: d.eventTitle || d.calendarData?.eventTitle || '',
      startDateTime: stripZ(d.startDateTime),
      endDateTime: stripZ(d.endDateTime),
      eventId: d.eventId,
      _id: String(d._id),
    });
  }
  for (const ex of exceptions) {
    const start = stripZ(ex.startDateTime);
    const end = stripZ(ex.endDateTime);
    if (
      new Date(start) < windowEndExclusive &&
      new Date(end) > windowStart
    ) {
      out.push({
        source: 'exception',
        title: ex.eventTitle || ex.calendarData?.eventTitle || '',
        startDateTime: start,
        endDateTime: end,
        eventId: ex.eventId,
        _id: String(ex._id),
      });
    }
  }
  for (const ad of additions) {
    const start = stripZ(ad.startDateTime);
    const end = stripZ(ad.endDateTime);
    if (
      new Date(start) < windowEndExclusive &&
      new Date(end) > windowStart
    ) {
      out.push({
        source: 'addition',
        title: ad.eventTitle || ad.calendarData?.eventTitle || '',
        startDateTime: start,
        endDateTime: end,
        eventId: ad.eventId,
        _id: String(ad._id),
      });
    }
  }
  for (const m of masters) {
    const excludedDates = exceptionDatesByMaster.get(String(m._id))
      || exceptionDatesByMaster.get(String(m.eventId))
      || new Set();
    const exp = expandRecurringOccurrencesInWindow(m, windowStart, windowEndExclusive);
    for (const occ of exp) {
      if (excludedDates.has(occ.occurrenceDate)) continue;
      out.push({
        source: 'master-expanded',
        title: m.eventTitle || m.calendarData?.eventTitle || '',
        startDateTime: occ.startDateTime,
        endDateTime: occ.endDateTime,
        eventId: m.eventId,
        _id: String(m._id),
      });
    }
  }

  return out;
}

async function loadGraphOccurrences() {
  const { events } = await fetchGraphCalendarView(
    OWNER,
    CALENDAR_ID,
    windowStartIso,
    windowEndIso,
    { timezone: 'Eastern Standard Time' },
  );
  return events
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      title: e.subject || '',
      startDateTime: stripZ(e.start?.dateTime || ''),
      endDateTime: stripZ(e.end?.dateTime || ''),
      graphId: e.id,
      type: e.type,
    }));
}

function summarize(label, rows) {
  console.log(`\n${label}  (n=${rows.length})`);
  console.log('─'.repeat(78));
  const sorted = [...rows].sort(
    (a, b) =>
      a.startDateTime.localeCompare(b.startDateTime) ||
      normTitle(a.title).localeCompare(normTitle(b.title)),
  );
  for (const r of sorted) {
    console.log(
      `  ${r.startDateTime}  ->  ${r.endDateTime}   ${r.title}`,
    );
  }
}

function diff(mongoRows, graphRows) {
  const used = new Set();
  const mongoOnly = [];
  const matched = [];
  for (const m of mongoRows) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < graphRows.length; i++) {
      if (used.has(i)) continue;
      const g = graphRows[i];
      if (normTitle(m.title) !== normTitle(g.title)) continue;
      const dStart = Math.abs(toMillis(m.startDateTime) - toMillis(g.startDateTime));
      const dEnd = Math.abs(toMillis(m.endDateTime) - toMillis(g.endDateTime));
      if (dStart > TOL_MS || dEnd > TOL_MS) continue;
      const score = dStart + dEnd;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      matched.push({ m, g: graphRows[bestIdx] });
    } else {
      mongoOnly.push(m);
    }
  }
  const graphOnly = graphRows.filter((_, i) => !used.has(i));
  return { matched, mongoOnly, graphOnly };
}

(async () => {
  console.log(`Window:    ${FROM_DATE} 00:00 .. ${TO_DATE} 23:59 (NYC local)`);
  console.log(`Owner:     ${OWNER}`);
  console.log(`CalendarId:${CALENDAR_ID?.slice(0, 28)}…`);
  console.log(`Tolerance: ±${TIME_TOLERANCE_MIN} min`);

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const [mongoRows, graphRows] = await Promise.all([
      loadMongoOccurrences(db),
      loadGraphOccurrences(),
    ]);

    summarize('MongoDB (published, non-deleted, expanded occurrences)', mongoRows);
    summarize('Graph /calendarView (excluding cancelled)', graphRows);

    const { matched, mongoOnly, graphOnly } = diff(mongoRows, graphRows);

    console.log('\n══════════════════════ DIFF SUMMARY ══════════════════════');
    console.log(`Mongo total:    ${mongoRows.length}`);
    console.log(`Graph total:    ${graphRows.length}`);
    console.log(`Matched:        ${matched.length}`);
    console.log(`Mongo only:     ${mongoOnly.length}`);
    console.log(`Graph only:     ${graphOnly.length}`);

    if (mongoOnly.length) {
      console.log('\n--- Mongo only (no matching Graph event) ---');
      for (const r of mongoOnly) {
        console.log(`  [${r.source}] ${r.startDateTime} -> ${r.endDateTime}  "${r.title}"  (eventId=${r.eventId})`);
      }
    }
    if (graphOnly.length) {
      console.log('\n--- Graph only (no matching Mongo doc) ---');
      for (const r of graphOnly) {
        console.log(`  [${r.type}] ${r.startDateTime} -> ${r.endDateTime}  "${r.title}"  (graphId=${r.graphId?.slice(0, 24)}…)`);
      }
    }
    console.log('═══════════════════════════════════════════════════════════');
  } finally {
    await client.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

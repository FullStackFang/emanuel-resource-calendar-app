/**
 * Read-only diagnostic v2: figure out where Mongo events actually live and
 * what data type startDateTime is stored as.
 *
 * Run when the audit's "in scope" count is suspiciously low. This version
 * avoids any $sort that Cosmos may have excluded from indexing.
 *
 * Usage:
 *   node diagnose-mongo-events.js
 *   node diagnose-mongo-events.js --owner=templeeventssandbox@emanuelnyc.org
 *   node diagnose-mongo-events.js --title="Sunday Lunch"
 *   node diagnose-mongo-events.js --owner=... --year=2026 --month=05
 */

'use strict';

const { MongoClient } = require('mongodb');
require('dotenv').config();

const args = process.argv.slice(2);
function getArg(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

const OWNER = getArg('owner');
const TITLE = getArg('title');
const YEAR = getArg('year');
const MONTH = getArg('month');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
if (!MONGODB_URI) {
  console.error('MONGODB_CONNECTION_STRING not set in .env');
  process.exit(1);
}

function pad(s, n) {
  const str = String(s ?? '');
  return str + ' '.repeat(Math.max(0, n - str.length));
}

function fmtVal(v) {
  if (v == null) return 'null';
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');

    // (1) Total non-deleted
    const total = await events.countDocuments({ isDeleted: { $ne: true } });
    console.log(`Total non-deleted events: ${total}`);

    // (2) calendarOwner distribution (case-insensitive aggregation)
    const ownersAgg = await events
      .aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$calendarOwner', n: { $sum: 1 } } },
      ])
      .toArray();
    console.log(`\nDistinct calendarOwner values (${ownersAgg.length}):`);
    for (const o of ownersAgg.sort((a, b) => b.n - a.n)) {
      console.log(`  ${pad(JSON.stringify(o._id), 50)} ${o.n}`);
    }

    // (3) startDateTime $type breakdown (the critical question)
    console.log('\n$type breakdown of startDateTime (top-level):');
    const typeAgg = await events
      .aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: { $type: '$startDateTime' }, n: { $sum: 1 } } },
      ])
      .toArray();
    for (const t of typeAgg.sort((a, b) => b.n - a.n)) {
      console.log(`  ${pad(t._id, 20)} ${t.n}`);
    }

    // (4) Sample value examples per type — Cosmos rejects $type: 'missing'
    // as a filter input, so handle it via $exists separately.
    console.log('\nSample startDateTime values by type (first 3 of each):');
    for (const t of typeAgg) {
      const filter = { isDeleted: { $ne: true } };
      if (t._id === 'missing') filter.startDateTime = { $exists: false };
      else filter.startDateTime = { $type: t._id };
      const samples = await events
        .find(filter, {
          projection: {
            eventId: 1,
            source: 1,
            eventTitle: 1,
            startDateTime: 1,
            'calendarData.eventTitle': 1,
            'calendarData.startDateTime': 1,
            calendarOwner: 1,
          },
        })
        .limit(3)
        .toArray();
      for (const s of samples) {
        const title = s.eventTitle || s.calendarData?.eventTitle || '(no title)';
        const top = s.startDateTime === undefined ? '(absent)' : fmtVal(s.startDateTime);
        const cd = s.calendarData?.startDateTime;
        console.log(
          `  [${pad(t._id, 8)}] top=${pad(top, 22)} cd=${pad(fmtVal(cd), 22)} title=${pad(title, 26)} src=${s.source || '-'}`,
        );
      }
    }

    // (5) For a target month/year, count by every reasonable query shape
    if (YEAR && MONTH) {
      const ymPrefix = `${YEAR}-${MONTH}`;
      const ymStart = new Date(`${YEAR}-${MONTH}-01T00:00:00.000Z`);
      const nextMonthStart = new Date(ymStart);
      nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);

      console.log(`\nCounts for ${ymPrefix} (multiple query shapes):`);
      const baseFilter = { isDeleted: { $ne: true } };
      if (OWNER) baseFilter.calendarOwner = OWNER;

      const cStringPrefix = await events.countDocuments({
        ...baseFilter,
        startDateTime: { $regex: `^${ymPrefix}` },
      });
      console.log(`  startDateTime regex '^${ymPrefix}':           ${cStringPrefix}`);

      const cStringRange = await events.countDocuments({
        ...baseFilter,
        startDateTime: { $gte: `${ymPrefix}-01T00:00:00`, $lt: `${YEAR}-${String(parseInt(MONTH, 10) + 1).padStart(2, '0')}-01T00:00:00` },
      });
      console.log(`  startDateTime $gte string..$lt string:        ${cStringRange}`);

      const cDateRange = await events.countDocuments({
        ...baseFilter,
        startDateTime: { $gte: ymStart, $lt: nextMonthStart },
      });
      console.log(`  startDateTime $gte Date..$lt Date:             ${cDateRange}`);

      const cCalendarDataPrefix = await events.countDocuments({
        ...baseFilter,
        'calendarData.startDateTime': { $regex: `^${ymPrefix}` },
      });
      console.log(`  calendarData.startDateTime regex '^${ymPrefix}': ${cCalendarDataPrefix}`);

      const cGraphPrefix = await events.countDocuments({
        ...baseFilter,
        'graphData.start.dateTime': { $regex: `^${ymPrefix}` },
      });
      console.log(`  graphData.start.dateTime regex '^${ymPrefix}': ${cGraphPrefix}`);
    }

    // (6) Title search across all owners
    if (TITLE) {
      console.log(`\nTitle search "${TITLE}" (case-insensitive, all owners):`);
      const re = new RegExp(TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const hits = await events
        .find(
          { isDeleted: { $ne: true }, eventTitle: { $regex: re } },
          {
            projection: {
              eventId: 1,
              source: 1,
              calendarOwner: 1,
              eventTitle: 1,
              startDateTime: 1,
              endDateTime: 1,
              'calendarData.startDateTime': 1,
              createdByEmail: 1,
              'graphData.id': 1,
            },
          },
        )
        .limit(50)
        .toArray();
      console.log(`  ${hits.length} hits (cap 50)`);
      for (const e of hits) {
        console.log(
          `  ${pad(e.eventTitle, 36)} top.start=${pad(fmtVal(e.startDateTime), 28)} cd.start=${pad(fmtVal(e.calendarData?.startDateTime), 25)} src=${pad(e.source || '-', 9)} graphId=${e.graphData?.id ? 'y' : 'n'}`,
        );
      }
    }

    // (7) Owner-specific sample WITHOUT sort
    if (OWNER) {
      console.log(`\nFirst 10 docs for owner=${OWNER} (no sort, batch order):`);
      const sample = await events
        .find(
          { calendarOwner: OWNER, isDeleted: { $ne: true } },
          {
            projection: {
              eventId: 1,
              source: 1,
              eventTitle: 1,
              startDateTime: 1,
              'calendarData.startDateTime': 1,
              createdByEmail: 1,
              'graphData.id': 1,
            },
          },
        )
        .limit(10)
        .toArray();
      for (const e of sample) {
        console.log(
          `  ${pad(e.eventTitle, 36)} top.start=${pad(fmtVal(e.startDateTime), 28)} cd.start=${pad(fmtVal(e.calendarData?.startDateTime), 25)} src=${pad(e.source || '-', 9)} graphId=${e.graphData?.id ? 'y' : 'n'}`,
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Diagnose failed:', err);
  process.exit(1);
});

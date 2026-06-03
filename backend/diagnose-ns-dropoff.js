/**
 * READ-ONLY diagnostic for the "NS Drop Off" recurring-event duplication bug.
 *
 * Does NOT modify any data. It inspects templeEvents__Events to answer:
 *   - How many documents exist that look like this series?
 *   - Are there duplicate seriesMaster docs, or stored occurrence docs?
 *   - What eventType / createdSource / startDate / seriesMasterId do they carry?
 *
 * Run: cd backend && node diagnose-ns-dropoff.js
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Adjust if the title differs slightly; matches case-insensitively on a substring.
const TITLE_REGEX = /drop\s*off/i;

async function main() {
  if (!MONGODB_URI) {
    console.error('Missing MONGODB_CONNECTION_STRING in backend/.env');
    process.exit(1);
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const col = client.db(DB_NAME).collection('templeEvents__Events');

  // Pull every doc whose title looks like the offending event, in the 2026-06..09 window.
  const q = {
    $and: [
      {
        $or: [
          { eventTitle: { $regex: TITLE_REGEX } },
          { 'calendarData.eventTitle': { $regex: TITLE_REGEX } },
          { 'graphData.subject': { $regex: TITLE_REGEX } },
          { subject: { $regex: TITLE_REGEX } },
        ],
      },
    ],
  };

  const docs = await col.find(q).toArray();
  console.log(`\nTotal docs matching /drop off/i: ${docs.length}\n`);

  // Group by eventType
  const byType = {};
  const bySource = {};
  const byMaster = {};
  const byStartDate = {};
  let withRecurrence = 0;

  for (const d of docs) {
    const type = d.eventType || d.graphData?.type || '(none)';
    byType[type] = (byType[type] || 0) + 1;

    const src = d.createdSource || d.source || '(none)';
    bySource[src] = (bySource[src] || 0) + 1;

    const master = d.seriesMasterId || d.seriesMasterEventId || d.graphData?.seriesMasterId || '(no-master)';
    byMaster[master] = (byMaster[master] || 0) + 1;

    const sd = d.startDate || (d.startDateTime || '').split('T')[0] || (d.calendarData?.startDateTime || '').split('T')[0] || '(no-date)';
    byStartDate[sd] = (byStartDate[sd] || 0) + 1;

    if (d.recurrence?.pattern || d.graphData?.recurrence?.pattern) withRecurrence++;
  }

  console.log('--- by eventType ---');
  console.table(byType);
  console.log('--- by createdSource/source ---');
  console.table(bySource);
  console.log(`\nDocs carrying a recurrence pattern (i.e. master-like): ${withRecurrence}`);

  console.log('\n--- by seriesMasterId (top 15) ---');
  console.table(Object.fromEntries(Object.entries(byMaster).sort((a, b) => b[1] - a[1]).slice(0, 15)));

  console.log('\n--- by startDate (top 20) ---');
  console.table(Object.fromEntries(Object.entries(byStartDate).sort((a, b) => b[1] - a[1]).slice(0, 20)));

  // How many distinct seriesMaster documents are there?
  const masters = docs.filter(d => (d.eventType || d.graphData?.type) === 'seriesMaster');
  console.log(`\nDistinct seriesMaster documents: ${masters.length}`);
  for (const m of masters.slice(0, 10)) {
    console.log(`  master eventId=${m.eventId} status=${m.status} isDeleted=${m.isDeleted} start=${m.startDate || (m.startDateTime||'').split('T')[0]} title=${m.eventTitle || m.calendarData?.eventTitle || m.subject}`);
  }

  // Sample a few non-master docs to see their shape
  const nonMasters = docs.filter(d => (d.eventType || d.graphData?.type) !== 'seriesMaster');
  console.log(`\nNon-master docs: ${nonMasters.length}. Sample of 8:`);
  for (const d of nonMasters.slice(0, 8)) {
    console.log(`  eventId=${d.eventId} type=${d.eventType || d.graphData?.type || '(none)'} src=${d.createdSource || d.source} start=${d.startDate || (d.startDateTime||'').split('T')[0]} master=${d.seriesMasterId || d.seriesMasterEventId || '(none)'} isDeleted=${d.isDeleted}`);
  }

  // Timestamp forensics on the 43 unified-form masters: tight clustering => server-side
  // loop/retry; spread over seconds/minutes => repeated client submissions.
  console.log('\n--- unified-form "NS Drop Off" master timestamps (sorted) ---');
  const formMasters = docs
    .filter(d => (d.eventType || d.graphData?.type) === 'seriesMaster')
    .filter(d => (d.createdSource || d.source) === 'unified-form')
    .map(d => ({
      eventId: d.eventId,
      createdAt: d.createdAt || d.createdDateTime || d._id?.getTimestamp?.()?.toISOString(),
      status: d.status,
      isDeleted: d.isDeleted,
      version: d._version,
      graphId: d.graphData?.id ? 'YES' : 'no',
      createdBy: (typeof d.createdBy === 'object' ? (d.createdBy?.email || d.createdBy?.name) : d.createdBy) || '(none)',
    }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  console.table(formMasters);

  // Span between first and last creation
  const times = formMasters.map(m => new Date(m.createdAt).getTime()).filter(t => !isNaN(t));
  if (times.length > 1) {
    const span = (Math.max(...times) - Math.min(...times)) / 1000;
    console.log(`\nCreation span across ${times.length} masters: ${span.toFixed(1)} seconds`);
    console.log(`First: ${new Date(Math.min(...times)).toISOString()}  Last: ${new Date(Math.max(...times)).toISOString()}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

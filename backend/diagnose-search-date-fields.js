// READ-ONLY diagnostic. Tests why a date-only search returns no results.
// Hypothesis: published events synced from Graph have graphData.start.dateTime
// but an empty/missing calendarData.startDateTime, so the search date filter
// (which only looks at calendarData.startDateTime) excludes them.
//
// Usage:
//   node diagnose-search-date-fields.js
//   node diagnose-search-date-fields.js --start 2026-05-01 --end 2026-07-31
//
// No writes. Safe to run anytime.

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cosmos throttles aggressively (429/16500). Retry with backoff + space calls.
async function rc(label, fn) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const out = await fn();
      await sleep(400); // gap before next query to stay under RU budget
      return out;
    } catch (e) {
      const retryMs = e.RetryAfterMs || e.retryAfterMs || 250 * attempt;
      if ((e.code === 16500 || /TooManyRequests|429/.test(e.message)) && attempt < 8) {
        await sleep(retryMs + 100);
        continue;
      }
      throw new Error(`${label}: ${e.message}`);
    }
  }
}

(async () => {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const col = client.db(DB_NAME).collection(COLLECTION);

    const publishedBase = { status: 'published', isDeleted: { $ne: true } };
    const missingCal = [
      { 'calendarData.startDateTime': { $exists: false } },
      { 'calendarData.startDateTime': null },
      { 'calendarData.startDateTime': '' },
    ];

    const totalPublished = await rc('totalPublished', () => col.countDocuments(publishedBase));

    const withCalStart = await rc('withCalStart', () => col.countDocuments({
      ...publishedBase,
      'calendarData.startDateTime': { $exists: true, $nin: [null, ''] },
    }));

    const missingCalStart = await rc('missingCalStart', () => col.countDocuments({
      ...publishedBase,
      $or: missingCal,
    }));

    const missingCalButHasGraph = await rc('missingCalButHasGraph', () => col.countDocuments({
      ...publishedBase,
      $and: [
        { $or: missingCal },
        { 'graphData.start.dateTime': { $exists: true, $nin: [null, ''] } },
      ],
    }));

    console.log('\n=== Published, non-deleted events: date-field population ===');
    console.log(`  Total published (non-deleted):                 ${totalPublished}`);
    console.log(`  - with calendarData.startDateTime populated:   ${withCalStart}`);
    console.log(`  - MISSING calendarData.startDateTime:          ${missingCalStart}`);
    console.log(`      of those, graphData.start.dateTime present: ${missingCalButHasGraph}`);

    // Samples of the suspect group (the events a date-only search would silently miss)
    if (missingCalButHasGraph > 0) {
      const samples = await rc('samples', () => col.find({
        ...publishedBase,
        $and: [
          { $or: missingCal },
          { 'graphData.start.dateTime': { $exists: true, $nin: [null, ''] } },
        ],
      }).project({
        eventId: 1,
        'calendarData.eventTitle': 1,
        'calendarData.startDateTime': 1,
        'graphData.subject': 1,
        'graphData.start': 1,
      }).limit(5).toArray());

      console.log('\n=== Sample events missing calendarData.startDateTime (search MISSES these) ===');
      for (const s of samples) {
        console.log(`  - ${s.calendarData?.eventTitle || s.graphData?.subject || s.eventId}`);
        console.log(`      calendarData.startDateTime: ${JSON.stringify(s.calendarData?.startDateTime)}`);
        console.log(`      graphData.start:            ${JSON.stringify(s.graphData?.start)}`);
      }
    }

    // Show the actual stored format of calendarData.startDateTime — string
    // comparison in the filter is format-sensitive.
    const fmtSamples = await rc('fmtSamples', () => col.find(publishedBase)
      .project({ 'calendarData.startDateTime': 1, 'calendarData.eventTitle': 1 })
      .limit(5).toArray());
    console.log('\n=== Sample calendarData.startDateTime values (any 5) ===');
    for (const s of fmtSamples) {
      console.log(`  ${JSON.stringify(s.calendarData?.startDateTime)}  (${typeof s.calendarData?.startDateTime})  ${s.calendarData?.eventTitle || ''}`);
    }

    // Optional: simulate the actual search filter for a given range
    const start = arg('--start');
    const end = arg('--end');
    if (start && end) {
      const dateFilter = {
        ...publishedBase,
        'calendarData.startDateTime': { $gte: `${start}T00:00:00`, $lte: `${end}T23:59:59` },
      };
      const matchesCurrentFilter = await rc('matchesCurrentFilter', () => col.countDocuments(dateFilter));

      // Run the EXACT backend find (same shape: filter + limit 100) to see if the
      // find returns rows or comes back empty while the count is positive.
      const findRows = await rc('findRows', () => col.find(dateFilter).limit(100).toArray());
      console.log(`  Backend-style find().limit(100) returned: ${findRows.length} rows`);

      // How many would match if we considered graphData.start.dateTime too (date-prefix compare)
      const graphInRange = await rc('graphInRange', () => col.countDocuments({
        ...publishedBase,
        $or: missingCal,
        'graphData.start.dateTime': { $gte: `${start}T00:00:00`, $lte: `${end}T23:59:59.999Z` },
      }));

      console.log(`\n=== Date range ${start}..${end} ===`);
      console.log(`  Matches date filter, NO calendarOwner:                     ${matchesCurrentFilter}`);
      console.log(`  Backend-style find().limit(100) returned:                  ${findRows.length} rows`);
      console.log(`  Published events in range with ONLY graphData date:        ${graphInRange}`);

      // The REAL search adds calendarOwner. Test with the owner the frontend sent.
      const owner = (arg('--owner') || 'templeevents@emanuelnyc.org').toLowerCase();
      const withOwner = await rc('withOwner', () => col.countDocuments({ ...dateFilter, calendarOwner: owner }));
      console.log(`\n  WITH calendarOwner='${owner}' (what the search actually sends): ${withOwner}`);

      // What calendarOwner values do the in-range events actually have?
      const ownerSample = await rc('ownerSample', () => col.find(dateFilter)
        .project({ calendarOwner: 1, 'calendarData.eventTitle': 1, source: 1 }).limit(20).toArray());
      const ownerCounts = {};
      for (const e of ownerSample) {
        const k = JSON.stringify(e.calendarOwner);
        ownerCounts[k] = (ownerCounts[k] || 0) + 1;
      }
      console.log('  calendarOwner values among in-range events (sample of 20):');
      for (const [k, n] of Object.entries(ownerCounts)) {
        console.log(`      ${k}: ${n}`);
      }
    } else {
      console.log('\n(Tip: pass --start YYYY-MM-DD --end YYYY-MM-DD to simulate your exact search range.)');
    }

    console.log('');
  } catch (err) {
    console.error('Diagnostic failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();

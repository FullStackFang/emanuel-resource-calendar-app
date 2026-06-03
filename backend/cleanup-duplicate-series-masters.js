/**
 * Cleanup: collapse duplicate series-master documents created by the
 * "recurrence + multi-day range -> per-day batch" bug (the "38 events a day"
 * incident). A single submit fanned a recurring event across every day in its
 * range, creating one identical series master PER DAY (e.g. 42 copies of
 * "NS Drop Off"). Each master then expanded its weekly pattern, stacking dozens
 * of occurrences on every weekday.
 *
 * What it does:
 *   1. Groups non-deleted series masters by a strict DUPLICATE SIGNATURE:
 *      same createdBy + eventTitle + createdSource + start + identical recurrence,
 *      AND all created within a short time window (a batch artifact, not events
 *      a user intentionally recreated days apart).
 *   2. For each group with >1 member, KEEPS the earliest published, non-deleted
 *      master and targets the rest for removal.
 *   3. For each target: soft-deletes the Mongo doc (status 'deleted', isDeleted,
 *      statusHistory entry) and deletes its Outlook/Graph event.
 *
 * SAFETY: this is destructive AND outward-facing (it deletes real Outlook
 * events), so it does a DRY RUN by default and changes NOTHING unless you pass
 * --apply. Flags:
 *   (default)        Dry run: print the groups, keepers, and targets. No writes.
 *   --apply          Perform soft-deletes + Graph deletes.
 *   --verify         Report how many duplicate-signature groups still have >1 live member.
 *   --skip-graph     With --apply, soft-delete Mongo only; leave Outlook events alone.
 *   --window-min=N   Max minutes between first/last creation to treat a group as a
 *                    batch artifact (default 30).
 *   --title="..."    Restrict to a single eventTitle (otherwise scans all titles).
 *
 * Run:
 *   cd backend
 *   node cleanup-duplicate-series-masters.js                 # dry run (all titles)
 *   node cleanup-duplicate-series-masters.js --title="NS Drop Off"
 *   node cleanup-duplicate-series-masters.js --title="NS Drop Off" --apply
 *   node cleanup-duplicate-series-masters.js --verify
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const graphApiService = require('./services/graphApiService');
const { retryWithBackoff } = require('./utils/retryWithBackoff');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const SKIP_GRAPH = args.includes('--skip-graph');
const WINDOW_MIN = Number((args.find(a => a.startsWith('--window-min=')) || '').split('=')[1]) || 30;
const TITLE = (args.find(a => a.startsWith('--title=')) || '').split('=').slice(1).join('=') || null;

function titleOf(d) { return d.eventTitle || d.calendarData?.eventTitle || d.graphData?.subject || ''; }
function startOf(d) { return d.startDateTime || d.calendarData?.startDateTime || (d.graphData?.start?.dateTime) || ''; }
function recurKey(d) { return JSON.stringify(d.recurrence || d.graphData?.recurrence || null); }
function createdMs(d) { return new Date(d.createdAt || d.createdDateTime || d._id?.getTimestamp?.() || 0).getTime(); }

/**
 * Group live series masters into duplicate-signature batches. Pure (no I/O), so
 * dry-run and apply share identical grouping logic.
 * @returns {Array<{ signature: string, keeper: Object, targets: Object[] }>}
 */
function findDuplicateGroups(masters) {
  const groups = new Map();
  for (const d of masters) {
    const sig = [d.createdBy || '', titleOf(d), d.createdSource || '', startOf(d), recurKey(d)].join('||');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(d);
  }

  const result = [];
  for (const [signature, members] of groups) {
    if (members.length < 2) continue;
    // Batch artifact only: all members created within WINDOW_MIN of each other.
    const times = members.map(createdMs).filter(Boolean);
    if (times.length >= 2 && (Math.max(...times) - Math.min(...times)) > WINDOW_MIN * 60 * 1000) continue;

    const sorted = [...members].sort((a, b) => createdMs(a) - createdMs(b));
    // Keeper: earliest published & not deleted; else earliest of any.
    const keeper = sorted.find(m => m.status === 'published' && !m.isDeleted) || sorted[0];
    const targets = sorted.filter(m => m.eventId !== keeper.eventId);
    result.push({ signature, keeper, targets });
  }
  return result;
}

async function main() {
  if (!MONGODB_URI) { console.error('Missing MONGODB_CONNECTION_STRING in backend/.env'); process.exit(1); }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const col = client.db(DB_NAME).collection('templeEvents__Events');

  const query = {
    eventType: 'seriesMaster',
    isDeleted: { $ne: true },
    status: { $ne: 'deleted' },
  };
  if (TITLE) query.$or = [{ eventTitle: TITLE }, { 'calendarData.eventTitle': TITLE }, { 'graphData.subject': TITLE }];

  const masters = await col.find(query).toArray();
  const groups = findDuplicateGroups(masters);

  const totalTargets = groups.reduce((n, g) => n + g.targets.length, 0);

  console.log('Config:');
  console.log(`  DB: ${DB_NAME}   title filter: ${TITLE || '(all)'}   window: ${WINDOW_MIN} min`);
  console.log(`  Mode: ${VERIFY ? 'VERIFY' : APPLY ? 'APPLY (destructive)' : 'DRY RUN (no changes)'}${SKIP_GRAPH ? '  (skip Graph)' : ''}`);
  console.log(`  Live series masters scanned: ${masters.length}`);
  console.log(`  Duplicate-signature groups: ${groups.length}`);
  console.log(`  Duplicate masters to remove: ${totalTargets}  (keeping 1 per group)\n`);

  if (VERIFY) {
    if (groups.length === 0) console.log('No duplicate-signature groups with >1 live member remain.');
    else groups.forEach(g => console.log(`  STILL DUPLICATED: "${titleOf(g.keeper)}" — ${g.targets.length + 1} live copies`));
    await client.close();
    return;
  }

  if (groups.length === 0) { console.log('Nothing to clean up.'); await client.close(); return; }

  if (!APPLY) {
    // Dry run: show per-group detail so the operator can sanity-check the scope.
    for (const g of groups) {
      console.log(`Group "${titleOf(g.keeper)}"  start=${startOf(g.keeper)}  by=${g.keeper.createdBy}`);
      console.log(`  KEEP   ${g.keeper.eventId}  (${g.keeper.status}, created ${new Date(createdMs(g.keeper)).toISOString()})`);
      for (const t of g.targets) {
        console.log(`  DELETE ${t.eventId}  graph=${t.graphData?.id ? 'yes' : 'no'}  (${t.status}, created ${new Date(createdMs(t)).toISOString()})`);
      }
    }
    console.log('\nDry run only. Re-run with --apply to perform the removals.');
    await client.close();
    return;
  }

  // APPLY: soft-delete each target + delete its Graph event. Bounded loop.
  let mongoDeleted = 0, graphDeleted = 0, graphFailed = 0;
  const allTargets = groups.flatMap(g => g.targets);
  for (let i = 0; i < allTargets.length; i++) {
    const t = allTargets[i];

    if (!SKIP_GRAPH && t.graphData?.id && t.calendarOwner) {
      try {
        await graphApiService.deleteCalendarEvent(t.calendarOwner, t.calendarId || null, t.graphData.id);
        graphDeleted++;
      } catch (err) {
        graphFailed++;
        // 404 = already gone; anything else we still soft-delete Mongo but flag it.
        if (!/404|NotFound|ErrorItemNotFound/i.test(err?.message || '')) {
          console.error(`\n  Graph delete failed for ${t.eventId}: ${err?.message || err}`);
        }
      }
    }

    // Cosmos throttles writes (Error 16500 / 429). retryWithBackoff honors the
    // RetryAfterMs the server returns and fails fast on non-retryable errors.
    await retryWithBackoff(
      () => col.updateOne(
        { eventId: t.eventId },
        {
          $set: { status: 'deleted', isDeleted: true, lastModifiedDateTime: new Date() },
          $push: {
            statusHistory: {
              status: 'deleted',
              changedAt: new Date(),
              changedBy: 'cleanup-duplicate-series-masters',
              reason: 'Duplicate series master from recurrence+multi-day batch bug',
            },
          },
        }
      ),
      { maxAttempts: 8, onRetry: ({ attempt, delay }) => process.stdout.write(`\r   [Throttled] retry ${attempt} in ${delay}ms ...        `) }
    );
    mongoDeleted++;

    const pct = Math.round(((i + 1) / allTargets.length) * 100);
    process.stdout.write(`\r   [Progress] ${pct}% (${i + 1}/${allTargets.length})        `);
    // Steady pacing between writes keeps RU usage under the throttle ceiling.
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n\nDone. Soft-deleted ${mongoDeleted} Mongo masters; Graph deleted ${graphDeleted}, failed/skipped ${graphFailed}.`);
  console.log('Re-run with --verify to confirm no duplicate-signature groups remain.');
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

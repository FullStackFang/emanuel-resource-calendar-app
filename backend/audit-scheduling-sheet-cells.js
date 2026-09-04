/**
 * audit-scheduling-sheet-cells.js
 *
 * Finds Scheduling Sheet starter-row cells holding content that row is not
 * for, and optionally corrects them.
 *
 * WHY THIS EXISTS
 * A cell is a list of typed segments (text / person / location). Nothing stops
 * any segment kind landing in any cell, and nothing should — the sheet is a
 * freeform artifact and the looseness is deliberate. But the five STARTER rows
 * are read back BY LABEL to build each person's schedule email
 * (extractDayAssignments in api-server.js), so a stray value in one of them is
 * not a cosmetic wrong cell: it is a wrong fact mailed to everyone tagged in
 * that column. Two such cells were found in the 2026 High Holy Days workbook
 * on 2026-09-04, one of which mailed 'event runs 4:30 PM - Help D'.
 *
 * WHAT IS *NOT* A FINDING
 * Free text in the Location row is legitimate and common: an offsite location
 * has no location chip to pick, so 'Central Park' is correctly stored as text.
 * The rules below are written narrowly around that fact — see each one.
 *
 * RULES
 *   1. Location row, text segment that is a BARE CLOCK VALUE ('6:00 PM',
 *      '18:00', '6pm'). A time is never a place. Anything with other words in
 *      it is left alone, which is what protects 'Central Park'.
 *   2. Time row (Call Time / Doors Open / Begins / Ends), text containing NO
 *      DIGIT AT ALL. Sheet times are free text and legitimately read
 *      'HD 4:30pm / Reg 4:45pm', so 'has a digit' is the widest possible
 *      benefit of the doubt; a value with none cannot be a time.
 *
 * Findings are reported per cell with their full before/after. --fix rewrites
 * ONLY the offending segment, never the whole cell: rule 1 drops one text
 * segment and keeps every location chip; rule 2 clears the cell. Person
 * segments are never touched by either rule, so taggedEmails cannot change and
 * is deliberately not recomputed.
 *
 * A fixed day is stamped lastModifiedAt and has _version bumped, matching the
 * app's own cell-write semantics. That marks any schedule already emailed for
 * that day as STALE, which is correct: the recipients hold the wrong value.
 *
 * Usage:
 *   node audit-scheduling-sheet-cells.js              # report only (default)
 *   node audit-scheduling-sheet-cells.js --dry-run    # report + name the exact writes
 *   node audit-scheduling-sheet-cells.js --fix        # apply the corrections
 *   node audit-scheduling-sheet-cells.js --verify     # re-report; clean means fixed
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const SHEETS = 'templeEvents__SchedulingSheets';
const DAYS = 'templeEvents__SchedulingSheetDays';

const BATCH_SIZE = 100;

const TIME_ROW_LABELS = new Set(['call time', 'doors open', 'begins', 'ends']);
const LOCATION_ROW_LABEL = 'location';

// A whole value that is nothing but a clock reading. Anchored on both ends on
// purpose: 'Doors 6:00 PM' and 'Central Park' must both fail.
const BARE_CLOCK = /^\s*\d{1,2}\s*(?::\s*\d{2})?\s*(?:[ap]\.?m\.?)?\s*$/i;
const HAS_DIGIT = /\d/;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FIX = args.includes('--fix');
const VERIFY = args.includes('--verify');

const textOf = (segments) =>
  segments.filter((s) => s.type === 'text').map((s) => s.text).join(' ').trim();

const render = (segments) =>
  !segments.length
    ? '(empty)'
    : segments
        .map((s) => (s.type === 'text' ? JSON.stringify(s.text) : `[${s.type}] ${s.name}`))
        .join('  |  ');

/**
 * The corrections one day doc needs. Pure: takes a day, returns findings with
 * the exact replacement segments, and never mutates.
 */
function findingsFor(day) {
  const rowById = Object.fromEntries((day.rows || []).map((r) => [r.id, r]));
  const colById = Object.fromEntries((day.columns || []).map((c) => [c.id, c]));
  const out = [];

  for (const [key, cell] of Object.entries(day.cells || {})) {
    const segments = (cell && cell.segments) || [];
    if (!segments.length) continue;

    const [rowId, colId] = key.split(':');
    const row = rowById[rowId];
    if (!row || row.kind !== 'starter') continue;

    const label = (row.label || '').toLowerCase();
    const where = { key, row: row.label, column: colById[colId] ? colById[colId].name : '(unknown column)' };

    if (label === LOCATION_ROW_LABEL) {
      const strays = segments.filter((s) => s.type === 'text' && BARE_CLOCK.test(s.text));
      if (strays.length) {
        out.push({
          ...where,
          rule: 'a time is not a place',
          before: segments,
          after: segments.filter((s) => !strays.includes(s)),
        });
      }
      continue;
    }

    if (TIME_ROW_LABELS.has(label)) {
      const text = textOf(segments);
      if (text && !HAS_DIGIT.test(text)) {
        out.push({
          ...where,
          rule: 'a time row value with no digit in it cannot be a time',
          before: segments,
          after: [],
        });
      }
    }
  }
  return out;
}

async function main() {
  const mode = FIX ? 'FIX' : VERIFY ? 'VERIFY' : DRY_RUN ? 'DRY RUN' : 'REPORT';
  console.log(`\n   Scheduling sheet cell audit — ${mode}`);
  console.log(`   Database: ${DB_NAME}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const sheets = await db.collection(SHEETS).find({}, { projection: { name: 1 } }).toArray();
  const sheetNameById = Object.fromEntries(sheets.map((s) => [String(s._id), s.name]));
  const days = await db.collection(DAYS).find({}).sort({ date: 1 }).toArray();

  const cellCount = days.reduce((n, d) => n + Object.keys(d.cells || {}).length, 0);
  console.log(`   Workbooks: ${sheets.length}   Days: ${days.length}   Cells: ${cellCount}\n`);

  const work = [];
  for (const day of days) {
    const findings = findingsFor(day);
    if (findings.length) work.push({ day, findings });
  }

  for (const { day, findings } of work) {
    console.log(`   ${day.date}  ${day.title || ''}  [${sheetNameById[String(day.sheetId)] || '?'}]`);
    for (const f of findings) {
      console.log(`     row '${f.row}'  column '${f.column}'`);
      console.log(`       rule:   ${f.rule}`);
      console.log(`       before: ${render(f.before)}`);
      console.log(`       after:  ${render(f.after)}`);
    }
    console.log('');
  }

  const cellsAffected = work.reduce((n, w) => n + w.findings.length, 0);
  console.log(`   Cells needing correction: ${cellsAffected} of ${cellCount}`);

  if (!FIX) {
    if (cellsAffected) {
      console.log(`   ${VERIFY ? 'Still present.' : 'Nothing written.'} Re-run with --fix to apply.\n`);
    } else {
      console.log('   Clean.\n');
    }
    await client.close();
    return;
  }

  if (!cellsAffected) {
    console.log('   Nothing to do.\n');
    await client.close();
    return;
  }

  // Batched to stay clear of Cosmos rate limiting (error 16500), even though
  // the working set here is small — the shape has to survive a bigger season.
  let processed = 0;
  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    const batch = work.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(({ day, findings }) => {
        const $set = { lastModifiedAt: new Date() };
        const $unset = {};
        for (const f of findings) {
          if (f.after.length) $set[`cells.${f.key}`] = { segments: f.after, note: (day.cells[f.key] || {}).note || null };
          else $unset[`cells.${f.key}`] = '';
        }
        const update = { $set, $inc: { _version: 1 } };
        if (Object.keys($unset).length) update.$unset = $unset;
        return db.collection(DAYS).updateOne({ _id: day._id }, update);
      })
    );

    processed = Math.min(i + BATCH_SIZE, work.length);
    const percent = Math.round((processed / work.length) * 100);
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${work.length} days)`);

    if (i + BATCH_SIZE < work.length) await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write('\n');

  const after = await db.collection(DAYS).find({}).toArray();
  const remaining = after.reduce((n, d) => n + findingsFor(d).length, 0);
  console.log(`\n   Corrected: ${cellsAffected}   Remaining: ${remaining}`);
  console.log('   Affected days are stamped lastModifiedAt, so any schedule already');
  console.log('   emailed for them now reads as stale. Re-send those.\n');

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

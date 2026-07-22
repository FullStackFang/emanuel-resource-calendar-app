# Search Recurrence + Mobile Expansion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Search & Export return recurring-event occurrences (with coherent counts and exports), make the phone agenda render the same expanded/deduped occurrence set as desktop, and add tooltips to the recurrence icons.

**Architecture:** Recurring events are stored as one `seriesMaster` document (whose `calendarData.startDateTime/endDateTime` hold only the FIRST occurrence) plus separate `exception`/`addition` child documents per customized date. Two consumers never learned this: the `view === 'search'` branch of `GET /api/events/list` queries raw documents with a flat date filter (so masters never match a window after their first occurrence, and counts/finds are two divergent Cosmos ops), and `MobileAgenda` renders raw documents 1:1 (so un-overridden occurrences vanish and master+child pairs duplicate). The fix: (1) backend — recurrence-aware date clause + server-side expansion for search, with count and page derived from ONE array; (2) frontend — a shared agenda pipeline that mirrors the desktop `Calendar.jsx` expansion/dedup for the phone view; (3) SVG `<title>` tooltips on the recurrence icons.

**Tech Stack:** Node.js/Express + MongoDB (Azure Cosmos DB), Jest + mongodb-memory-server (backend), React 19 + Vite, Vitest + React Testing Library (frontend).

## Global Constraints

- Straight quotes only in all code and docs — never curly/smart quotes (repo rule).
- NEVER use double quotes (`"`) inside git commit messages; use single quotes (`'`) when quoting values (repo rule).
- Do NOT run the full backend test suite; run only the named test file(s) per step (repo rule).
- Retry loops must be bounded (repo rule: `retryWithBackoff`-style caps; no unbounded while-retry).
- Backend Graph calls are irrelevant here — no Graph API changes in this plan.
- `calendarData.startDateTime/endDateTime` are LOCAL-time ISO strings without `Z`; compare with string bounds, never `new Date().toISOString()`.
- Do not remove the one-shot retry inside `enrichSeriesMastersWithOverrides` (documented Cosmos cold-empty workaround).
- No silent caps: when a cap truncates results, `logger.warn` it.

## File Structure

| File | Role |
|---|---|
| `backend/utils/eventDateRangeFilter.js` | + `buildSeriesAwareDateRangeClause()` — recurrence-aware `$or` date clause (Task 1) |
| `backend/utils/coldEmptyRetry.js` | Generalize `findWithColdEmptyRetry` to reconcile SHORT reads, not just empty ones (Task 2) |
| `backend/utils/searchOccurrenceExpansion.js` | NEW — pure function: raw docs → expanded occurrence rows (Task 3) |
| `backend/api-server.js` | Wire search branch: new clause + raw fetch + expansion + in-memory pagination (Task 4) |
| `src/utils/agendaEventPipeline.js` | NEW — shared expand/dedup pipeline for the phone agenda (Task 5) |
| `src/components/mobile/MobileAgenda.jsx` | Consume the pipeline before flattening (Task 6) |
| `src/components/shared/CalendarIcons.jsx` | `<title>` tooltips on recurrence icons (Task 7) |

Design decisions locked in (from the adversarial review):

1. **Count and page must come from ONE array.** For search we drop the `countDocuments`-vs-`find` pair entirely: fetch ALL matching raw docs (bounded), expand in memory, then `totalCount = expanded.length` and the page is a `slice()` of the same array. "5 of 8" becomes structurally impossible.
2. **Expansion must skip materialized dates** (dates having an `exception`/`addition` child) or the fix itself introduces master+child duplicates. Every `occurrenceOverrides` entry carries `occurrenceDate` (see `_buildOverrideEntry`, `backend/utils/exceptionDocumentService.js:760-772`), and occurrence dates are immutable (`_validateOccurrenceDateNotChanged`), so a `Set` of those dates is an exact dedup key.
3. **Short-read reconciliation must compare against `min(count, cap)`** and be bounded — never raw `totalCount` with DB-level skip (that would retry forever on page 2+). Search now has no DB-level skip, so `expected = min(count, cap)` is exact.
4. Raw stored `eventType: 'occurrence'` docs are excluded from the search query — occurrences are regenerated from masters, so returning stored ones would duplicate.

---

### Task 1: Recurrence-aware date clause (`buildSeriesAwareDateRangeClause`)

**Files:**
- Modify: `backend/utils/eventDateRangeFilter.js`
- Test: `backend/__tests__/unit/utils/eventDateRangeFilter.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildSeriesAwareDateRangeClause(startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD') => { $or: [...] }` — a fragment to push into `query.$and`. Both args required (the search view already 400s without them). Exported alongside the existing `buildEventDateRangeOverlapFilter`.

The clause mirrors the proven seriesMaster handling in `POST /api/events/load` (`backend/api-server.js:6156-6190`), adapted to search's inclusive string bounds.

- [ ] **Step 1: Write the failing tests**

Append to `backend/__tests__/unit/utils/eventDateRangeFilter.test.js` (inside the file, as a new top-level `describe`; keep the existing `require` line and add the new symbol to it):

```js
describe('buildSeriesAwareDateRangeClause (EDR-10+)', () => {
  const { buildSeriesAwareDateRangeClause } = require('../../../utils/eventDateRangeFilter');

  it('EDR-10: returns a $or with four branches', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-22');
    expect(Array.isArray(clause.$or)).toBe(true);
    expect(clause.$or).toHaveLength(4);
  });

  it('EDR-11: concrete-event branch excludes seriesMaster and stored occurrence docs and uses overlap bounds', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const concrete = clause.$or[0];
    expect(concrete.eventType).toEqual({ $nin: ['seriesMaster', 'occurrence'] });
    expect(concrete['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(concrete['calendarData.endDateTime']).toEqual({ $gte: '2026-07-21T00:00:00' });
  });

  it('EDR-12: legacy branch matches docs with no eventType via overlap bounds', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const legacy = clause.$or[1];
    expect(legacy.eventType).toEqual({ $exists: false });
    expect(legacy['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(legacy['calendarData.endDateTime']).toEqual({ $gte: '2026-07-21T00:00:00' });
  });

  it('EDR-13: seriesMaster branch matches on recurrence range, not first-occurrence end', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const master = clause.$or[2];
    expect(master.eventType).toBe('seriesMaster');
    expect(master['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(master.$or).toEqual([
      { 'recurrence.range.endDate': { $gte: '2026-07-21' } },
      { 'recurrence.range.type': 'noEnd' },
      { 'recurrence.range.type': 'numbered' },
    ]);
    // The clause must NOT constrain calendarData.endDateTime for masters —
    // that field holds only the FIRST occurrence's end and is what excluded
    // every series from search until now.
    expect(master['calendarData.endDateTime']).toBeUndefined();
  });

  it('EDR-14: additions branch matches masters with an ad-hoc date inside the window via $elemMatch', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-22');
    const additions = clause.$or[3];
    expect(additions.eventType).toBe('seriesMaster');
    expect(additions['recurrence.additions']).toEqual({
      $elemMatch: { $gte: '2026-07-21', $lte: '2026-07-22' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; npm test -- eventDateRangeFilter.test.js`
Expected: FAIL — `buildSeriesAwareDateRangeClause is not a function`.

- [ ] **Step 3: Implement**

In `backend/utils/eventDateRangeFilter.js`, add below `buildEventDateRangeOverlapFilter` and export both:

```js
/**
 * Recurrence-aware date clause for the SEARCH view.
 *
 * A seriesMaster's calendarData.startDateTime/endDateTime hold only its FIRST
 * occurrence (see the explicit note at api-server.js getUnifiedEvents), so the
 * flat overlap filter above can never match a series for any window after its
 * first-occurrence day — the root cause of recurring events missing from
 * Search & Export. Masters must instead match on their recurrence RANGE.
 *
 * Branches (OR-ed):
 *  1. Concrete events (singleInstance, exception, addition): standard overlap.
 *     Stored eventType 'occurrence' docs are excluded — occurrences are
 *     regenerated from their master during expansion, so returning stored
 *     occurrence rows would double-count.
 *  2. Legacy docs with no eventType: standard overlap.
 *  3. seriesMaster: series started on/before the window end AND the recurrence
 *     range reaches the window (endDate >= windowStart, or noEnd/numbered).
 *  4. seriesMaster with an ad-hoc additions date inside the window ($elemMatch
 *     so both bounds apply to a single element).
 *
 * Mirrors the seriesMaster OR clause in POST /api/events/load. Both bounds are
 * required (the search view 400s without them).
 *
 * @param {string} startDate - 'YYYY-MM-DD' window start (inclusive).
 * @param {string} endDate   - 'YYYY-MM-DD' window end (inclusive).
 * @returns {{ $or: Array<object> }} fragment to push into query.$and.
 */
function buildSeriesAwareDateRangeClause(startDate, endDate) {
  const windowEndBound = `${endDate}T23:59:59`;
  const windowStartBound = `${startDate}T00:00:00`;
  return {
    $or: [
      {
        eventType: { $nin: ['seriesMaster', 'occurrence'] },
        'calendarData.startDateTime': { $lte: windowEndBound },
        'calendarData.endDateTime': { $gte: windowStartBound },
      },
      {
        eventType: { $exists: false },
        'calendarData.startDateTime': { $lte: windowEndBound },
        'calendarData.endDateTime': { $gte: windowStartBound },
      },
      {
        eventType: 'seriesMaster',
        'calendarData.startDateTime': { $lte: windowEndBound },
        $or: [
          { 'recurrence.range.endDate': { $gte: startDate } },
          { 'recurrence.range.type': 'noEnd' },
          { 'recurrence.range.type': 'numbered' },
        ],
      },
      {
        eventType: 'seriesMaster',
        'recurrence.additions': { $elemMatch: { $gte: startDate, $lte: endDate } },
      },
    ],
  };
}

module.exports = { buildEventDateRangeOverlapFilter, buildSeriesAwareDateRangeClause };
```

(Replace the existing `module.exports` line — keep `buildEventDateRangeOverlapFilter` exported.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; npm test -- eventDateRangeFilter.test.js`
Expected: PASS (existing EDR tests + new EDR-10..14).

- [ ] **Step 5: Commit**

```bash
git add backend/utils/eventDateRangeFilter.js backend/__tests__/unit/utils/eventDateRangeFilter.test.js
git commit -m "feat(search): add recurrence-aware date clause for series masters

- seriesMaster docs store only first-occurrence dates, so the flat overlap
  filter excluded every series from search windows after day one
- new clause matches masters on recurrence.range and additions, mirroring
  the proven /api/events/load handling
- Tests: 5 new, eventDateRangeFilter suite passing"
```

---

### Task 2: Generalize `findWithColdEmptyRetry` to short reads

**Files:**
- Modify: `backend/utils/coldEmptyRetry.js`
- Test: `backend/__tests__/unit/utils/coldEmptyRetry.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `findWithColdEmptyRetry(runFind, runCount, options)` gains `options.expectedFromCount: (count: number) => number`. Default `(count) => (count > 0 ? 1 : 0)` preserves today's behavior exactly (including the no-count fast path when the first find is non-empty). With `expectedFromCount` supplied, a find shorter than `expectedFromCount(count)` triggers bounded retries; the longest result seen is returned.

- [ ] **Step 1: Write the failing tests**

Append to `backend/__tests__/unit/utils/coldEmptyRetry.test.js` (match the file's existing style for fakes; a `sleep: async () => {}` stub keeps tests instant):

```js
describe('expectedFromCount (short-read reconciliation)', () => {
  const noSleep = async () => {};

  it('retries when the find returns fewer docs than expectedFromCount(count)', async () => {
    const finds = [
      [{ id: 1 }, { id: 2 }],                                  // partial (5 expected)
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], // full
    ];
    let call = 0;
    const runFind = async () => finds[Math.min(call++, finds.length - 1)];
    const runCount = async () => 5;

    const results = await findWithColdEmptyRetry(runFind, runCount, {
      sleep: noSleep,
      expectedFromCount: (count) => Math.min(count, 2000),
    });
    expect(results).toHaveLength(5);
    expect(call).toBe(2);
  });

  it('returns the longest result seen when retries never reach expected', async () => {
    const finds = [[{ id: 1 }], [{ id: 1 }, { id: 2 }], [{ id: 1 }]];
    let call = 0;
    const runFind = async () => finds[Math.min(call++, finds.length - 1)];
    const runCount = async () => 5;

    const results = await findWithColdEmptyRetry(runFind, runCount, {
      sleep: noSleep,
      maxRetries: 2,
      expectedFromCount: (count) => count,
    });
    expect(results).toHaveLength(2); // best-so-far, not last-seen
  });

  it('does not retry when the find meets expectedFromCount(count)', async () => {
    let findCalls = 0;
    const runFind = async () => { findCalls++; return [{ id: 1 }, { id: 2 }]; };
    const runCount = async () => 2;

    const results = await findWithColdEmptyRetry(runFind, runCount, {
      sleep: noSleep,
      expectedFromCount: (count) => count,
    });
    expect(results).toHaveLength(2);
    expect(findCalls).toBe(1);
  });

  it('default behavior unchanged: non-empty first find returns without calling count', async () => {
    let countCalls = 0;
    const runFind = async () => [{ id: 1 }];
    const runCount = async () => { countCalls++; return 99; };

    const results = await findWithColdEmptyRetry(runFind, runCount, { sleep: noSleep });
    expect(results).toHaveLength(1);
    expect(countCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; npm test -- coldEmptyRetry.test.js`
Expected: FAIL — the first two new tests fail (no retry on short read); the last two pass (they assert current behavior).

- [ ] **Step 3: Implement**

Replace the body of `findWithColdEmptyRetry` in `backend/utils/coldEmptyRetry.js` (keep the file header comment; update the function's JSDoc to document the new option):

```js
async function findWithColdEmptyRetry(runFind, runCount, options = {}) {
  const {
    maxRetries = 3,
    delayMs = 250,
    sleep = defaultSleep,
    onColdEmpty = null,
    // Expected minimum result length as a function of the authoritative count.
    // Default preserves the original contract: any non-empty find is accepted
    // without a count round-trip; an empty find is reconciled against count>0.
    expectedFromCount = null,
  } = options;

  let results = await runFind();

  // Original fast path: with no explicit expectation, a non-empty find is
  // accepted immediately (no count query issued).
  if (!expectedFromCount && results.length > 0) return results;

  const count = await runCount();
  const expected = expectedFromCount ? expectedFromCount(count) : (count > 0 ? 1 : 0);
  if (results.length >= expected) return results;

  let best = results;
  for (let attempt = 1; attempt <= maxRetries && best.length < expected; attempt++) {
    if (onColdEmpty) onColdEmpty({ attempt, count, maxRetries, got: best.length, expected });
    await sleep(delayMs * attempt);
    results = await runFind();
    if (results.length > best.length) best = results;
  }
  return best;
}
```

Note: `onColdEmpty` gains `got`/`expected` fields — additive, no existing caller destructures beyond `attempt/count/maxRetries` (`api-server.js:6217`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; npm test -- coldEmptyRetry.test.js`
Expected: PASS — all pre-existing tests (behavior-preserving) plus 4 new.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/coldEmptyRetry.js backend/__tests__/unit/utils/coldEmptyRetry.test.js
git commit -m "feat(cosmos): reconcile short reads in findWithColdEmptyRetry

- optional expectedFromCount lets callers treat a PARTIAL cross-partition
  find as suspect, not just an all-empty one (the '5 results of 8' class)
- bounded retries, best-result-wins; default path byte-for-byte compatible
- Tests: 4 new, coldEmptyRetry suite passing"
```

---

### Task 3: Server-side expansion helper (`expandSearchResults`)

**Files:**
- Create: `backend/utils/searchOccurrenceExpansion.js`
- Test: `backend/__tests__/unit/utils/searchOccurrenceExpansion.test.js`

**Interfaces:**
- Consumes: `expandRecurringOccurrencesInWindow(masterEvent, windowStart: Date, windowEnd: Date)` from `backend/utils/recurrenceExpansion.js` (returns `[{ occurrenceDate, startDateTime, endDateTime }]`, honors `recurrence.exclusions`, derives time-of-day from the master's `calendarData` datetimes).
- Produces: `expandSearchResults(rawDocs: Array, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD') => Array` — masters replaced by per-occurrence rows; every other doc passed through untouched. Occurrence rows have: `eventType: 'occurrence'`, unique `eventId` (`<masterEventId>-occurrence-<date>`), string `_id` (`<masterId>-occ-<date>`), `seriesMasterId`/`masterEventId`, `isRecurringOccurrence: true`, `recurrence: null`, and BOTH top-level and `calendarData` datetimes rewritten to the occurrence's date. Dates present in the master's `occurrenceOverrides[].occurrenceDate` are skipped (the child doc is the row for that date).

- [ ] **Step 1: Write the failing tests**

Create `backend/__tests__/unit/utils/searchOccurrenceExpansion.test.js`:

```js
const { expandSearchResults } = require('../../../utils/searchOccurrenceExpansion');

// Weekly Tuesdays 2026-03-10 .. 2026-06-30, 10:00-11:00.
// 2026-06-16 is a Tuesday (14 weeks after 2026-03-10).
function makeMaster(overrides = {}) {
  return {
    _id: 'master-oid-1',
    eventId: 'master-1',
    eventType: 'seriesMaster',
    status: 'published',
    eventTitle: 'Weekly Torah Study',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      additions: [],
      exclusions: [],
    },
    calendarData: {
      eventTitle: 'Weekly Torah Study',
      startDateTime: '2026-03-10T10:00:00',
      endDateTime: '2026-03-10T11:00:00',
    },
    ...overrides,
  };
}

describe('expandSearchResults', () => {
  it('replaces a master with an occurrence row carrying the window date and master times', () => {
    const out = expandSearchResults([makeMaster()], '2026-06-16', '2026-06-16');
    expect(out).toHaveLength(1);
    const occ = out[0];
    expect(occ.eventType).toBe('occurrence');
    expect(occ.eventId).toBe('master-1-occurrence-2026-06-16');
    expect(occ.seriesMasterId).toBe('master-1');
    expect(occ.isRecurringOccurrence).toBe(true);
    expect(occ.recurrence).toBeNull();
    expect(occ.calendarData.startDateTime).toBe('2026-06-16T10:00:00');
    expect(occ.calendarData.endDateTime).toBe('2026-06-16T11:00:00');
    expect(occ.startDateTime).toBe('2026-06-16T10:00:00');
    expect(occ.startDate).toBe('2026-06-16');
    expect(occ.calendarData.eventTitle).toBe('Weekly Torah Study');
  });

  it('emits one row per pattern date across a multi-day window', () => {
    // 2026-06-16 and 2026-06-23 are consecutive Tuesdays
    const out = expandSearchResults([makeMaster()], '2026-06-15', '2026-06-24');
    expect(out.map(o => o.startDate)).toEqual(['2026-06-16', '2026-06-23']);
  });

  it('skips dates materialized as exception/addition children (occurrenceOverrides)', () => {
    const master = makeMaster({
      occurrenceOverrides: [{ occurrenceDate: '2026-06-16', locationDisplayNames: ['Library'] }],
    });
    const childDoc = {
      _id: 'child-oid-1',
      eventId: 'master-1-2026-06-16',
      eventType: 'exception',
      seriesMasterEventId: 'master-1',
      occurrenceDate: '2026-06-16',
      status: 'published',
      calendarData: { startDateTime: '2026-06-16T10:00:00', endDateTime: '2026-06-16T11:00:00' },
    };
    const out = expandSearchResults([master, childDoc], '2026-06-16', '2026-06-16');
    // Exactly ONE row for 2026-06-16: the child, not a synthetic occurrence.
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('exception');
  });

  it('honors recurrence.exclusions (delegated to expandRecurringOccurrencesInWindow)', () => {
    const master = makeMaster();
    master.recurrence.exclusions = ['2026-06-16'];
    const out = expandSearchResults([master], '2026-06-16', '2026-06-16');
    expect(out).toHaveLength(0);
  });

  it('passes non-master docs through untouched and drops a malformed master silently', () => {
    const single = { _id: 's1', eventId: 'single-1', eventType: 'singleInstance', calendarData: {} };
    const brokenMaster = makeMaster({ eventId: 'master-2', recurrence: null });
    const out = expandSearchResults([single, brokenMaster], '2026-06-16', '2026-06-16');
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(single);
  });

  it('does not leak occurrenceOverrides onto occurrence rows and keeps _id unique per row', () => {
    const master = makeMaster({ occurrenceOverrides: [{ occurrenceDate: '2026-06-23' }] });
    const out = expandSearchResults([master], '2026-06-16', '2026-06-16');
    expect(out).toHaveLength(1);
    expect(out[0].occurrenceOverrides).toBeUndefined();
    expect(out[0]._id).toBe('master-oid-1-occ-2026-06-16');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; npm test -- searchOccurrenceExpansion.test.js`
Expected: FAIL — cannot find module `searchOccurrenceExpansion`.

- [ ] **Step 3: Implement**

Create `backend/utils/searchOccurrenceExpansion.js`:

```js
// backend/utils/searchOccurrenceExpansion.js
//
// Server-side recurrence expansion for the SEARCH view of /api/events/list.
//
// A seriesMaster doc stores only its FIRST occurrence's datetimes; the search
// view returns a flat, paginated list, so masters must be replaced with
// per-occurrence rows for the requested window. Dates that have a
// materialized exception/addition child (listed in the master's enriched
// occurrenceOverrides — every entry carries occurrenceDate, and occurrence
// dates are immutable) are skipped: the child document, matched by its own
// calendarData dates, IS the row for that date.
//
// Callers MUST run enrichSeriesMastersWithOverrides on the raw docs first,
// otherwise customized dates double-render (synthetic occurrence + child).

const { expandRecurringOccurrencesInWindow } = require('./recurrenceExpansion');

function buildOccurrenceRow(master, occ) {
  const row = {
    ...master,
    _id: `${String(master._id)}-occ-${occ.occurrenceDate}`,
    eventId: `${master.eventId}-occurrence-${occ.occurrenceDate}`,
    eventType: 'occurrence',
    seriesMasterId: master.eventId,
    masterEventId: master.eventId,
    isRecurringOccurrence: true,
    recurrence: null,
    startDateTime: occ.startDateTime,
    endDateTime: occ.endDateTime,
    startDate: occ.occurrenceDate,
    endDate: occ.occurrenceDate,
    calendarData: {
      ...(master.calendarData || {}),
      startDateTime: occ.startDateTime,
      endDateTime: occ.endDateTime,
      startDate: occ.occurrenceDate,
      endDate: occ.occurrenceDate,
    },
  };
  delete row.occurrenceOverrides;
  return row;
}

/**
 * @param {Array<object>} rawDocs - enriched raw documents from the search find
 * @param {string} startDate - 'YYYY-MM-DD' window start (inclusive)
 * @param {string} endDate - 'YYYY-MM-DD' window end (inclusive)
 * @returns {Array<object>} non-master docs + synthetic occurrence rows
 */
function expandSearchResults(rawDocs, startDate, endDate) {
  const masters = [];
  const rest = [];
  for (const doc of rawDocs) {
    if (doc.eventType === 'seriesMaster') masters.push(doc);
    else rest.push(doc);
  }
  if (masters.length === 0) return rest;

  const windowStart = new Date(`${startDate}T00:00:00`);
  const windowEnd = new Date(`${endDate}T23:59:59`);

  const occurrenceRows = [];
  for (const master of masters) {
    if (!master.recurrence?.pattern || !master.recurrence?.range) continue;
    const materialized = new Set(
      (master.occurrenceOverrides || []).map(o => o && o.occurrenceDate).filter(Boolean)
    );
    const occurrences = expandRecurringOccurrencesInWindow(master, windowStart, windowEnd);
    for (const occ of occurrences) {
      if (materialized.has(occ.occurrenceDate)) continue;
      occurrenceRows.push(buildOccurrenceRow(master, occ));
    }
  }
  return rest.concat(occurrenceRows);
}

module.exports = { expandSearchResults };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; npm test -- searchOccurrenceExpansion.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/utils/searchOccurrenceExpansion.js backend/__tests__/unit/utils/searchOccurrenceExpansion.test.js
git commit -m "feat(search): server-side occurrence expansion helper

- replaces seriesMaster docs with per-occurrence rows for a date window
- skips dates materialized as exception/addition children to prevent
  master+child duplicates
- Tests: 6 new, all passing"
```

---

### Task 4: Wire the search branch in `api-server.js`

**Files:**
- Modify: `backend/api-server.js` (search branch ~7508-7532, shared date block ~7534-7544, execute section ~7648-7682)
- Test: `backend/__tests__/integration/events/searchView.test.js`

**Interfaces:**
- Consumes: `buildSeriesAwareDateRangeClause` (Task 1), `findWithColdEmptyRetry` with `expectedFromCount` (Task 2), `expandSearchResults` (Task 3), existing `enrichSeriesMastersWithOverrides`, `withCosmosRetry`, `EVENT_LIST_PROJECTION`.
- Produces: unchanged response contract `{ events, pagination: { page, limit, totalCount, totalPages, hasMore }, exportCapped }` — but for search, `totalCount` now counts OCCURRENCES (same array as `events`), and `exportCapped` reflects the expanded length.

**Pre-check (do before writing code):** confirm `EVENT_LIST_PROJECTION` includes `recurrence`, `eventType`, `seriesMasterEventId`, `occurrenceDate`, and `occurrenceOverrides` is not excluded — expansion silently produces nothing without `recurrence`. Run: `grep -n "EVENT_LIST_PROJECTION" backend/api-server.js` and read the definition. If any of those fields are missing, add them to the projection in this task.

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/__tests__/integration/events/searchView.test.js`. Extend the existing factory import with the recurring helpers:

```js
const {
  createPendingEvent,
  createPublishedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
```

New tests (factory default recurrence = weekly Tuesdays, `range 2026-03-10 .. 2026-06-30`; 2026-06-16 is a Tuesday 14 weeks in):

```js
  // ── Recurring events in search (SV-13+) ──
  // A series master stores only its FIRST occurrence's datetimes, so these
  // tests pin the master start explicitly and search a window months later.
  function makePublishedMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      eventTitle: 'Weekly Torah Study',
      status: 'published',
      startDateTime: new Date('2026-03-10T10:00:00'),
      endDateTime: new Date('2026-03-10T11:00:00'),
      ...overrides,
    });
  }

  it('SV-13: search returns a virtual occurrence of a series that started before the window', async () => {
    await insertEvents(db, [makePublishedMaster()]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    const occ = res.body.events[0];
    expect(occ.calendarData.eventTitle).toBe('Weekly Torah Study');
    expect(occ.eventType).toBe('occurrence');
    expect(occ.calendarData.startDateTime).toBe('2026-06-16T10:00:00');
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it('SV-14: a customized occurrence returns the exception child exactly once (no master duplicate)', async () => {
    const master = makePublishedMaster();
    const exception = createExceptionDocument(
      master, '2026-06-16', { locationDisplayNames: ['Library'] }, { status: 'published' }
    );
    await insertEvents(db, [master, exception]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('exception');
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it('SV-15: an excluded occurrence date returns nothing for that series', async () => {
    const master = makePublishedMaster();
    master.recurrence.exclusions = ['2026-06-16'];
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
    expect(res.body.pagination.totalCount).toBe(0);
  });

  it('SV-16: an ad-hoc addition child on an off-pattern date is returned', async () => {
    const master = makePublishedMaster();
    // 2026-06-17 is a Wednesday — off the Tuesday pattern
    const addition = createAdditionDocument(master, '2026-06-17', {}, { status: 'published' });
    await insertEvents(db, [master, addition]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-17&endDate=2026-06-17`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('addition');
  });

  it('SV-17: totalCount counts occurrences from the SAME array as the page (no count/find divergence)', async () => {
    const singles = ['A', 'B', 'C'].map(suffix => {
      const ev = createPublishedEvent({ eventTitle: `Single ${suffix}` });
      ev.calendarData.startDateTime = '2026-06-16T14:00:00';
      ev.calendarData.endDateTime = '2026-06-16T15:00:00';
      return ev;
    });
    await insertEvents(db, [makePublishedMaster(), ...singles]);

    const page1 = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16&limit=2&page=1`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(page1.status).toBe(200);
    expect(page1.body.events).toHaveLength(2);
    expect(page1.body.pagination.totalCount).toBe(4); // 3 singles + 1 occurrence
    expect(page1.body.pagination.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16&limit=2&page=2`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(page2.body.events).toHaveLength(2);
    expect(page2.body.pagination.hasMore).toBe(false);
  });

  it('SV-18: a series whose recurrence range ended before the window is not returned', async () => {
    await insertEvents(db, [makePublishedMaster()]); // range ends 2026-06-30

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-07-21&endDate=2026-07-21`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  it('SV-19: export mode (limit=0) includes expanded occurrences', async () => {
    await insertEvents(db, [makePublishedMaster()]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-01&endDate=2026-06-30&limit=0`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    // Tuesdays in June 2026 within the range: 06-02, 06-09, 06-16, 06-23, 06-30
    expect(res.body.events).toHaveLength(5);
    expect(res.body.events.every(e => e.eventType === 'occurrence')).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd backend; npm test -- searchView.test.js`
Expected: SV-1..SV-12 PASS; SV-13, SV-15 (returns master row? no — master excluded by date filter, so 0 events but ALSO SV-13 gets 0), SV-17, SV-19 FAIL. SV-14/SV-16 may pass partially (children already leak in) — confirm SV-14 fails on `totalCount`/duplication if the master's first occurrence is outside the window (it is), so SV-14 should pass its length check pre-fix; that is acceptable — it locks the post-fix dedupe.

- [ ] **Step 3: Implement the wiring**

3a. Add imports near the existing `require` of `eventDateRangeFilter` in `backend/api-server.js`:

```js
const { buildEventDateRangeOverlapFilter, buildSeriesAwareDateRangeClause } = require('./utils/eventDateRangeFilter');
const { expandSearchResults } = require('./utils/searchOccurrenceExpansion');
```

(Adjust the first line in place — `buildEventDateRangeOverlapFilter` is already required.)

3b. Replace the shared date-filter application (`api-server.js:7534-7544`, the block ending in `Object.assign(query, buildEventDateRangeOverlapFilter(startDate, endDate));`) with:

```js
    // ── Date range filter ──
    // OVERLAP semantics for concrete events. The SEARCH view additionally needs
    // recurrence-aware matching: a seriesMaster's calendarData datetimes hold
    // only its FIRST occurrence, so the flat overlap filter can never match a
    // series for any later window — masters must match on recurrence.range
    // instead (same approach as POST /api/events/load). calendarData.* are
    // local-time ISO strings, so both builders compare with local-time string
    // boundaries (no Date objects, no host-timezone shift).
    if (view === 'search') {
      query.$and = [...(query.$and || []), buildSeriesAwareDateRangeClause(startDate, endDate)];
    } else {
      Object.assign(query, buildEventDateRangeOverlapFilter(startDate, endDate));
    }
```

3c. Replace the execute section (`api-server.js:7648-7682` — from `const MAX_COUNT = 5000;` through the zero-only retry block) with:

```js
    // ── Execute query ──
    const MAX_COUNT = 5000;
    let totalCount = 0;
    let totalCapped = false;
    let events;

    if (view === 'search') {
      // Recurring-aware search: fetch EVERY matching raw doc in the window
      // (no skip/limit — pagination happens after expansion), expand series
      // masters into per-occurrence rows, and derive count + page from the
      // SAME array so the displayed count can never disagree with the results
      // (the '5 results of 8' bug was countDocuments and find diverging on a
      // Cosmos partial cross-partition read).
      const runRawFind = () => withCosmosRetry(() =>
        unifiedEventsCollection.find(query).project(projection).limit(EXPORT_MAX_EVENTS).toArray()
      );
      const runRawCount = () => withCosmosRetry(() =>
        unifiedEventsCollection.countDocuments(query, { limit: EXPORT_MAX_EVENTS + 1 })
      );
      let rawDocs = await findWithColdEmptyRetry(runRawFind, runRawCount, {
        expectedFromCount: (count) => Math.min(count, EXPORT_MAX_EVENTS),
        onColdEmpty: ({ attempt, count, maxRetries, got, expected }) =>
          logger.warn(`[events/list] view=search short read: got=${got} expected=${expected} (count=${count}), retry ${attempt}/${maxRetries} (suspected Cosmos cold cross-partition query)`),
      });
      if (rawDocs.length >= EXPORT_MAX_EVENTS) {
        logger.warn(`[events/list] view=search raw fetch hit cap (${EXPORT_MAX_EVENTS} docs); results may be truncated`);
      }

      // Overrides must be attached BEFORE expansion so materialized
      // (customized) dates are skipped — otherwise the master's synthetic
      // occurrence and the exception child both render for the same date.
      if (rawDocs.some(e => e.eventType === 'seriesMaster')) {
        rawDocs = await withCosmosRetry(() =>
          enrichSeriesMastersWithOverrides(unifiedEventsCollection, rawDocs, {
            log: (info) => logger.debug('[exceptionEnrichment] view=search(pre-expansion)', info),
            warn: (msg, ctx) => logger.debug(`${msg} view=search(pre-expansion)`, ctx),
            retry: (ctx) => logger.debug(`[exceptionEnrichment] view=search(pre-expansion) retry produced ${ctx.childCount} children`),
          })
        );
      }

      const expanded = expandSearchResults(rawDocs, startDate, endDate);
      // Sort BEFORE slicing — the page is a window into the sorted whole.
      expanded.sort((a, b) => {
        const dateA = a.calendarData?.startDateTime || a.graphData?.start?.dateTime || '';
        const dateB = b.calendarData?.startDateTime || b.graphData?.start?.dateTime || '';
        return dateB.localeCompare(dateA);
      });

      totalCapped = expanded.length > MAX_COUNT;
      totalCount = totalCapped ? MAX_COUNT : expanded.length;
      events = limitNum > 0 ? expanded.slice(skip, skip + limitNum) : expanded;
    } else {
      if (limitNum > 0) {
        totalCount = await withCosmosRetry(() => unifiedEventsCollection.countDocuments(query, { limit: MAX_COUNT + 1 }));
        if (totalCount > MAX_COUNT) {
          totalCapped = true;
          totalCount = MAX_COUNT;
        }
      }

      const runFind = () => withCosmosRetry(async () => {
        let cursor = unifiedEventsCollection.find(query).project(projection);
        if (limitNum > 0) {
          cursor = cursor.skip(skip).limit(limitNum);
        }
        return cursor.toArray();
      });

      events = await runFind();

      // Cosmos cross-partition cold-query mitigation. The count and the find use
      // the IDENTICAL query, so an empty find while the count is positive means the
      // cross-partition find returned silently-empty on a cold call (index metadata
      // warming). withCosmosRetry only retries thrown throttle errors, not a
      // successful-but-empty result, so retry the find once here. This only fires
      // on a provable count/find inconsistency. Manifested as 'Found N events.
      // Showing first 0'.
      if (limitNum > 0 && totalCount > 0 && events.length === 0) {
        logger.warn(`[events/list] view=${view}: count=${totalCount} but find returned 0; retrying find once (suspected Cosmos cold cross-partition query)`);
        events = await runFind();
      }
    }
```

Notes on what happens downstream (no changes needed there):
- The shared sort at ~7685 re-sorts the search page with the identical comparator — harmless.
- The `_hasMastersForList` enrichment gate is false for search post-expansion (no masters remain) — no double enrichment.
- `totalPages`/`hasMore`/`exportCapped` at ~7764-7776 compute correctly from the branch-set `totalCount`/`events`/`skip`.
- `let events` replaces the previous `let events = await runFind();` declaration — make sure the variable is declared once (in the new block) and the old declaration is removed.

3d. Change the `exportCapped` line (~7776) to reflect expanded length for search — it already reads `totalCount > EXPORT_MAX_EVENTS`, which now uses the expanded count for search. No change needed; verify only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; npm test -- searchView.test.js`
Expected: PASS — SV-1..SV-19 all green. SV-5/SV-6/SV-7/SV-12 (existing) must still pass — they exercise the non-recurring branches of the new clause.

Also run the neighboring views' suites to prove no regression from the execute-section restructure:
Run: `cd backend; npm test -- --testPathPattern "listView|approvalQueue|myEvents"` (adjust to the actual file names found via `ls backend/__tests__/integration/events/`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/__tests__/integration/events/searchView.test.js
git commit -m "fix(search): return recurring occurrences with coherent counts

- search view now matches series masters on recurrence.range and expands
  them server-side into per-occurrence rows for the window
- customized dates dedupe to their exception/addition child via
  pre-expansion enrichment
- count and page now derive from the same expanded array, eliminating the
  countDocuments/find divergence behind '5 results of 8'; raw fetch guarded
  by bounded short-read reconciliation
- PDF/CSV/JSON export re-queries this endpoint, so exports inherit the fix
- Tests: 7 new integration (SV-13..SV-19), searchView suite passing"
```

---

### Task 5: Frontend agenda pipeline (`prepareEventsForAgenda`)

**Files:**
- Create: `src/utils/agendaEventPipeline.js`
- Test: `src/__tests__/unit/utils/agendaEventPipeline.test.js`

**Interfaces:**
- Consumes: `expandRecurringSeries(masterForExpansion, expandStart: 'YYYY-MM-DD', expandEnd: 'YYYY-MM-DD', exceptions, eventOverrides, materializedDates)` from `src/utils/recurrenceUtils.js` (same call desktop `Calendar.jsx:1688-1695` makes; returns occurrences with `start.dateTime`, `end.dateTime`, optional override fields and `hasOccurrenceOverride`/`isAdHocAddition` flags).
- Produces: `prepareEventsForAgenda(rawEvents: Array, rangeStart: Date, rangeEnd: Date) => Array` — raw `/api/events/load` docs in, render-ready docs out: masters expanded to occurrence rows (unique `eventId`), exception/addition children normalized and kept, stored Graph occurrence records dropped, masters removed. Output rows are still RAW-shaped (top-level `start`/`end` objects + datetimes) so `transformEventToFlatStructure` consumes them unchanged (occurrence rows set `isRecurringOccurrence: true`, which that transform already special-cases to avoid leaking master times from inherited `calendarData` — see `eventTransformers.js:236-247`).

This intentionally mirrors `Calendar.jsx:1522-1827` minus desktop-only concerns (expansion cache, edit-request scoping, occurrence numbering). Follow-up (NOT this plan): refactor `Calendar.jsx` to consume this util.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/unit/utils/agendaEventPipeline.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { prepareEventsForAgenda } from '../../../utils/agendaEventPipeline';

// Weekly Tuesdays 2026-03-10 .. 2026-06-30, 10:00-11:00.
// 2026-06-16 / 2026-06-23 are Tuesdays.
function makeMaster(overrides = {}) {
  return {
    _id: 'master-oid-1',
    eventId: 'master-1',
    eventType: 'seriesMaster',
    status: 'published',
    eventTitle: 'Intro to Judaism',
    startDateTime: '2026-03-10T10:00:00',
    endDateTime: '2026-03-10T11:00:00',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      additions: [],
      exclusions: [],
    },
    calendarData: {
      eventTitle: 'Intro to Judaism',
      startDateTime: '2026-03-10T10:00:00',
      endDateTime: '2026-03-10T11:00:00',
      locationDisplayNames: ['Room 402 - Leventritt', 'Library'],
    },
    locationDisplayNames: ['Room 402 - Leventritt', 'Library'],
    ...overrides,
  };
}

function makeExceptionChild(overrides = {}) {
  return {
    _id: 'child-oid-1',
    eventId: 'master-1-2026-06-16',
    eventType: 'exception',
    seriesMasterEventId: 'master-1',
    occurrenceDate: '2026-06-16',
    status: 'published',
    eventTitle: 'Intro to Judaism',
    startDateTime: '2026-06-16T10:00:00',
    endDateTime: '2026-06-16T11:00:00',
    locationDisplayNames: ['Room 402 - Leventritt'],
    calendarData: {
      eventTitle: 'Intro to Judaism',
      startDateTime: '2026-06-16T10:00:00',
      endDateTime: '2026-06-16T11:00:00',
      locationDisplayNames: ['Room 402 - Leventritt'],
    },
    ...overrides,
  };
}

const RANGE_START = new Date(2026, 5, 14); // 2026-06-14 local
const RANGE_END = new Date(2026, 5, 27, 23, 59, 59); // 2026-06-27 local

describe('prepareEventsForAgenda', () => {
  it('expands a master into occurrence rows and removes the master itself', () => {
    const out = prepareEventsForAgenda([makeMaster()], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventType === 'seriesMaster')).toBe(false);
    const dates = out.map(e => e.startDate).sort();
    expect(dates).toEqual(['2026-06-16', '2026-06-23']);
    expect(out[0].eventType).toBe('occurrence');
    expect(out[0].isRecurringOccurrence).toBe(true);
  });

  it('gives every occurrence row a unique eventId (list keys and append-dedupe rely on it)', () => {
    const out = prepareEventsForAgenda([makeMaster()], RANGE_START, RANGE_END);
    const ids = out.map(e => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('master-1-occurrence-2026-06-16');
  });

  it('renders a customized date exactly once — the child doc, not a master expansion (the phone duplicate bug)', () => {
    const out = prepareEventsForAgenda([makeMaster(), makeExceptionChild()], RANGE_START, RANGE_END);
    const june16 = out.filter(e => (e.startDate || e.occurrenceDate) === '2026-06-16'
      || e.startDateTime?.startsWith('2026-06-16'));
    expect(june16).toHaveLength(1);
    expect(june16[0].eventType).toBe('exception');
    expect(june16[0].hasOccurrenceOverride).toBe(true);
    expect(june16[0].masterEventId).toBe('master-1');
    // The child's own room list wins — no second card with the master's rooms.
    expect(june16[0].locationDisplayNames).toEqual(['Room 402 - Leventritt']);
  });

  it('drops stored Graph occurrence records (they are regenerated from the master)', () => {
    const graphOccurrence = {
      eventId: 'graph-occ-1',
      eventType: 'occurrence',
      seriesMasterId: 'master-1',
      startDateTime: '2026-06-16T10:00:00',
    };
    const out = prepareEventsForAgenda([makeMaster(), graphOccurrence], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventId === 'graph-occ-1')).toBe(false);
  });

  it('passes standalone events through untouched', () => {
    const single = { eventId: 'single-1', eventType: 'singleInstance', status: 'published', startDateTime: '2026-06-17T09:00:00' };
    const out = prepareEventsForAgenda([single], RANGE_START, RANGE_END);
    expect(out).toContain(single);
  });

  it('keeps a corrupt master (no recurrence) as a plain event instead of dropping it', () => {
    const stale = makeMaster({ eventId: 'master-stale', recurrence: null });
    const out = prepareEventsForAgenda([stale], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventId === 'master-stale')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- agendaEventPipeline`
Expected: FAIL — cannot resolve `../../../utils/agendaEventPipeline`.

- [ ] **Step 3: Implement**

Create `src/utils/agendaEventPipeline.js`:

```js
/**
 * Shared expand/dedup pipeline for the mobile agenda.
 *
 * MobileAgenda originally rendered raw /api/events/load documents 1:1, which
 * broke both ways at once:
 *  - un-overridden recurring occurrences have NO document of their own (they
 *    exist only as virtual expansions of the seriesMaster) and silently
 *    disappeared from the phone;
 *  - customized occurrences rendered TWICE (the exception/addition child AND
 *    the master's own card), with divergent rooms/categories.
 *
 * This mirrors the desktop pipeline in Calendar.jsx (~1522-1827) minus
 * desktop-only concerns (expansion cache, edit-request scoping, occurrence
 * numbering). Follow-up: refactor Calendar.jsx to consume this util.
 */
import { expandRecurringSeries } from './recurrenceUtils';
import { logger } from './logger';

function getRecurrence(event) {
  return event.recurrence || event.graphData?.recurrence || null;
}

const pad = (n) => String(n).padStart(2, '0');
const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param {Array<object>} rawEvents - raw documents from POST /api/events/load
 * @param {Date} rangeStart - inclusive local range start
 * @param {Date} rangeEnd - inclusive local range end
 * @returns {Array<object>} render-ready docs: children normalized, masters
 *          replaced by per-occurrence rows, stored occurrence records dropped
 */
export function prepareEventsForAgenda(rawEvents, rangeStart, rangeEnd) {
  const expandStart = toLocalDateStr(rangeStart);
  const expandEnd = toLocalDateStr(rangeEnd);

  const kept = [];
  const masters = [];
  const materializedDatesByMaster = new Map();

  for (const event of rawEvents) {
    const type = event.eventType || event.graphData?.type;
    const seriesMasterId = event.seriesMasterId || event.graphData?.seriesMasterId;

    if (event.eventType === 'exception' || event.eventType === 'addition') {
      // Materialized child: the authoritative row for its date. Normalize the
      // flags downstream consumers (cards, icons) read, and record its date so
      // master expansion skips it (this is the dedup that desktop does).
      if (event.seriesMasterEventId && event.occurrenceDate) {
        if (!materializedDatesByMaster.has(event.seriesMasterEventId)) {
          materializedDatesByMaster.set(event.seriesMasterEventId, new Set());
        }
        materializedDatesByMaster.get(event.seriesMasterEventId).add(event.occurrenceDate);
      }
      kept.push({
        ...event,
        isRecurringOccurrence: true,
        masterEventId: event.seriesMasterEventId,
        hasOccurrenceOverride: true,
        isAdHocAddition: event.eventType === 'addition',
      });
      continue;
    }

    if (type === 'seriesMaster' && getRecurrence(event)) {
      masters.push(event);
      continue;
    }

    // Stored Graph occurrence records are regenerated from their master.
    // (A seriesMaster with null recurrence is a stale record — falls through
    // and renders as a plain event, matching desktop behavior.)
    if (seriesMasterId) continue;

    kept.push(event);
  }

  for (const master of masters) {
    const recurrence = getRecurrence(master);
    if (!recurrence?.pattern || !recurrence?.range) {
      kept.push(master);
      continue;
    }

    const masterForExpansion = {
      eventId: master.eventId,
      start: { dateTime: master.startDateTime || master.calendarData?.startDateTime, timeZone: 'America/New_York' },
      end: { dateTime: master.endDateTime || master.calendarData?.endDateTime, timeZone: 'America/New_York' },
      subject: master.subject || master.eventTitle || master.calendarData?.eventTitle,
      recurrence,
      calendarData: master.calendarData,
    };

    let occurrences = [];
    try {
      occurrences = expandRecurringSeries(
        masterForExpansion,
        expandStart,
        expandEnd,
        [], // exceptions (Graph API only)
        master.occurrenceOverrides || [],
        materializedDatesByMaster.get(master.eventId) || null
      );
    } catch (error) {
      logger.error('agendaEventPipeline: error expanding series', master.eventId, error);
      continue;
    }

    for (const occurrence of occurrences) {
      const occurrenceDate = occurrence.start.dateTime.split('T')[0];
      kept.push({
        ...master,
        eventId: `${master.eventId}-occurrence-${occurrenceDate}`,
        eventType: 'occurrence',
        seriesMasterId: master.eventId,
        masterEventId: master.eventId,
        isRecurringOccurrence: true,
        recurrence: null,
        start: occurrence.start,
        end: occurrence.end,
        startDate: occurrenceDate,
        startDateTime: occurrence.start.dateTime,
        endDateTime: occurrence.end.dateTime,
        endDate: occurrence.end.dateTime.split('T')[0],
        startTime: occurrence.start.dateTime.split('T')[1]?.substring(0, 5),
        endTime: occurrence.end.dateTime.split('T')[1]?.substring(0, 5),
        subject: occurrence.subject || master.subject,
        eventTitle: occurrence.eventTitle || master.eventTitle || master.calendarData?.eventTitle,
        hasOccurrenceOverride: occurrence.hasOccurrenceOverride || false,
        isAdHocAddition: occurrence.isAdHocAddition || false,
        // Re-apply per-occurrence override fields: expandRecurringSeries spreads
        // them onto its output, but this row is rebuilt from ...master, so
        // master values would win without this (same block as Calendar.jsx).
        ...(occurrence.hasOccurrenceOverride ? {
          ...(occurrence.locations !== undefined && { locations: occurrence.locations }),
          ...(occurrence.locationDisplayNames !== undefined && { locationDisplayNames: occurrence.locationDisplayNames }),
          ...(occurrence.startTime !== undefined && { startTime: occurrence.startTime }),
          ...(occurrence.endTime !== undefined && { endTime: occurrence.endTime }),
          ...(occurrence.categories !== undefined && { categories: occurrence.categories }),
          ...(occurrence.services !== undefined && { services: occurrence.services }),
          ...(occurrence.eventDescription !== undefined && { eventDescription: occurrence.eventDescription }),
          ...(occurrence.isOffsite !== undefined && { isOffsite: occurrence.isOffsite }),
          ...(occurrence.offsiteName !== undefined && { offsiteName: occurrence.offsiteName }),
          ...(occurrence.offsiteAddress !== undefined && { offsiteAddress: occurrence.offsiteAddress }),
        } : {}),
      });
    }
  }

  return kept;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- agendaEventPipeline`
Expected: PASS (6 tests). If the materialized-date or flag assertions fail, check `expandRecurringSeries`'s actual output shape in `src/utils/recurrenceUtils.js:222` and `src/__tests__/unit/utils/recurrenceUtils.test.js` before changing the pipeline — the util is the contract, tests must match it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/agendaEventPipeline.js src/__tests__/unit/utils/agendaEventPipeline.test.js
git commit -m "feat(mobile): shared expand/dedup pipeline for agenda events

- expands series masters into virtual occurrences within the loaded range
- normalizes exception/addition children and skips their dates during
  expansion so customized occurrences render exactly once
- drops stored occurrence records and master cards, mirroring desktop
- Tests: 6 new, agendaEventPipeline suite passing"
```

---

### Task 6: Wire the pipeline into `MobileAgenda`

**Files:**
- Modify: `src/components/mobile/MobileAgenda.jsx:74-76` (inside `fetchEvents`)

**Interfaces:**
- Consumes: `prepareEventsForAgenda(rawEvents, rangeStart, rangeEnd)` from Task 5. `fetchEvents` already has `rangeStart`/`rangeEnd` as `Date` params.
- Produces: no API change — `events` state now contains expanded/deduped rows. Append-dedupe keeps working because occurrence rows carry unique `eventId` and `transformEventToFlatStructure` maps `id` from `eventId` (`eventTransformers.js:292`).

- [ ] **Step 1: Make the change**

In `src/components/mobile/MobileAgenda.jsx`, add the import:

```js
import { prepareEventsForAgenda } from '../../utils/agendaEventPipeline';
```

and replace lines 74-76:

```js
      const transformed = rawEvents
        .map(e => transformEventToFlatStructure(e))
        .filter(e => e.status === 'published' || e.status === 'pending');
```

with:

```js
      // Expand recurring series and dedupe customized occurrences BEFORE
      // flattening — raw docs contain seriesMaster + exception/addition
      // children, not renderable occurrence rows (see agendaEventPipeline).
      const transformed = prepareEventsForAgenda(rawEvents, rangeStart, rangeEnd)
        .map(e => transformEventToFlatStructure(e))
        .filter(e => e.status === 'published' || e.status === 'pending');
```

- [ ] **Step 2: Run the frontend unit suite for regressions**

Run: `npm run test:run`
Expected: PASS (169 existing + 6 from Task 5; no mobile component tests exist today — verify with `ls src/__tests__` and update any that appear).

- [ ] **Step 3: Manual verification (dev servers)**

1. `cd backend; npm run dev` and `npm run dev` (root).
2. Open `https://localhost:5173` in a browser window narrowed to <= 480px (or DevTools device emulation, e.g. iPhone SE) — this routes to `MobileApp` (`useDeviceType` classifies `phone` at `max-width: 480px`).
3. Navigate the week strip to a week containing a known recurring series occurrence with NO customization — the occurrence must now appear.
4. Navigate to a date with a customized occurrence (an exception child) — exactly ONE card must render, showing the override's rooms/category.
5. Widen the window past 480px and confirm desktop Month/Week/Day views are unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile/MobileAgenda.jsx
git commit -m "fix(mobile): expand recurring series in the phone agenda

- MobileAgenda rendered raw documents 1:1, so un-overridden recurring
  occurrences never appeared and customized dates rendered twice
  (master card + exception child with divergent rooms/categories)
- route raw events through prepareEventsForAgenda before flattening
- Tests: covered by agendaEventPipeline unit suite"
```

---

### Task 7: Tooltips on the recurrence icons

**Files:**
- Modify: `src/components/shared/CalendarIcons.jsx:26-43`
- Test: `src/__tests__/unit/components/CalendarIcons.test.jsx` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `RecurringIcon` and `RecurringExceptionIcon` accept an optional `title` prop with sensible defaults; the SVG gains a `<title>` child (native browser tooltip on hover) and `role='img'` + `aria-label` for screen readers. No call-site changes required — `WeekView.jsx:492-494` and `DayView.jsx:546-548` pick up the defaults.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/components/CalendarIcons.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RecurringIcon, RecurringExceptionIcon } from '../../../components/shared/CalendarIcons';

describe('CalendarIcons recurrence tooltips', () => {
  it('RecurringIcon exposes a default tooltip and accessible label', () => {
    const { container } = render(<RecurringIcon />);
    const svg = container.querySelector('svg');
    expect(svg.querySelector('title').textContent).toBe('Recurring event');
    expect(svg.getAttribute('aria-label')).toBe('Recurring event');
    expect(svg.getAttribute('role')).toBe('img');
  });

  it('RecurringExceptionIcon explains the slash means a modified occurrence', () => {
    const { container } = render(<RecurringExceptionIcon />);
    const title = container.querySelector('svg title').textContent;
    expect(title).toBe('Recurring event - this occurrence was modified from the series');
  });

  it('accepts a custom title', () => {
    const { container } = render(<RecurringIcon title='Weekly series' />);
    expect(container.querySelector('svg title').textContent).toBe('Weekly series');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- CalendarIcons`
Expected: FAIL — no `<title>` element found.

- [ ] **Step 3: Implement**

In `src/components/shared/CalendarIcons.jsx`, replace `RecurringIcon` and `RecurringExceptionIcon`:

```jsx
export const RecurringIcon = ({ size = 12, className = '', title = 'Recurring event' }) => (
  <svg {...svgProps(size, className)} role="img" aria-label={title}>
    <title>{title}</title>
    <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
    <polyline points="12 1 12 4.5 8.5 4.5" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
    <polyline points="4 15 4 11.5 7.5 11.5" />
  </svg>
);

export const RecurringExceptionIcon = ({ size = 12, className = '', title = 'Recurring event - this occurrence was modified from the series' }) => (
  <svg {...svgProps(size, className)} role="img" aria-label={title}>
    <title>{title}</title>
    <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
    <polyline points="12 1 12 4.5 8.5 4.5" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
    <polyline points="4 15 4 11.5 7.5 11.5" />
    <line x1="2" y1="14" x2="14" y2="2" strokeWidth="2" />
  </svg>
);
```

(Leave every other icon in the file untouched — surgical change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- CalendarIcons`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/CalendarIcons.jsx src/__tests__/unit/components/CalendarIcons.test.jsx
git commit -m "feat(calendar): hover tooltips on recurrence icons

- native SVG title + aria-label on RecurringIcon and RecurringExceptionIcon
- slashed icon now self-explains as 'modified from the series'
- Tests: 3 new, passing"
```

---

## Post-plan verification and follow-ups (not tasks in this plan)

1. **End-to-end check (use the verify-app skill):** search 7/21/2026-7/21/2026 in Search & Export against dev data containing a recurring series — recurring occurrences appear, the count matches the list, PDF export includes them.
2. **Prod log check for the Cosmos partial-read theory:** grep backend logs for `[events/list] view=search short read` (new) and the existing `count=... but find returned 0` warn — confirms/denies the runtime attribution for the historical '5 of 8'.
3. **`occurrenceOverrides` delivery to RecurrenceTabContent:** the series editor DOES list customized dates (`RecurrenceTabContent.jsx:494-501`); if a user reports an empty exceptions list for a series with a slashed icon, investigate enrichment delivery (Network tab vs the `response preview` debug log at `api-server.js:7757-7761`), not missing UI.
4. **Follow-up refactor:** have `Calendar.jsx` consume `agendaEventPipeline` (or extract further) so desktop and mobile share one expansion implementation.
5. **Follow-up:** consider `expectedFromCount` short-read reconciliation for the non-search views (requires `min(limitNum, max(0, totalCount - skip))` page math — deliberately out of scope here).
6. **CLAUDE.md:** after archiving, note in 'Completed Architectural Work' that search expands recurrences server-side and counts occurrences.

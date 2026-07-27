# Sync Health Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an on-demand Sync Health report that diffs what the app believes is published against what Outlook actually shows, and names the specific discrepancies.

**Architecture:** A pure, I/O-free diff module (`syncHealthDiff.js`) holds every matching rule and is unit-tested without Mongo or Graph. A dependency-injected service (`syncHealthService.js`) does the Mongo query, series expansion, and per-calendar Graph fetch. `api-server.js` mounts a thin route over it; integration tests drive that same real route through `createAppForTest.js`, which injects a test DB and the Graph mock into the production Express app. The frontend is a single on-demand page following the `EventSearch` manual-query pattern.

**Tech Stack:** Node.js/Express + MongoDB driver (backend), Jest + MongoDB Memory Server (backend tests), React 19 + TanStack Query v5 (frontend), Vitest + Testing Library (frontend tests).

## Global Constraints

- **Spec of record:** `docs/superpowers/specs/2026-07-27-sync-health-report-design.md`. Every decision below traces to it.
- **Timezone:** all date comparison happens as **local dates in `America/New_York`**, never UTC. The calendar timezone constant is `'America/New_York'`.
- **Graph datetime shape:** `calendarView` returns `start.dateTime` WITHOUT a `Z` suffix plus a sibling `start.timeZone` field (`'UTC'` by default, since we do **not** send the `Prefer: outlook.timezone` header). A `Z` must be appended before any `new Date()` call or the value parses as host-local time.
- **Matching is by Graph ID** (plus date for series occurrences), **never by title or time** — renames and time edits must not produce findings.
- **`isCancelled: true`** Outlook instances are treated as absent.
- **Default window:** `startDate` = today−30 days, `endDate` = today+180 days.
- **Validation:** 400 when the window exceeds 400 days or `endDate < startDate`.
- **Auth:** allowed when `isAdmin(user, email)` OR `canApproveReservations(user, email)`; otherwise 403.
- **Partial success is a 200:** one calendar's Graph failure sets that calendar entry's `error` field; other calendars still return results.
- **Backend module system is CommonJS** (`require`/`module.exports`). Frontend is ESM.
- **No curly/smart quotes** anywhere — straight `"` and `'` only.
- **Git commit messages must not contain double quotes** — use single quotes when quoting values.
- **Do not run the full backend suite** (`npm test`, 472 tests, ~2 min). Run only the named test file for each task.
- **v1 excludes:** cron/email delivery, field-level comparison of matched pairs, stored report history, remediation actions.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `backend/utils/syncHealthDiff.js` | Pure functions. Eastern date-key normalization, Outlook indexing, and the whole matching/finding algorithm. No I/O, no `require` of Mongo or Graph. |
| `backend/services/syncHealthService.js` | Orchestration. Queries Mongo, groups by calendar, expands series, calls Graph per calendar with retry, delegates to the diff module, assembles the response. All dependencies injected. |
| `backend/__tests__/unit/utils/syncHealthDiff.test.js` | Unit tests for the diff module. |
| `backend/__tests__/integration/events/syncHealth.test.js` | Endpoint integration tests (permission gate, happy path with seeded discrepancy, partial Graph failure). |
| `src/components/SyncHealthReport.jsx` | The `/admin/sync-health` page. |
| `src/components/SyncHealthReport.css` | Page styles. |
| `src/__tests__/unit/components/SyncHealthReport.test.jsx` | Frontend tests. |

**Modify:**

| File | Change |
|---|---|
| `backend/api-server.js` | Mount `GET /api/admin/reports/sync-health` (thin route over the service). |
| `backend/__tests__/__helpers__/graphApiMock.js` | Add a `getCalendarEvents` mock (currently absent). |
| `src/queries/keys.js` | Add a `syncHealth` query-key entry. |
| `src/App.jsx` | Lazy import, `RequireSyncHealth` guard, `/admin/sync-health` route. |
| `src/components/Navigation.jsx` | Nav link (Admin dropdown + top-level for non-admin approvers). |

**Deviation from the spec, deliberate:** the spec names the unit test `backend/__tests__/unit/syncHealthDiff.test.js`. The repo convention is `backend/__tests__/unit/utils/` for util tests (see `retryWithBackoff.test.js`, `eventDateRangeFilter.test.js`). This plan follows the repo convention.

---

### Task 1: Outlook instance normalization (Eastern date keys + index)

The lowest layer of the diff module: turn raw Graph `calendarView` instances into a lookup structure keyed by Eastern-local date. Getting this wrong shifts every date-based comparison by the host's UTC offset, so it is isolated and tested first.

**Files:**
- Create: `backend/utils/syncHealthDiff.js`
- Test: `backend/__tests__/unit/utils/syncHealthDiff.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `CALENDAR_TIMEZONE` — the string `'America/New_York'`.
  - `toEasternDateKey(dateTime: string, timeZone?: string): string | null` — returns `'YYYY-MM-DD'`.
  - `buildOutlookIndex(outlookInstances: Array<GraphEvent>): { byId: Map<string, IndexEntry>, bySeriesDate: Map<string, IndexEntry>, entries: Array<IndexEntry> }`
  - `IndexEntry` = `{ graphId: string, subject: string, date: string|null, seriesMasterId: string|null, consumed: boolean }`
  - `seriesDateKey(seriesMasterId: string, date: string): string` — `` `${seriesMasterId}|${date}` ``

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/unit/utils/syncHealthDiff.test.js`:

```javascript
const {
  toEasternDateKey,
  buildOutlookIndex,
  seriesDateKey,
  CALENDAR_TIMEZONE,
} = require('../../../utils/syncHealthDiff');

describe('syncHealthDiff — Outlook normalization', () => {
  describe('toEasternDateKey', () => {
    it('exports the calendar timezone', () => {
      expect(CALENDAR_TIMEZONE).toBe('America/New_York');
    });

    // Graph calendarView returns dateTime WITHOUT a Z and a sibling
    // timeZone: 'UTC'. Parsing it without appending Z reads it as host-local
    // time, silently shifting every date key by the host offset.
    it('treats a UTC-flagged dateTime as UTC even though it has no Z suffix', () => {
      expect(toEasternDateKey('2026-08-14T17:00:00.0000000', 'UTC')).toBe('2026-08-14');
    });

    // 02:00 UTC on Aug 15 is 22:00 EDT on Aug 14. Naive UTC date extraction
    // would report 2026-08-15 and manufacture a false discrepancy.
    it('maps a late-evening Eastern instant back to the previous local date (EDT)', () => {
      expect(toEasternDateKey('2026-08-15T02:00:00.0000000', 'UTC')).toBe('2026-08-14');
    });

    // Same edge under EST (UTC-5): 04:30 UTC Jan 15 is 23:30 EST Jan 14.
    it('maps a late-evening Eastern instant back to the previous local date (EST)', () => {
      expect(toEasternDateKey('2026-01-15T04:30:00.0000000', 'UTC')).toBe('2026-01-14');
    });

    // Early-morning Eastern must NOT roll backwards.
    it('keeps an early-morning Eastern instant on its own local date', () => {
      expect(toEasternDateKey('2026-08-14T13:00:00.0000000', 'UTC')).toBe('2026-08-14');
    });

    it('accepts an explicit Z suffix', () => {
      expect(toEasternDateKey('2026-08-15T02:00:00Z', 'UTC')).toBe('2026-08-14');
    });

    // Defensive: if a caller ever adds Prefer: outlook.timezone, dateTime
    // arrives as wall-clock in that zone and must NOT be shifted again.
    it('takes the date part verbatim when the timeZone is not UTC', () => {
      expect(toEasternDateKey('2026-08-14T22:00:00.0000000', 'Eastern Standard Time'))
        .toBe('2026-08-14');
    });

    it('returns null for missing input', () => {
      expect(toEasternDateKey(null, 'UTC')).toBeNull();
      expect(toEasternDateKey('', 'UTC')).toBeNull();
    });
  });

  describe('buildOutlookIndex', () => {
    it('indexes a standalone event by id', () => {
      const index = buildOutlookIndex([
        { id: 'g1', subject: 'Board Meeting', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' } },
      ]);
      expect(index.byId.get('g1').subject).toBe('Board Meeting');
      expect(index.byId.get('g1').date).toBe('2026-08-14');
      expect(index.entries).toHaveLength(1);
    });

    it('indexes a series occurrence by (seriesMasterId, local date) as well as by id', () => {
      const index = buildOutlookIndex([
        {
          id: 'occ1',
          subject: 'Weekly Standup',
          seriesMasterId: 'master1',
          type: 'occurrence',
          start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' },
        },
      ]);
      expect(index.bySeriesDate.get(seriesDateKey('master1', '2026-08-14')).graphId).toBe('occ1');
      expect(index.byId.get('occ1').graphId).toBe('occ1');
    });

    // A cancelled instance is Outlook's tombstone. Treating it as present
    // would mask a genuine missingFromOutlook finding.
    it('omits cancelled instances entirely', () => {
      const index = buildOutlookIndex([
        { id: 'g1', subject: 'Cancelled', isCancelled: true, start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' } },
        { id: 'g2', subject: 'Live', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' } },
      ]);
      expect(index.byId.has('g1')).toBe(false);
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].graphId).toBe('g2');
    });

    it('marks every entry unconsumed initially', () => {
      const index = buildOutlookIndex([
        { id: 'g1', subject: 'A', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' } },
      ]);
      expect(index.entries.every(e => e.consumed === false)).toBe(true);
    });

    it('tolerates an empty or missing instance list', () => {
      expect(buildOutlookIndex([]).entries).toEqual([]);
      expect(buildOutlookIndex(undefined).entries).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- syncHealthDiff.test.js`
Expected: FAIL with `Cannot find module '../../../utils/syncHealthDiff'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/utils/syncHealthDiff.js`:

```javascript
// backend/utils/syncHealthDiff.js
//
// Pure diff layer for the Sync Health report. NO I/O — no Mongo, no Graph, no
// clock reads beyond what callers pass in. Every matching rule lives here so it
// is unit-testable in isolation (same reasoning as calendarLoadDecision.js on
// the frontend).
//
// Ground truth on the Outlook side is Graph's calendarView, which expands
// recurring series into concrete dated instances server-side. Both sides of the
// diff are therefore flat lists of dated instances, and pattern-level drift
// surfaces as date-level differences.

const CALENDAR_TIMEZONE = 'America/New_York';

// 'en-CA' formats as YYYY-MM-DD, which is exactly the key shape we store
// occurrenceDate in. Constructed once — DateTimeFormat construction is the
// expensive part, formatting is cheap.
const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Normalize a Graph instance start time to its LOCAL date in the calendar's
 * timezone.
 *
 * Graph's calendarView returns `start.dateTime` with NO trailing Z plus a
 * sibling `start.timeZone` of 'UTC' (we deliberately do not send the
 * `Prefer: outlook.timezone` header). Passing that string straight to
 * `new Date()` parses it as HOST-LOCAL time, which shifts the date key by the
 * host's UTC offset and manufactures false discrepancies on any non-UTC box.
 *
 * @param {string|null|undefined} dateTime - e.g. '2026-08-15T02:00:00.0000000'
 * @param {string} [timeZone='UTC'] - the sibling Graph timeZone field
 * @returns {string|null} 'YYYY-MM-DD' local date, or null when input is falsy
 */
function toEasternDateKey(dateTime, timeZone = 'UTC') {
  if (!dateTime) return null;

  // Non-UTC means Graph already rendered wall-clock time in that zone, so the
  // date part is authoritative and must not be shifted a second time.
  if (timeZone && timeZone !== 'UTC') {
    return dateTime.split('T')[0] || null;
  }

  const utcString = /[Zz]$|[+-]\d{2}:\d{2}$/.test(dateTime) ? dateTime : `${dateTime}Z`;
  const parsed = new Date(utcString);
  if (Number.isNaN(parsed.getTime())) return null;

  return EASTERN_DATE_FORMATTER.format(parsed);
}

/**
 * Composite key for matching a series occurrence: the master's Graph ID plus
 * the occurrence's local date.
 */
function seriesDateKey(seriesMasterId, date) {
  return `${seriesMasterId}|${date}`;
}

/**
 * Index one calendar's Outlook instances for O(1) lookup two ways: by event id
 * (standalone events, addition events, exception events) and by
 * (seriesMasterId, local date) (occurrences and exceptions of a series).
 *
 * Cancelled instances are dropped here rather than filtered by callers, so
 * every consumer sees the same "cancelled means absent" semantics.
 *
 * @param {Array<object>} outlookInstances - raw Graph calendarView events
 * @returns {{ byId: Map, bySeriesDate: Map, entries: Array }}
 */
function buildOutlookIndex(outlookInstances) {
  const byId = new Map();
  const bySeriesDate = new Map();
  const entries = [];

  for (const raw of outlookInstances || []) {
    if (!raw || raw.isCancelled === true) continue;

    const entry = {
      graphId: raw.id,
      subject: raw.subject || '(no subject)',
      date: toEasternDateKey(raw.start?.dateTime, raw.start?.timeZone),
      seriesMasterId: raw.seriesMasterId || null,
      consumed: false,
    };

    entries.push(entry);
    if (entry.graphId) byId.set(entry.graphId, entry);
    if (entry.seriesMasterId && entry.date) {
      bySeriesDate.set(seriesDateKey(entry.seriesMasterId, entry.date), entry);
    }
  }

  return { byId, bySeriesDate, entries };
}

module.exports = {
  CALENDAR_TIMEZONE,
  toEasternDateKey,
  seriesDateKey,
  buildOutlookIndex,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- syncHealthDiff.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add backend/utils/syncHealthDiff.js backend/__tests__/unit/utils/syncHealthDiff.test.js
git commit -m "feat(sync-health): Outlook instance normalization for diff module

- Eastern-local date keys from Graph UTC instants (appends missing Z)
- Dual index by graph id and by (seriesMasterId, local date)
- Cancelled instances dropped at index time
- Tests: 13 new"
```

---

### Task 2: The diff algorithm (matching rules and finding types)

The core of the feature. Consumes the index from Task 1 and produces the four finding types.

**Files:**
- Modify: `backend/utils/syncHealthDiff.js` (append)
- Test: `backend/__tests__/unit/utils/syncHealthDiff.test.js` (append)

**Interfaces:**
- Consumes: `buildOutlookIndex`, `seriesDateKey` from Task 1.
- Produces: `diffCalendar({ appInstances, trackedSeries, outlookInstances }): CalendarFindings`

Input types (produced by Task 3's service, consumed here):

```javascript
// AppInstance — one dated instance the app believes should exist in Outlook.
{
  mongoId: string,          // String(doc._id)
  eventTitle: string,
  date: string,             // 'YYYY-MM-DD' local Eastern
  eventType: 'singleInstance' | 'seriesMaster' | 'exception' | 'addition',
  graphId: string | null,   // graphData.id (single/exception/addition child) — null when untethered
  seriesGraphId: string | null, // the MASTER's graphData.id; set for seriesMaster + exception rows
  isDeleted: boolean,       // true only for the failed-deletion check
}

// TrackedSeries — one published series master, for the excluded-date check.
{ mongoId: string, eventTitle: string, seriesGraphId: string | null, exclusions: string[] }
```

Output type:

```javascript
{
  counts: { appExpected: number, outlookFound: number, matched: number },
  missingFromOutlook: Array<{ mongoId, eventTitle, date, eventType, reason }>,
  untethered: Array<{ mongoId, eventTitle, eventType }>,
  shouldNotBeInOutlook: Array<{ graphId, subject, date, reason }>,
  untracked: Array<{ graphId, subject, date }>,
}
```

- [ ] **Step 1: Write the failing test**

Append to `backend/__tests__/unit/utils/syncHealthDiff.test.js`:

```javascript
const { diffCalendar } = require('../../../utils/syncHealthDiff');

// --- builders -------------------------------------------------------------
const outlookEvent = (id, date, extra = {}) => ({
  id,
  subject: extra.subject || `Outlook ${id}`,
  start: { dateTime: `${date}T17:00:00.0000000`, timeZone: 'UTC' },
  ...extra,
});

const occurrenceOf = (id, masterId, date, extra = {}) =>
  outlookEvent(id, date, { seriesMasterId: masterId, type: 'occurrence', ...extra });

const appInstance = (over = {}) => ({
  mongoId: 'm1',
  eventTitle: 'Test Event',
  date: '2026-08-14',
  eventType: 'singleInstance',
  graphId: 'g1',
  seriesGraphId: null,
  isDeleted: false,
  ...over,
});

const emptyArgs = { appInstances: [], trackedSeries: [], outlookInstances: [] };

describe('syncHealthDiff — diffCalendar', () => {
  it('reports no findings when app and Outlook agree', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance()],
      outlookInstances: [outlookEvent('g1', '2026-08-14')],
    });

    expect(result.missingFromOutlook).toEqual([]);
    expect(result.untethered).toEqual([]);
    expect(result.shouldNotBeInOutlook).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.counts).toEqual({ appExpected: 1, outlookFound: 1, matched: 1 });
  });

  it('matches a series pattern date by (master graph id, local date)', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        eventType: 'seriesMaster', graphId: null, seriesGraphId: 'master1', eventTitle: 'Weekly Standup',
      })],
      trackedSeries: [{ mongoId: 'm1', eventTitle: 'Weekly Standup', seriesGraphId: 'master1', exclusions: [] }],
      outlookInstances: [occurrenceOf('occ1', 'master1', '2026-08-14')],
    });

    expect(result.missingFromOutlook).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.counts.matched).toBe(1);
  });

  // REGRESSION: the shipped recurrence.additions bug. 43 added dates rendered
  // in the app while Outlook had never heard of them.
  it('flags an added date whose child document has no Outlook event', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        mongoId: 'add1', eventTitle: 'Extra Rehearsal', date: '2026-08-20',
        eventType: 'addition', graphId: null, seriesGraphId: 'master1',
      })],
      trackedSeries: [{ mongoId: 'm1', eventTitle: 'Weekly Standup', seriesGraphId: 'master1', exclusions: [] }],
      outlookInstances: [],
    });

    // No stored Graph ID at all => untethered, which is the sharper signal.
    expect(result.untethered).toEqual([
      { mongoId: 'add1', eventTitle: 'Extra Rehearsal', eventType: 'addition' },
    ]);
    expect(result.counts.matched).toBe(0);
  });

  it('flags an added date whose stored Graph event is absent from Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        mongoId: 'add1', eventTitle: 'Extra Rehearsal', date: '2026-08-20',
        eventType: 'addition', graphId: 'gone', seriesGraphId: 'master1',
      })],
      outlookInstances: [],
    });

    expect(result.missingFromOutlook).toEqual([{
      mongoId: 'add1',
      eventTitle: 'Extra Rehearsal',
      date: '2026-08-20',
      eventType: 'addition',
      reason: 'no Outlook event for added date',
    }]);
  });

  it('flags a single instance whose Graph event is absent from Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance()],
      outlookInstances: [],
    });

    expect(result.missingFromOutlook).toEqual([{
      mongoId: 'm1', eventTitle: 'Test Event', date: '2026-08-14',
      eventType: 'singleInstance', reason: 'no Outlook event with this Graph ID',
    }]);
  });

  // An untethered master must produce ONE finding, not one per pattern date.
  it('reports an untethered master once and does not spam per-date findings', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [
        appInstance({ eventType: 'seriesMaster', date: '2026-08-14', graphId: null, seriesGraphId: null, eventTitle: 'Untethered Series' }),
        appInstance({ eventType: 'seriesMaster', date: '2026-08-21', graphId: null, seriesGraphId: null, eventTitle: 'Untethered Series' }),
      ],
      outlookInstances: [],
    });

    expect(result.untethered).toEqual([
      { mongoId: 'm1', eventTitle: 'Untethered Series', eventType: 'seriesMaster' },
    ]);
    expect(result.missingFromOutlook).toEqual([]);
  });

  it('flags an excluded date that is still present in Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [],
      trackedSeries: [{
        mongoId: 'm1', eventTitle: 'Weekly Standup', seriesGraphId: 'master1',
        exclusions: ['2026-09-02'],
      }],
      outlookInstances: [occurrenceOf('occ9', 'master1', '2026-09-02', { subject: 'Weekly Standup' })],
    });

    expect(result.shouldNotBeInOutlook).toEqual([{
      graphId: 'occ9', subject: 'Weekly Standup', date: '2026-09-02',
      reason: 'excluded date still present',
    }]);
    // Consumed by the exclusion check, so it must NOT also appear as untracked.
    expect(result.untracked).toEqual([]);
  });

  it('flags a deleted app event that is still present in Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({ isDeleted: true, eventTitle: 'Deleted Event' })],
      outlookInstances: [outlookEvent('g1', '2026-08-14', { subject: 'Deleted Event' })],
    });

    expect(result.shouldNotBeInOutlook).toEqual([{
      graphId: 'g1', subject: 'Deleted Event', date: '2026-08-14',
      reason: 'deleted in app but still in Outlook',
    }]);
    // Deleted events are not "expected", so they must not inflate appExpected.
    expect(result.counts.appExpected).toBe(0);
  });

  it('reports an Outlook event the app knows nothing about as untracked', () => {
    const result = diffCalendar({
      ...emptyArgs,
      outlookInstances: [outlookEvent('stray', '2026-08-01', { subject: 'Booked in Outlook' })],
    });

    expect(result.untracked).toEqual([
      { graphId: 'stray', subject: 'Booked in Outlook', date: '2026-08-01' },
    ]);
    expect(result.counts.outlookFound).toBe(1);
  });

  it('treats a cancelled Outlook instance as absent', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance()],
      outlookInstances: [outlookEvent('g1', '2026-08-14', { isCancelled: true })],
    });

    expect(result.missingFromOutlook).toHaveLength(1);
    expect(result.counts).toEqual({ appExpected: 1, outlookFound: 0, matched: 0 });
  });

  it('matches an exception child by (master graph id, date) before falling back to its own id', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        mongoId: 'exc1', eventType: 'exception', graphId: 'standalone-id', seriesGraphId: 'master1',
      })],
      outlookInstances: [occurrenceOf('exception-occ', 'master1', '2026-08-14')],
    });

    expect(result.counts.matched).toBe(1);
    expect(result.missingFromOutlook).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('falls back to the exception child own Graph ID when it is standalone', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        mongoId: 'exc1', eventType: 'exception', graphId: 'standalone-id', seriesGraphId: 'master1',
      })],
      outlookInstances: [outlookEvent('standalone-id', '2026-08-14')],
    });

    expect(result.counts.matched).toBe(1);
    expect(result.untracked).toEqual([]);
  });

  // A rename in Outlook must not register as a discrepancy — matching is by ID.
  it('does not flag an event that was renamed in Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({ eventTitle: 'Original Title' })],
      outlookInstances: [outlookEvent('g1', '2026-08-14', { subject: 'Totally Different Title' })],
    });

    expect(result.missingFromOutlook).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.counts.matched).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- syncHealthDiff.test.js`
Expected: FAIL with `diffCalendar is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/utils/syncHealthDiff.js`, above `module.exports`:

```javascript
/**
 * Look up an app instance in the Outlook index and consume the match.
 *
 * Series occurrences are matched by (master graph id, local date) because a
 * pattern date has no independent Graph ID of its own. Exception children may
 * be EITHER a real series exception (matched by master+date) or a standalone
 * event (matched by its own graphEventId), so they try both in that order.
 *
 * @returns {object|null} the consumed index entry, or null when absent
 */
function consumeMatch(index, instance) {
  const trySeries = () => {
    if (!instance.seriesGraphId || !instance.date) return null;
    const hit = index.bySeriesDate.get(seriesDateKey(instance.seriesGraphId, instance.date));
    return hit && !hit.consumed ? hit : null;
  };
  const tryId = () => {
    if (!instance.graphId) return null;
    const hit = index.byId.get(instance.graphId);
    return hit && !hit.consumed ? hit : null;
  };

  // seriesMaster pattern dates have no own ID; everything else prefers its own
  // ID, except exceptions which are series-first (see doc comment).
  const order = instance.eventType === 'seriesMaster' || instance.eventType === 'exception'
    ? [trySeries, tryId]
    : [tryId, trySeries];

  for (const attempt of order) {
    const hit = attempt();
    if (hit) {
      hit.consumed = true;
      return hit;
    }
  }
  return null;
}

const MISSING_REASON = {
  addition: 'no Outlook event for added date',
  seriesMaster: 'no Outlook occurrence on this date',
  exception: 'no Outlook event for this occurrence override',
  singleInstance: 'no Outlook event with this Graph ID',
};

/**
 * Diff one calendar's app-side expectations against its Outlook instances.
 *
 * Matching is by Graph ID (plus date for series occurrences) and NEVER by
 * title or time, so renames and time edits in Outlook cannot produce findings.
 *
 * @param {object} params
 * @param {Array<object>} params.appInstances - dated instances the app expects
 * @param {Array<object>} params.trackedSeries - published masters, for exclusions
 * @param {Array<object>} params.outlookInstances - raw Graph calendarView events
 * @returns {object} findings + counts for this calendar
 */
function diffCalendar({ appInstances = [], trackedSeries = [], outlookInstances = [] } = {}) {
  const index = buildOutlookIndex(outlookInstances);

  const missingFromOutlook = [];
  const untethered = [];
  const shouldNotBeInOutlook = [];

  // One untethered finding per DOCUMENT, not per expanded date — an untethered
  // master would otherwise emit one row per pattern date and drown the report.
  const untetheredMongoIds = new Set();

  const live = appInstances.filter(i => !i.isDeleted);
  const deleted = appInstances.filter(i => i.isDeleted);

  let matched = 0;

  for (const instance of live) {
    const linkage = instance.eventType === 'seriesMaster'
      ? instance.seriesGraphId
      : (instance.graphId || instance.seriesGraphId);

    if (!linkage) {
      if (!untetheredMongoIds.has(instance.mongoId)) {
        untetheredMongoIds.add(instance.mongoId);
        untethered.push({
          mongoId: instance.mongoId,
          eventTitle: instance.eventTitle,
          eventType: instance.eventType,
        });
      }
      continue;
    }

    if (consumeMatch(index, instance)) {
      matched++;
    } else {
      missingFromOutlook.push({
        mongoId: instance.mongoId,
        eventTitle: instance.eventTitle,
        date: instance.date,
        eventType: instance.eventType,
        reason: MISSING_REASON[instance.eventType] || 'no matching Outlook event',
      });
    }
  }

  // Failed-deletion detector: the app deleted it, Outlook still shows it.
  for (const instance of deleted) {
    if (!instance.graphId && !instance.seriesGraphId) continue;
    const hit = consumeMatch(index, instance);
    if (hit) {
      shouldNotBeInOutlook.push({
        graphId: hit.graphId,
        subject: hit.subject,
        date: hit.date,
        reason: 'deleted in app but still in Outlook',
      });
    }
  }

  // Excluded dates that Outlook never dropped.
  for (const series of trackedSeries) {
    if (!series.seriesGraphId) continue;
    for (const excludedDate of series.exclusions || []) {
      const hit = index.bySeriesDate.get(seriesDateKey(series.seriesGraphId, excludedDate));
      if (hit && !hit.consumed) {
        hit.consumed = true;
        shouldNotBeInOutlook.push({
          graphId: hit.graphId,
          subject: hit.subject,
          date: hit.date,
          reason: 'excluded date still present',
        });
      }
    }
  }

  const untracked = index.entries
    .filter(entry => !entry.consumed)
    .map(entry => ({ graphId: entry.graphId, subject: entry.subject, date: entry.date }));

  return {
    counts: {
      appExpected: live.length,
      outlookFound: index.entries.length,
      matched,
    },
    missingFromOutlook,
    untethered,
    shouldNotBeInOutlook,
    untracked,
  };
}
```

Then extend the exports block:

```javascript
module.exports = {
  CALENDAR_TIMEZONE,
  toEasternDateKey,
  seriesDateKey,
  buildOutlookIndex,
  diffCalendar,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- syncHealthDiff.test.js`
Expected: PASS, 26 tests total

- [ ] **Step 5: Commit**

```bash
git add backend/utils/syncHealthDiff.js backend/__tests__/unit/utils/syncHealthDiff.test.js
git commit -m "feat(sync-health): diff algorithm with four finding types

- ID-based matching only, so renames and time edits never false-positive
- missingFromOutlook, untethered, shouldNotBeInOutlook, untracked
- Untethered reported once per document, not once per expanded date
- Tests: 13 new, 26 passing"
```

---

### Task 3: The gathering service

Turns MongoDB documents into the `appInstances` / `trackedSeries` shape Task 2 consumes, fetches Outlook per calendar, and assembles the response. Dependencies are injected rather than imported so the route can hand it whichever Graph client is currently installed (tests swap it via `setGraphApiService`).

**Files:**
- Create: `backend/services/syncHealthService.js`
- Test: covered by Task 4's integration test (this service is pure orchestration over injected deps; testing it separately would duplicate that coverage)

**Interfaces:**
- Consumes: `diffCalendar` (Task 2); `expandAllOccurrences` from `backend/utils/recurrenceExpansion.js`; `buildSeriesAwareDateRangeClause` from `backend/utils/eventDateRangeFilter.js`; `retryWithBackoff` from `backend/utils/retryWithBackoff.js`.
- Produces:
  - `resolveWindow({ startDate, endDate }, now): { startDate, endDate }` — applies defaults (−30d / +180d).
  - `validateWindow({ startDate, endDate }): string | null` — returns an error message or null.
  - `runSyncHealthCheck({ eventsCollection, graphApi, startDate, endDate }): Promise<{ window, calendars }>`
  - `MAX_WINDOW_DAYS` = `400`

- [ ] **Step 1: Write the implementation**

There is no separate unit test for this task — it is exercised end-to-end by Task 4's integration test, which is written test-first there. Create `backend/services/syncHealthService.js`:

```javascript
// backend/services/syncHealthService.js
//
// Gathering + orchestration layer for the Sync Health report.
//
// Every dependency is INJECTED (eventsCollection, graphApi) rather than
// imported. api-server.js swaps its Graph client at runtime via
// setGraphApiService() — which tests use to install graphApiMock — so a
// module-level `require` captured here would pin the real client and bypass
// the mock. The route passes the live binding at request time instead.
//
// All matching rules live in utils/syncHealthDiff.js — this file only decides
// WHAT to compare, never HOW to compare it.

const { diffCalendar } = require('../utils/syncHealthDiff');
const { expandAllOccurrences } = require('../utils/recurrenceExpansion');
const { buildSeriesAwareDateRangeClause } = require('../utils/eventDateRangeFilter');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const logger = require('../utils/logger');

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LOOKAHEAD_DAYS = 180;
const MAX_WINDOW_DAYS = 400;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Only these fields are needed; calendarView pages are large and the report is
// interactive, so we keep the payload tight.
const GRAPH_SELECT = 'id,subject,start,end,type,seriesMasterId,isCancelled';

// Same retryable-error policy as backfill-addition-graph-events.js.
const withGraphRetry = (op) => retryWithBackoff(op, {
  maxAttempts: 3,
  retryableError: (err) =>
    err?.statusCode === 429 || err?.statusCode === 503 ||
    err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET',
});

const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Apply the default window when either bound is omitted.
 * @param {{startDate?: string, endDate?: string}} params
 * @param {Date} [now] - injectable clock for tests
 * @returns {{startDate: string, endDate: string}}
 */
function resolveWindow({ startDate, endDate } = {}, now = new Date()) {
  const back = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * MS_PER_DAY);
  const ahead = new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * MS_PER_DAY);
  return {
    startDate: startDate || toDateStr(back),
    endDate: endDate || toDateStr(ahead),
  };
}

/**
 * @returns {string|null} a 400-worthy error message, or null when valid
 */
function validateWindow({ startDate, endDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return 'startDate and endDate must be YYYY-MM-DD';
  }
  if (endDate < startDate) return 'endDate must be on or after startDate';

  const spanDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / MS_PER_DAY
  );
  if (spanDays > MAX_WINDOW_DAYS) {
    return `Window must not exceed ${MAX_WINDOW_DAYS} days (requested ${spanDays})`;
  }
  return null;
}

const titleOf = (doc) => doc.eventTitle || doc.calendarData?.eventTitle || '(no title)';
const calendarKeyOf = (doc) => `${doc.calendarOwner || ''}|${doc.calendarId || ''}`;

/**
 * The LOCAL date of an app-side document.
 *
 * Deliberately does NOT use toEasternDateKey — that function exists to convert
 * Graph's UTC instants. App-side values are already local: calendarData.
 * startDateTime is a local-time ISO string with no Z, and top-level
 * startDateTime may be a Date. Running the UTC normalizer over either would
 * shift the date. Keeping the two conversions separate is the whole point.
 *
 * @param {object} doc - an event document
 * @returns {string|null} 'YYYY-MM-DD'
 */
function localDateOf(doc) {
  const raw = doc.calendarData?.startDateTime || doc.startDateTime;
  if (raw instanceof Date) return toDateStr(raw);
  if (typeof raw === 'string' && raw.includes('T')) return raw.split('T')[0];
  return doc.startDate || null;
}

/**
 * Build the flat list of dated instances the app expects to exist in Outlook,
 * for ONE calendar.
 *
 * Series masters are expanded with expandAllOccurrences (which honors additions
 * and exclusions), then any date that has its own exception/addition child
 * document is REMOVED from the master's list and re-added from the child. That
 * overlay is what stops a date being counted twice — the child carries the
 * authoritative graphEventId, the master's pattern date does not.
 */
function buildAppSide(docs, startDate, endDate) {
  const appInstances = [];
  const trackedSeries = [];

  const masters = docs.filter(d => d.eventType === 'seriesMaster');
  const children = docs.filter(d => d.eventType === 'exception' || d.eventType === 'addition');
  const singles = docs.filter(d => !['seriesMaster', 'exception', 'addition', 'occurrence'].includes(d.eventType));

  // Child docs, keyed by their master's eventId so masters can skip those dates.
  const childDatesByMaster = new Map();
  for (const child of children) {
    const key = child.seriesMasterEventId;
    if (!childDatesByMaster.has(key)) childDatesByMaster.set(key, new Set());
    childDatesByMaster.get(key).add(child.occurrenceDate);
  }

  const masterGraphIdByEventId = new Map();
  for (const master of masters) {
    if (master.eventId) masterGraphIdByEventId.set(master.eventId, master.graphData?.id || null);
  }

  for (const doc of singles) {
    appInstances.push({
      mongoId: String(doc._id),
      eventTitle: titleOf(doc),
      date: localDateOf(doc),
      eventType: 'singleInstance',
      graphId: doc.graphData?.id || null,
      seriesGraphId: null,
      isDeleted: doc.isDeleted === true || doc.status === 'deleted',
    });
  }

  for (const master of masters) {
    const seriesGraphId = master.graphData?.id || null;
    trackedSeries.push({
      mongoId: String(master._id),
      eventTitle: titleOf(master),
      seriesGraphId,
      exclusions: (master.recurrence?.exclusions || []).filter(d => d >= startDate && d <= endDate),
    });

    const overlaid = childDatesByMaster.get(master.eventId) || new Set();
    // calendarData first: it holds local-time STRINGS, which is what
    // expandAllOccurrences parses for time-of-day. A top-level Date would
    // silently fall back to midnight (harmless here since we only read
    // occurrenceDate, but the string path is the intended one).
    const occurrences = expandAllOccurrences(
      master.recurrence,
      master.calendarData?.startDateTime || master.startDateTime,
      master.calendarData?.endDateTime || master.endDateTime,
    );

    for (const occ of occurrences) {
      if (occ.occurrenceDate < startDate || occ.occurrenceDate > endDate) continue;
      if (overlaid.has(occ.occurrenceDate)) continue; // the child doc speaks for this date
      appInstances.push({
        mongoId: String(master._id),
        eventTitle: titleOf(master),
        date: occ.occurrenceDate,
        eventType: 'seriesMaster',
        graphId: null,
        seriesGraphId,
        isDeleted: master.isDeleted === true || master.status === 'deleted',
      });
    }
  }

  for (const child of children) {
    if (child.occurrenceDate < startDate || child.occurrenceDate > endDate) continue;
    appInstances.push({
      mongoId: String(child._id),
      eventTitle: titleOf(child),
      date: child.occurrenceDate,
      eventType: child.eventType,
      graphId: child.graphEventId || child.graphData?.id || null,
      seriesGraphId: masterGraphIdByEventId.get(child.seriesMasterEventId) || null,
      isDeleted: child.isDeleted === true || child.status === 'deleted',
    });
  }

  return { appInstances, trackedSeries };
}

/**
 * Run the full sync-health check across every calendar the app manages.
 *
 * @param {object} params
 * @param {import('mongodb').Collection} params.eventsCollection
 * @param {object} params.graphApi - needs getCalendarEvents(owner, calId, startIso, endIso, opts)
 * @param {string} params.startDate - 'YYYY-MM-DD'
 * @param {string} params.endDate - 'YYYY-MM-DD'
 * @returns {Promise<{window: object, calendars: Array<object>}>}
 */
async function runSyncHealthCheck({ eventsCollection, graphApi, startDate, endDate }) {
  // Published events overlapping the window. buildSeriesAwareDateRangeClause is
  // reused verbatim from the search view so masters match on their recurrence
  // RANGE (a master's own startDateTime holds only its first occurrence).
  const publishedDocs = await eventsCollection.find({
    status: 'published',
    isDeleted: { $ne: true },
    $and: [buildSeriesAwareDateRangeClause(startDate, endDate)],
  }).toArray();

  // Deleted-but-tracked events feed ONLY the failed-deletion check. A deleted
  // doc keeps its graphData.id, which is exactly the handle we need to ask
  // "is it still in Outlook?".
  const deletedDocs = await eventsCollection.find({
    isDeleted: true,
    'graphData.id': { $exists: true, $ne: null },
    $and: [buildSeriesAwareDateRangeClause(startDate, endDate)],
  }).toArray();

  const allDocs = [...publishedDocs, ...deletedDocs];

  // The set of distinct (calendarOwner, calendarId) pairs IS the set of
  // calendars the app manages — there is no separate registry.
  const docsByCalendar = new Map();
  for (const doc of allDocs) {
    if (!doc.calendarOwner) continue;
    const key = calendarKeyOf(doc);
    if (!docsByCalendar.has(key)) {
      docsByCalendar.set(key, {
        calendarOwner: doc.calendarOwner,
        calendarId: doc.calendarId || null,
        docs: [],
      });
    }
    docsByCalendar.get(key).docs.push(doc);
  }

  const windowStartIso = `${startDate}T00:00:00Z`;
  const windowEndIso = `${endDate}T23:59:59Z`;

  const calendars = [];
  for (const { calendarOwner, calendarId, docs } of docsByCalendar.values()) {
    const { appInstances, trackedSeries } = buildAppSide(docs, startDate, endDate);

    let outlookInstances;
    try {
      outlookInstances = await withGraphRetry(() => graphApi.getCalendarEvents(
        calendarOwner, calendarId, windowStartIso, windowEndIso, { select: GRAPH_SELECT }
      ));
    } catch (err) {
      // Per-calendar isolation: one mailbox failing must not blank the report.
      logger.warn('[syncHealth] Graph fetch failed for %s: %s', calendarOwner, err.message);
      calendars.push({
        calendarOwner,
        calendarId,
        error: err.message || 'Graph request failed',
        counts: { appExpected: appInstances.filter(i => !i.isDeleted).length, outlookFound: 0, matched: 0 },
        missingFromOutlook: [],
        untethered: [],
        shouldNotBeInOutlook: [],
        untracked: [],
      });
      continue;
    }

    calendars.push({
      calendarOwner,
      calendarId,
      error: null,
      ...diffCalendar({ appInstances, trackedSeries, outlookInstances }),
    });
  }

  calendars.sort((a, b) => a.calendarOwner.localeCompare(b.calendarOwner));

  return { window: { start: startDate, end: endDate }, calendars };
}

module.exports = {
  MAX_WINDOW_DAYS,
  resolveWindow,
  validateWindow,
  buildAppSide,
  runSyncHealthCheck,
};
```

- [ ] **Step 2: Verify the module loads and its pure helpers behave**

Run:
```bash
cd backend && node -e "
const s = require('./services/syncHealthService');
const w = s.resolveWindow({}, new Date('2026-07-27T12:00:00Z'));
console.log('window:', JSON.stringify(w));
console.log('valid:', s.validateWindow(w));
console.log('reversed:', s.validateWindow({ startDate: '2026-08-01', endDate: '2026-07-01' }));
console.log('too wide:', s.validateWindow({ startDate: '2026-01-01', endDate: '2027-06-01' }));
"
```
Expected: a window spanning roughly 2026-06-27 to 2027-01-23, `valid: null`, a non-null message for the reversed window, and a non-null message for the too-wide window.

- [ ] **Step 3: Commit**

```bash
git add backend/services/syncHealthService.js
git commit -m "feat(sync-health): gathering service with injected dependencies

- Reuses buildSeriesAwareDateRangeClause so masters match on recurrence range
- Expands masters via expandAllOccurrences, overlays exception/addition children
- Per-calendar try/catch keeps one failed mailbox from blanking the report
- Dependencies injected so the test harness runs the same code as production"
```

---

### Task 4: The endpoint (api-server route, Graph mock, integration tests)

**Files:**
- Modify: `backend/api-server.js`
- Modify: `backend/__tests__/__helpers__/graphApiMock.js`
- Test: `backend/__tests__/integration/events/syncHealth.test.js`

**Interfaces:**
- Consumes: `runSyncHealthCheck`, `resolveWindow`, `validateWindow` (Task 3).
- Produces: `GET /api/admin/reports/sync-health?startDate&endDate`, and `graphApiMock.getCalendarEvents` + `setMockResponse('getCalendarEvents', …)` for later tests.

**Test harness note — do NOT touch `testApp.js`.** The repo has two integration harnesses. The legacy `__tests__/__helpers__/testApp.js` is a 6,138-line hand-written *mirror* of api-server's routes; adding a route there would test a copy of the logic. `__tests__/__helpers__/createAppForTest.js` runs the **real** `api-server.js` app, injecting a test DB via `setDatabase(db)`, a bypass auth middleware via `setTestAuthMiddleware()`, and the Graph mock via `setGraphApiService(graphApiMock)`. Use `createAppForTest`. Because `setGraphApiService` reassigns the module-level `graphApiService` binding, the route must read that binding **inside** the handler (as written below), not capture it at module load.

Harness API, exact:
- `setupTestApp(db)` from `__helpers__/createAppForTest` → returns the configured app.
- `connectToGlobalServer(suiteName)` → `{ db, client }`; `disconnectFromGlobalServer(client, db)`; both from `__helpers__/testSetup`. There is no `setupTestDb`/`clearTestDb`.
- `createAdmin()`, `createApprover()`, `createRequester()`, `insertUsers(db, [users])` from `__helpers__/userFactory`. There is no `createTestUser`.
- `createMockToken(user)` is **async** — always `await` it. `initTestKeys()` must run once in `beforeAll`.
- `insertEvent(db, event)` takes the **db**, not a collection.
- `createBaseEvent` (and everything built on it) expects `startDateTime`/`endDateTime` as **`Date` objects**, not strings — it calls `.getTime()` and `.toISOString()` on them. It derives `calendarData.startDateTime` as a local-time ISO string, which is the field `buildSeriesAwareDateRangeClause` queries.

- [ ] **Step 1: Add `getCalendarEvents` to the Graph mock**

The mock currently has no `getCalendarEvents` — the report cannot be tested without it. In `backend/__tests__/__helpers__/graphApiMock.js`:

Add `getCalendarEvents: []` to the `callHistory` object, and `getCalendarEvents: null` to BOTH `mockResponses` and `mockErrors`.

Add this function above `clearCallHistory`:

```javascript
/**
 * Mock getCalendarEvents (Graph calendarView).
 *
 * Supports per-calendar responses: set the mock response to a plain array for a
 * single-calendar test, or to an object keyed by calendarOwner when a test
 * needs different results (or a thrown error) per mailbox.
 *
 * @param {string} userId - calendar owner email
 * @param {string|null} calendarId
 * @param {string} startDateTime
 * @param {string} endDateTime
 * @param {Object} options
 * @returns {Promise<Array>} Array of Graph events
 */
async function getCalendarEvents(userId, calendarId, startDateTime, endDateTime, options = {}) {
  callHistory.getCalendarEvents.push({ userId, calendarId, startDateTime, endDateTime, options });

  if (mockErrors.getCalendarEvents) {
    throw mockErrors.getCalendarEvents;
  }

  const configured = mockResponses.getCalendarEvents;
  if (Array.isArray(configured)) return configured;
  if (configured && typeof configured === 'object') {
    const perCalendar = configured[userId];
    if (perCalendar instanceof Error) throw perCalendar;
    return perCalendar || [];
  }

  return [];
}
```

Add `getCalendarEvents: []` reset to `clearCallHistory`, and `mockResponses.getCalendarEvents = null; mockErrors.getCalendarEvents = null;` to `resetMocks`. Add `getCalendarEvents` to the `module.exports` Calendar-operations group.

- [ ] **Step 2: Write the failing integration test**

Create `backend/__tests__/integration/events/syncHealth.test.js`:

```javascript
/**
 * Integration tests for GET /api/admin/reports/sync-health.
 *
 * Drives the REAL api-server.js route via createAppForTest (which injects the
 * test DB and graphApiMock), so these exercise shipped logic — not the legacy
 * testApp.js mirror.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  createPublishedEventWithGraph,
  createRecurringSeriesMaster,
  createAdditionDocument,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

const ENDPOINT = '/api/admin/reports/sync-health';
const WINDOW = { startDate: '2026-08-01', endDate: '2026-09-30' };

// createBaseEvent requires Date objects, not strings — it calls .getTime().
const at = (iso) => new Date(iso);

const outlookEvent = (id, date, extra = {}) => ({
  id,
  subject: extra.subject || `Outlook ${id}`,
  start: { dateTime: `${date}T17:00:00.0000000`, timeZone: 'UTC' },
  end: { dateTime: `${date}T18:00:00.0000000`, timeZone: 'UTC' },
  ...extra,
});

describe('GET /api/admin/reports/sync-health', () => {
  let mongoClient;
  let db;
  let app;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('syncHealth'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    graphApiMock.resetMocks();
  });

  const authAs = async (user) => {
    await insertUsers(db, [user]);
    return createMockToken(user);
  };

  // --- permission gate ---------------------------------------------------

  it('rejects a requester with 403', async () => {
    const token = await authAs(createRequester());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('allows an approver', async () => {
    const token = await authAs(createApprover());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.window).toEqual({ start: WINDOW.startDate, end: WINDOW.endDate });
    expect(Array.isArray(res.body.calendars)).toBe(true);
  });

  it('allows an admin', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  // --- validation --------------------------------------------------------

  it('400s when endDate is before startDate', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT)
      .query({ startDate: '2026-09-30', endDate: '2026-08-01' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('400s when the window exceeds 400 days', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT)
      .query({ startDate: '2026-01-01', endDate: '2027-06-01' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  // --- happy path + seeded discrepancy -----------------------------------

  it('reports a clean calendar with no findings', async () => {
    const token = await authAs(createAdmin());

    const event = createPublishedEventWithGraph({
      eventTitle: 'Board Meeting',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
    });
    await insertEvent(db, event);

    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent(event.graphData.id, '2026-08-14', { subject: 'Board Meeting' }),
    ]);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(1);

    const calendar = res.body.calendars[0];
    expect(calendar.error).toBeNull();
    expect(calendar.missingFromOutlook).toEqual([]);
    expect(calendar.untracked).toEqual([]);
    expect(calendar.counts.matched).toBe(1);
  });

  // REGRESSION for the shipped recurrence.additions bug: an added date the app
  // renders but Outlook never received.
  it('flags an added date that never reached Outlook', async () => {
    const token = await authAs(createAdmin());

    const master = createRecurringSeriesMaster({
      eventTitle: 'Weekly Standup',
      startDateTime: at('2026-08-03T13:00:00'),
      endDateTime: at('2026-08-03T14:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'endDate', startDate: '2026-08-03', endDate: '2026-08-31' },
        additions: ['2026-08-20'],
        exclusions: [],
      },
      status: 'published',
      graphData: { id: 'master-graph-1' },
    });
    await insertEvent(db, master);

    // The addition child exists in Mongo but carries NO graphEventId — exactly
    // the shipped-bug shape.
    const addition = createAdditionDocument(master, '2026-08-20', {});
    addition.status = 'published';
    addition.graphEventId = null;
    await insertEvent(db, addition);

    // Outlook has every Monday occurrence but nothing on the 20th.
    graphApiMock.setMockResponse('getCalendarEvents',
      ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d, i) =>
        outlookEvent(`occ${i}`, d, {
          seriesMasterId: 'master-graph-1', type: 'occurrence', subject: 'Weekly Standup',
        })
      )
    );

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const calendar = res.body.calendars[0];
    const flagged = [...calendar.untethered, ...calendar.missingFromOutlook];
    expect(flagged.some(f => f.eventType === 'addition')).toBe(true);
  });

  // --- partial failure ----------------------------------------------------

  it('returns partial results when one calendar Graph call fails', async () => {
    const token = await authAs(createAdmin());

    const healthy = createPublishedEventWithGraph({
      eventTitle: 'Healthy Calendar Event',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
    });
    await insertEvent(db, healthy);

    const broken = createPublishedEventWithGraph({
      eventTitle: 'Broken Calendar Event',
      startDateTime: at('2026-08-15T13:00:00'),
      endDateTime: at('2026-08-15T14:00:00'),
      calendarOwner: 'broken@emanuelnyc.org',
    });
    await insertEvent(db, broken);

    // statusCode 500 is NOT in the retryable set, so this fails fast instead of
    // making the test sit through exponential backoff.
    const boom = new Error('Graph is down');
    boom.statusCode = 500;
    graphApiMock.setMockResponse('getCalendarEvents', {
      [TEST_CALENDAR_OWNER]: [outlookEvent(healthy.graphData.id, '2026-08-14')],
      'broken@emanuelnyc.org': boom,
    });

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(2);

    const brokenEntry = res.body.calendars.find(c => c.calendarOwner === 'broken@emanuelnyc.org');
    expect(brokenEntry.error).toBe('Graph is down');

    const healthyEntry = res.body.calendars.find(c => c.calendarOwner === TEST_CALENDAR_OWNER);
    expect(healthyEntry.error).toBeNull();
    expect(healthyEntry.counts.matched).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- syncHealth.test.js`
Expected: FAIL — the permission tests return 404 because the route does not exist yet.

- [ ] **Step 4: Mount the route in `api-server.js`**

Add the require alongside the other service requires near the top (after the `errorLoggingService` line, around line 55):

```javascript
const syncHealthService = require('./services/syncHealthService');
```

Add the route next to the other `/api/admin/` report-style endpoints (immediately after the `requireAdminUser` helper definition, around line 12230):

```javascript
/**
 * GET /api/admin/reports/sync-health
 *
 * On-demand diff between what the app believes is published and what Outlook
 * actually shows. Read-only; no remediation. All logic lives in
 * services/syncHealthService.js so the test harness runs the same code.
 */
app.get('/api/admin/reports/sync-health', verifyToken, async (req, res) => {
  try {
    const user = await getCachedUser(req.user.userId);
    const userEmail = req.user.email;
    if (!isAdmin(user, userEmail) && !canApproveReservations(user, userEmail)) {
      return res.status(403).json({ error: 'Admin or Approver access required' });
    }

    const window = syncHealthService.resolveWindow({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    const validationError = syncHealthService.validateWindow(window);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const report = await syncHealthService.runSyncHealthCheck({
      eventsCollection: unifiedEventsCollection,
      graphApi: graphApiService,
      startDate: window.startDate,
      endDate: window.endDate,
    });

    res.json(report);
  } catch (err) {
    logger.error('sync-health report error:', err);
    res.status(500).json({ error: err.message || 'Failed to run sync health check' });
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- syncHealth.test.js`
Expected: PASS, 8 tests

Then confirm nothing regressed in the diff module or in the Graph mock's other consumers:
```bash
cd backend && npm test -- syncHealthDiff.test.js
cd backend && npm test -- recurringPublish.test.js
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/graphApiMock.js backend/__tests__/integration/events/syncHealth.test.js
git commit -m "feat(api-server): GET /api/admin/reports/sync-health endpoint

- Admin or Approver gate, window defaults and 400-day cap
- Partial success: a failed mailbox sets its own error field, others still return
- Adds getCalendarEvents to graphApiMock with per-calendar responses
- Tests: 8 new integration tests"
```

---

### Task 5: The Sync Health page

**Files:**
- Create: `src/components/SyncHealthReport.jsx`
- Create: `src/components/SyncHealthReport.css`
- Modify: `src/queries/keys.js`
- Modify: `src/App.jsx`
- Modify: `src/components/Navigation.jsx`
- Test: `src/__tests__/unit/components/SyncHealthReport.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/reports/sync-health` (Task 4); `deriveListLoadingState` from `src/utils/listLoadingState.js`; `useNotification` from `src/context/NotificationContext`.
- Produces: default-exported `SyncHealthReport({ apiToken })`; `keys.syncHealth.report(scope)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/components/SyncHealthReport.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SyncHealthReport from '../../../components/SyncHealthReport';

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncHealthReport apiToken="test-token" />
    </QueryClientProvider>
  );
};

const respondWith = (body) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
};

describe('SyncHealthReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The idle state is a legitimate prompt, NOT a spinner — this page's
  // `enabled` is a deliberate user action (the Run Check button).
  it('shows the idle prompt before the first run and does not fetch', () => {
    respondWith({ window: {}, calendars: [] });
    renderPage();

    expect(screen.getByText(/run check/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a date range/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders an all-green banner when a calendar has no findings', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org',
        calendarId: null,
        error: null,
        counts: { appExpected: 12, outlookFound: 12, matched: 12 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText(/app and outlook agree/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/12 instances matched/i)).toBeInTheDocument();
  });

  it('renders discrepancy rows for a calendar with findings', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org',
        calendarId: null,
        error: null,
        counts: { appExpected: 14, outlookFound: 13, matched: 12 },
        missingFromOutlook: [{
          mongoId: 'a1', eventTitle: 'Extra Rehearsal', date: '2026-08-20',
          eventType: 'addition', reason: 'no Outlook event for added date',
        }],
        untethered: [{ mongoId: 'm1', eventTitle: 'Orphan Series', eventType: 'seriesMaster' }],
        shouldNotBeInOutlook: [{
          graphId: 'g9', subject: 'Cancelled Standup', date: '2026-09-02',
          reason: 'excluded date still present',
        }],
        untracked: [{ graphId: 'stray', subject: 'Booked in Outlook', date: '2026-08-01' }],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText('Extra Rehearsal')).toBeInTheDocument();
    });
    expect(screen.getByText(/no Outlook event for added date/i)).toBeInTheDocument();
    expect(screen.getByText('Orphan Series')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Standup')).toBeInTheDocument();
    expect(screen.queryByText(/app and outlook agree/i)).not.toBeInTheDocument();
  });

  it('renders an error card for a calendar whose Graph call failed', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'broken@emanuelnyc.org',
        calendarId: null,
        error: 'Graph is down',
        counts: { appExpected: 4, outlookFound: 0, matched: 0 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText(/graph is down/i)).toBeInTheDocument();
    });
    expect(screen.getByText('broken@emanuelnyc.org')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- SyncHealthReport`
Expected: FAIL — cannot resolve `../../../components/SyncHealthReport`

- [ ] **Step 3: Add the query key**

In `src/queries/keys.js`, add this entry inside the `keys` object, immediately after the `calendarMarkers` block:

```javascript
  // Sync Health report (app-vs-Outlook diff). Manual-run only, so the key is
  // versioned by run count rather than by filter values — clicking Run Check
  // must refetch even when the date range has not changed.
  syncHealth: {
    all: () => ['syncHealth'],
    report: (scope) => scope === undefined ? ['syncHealth', 'report'] : ['syncHealth', 'report', scope],
  },
```

- [ ] **Step 4: Write the component**

Create `src/components/SyncHealthReport.jsx`:

```jsx
// src/components/SyncHealthReport.jsx
//
// "Sync Health" screen (admins + approvers). Runs an on-demand diff between
// what the app believes is published and what Outlook actually shows.
//
// Loading contract: this view follows the EventSearch pattern, NOT the
// auto-firing list pattern. Its `enabled` is a deliberate user action (the Run
// Check button), so the idle state is a legitimate "choose a range" prompt
// rather than a spinner. deriveListLoadingState keeps the spinner up through
// the `pending && idle` tick after the click so we never flash an empty result.

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { deriveListLoadingState } from '../utils/listLoadingState';
import { useNotification } from '../context/NotificationContext';
import LoadingSpinner from './shared/LoadingSpinner';
import DatePickerInput from './DatePickerInput';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './SyncHealthReport.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const defaultWindow = () => {
  const now = new Date();
  return {
    startDate: toDateStr(new Date(now.getTime() - 30 * MS_PER_DAY)),
    endDate: toDateStr(new Date(now.getTime() + 180 * MS_PER_DAY)),
  };
};

const calendarLabel = (calendar) =>
  calendar.calendarId ? `${calendar.calendarOwner} (${calendar.calendarId})` : calendar.calendarOwner;

function FindingSection({ title, rows, renderRow }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="sync-health-section sync-health-section--critical">
      <h4 className="sync-health-section-title">
        {title} <span className="sync-health-count">{rows.length}</span>
      </h4>
      <ul className="sync-health-rows">
        {rows.map((row, i) => <li key={i} className="sync-health-row">{renderRow(row)}</li>)}
      </ul>
    </section>
  );
}

function CalendarCard({ calendar }) {
  const [untrackedOpen, setUntrackedOpen] = useState(false);

  if (calendar.error) {
    return (
      <article className="sync-health-card sync-health-card--errored">
        <header className="sync-health-card-header">
          <h3 className="sync-health-card-title">{calendarLabel(calendar)}</h3>
        </header>
        <p className="sync-health-error">Could not check this calendar: {calendar.error}</p>
      </article>
    );
  }

  const { counts, missingFromOutlook, untethered, shouldNotBeInOutlook, untracked } = calendar;
  const isClean =
    missingFromOutlook.length === 0 &&
    untethered.length === 0 &&
    shouldNotBeInOutlook.length === 0;

  return (
    <article className="sync-health-card">
      <header className="sync-health-card-header">
        <h3 className="sync-health-card-title">{calendarLabel(calendar)}</h3>
        <dl className="sync-health-counts">
          <div><dt>App expects</dt><dd>{counts.appExpected}</dd></div>
          <div><dt>In Outlook</dt><dd>{counts.outlookFound}</dd></div>
          <div><dt>Matched</dt><dd>{counts.matched}</dd></div>
        </dl>
      </header>

      {isClean && (
        <p className="sync-health-banner sync-health-banner--ok">
          App and Outlook agree: {counts.matched} instances matched
        </p>
      )}

      <FindingSection
        title="Missing from Outlook"
        rows={missingFromOutlook}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.eventTitle}</span>
            <span className="sync-health-row-date">{row.date}</span>
            <span className="sync-health-row-reason">{row.reason}</span>
          </>
        )}
      />

      <FindingSection
        title="No Outlook link stored"
        rows={untethered}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.eventTitle}</span>
            <span className="sync-health-row-reason">{row.eventType} has no stored Graph ID</span>
          </>
        )}
      />

      <FindingSection
        title="Should not be in Outlook"
        rows={shouldNotBeInOutlook}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.subject}</span>
            <span className="sync-health-row-date">{row.date}</span>
            <span className="sync-health-row-reason">{row.reason}</span>
          </>
        )}
      />

      {untracked.length > 0 && (
        <section className="sync-health-section sync-health-section--info">
          <button
            type="button"
            className="sync-health-disclosure"
            onClick={() => setUntrackedOpen(open => !open)}
            aria-expanded={untrackedOpen}
          >
            In Outlook only <span className="sync-health-count">{untracked.length}</span>
          </button>
          {untrackedOpen && (
            <ul className="sync-health-rows">
              {untracked.map((row) => (
                <li key={row.graphId} className="sync-health-row">
                  <span className="sync-health-row-title">{row.subject}</span>
                  <span className="sync-health-row-date">{row.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

export default function SyncHealthReport({ apiToken }) {
  const { showError } = useNotification();
  const [range, setRange] = useState(defaultWindow);
  // Bumped by every Run Check click so an unchanged date range still refetches.
  const [runVersion, setRunVersion] = useState(0);
  const [appliedRange, setAppliedRange] = useState(null);

  const queryKey = useMemo(
    () => keys.syncHealth.report({ version: runVersion }),
    [runVersion]
  );

  const enabled = runVersion > 0 && !!apiToken && !!appliedRange;

  const { data, isPending, isFetching, error } = useQuery({
    queryKey,
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: appliedRange.startDate,
        endDate: appliedRange.endDate,
      });
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/reports/sync-health?${params}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Sync health check failed (${response.status})`);
      }
      return response.json();
    },
  });

  const { isFirstLoad: isRunning } = deriveListLoadingState(
    { isPending, isFetching },
    { enabled }
  );

  React.useEffect(() => {
    if (error) {
      logger.error('Sync health check failed:', error);
      showError(error.message || 'Sync health check failed');
    }
  }, [error, showError]);

  const handleRunCheck = () => {
    setAppliedRange({ ...range });
    setRunVersion(v => v + 1);
  };

  return (
    <div className="sync-health">
      <header className="sync-health-header">
        <h2>Sync Health</h2>
        <p className="sync-health-subtitle">
          Compares what this app believes is published against what Outlook actually shows.
          Read-only — nothing is changed by running a check.
        </p>
      </header>

      {/* DatePickerInput renders a bare <input type="date"> — it has NO label
          prop, and its onChange is a raw DOM handler, so read e.target.value. */}
      <div className="sync-health-controls">
        <div className="sync-health-field">
          <label htmlFor="sync-health-start">From</label>
          <DatePickerInput
            id="sync-health-start"
            value={range.startDate}
            onChange={(e) => setRange(r => ({ ...r, startDate: e.target.value }))}
          />
        </div>
        <div className="sync-health-field">
          <label htmlFor="sync-health-end">To</label>
          <DatePickerInput
            id="sync-health-end"
            value={range.endDate}
            onChange={(e) => setRange(r => ({ ...r, endDate: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="sync-health-run-btn"
          onClick={handleRunCheck}
          disabled={isRunning || isFetching}
        >
          {isRunning || isFetching ? 'Checking...' : 'Run Check'}
        </button>
      </div>

      <div className="sync-health-results">
        {isRunning || isFetching ? (
          <LoadingSpinner variant="card" text="Comparing app and Outlook..." />
        ) : !data ? (
          <p className="sync-health-idle">
            Choose a date range and click Run Check to compare the app against Outlook.
          </p>
        ) : data.calendars.length === 0 ? (
          <p className="sync-health-idle">No managed calendars have events in this window.</p>
        ) : (
          data.calendars.map((calendar) => (
            <CalendarCard
              key={`${calendar.calendarOwner}|${calendar.calendarId || ''}`}
              calendar={calendar}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the stylesheet**

Create `src/components/SyncHealthReport.css`:

```css
/* src/components/SyncHealthReport.css
   Scoped under .sync-health so nothing leaks into other admin screens. */

.sync-health { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }

.sync-health-header h2 { margin: 0 0 0.25rem; }
.sync-health-subtitle { margin: 0 0 1.25rem; color: var(--color-neutral-600); font-size: 0.9rem; }

.sync-health-controls {
  display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;
  padding: 1rem; margin-bottom: 1.5rem;
  background: var(--color-neutral-50); border-radius: 6px;
}

.sync-health-field { display: flex; flex-direction: column; gap: 0.25rem; }
.sync-health-field label { font-size: 0.75rem; font-weight: 600; color: var(--color-neutral-600); }

.sync-health-run-btn {
  padding: 0.5rem 1.25rem; border: none; border-radius: 4px; cursor: pointer;
  background: var(--color-info-500); color: #fff; font-weight: 600;
}
.sync-health-run-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.sync-health-idle { color: var(--color-neutral-600); font-style: italic; }

.sync-health-card {
  border: 1px solid var(--color-neutral-200); border-radius: 6px;
  padding: 1rem; margin-bottom: 1.25rem; background: #fff;
}
.sync-health-card--errored { border-color: var(--color-error-500); }

.sync-health-card-header {
  display: flex; flex-wrap: wrap; justify-content: space-between;
  align-items: center; gap: 1rem; margin-bottom: 0.75rem;
}
.sync-health-card-title { margin: 0; font-size: 1rem; }

.sync-health-counts { display: flex; gap: 1.25rem; margin: 0; }
.sync-health-counts div { text-align: center; }
.sync-health-counts dt { font-size: 0.7rem; text-transform: uppercase; color: var(--color-neutral-600); }
.sync-health-counts dd { margin: 0; font-size: 1.1rem; font-weight: 600; }

.sync-health-banner {
  margin: 0; padding: 0.6rem 0.9rem; border-radius: 4px; font-weight: 500;
}
.sync-health-banner--ok {
  background: var(--color-success-50, #eaf7ee);
  color: var(--color-success-700, #1c6b34);
}

.sync-health-error { margin: 0; color: var(--color-error-500); }

.sync-health-section { margin-top: 1rem; }
.sync-health-section-title { margin: 0 0 0.5rem; font-size: 0.9rem; }
.sync-health-section--critical .sync-health-section-title { color: var(--color-error-500); }

.sync-health-count {
  display: inline-block; min-width: 1.4em; padding: 0 0.4em;
  border-radius: 10px; background: var(--color-neutral-200);
  font-size: 0.75rem; text-align: center;
}

.sync-health-rows { list-style: none; margin: 0; padding: 0; }
.sync-health-row {
  display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: baseline;
  padding: 0.4rem 0; border-top: 1px solid var(--color-neutral-100);
}
.sync-health-row-title { font-weight: 500; }
.sync-health-row-date { font-variant-numeric: tabular-nums; color: var(--color-neutral-600); }
.sync-health-row-reason { color: var(--color-neutral-600); font-size: 0.85rem; }

.sync-health-disclosure {
  background: none; border: none; padding: 0; cursor: pointer;
  font-size: 0.9rem; font-weight: 600; color: var(--color-neutral-700);
}
```

- [ ] **Step 6: Run the frontend test to verify it passes**

Run: `npm run test:run -- SyncHealthReport`
Expected: PASS, 4 tests

- [ ] **Step 7: Wire the route and guard in `App.jsx`**

Add the lazy import with the other admin components (after the `RschedImport` line, around line 92):

```javascript
const SyncHealthReport = lazy(() => import('./components/SyncHealthReport'));
```

Add the guard next to `RequireCalendarMarkers` (around line 110):

```javascript
// Guards /admin/sync-health — reachable by admins and approvers. UX redirect
// only; the backend gate is authoritative.
function RequireSyncHealth({ children }) {
  const { effectivePermissions } = useRoleSimulation();
  if (!effectivePermissions.isAdmin && !effectivePermissions.canApproveReservations) {
    return <Navigate to="/" replace />;
  }
  return children;
}
```

Add the route next to the calendar-markers route (around line 353):

```jsx
                  <Route path="/admin/sync-health" element={<RequireSyncHealth><SyncHealthReport apiToken={apiToken} /></RequireSyncHealth>} />
```

- [ ] **Step 8: Add the nav links in `Navigation.jsx`**

Add a top-level link for non-admin approvers, immediately after the `canManageCalendarMarkers && !isAdmin` block (around line 186):

```jsx
        {/* Sync Health - top-level for approvers who are not admins. Admins
            reach it in the Admin dropdown below, same as Holidays & Closures. */}
        {canApproveReservations && !isAdmin && (
          <li>
            <NavLink to="/admin/sync-health" className={({ isActive }) => isActive ? 'active' : ''}>
              Sync Health
            </NavLink>
          </li>
        )}
```

Add the dropdown entry immediately after the calendar-markers `<li>` inside the Admin dropdown (around line 247):

```jsx
                <li>
                  <NavLink
                    to="/admin/sync-health"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Sync Health
                  </NavLink>
                </li>
```

`canApproveReservations` is already destructured from `usePermissions()` at the top of `Navigation.jsx` (line ~15), so no change is needed there.

One gate does need widening: the early return at line ~123 currently reads
`if (!canSubmitReservation && !canApproveReservations && !isAdmin && !canManageCalendarMarkers) return null;`.
It already admits approvers, so Sync Health is reachable — leave it as is.

- [ ] **Step 9: Verify the build and the touched frontend tests**

Run:
```bash
npm run build
npm run test:run -- SyncHealthReport
npm run test:run -- Navigation
```
Expected: build succeeds; both test files PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/SyncHealthReport.jsx src/components/SyncHealthReport.css src/queries/keys.js src/App.jsx src/components/Navigation.jsx src/__tests__/unit/components/SyncHealthReport.test.jsx
git commit -m "feat(sync-health): admin page at /admin/sync-health

- On-demand Run Check following the EventSearch manual-query pattern
- Per-calendar cards: counts, all-green banner, red finding sections
- Collapsed 'In Outlook only' section; error card for a failed calendar
- Route guarded for admins and approvers, nav link in both placements
- Tests: 4 new frontend tests"
```

---

## Verification (after all tasks)

Run only the files this feature touches:

```bash
cd backend && npm test -- syncHealthDiff.test.js
cd backend && npm test -- syncHealth.test.js
cd backend && npm test -- recurringPublish.test.js   # guards the graphApiMock change
npm run test:run -- SyncHealthReport
npm run test:run -- Navigation
npm run build
```

Note: the repo has known pre-existing failures on `main` that are untriaged bugs rather than noise. If a failure appears in a file this feature did not touch, report it — do not silently fix or silently ignore it.

## Self-Review Notes

- **Spec coverage:** endpoint + auth + defaults + validation (Task 4); data gathering + grouping + expansion + child overlay (Task 3); diff module + Outlook index + four matching rules + four finding types + counts + cancelled handling (Tasks 1-2); retry policy + per-calendar isolation (Task 3); response shape (Tasks 2-3); route + guard + nav + page + results + error card + toast (Task 5); all eight spec'd unit cases, all three integration cases, all three frontend cases.
- **Known deviations, both deliberate:** the unit test lives in `__tests__/unit/utils/` per repo convention rather than the spec's `__tests__/unit/`; and the gathering service has no standalone unit test because the integration test in Task 4 covers it end-to-end against the real route.
- **Reused rather than rebuilt:** `expandAllOccurrences`, `buildSeriesAwareDateRangeClause`, `retryWithBackoff`, `createAppForTest`, `deriveListLoadingState`, `LoadingSpinner`, `DatePickerInput`, `useNotification`. The only new primitive is the Eastern date-key normalizer, which has no existing equivalent (`backend/utils/dateUtils.js` exports only `extractDatePart`, which is timezone-naive).
- **Signature checks performed against the codebase** (these were wrong in the first draft and are now correct): `insertEvent(db, event)` takes the db; `createMockToken` is async; `userFactory` exposes `createAdmin`/`createApprover`/`createRequester`, not `createTestUser`; `testSetup` exposes `connectToGlobalServer`/`disconnectFromGlobalServer`, not `setupTestDb`; `createBaseEvent` requires `Date` objects for start/end; `DatePickerInput` has no `label` prop and its `onChange` receives a DOM event.
- **Two date conversions, deliberately separate:** `toEasternDateKey` converts Graph's UTC instants only. App-side documents already store local values (`calendarData.startDateTime` is a local-time string, top-level `startDateTime` may be a `Date`), and `localDateOf` handles those. Running either function over the other side's data reintroduces the offset bug.

const {
  toEasternDateKey,
  toEasternTimeKey,
  buildOutlookIndex,
  seriesDateKey,
  diffCalendar,
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

// App-side findings carry location/time so the report can show them as
// columns. Purely display — see displayFieldsOf in syncHealthDiff.js; nothing
// here participates in matching. Spread into the exact-equality assertions
// below so those keep asserting "these fields and no others".
const NO_DISPLAY = { location: '', startTime: '', endTime: '' };

describe('syncHealthDiff — toEasternTimeKey', () => {
  // Graph sends `start.dateTime` with NO trailing Z and a sibling timeZone of
  // 'UTC'. A 17:00 Eastern booking in January arrives as 22:00; printing that
  // raw next to the app's local '17:00' makes one event look like two.
  it('converts a UTC instant to local wall clock (EST)', () => {
    expect(toEasternTimeKey('2027-01-23T22:00:00.0000000', 'UTC')).toBe('17:00');
  });

  it('converts across the DST boundary (EDT)', () => {
    expect(toEasternTimeKey('2026-07-15T21:00:00.0000000', 'UTC')).toBe('17:00');
  });

  // A named zone means Graph already rendered wall-clock time; shifting again
  // would double-apply the offset.
  it('takes the time as-is when Graph already localized it', () => {
    expect(toEasternTimeKey('2027-01-23T17:00:00.0000000', 'America/New_York')).toBe('17:00');
  });

  it('is null for nothing', () => {
    expect(toEasternTimeKey(null)).toBeNull();
    expect(toEasternTimeKey('')).toBeNull();
  });
});

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

    // The child carries a seriesGraphId but has no Outlook match on that date.
    expect(result.missingFromOutlook).toEqual([{
      mongoId: 'add1',
      eventTitle: 'Extra Rehearsal',
      date: '2026-08-20',
      eventType: 'addition',
      reason: 'no Outlook event for added date',
      ...NO_DISPLAY,
    }]);
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
      ...NO_DISPLAY,
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
      ...NO_DISPLAY,
    }]);
  });

  it('carries location and time onto findings for the report columns', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        eventTitle: 'Religious School Reserved',
        location: 'Lowenstein', startTime: '09:00', endTime: '12:00',
      })],
      outlookInstances: [],
    });

    expect(result.missingFromOutlook[0]).toMatchObject({
      location: 'Lowenstein', startTime: '09:00', endTime: '12:00',
    });
  });

  // The app calls a room 'Lowenstein', Outlook calls it 'Leon Lowenstein'
  // (Locations carries Graph-sourced aliases). Matching is by Graph ID alone,
  // so that drift must be invisible to the diff — it is a column, not a rule.
  it('does not flag an event whose room is named differently in Outlook', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        eventTitle: 'Religious School Reserved', location: 'Lowenstein',
      })],
      outlookInstances: [outlookEvent('g1', '2026-08-14', {
        subject: 'Religious School Reserved', location: { displayName: 'Leon Lowenstein' },
      })],
    });

    expect(result.missingFromOutlook).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.counts.matched).toBe(1);
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
      // A master stands for its whole pattern, so no single date is "the" date.
      { mongoId: 'm1', eventTitle: 'Untethered Series', eventType: 'seriesMaster', date: null, ...NO_DISPLAY },
    ]);
    expect(result.missingFromOutlook).toEqual([]);
  });

  it('reports an untethered addition child with no stored Graph ID at all', () => {
    const result = diffCalendar({
      ...emptyArgs,
      appInstances: [appInstance({
        mongoId: 'add1', eventTitle: 'Extra Rehearsal', date: '2026-08-20',
        eventType: 'addition', graphId: null, seriesGraphId: null,
      })],
      outlookInstances: [],
    });

    // Everything that is not a master carries its date, so the report can say
    // WHEN rather than falling back to "whole series".
    expect(result.untethered).toEqual([
      { mongoId: 'add1', eventTitle: 'Extra Rehearsal', eventType: 'addition', date: '2026-08-20', ...NO_DISPLAY },
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

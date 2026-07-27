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

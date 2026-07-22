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

  it('expands two independent masters in the same rawDocs batch', () => {
    const masterA = makeMaster({ _id: 'master-oid-a', eventId: 'master-a', eventTitle: 'Weekly Torah Study' });
    const masterB = makeMaster({
      _id: 'master-oid-b',
      eventId: 'master-b',
      eventTitle: 'Weekly Board Meeting',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Weekly Board Meeting',
        startDateTime: '2026-03-10T18:00:00',
        endDateTime: '2026-03-10T19:00:00',
      },
    });
    const out = expandSearchResults([masterA, masterB], '2026-06-16', '2026-06-16');
    expect(out).toHaveLength(2);
    const titles = out.map(o => o.calendarData.eventTitle).sort();
    expect(titles).toEqual(['Weekly Board Meeting', 'Weekly Torah Study']);
    expect(out.every(o => o.startDate === '2026-06-16')).toBe(true);
  });

  it('fires onMasterCap when a daily noEnd master produces >= MAX_OCCURRENCES over a long window', () => {
    const dailyMaster = makeMaster({
      eventId: 'master-daily',
      recurrence: {
        pattern: { type: 'daily', interval: 1 },
        range: { type: 'noEnd', startDate: '2020-01-01' },
        additions: [],
        exclusions: [],
      },
    });
    const calls = [];
    // Window spans well over 500 days so the per-master cap is hit.
    const out = expandSearchResults([dailyMaster], '2020-01-01', '2022-06-01', {
      onMasterCap: (info) => calls.push(info),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].masterEventId).toBe('master-daily');
    expect(calls[0].produced).toBeGreaterThanOrEqual(500);
    expect(out.length).toBeGreaterThanOrEqual(500);
  });

  it('does not fire onMasterCap when a master stays under MAX_OCCURRENCES', () => {
    const calls = [];
    expandSearchResults([makeMaster()], '2026-06-15', '2026-06-24', {
      onMasterCap: (info) => calls.push(info),
    });
    expect(calls).toHaveLength(0);
  });
});

/**
 * buildGraphMarkerEventData — all-day Graph payload mapping for calendar markers.
 *
 * Locks the contract from openspec/changes/add-calendar-markers/specs/
 * calendar-marker-outlook-sync/spec.md:
 *   - isAllDay true
 *   - start.dateTime = startDate (bare YYYY-MM-DD, NO timeZone)
 *   - end.dateTime   = endDate + 1 day (exclusive), via UTC date math
 *   - showAs derived from type (oof for officeClosed, free for holiday)
 *   - subject/body from name/note
 */

const { buildGraphMarkerEventData, addOneUtcDay } = require('../../../utils/graphEventBuilder');

describe('buildGraphMarkerEventData', () => {
  it('single-day marker → exclusive end is the day after startDate', () => {
    const payload = buildGraphMarkerEventData({
      type: 'holiday',
      name: 'Christmas',
      note: '',
      startDate: '2026-12-25',
      endDate: '2026-12-25',
    });
    expect(payload.isAllDay).toBe(true);
    expect(payload.start.dateTime).toBe('2026-12-25');
    expect(payload.end.dateTime).toBe('2026-12-26'); // exclusive end
  });

  it('omits timeZone on start and end (Graph rejects all-day events that carry one)', () => {
    const payload = buildGraphMarkerEventData({
      type: 'holiday',
      name: 'Festival',
      startDate: '2026-09-12',
      endDate: '2026-09-12',
    });
    expect(payload.start).not.toHaveProperty('timeZone');
    expect(payload.end).not.toHaveProperty('timeZone');
  });

  it('multi-day marker → covers the inclusive range with an exclusive end one past endDate', () => {
    const payload = buildGraphMarkerEventData({
      type: 'officeClosed',
      name: 'Sukkot',
      startDate: '2026-09-12',
      endDate: '2026-09-20',
    });
    expect(payload.start.dateTime).toBe('2026-09-12');
    expect(payload.end.dateTime).toBe('2026-09-21');
  });

  it('officeClosed → showAs oof', () => {
    const payload = buildGraphMarkerEventData({ type: 'officeClosed', name: 'Closed', startDate: '2026-01-01', endDate: '2026-01-01' });
    expect(payload.showAs).toBe('oof');
  });

  it('holiday → showAs free', () => {
    const payload = buildGraphMarkerEventData({ type: 'holiday', name: 'Holiday', startDate: '2026-01-01', endDate: '2026-01-01' });
    expect(payload.showAs).toBe('free');
  });

  it('maps subject from name and body from note', () => {
    const payload = buildGraphMarkerEventData({
      type: 'holiday',
      name: 'Passover',
      note: 'First day',
      startDate: '2026-04-01',
      endDate: '2026-04-01',
    });
    expect(payload.subject).toBe('Passover');
    expect(payload.body).toEqual({ contentType: 'Text', content: 'First day' });
  });

  describe('DST-boundary correctness (UTC date math)', () => {
    it('US spring-forward: 2026-03-08 → 2026-03-09 (no off-by-one)', () => {
      // 2026-03-08 is the US DST spring-forward day. Local Date math could land
      // the +1 day on 01:00 instead of midnight; UTC math keeps it on the date line.
      expect(addOneUtcDay('2026-03-08')).toBe('2026-03-09');
      const payload = buildGraphMarkerEventData({ type: 'holiday', name: 'x', startDate: '2026-03-08', endDate: '2026-03-08' });
      expect(payload.end.dateTime).toBe('2026-03-09');
    });

    it('US fall-back: 2026-11-01 → 2026-11-02', () => {
      expect(addOneUtcDay('2026-11-01')).toBe('2026-11-02');
    });

    it('end-of-month and leap-year rollovers', () => {
      expect(addOneUtcDay('2026-01-31')).toBe('2026-02-01');
      expect(addOneUtcDay('2026-12-31')).toBe('2027-01-01');
      expect(addOneUtcDay('2028-02-28')).toBe('2028-02-29'); // 2028 is a leap year
      expect(addOneUtcDay('2028-02-29')).toBe('2028-03-01');
    });
  });
});

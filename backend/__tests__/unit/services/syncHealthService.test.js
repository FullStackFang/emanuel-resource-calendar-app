/**
 * Unit tests for the gathering layer of the Sync Health report.
 *
 * buildAppSide is pure (documents in, instances out), so it is testable without
 * Mongo or Graph. The diff rules themselves live in syncHealthDiff.test.js.
 */

const { ObjectId } = require('mongodb');

const { buildAppSide } = require('../../../services/syncHealthService');
const logger = require('../../../utils/logger');

const WINDOW = ['2026-08-01', '2026-08-31'];

describe('syncHealthService — buildAppSide null-date guard', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // localDateOf reads calendarData.startDateTime, then top-level startDateTime,
  // then startDate. A document that has none of them resolves to null, and a
  // null date fails every match in diffCalendar — producing a
  // missingFromOutlook finding that looks identical to a real one. The
  // calendarData removal refactor is in flight, so this must be loud.
  it('reports and logs a document whose local date cannot be resolved', () => {
    const doc = {
      _id: new ObjectId(),
      eventTitle: 'Dateless Event',
      calendarOwner: 'templeevents@emanuelnyc.org',
      status: 'published',
      eventType: 'singleInstance',
      graphData: { id: 'graph-1' },
      // no calendarData, no startDateTime, no startDate
    };

    const { appInstances, nullDateMongoIds } = buildAppSide([doc], ...WINDOW);

    expect(nullDateMongoIds).toEqual([String(doc._id)]);
    expect(appInstances[0].date).toBeNull();

    expect(errorSpy).toHaveBeenCalled();
    // The mongoId must be in the log line — it is the only handle for finding
    // the offending record.
    expect(errorSpy.mock.calls[0].map(String).join(' ')).toContain(String(doc._id));
  });

  it('stays silent for a document with a resolvable date', () => {
    const doc = {
      _id: new ObjectId(),
      eventTitle: 'Normal Event',
      calendarOwner: 'templeevents@emanuelnyc.org',
      status: 'published',
      eventType: 'singleInstance',
      graphData: { id: 'graph-2' },
      calendarData: { startDateTime: '2026-08-14T13:00:00', endDateTime: '2026-08-14T14:00:00' },
    };

    const { appInstances, nullDateMongoIds } = buildAppSide([doc], ...WINDOW);

    expect(nullDateMongoIds).toEqual([]);
    expect(appInstances[0].date).toBe('2026-08-14');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

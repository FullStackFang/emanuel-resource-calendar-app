/**
 * publishedMasterGraphSync unit tests (PMS-1..10)
 *
 * buildMasterPatch is pure; reconcilePublishedSeries runs against a real
 * (memory-server) collection with graphApiMock and stubbed api-server helpers
 * injected through deps.
 */

const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createPublishedSeriesMaster, createExceptionDocument, createAdditionDocument } = require('../../__helpers__/eventFactory');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { findGraphOccurrenceForDate } = require('../../../utils/graphOccurrenceLookup');
const { buildMasterPatch, reconcilePublishedSeries } = require('../../../services/publishedMasterGraphSync');

const quietLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

const patchDeps = {
  buildGraphSubject: (title, s, e) => ((s && e) ? (title || 'Untitled Event') : `[Hold] ${title || 'Untitled Event'}`),
  buildOffsiteGraphLocation: (name, addr) => ({ displayName: `${name} (Offsite) - ${addr}`, locationType: 'default' }),
  logger: quietLogger,
};

function master(overrides = {}) {
  const m = createPublishedSeriesMaster({ eventTitle: 'Class', graphId: 'G-series', ...overrides });
  m.calendarData.endDateTime = '2026-06-30T11:00:00'; // series END, as production stores it
  return m;
}

function flat(event) {
  const cd = event.calendarData;
  return { ...cd, recurrence: event.recurrence };
}

describe('buildMasterPatch (PMS-1..5)', () => {
  it('PMS-1: Save mode (changedFields null) always emits subject and times', () => {
    const event = master();
    const patch = buildMasterPatch({ effective: { eventTitle: 'X' }, changedFields: null, event, deps: patchDeps });
    expect(patch.subject).toBe('X');
    expect(patch.start).toBeDefined();
    expect(patch.end).toBeDefined();
  });

  it('PMS-2: approval mode emits only the groups that changed', () => {
    const event = master();
    const patch = buildMasterPatch({
      effective: { ...flat(event), eventTitle: 'Renamed' },
      changedFields: new Set(['eventTitle']),
      event, deps: patchDeps,
    });
    expect(Object.keys(patch)).toEqual(['subject']);
    expect(patch.subject).toBe('Renamed');
  });

  it('PMS-3: a time-only change on a recurring master is aligned and sends no recurrence', () => {
    const event = master();
    const patch = buildMasterPatch({
      effective: { ...flat(event), startDateTime: '2026-03-10T14:00:00', endDateTime: '2026-06-30T15:00:00' },
      changedFields: new Set(['startDateTime', 'endDateTime']),
      event, deps: patchDeps,
    });
    expect(patch.start.dateTime).toBe('2026-03-10T14:00:00');
    expect(patch.end.dateTime).toBe('2026-03-10T15:00:00');
    expect('recurrence' in patch).toBe(false);
  });

  it('PMS-4: a rewritten schedule sends recurrence and aligns start/end to the new range start', () => {
    const event = master();
    const recurrence = { ...event.recurrence, range: { ...event.recurrence.range, startDate: '2026-03-17' } };
    const patch = buildMasterPatch({
      effective: { ...flat(event), recurrence },
      changedFields: new Set(['recurrence']),
      recurrenceRewritten: true,
      event, deps: patchDeps,
    });
    expect(patch.recurrence.range.startDate).toBe('2026-03-17');
    expect(patch.start.dateTime).toBe('2026-03-17T10:00:00');
  });

  it('PMS-5: changed rooms use resolved names; cleared rooms send Unspecified', () => {
    const event = master();
    const changed = buildMasterPatch({
      effective: flat(event),
      changedFields: new Set(['locations']),
      locations: [{ displayName: 'A', locationType: 'default' }, { displayName: 'B', locationType: 'default' }],
      event, deps: patchDeps,
    });
    expect(changed.location.displayName).toBe('A; B');
    const cleared = buildMasterPatch({
      effective: { ...flat(event), locations: [] },
      changedFields: new Set(['locations']),
      event, deps: patchDeps,
    });
    expect(cleared.location.displayName).toBe('Unspecified');
  });
});

describe('reconcilePublishedSeries (PMS-6..10)', () => {
  let mongoClient, db, collection;

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('publishedMasterGraphSyncUnit'));
    collection = db.collection(COLLECTIONS.EVENTS);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await collection.deleteMany({});
    graphApiMock.resetMocks();
  });

  function deps() {
    return {
      graphApi: graphApiMock,
      collection,
      logger: quietLogger,
      ensureSeconds: dt => (dt && /\d{2}:\d{2}$/.test(dt) ? `${dt}:00` : dt),
      buildGraphLocationFields: names => {
        const list = Array.isArray(names) ? names : String(names || '').split('; ').filter(Boolean);
        return { location: { displayName: list.join('; '), locationType: 'default' }, locations: list.map(n => ({ displayName: n, locationType: 'default' })) };
      },
      syncExceptionDocumentsToGraph: async () => ({ synced: [], failed: [] }),
      // Same shape as api-server's helper, over the shared lookup.
      syncRecurrenceExclusionsToGraph: async (owner, calId, seriesId, dates, tz) => {
        const out = { cancelledOccurrences: [], notFound: [], failed: [] };
        for (const date of dates) {
          const match = await findGraphOccurrenceForDate(graphApiMock, owner, calId, seriesId, date, tz);
          if (!match) { out.notFound.push(date); continue; }
          await graphApiMock.deleteCalendarEvent(owner, calId, match.id);
          out.cancelledOccurrences.push({ date, graphId: match.id });
        }
        return out;
      },
    };
  }

  const instances = dates => dates.map(d => ({ id: `inst-${d}`, start: { dateTime: `${d}T10:00:00.0000000` } }));

  async function seed(stored, savedRecurrence) {
    await collection.insertOne(stored);
    const updatedEvent = { ...stored, recurrence: savedRecurrence };
    await collection.updateOne({ _id: stored._id }, { $set: { recurrence: savedRecurrence } });
    return updatedEvent;
  }

  it('PMS-6: delta mode cancels only the newly added exclusion', async () => {
    const stored = master();
    stored.recurrence = { ...stored.recurrence, exclusions: ['2026-03-17'] };
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-03-17', '2026-03-24']));
    const updatedEvent = await seed(stored, { ...stored.recurrence, exclusions: ['2026-03-17', '2026-03-24'] });

    const r = await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });

    expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(1);
    expect(r.cancelledExclusions).toEqual([{ date: '2026-03-24', graphId: 'inst-2026-03-24' }]);
  });

  it('PMS-7: rewritten mode re-cancels the full exclusion list', async () => {
    const stored = master();
    stored.recurrence = { ...stored.recurrence, exclusions: ['2026-03-17'] };
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-03-17', '2026-03-24']));
    const updatedEvent = await seed(stored, { ...stored.recurrence, exclusions: ['2026-03-17', '2026-03-24'] });

    const r = await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: true, deps: deps() });

    expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(2);
    expect(r.cancelledExclusions.map(c => c.date)).toEqual(['2026-03-17', '2026-03-24']);
  });

  it('PMS-8: an excluded date with a child soft-deletes it and deletes its own Graph event', async () => {
    const stored = master();
    await collection.insertOne(createAdditionDocument(stored, '2026-03-12', {}, { graphEventId: 'G-add-0312' }));
    const updatedEvent = await seed(stored, { ...stored.recurrence, additions: ['2026-03-12'], exclusions: ['2026-03-12'] });

    await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });

    const child = await collection.findOne({ seriesMasterEventId: stored.eventId, occurrenceDate: '2026-03-12' });
    expect(child.isDeleted).toBe(true);
    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['G-add-0312']);
    expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(0);
  });

  it('PMS-11: an excluded date whose exception child has no graphEventId still cancels the series instance', async () => {
    const stored = master();
    await collection.insertOne(createExceptionDocument(stored, '2026-03-24', { eventTitle: 'Unlinked' }));
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-03-24']));
    const updatedEvent = await seed(stored, { ...stored.recurrence, exclusions: ['2026-03-24'] });

    const r = await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });

    const child = await collection.findOne({ seriesMasterEventId: stored.eventId, occurrenceDate: '2026-03-24' });
    expect(child.isDeleted).toBe(true);
    expect(r.cancelledExclusions).toEqual([{ date: '2026-03-24', graphId: 'inst-2026-03-24' }]);
  });

  it('PMS-9: cancellations are appended, never overwriting earlier entries', async () => {
    const stored = master();
    stored.graphData.cancelledOccurrences = [{ date: '2026-03-17', graphId: 'inst-old' }];
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-03-24']));
    const updatedEvent = await seed(stored, { ...stored.recurrence, exclusions: ['2026-03-24'] });

    await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });

    const after = await collection.findOne({ _id: stored._id });
    expect(after.graphData.cancelledOccurrences).toEqual([
      { date: '2026-03-17', graphId: 'inst-old' },
      { date: '2026-03-24', graphId: 'inst-2026-03-24' },
    ]);
    expect(after._version).toBe(stored._version);
  });

  it('PMS-10: master changes cascade to linked children; a Graph error is reported, not thrown', async () => {
    const stored = master();
    await collection.insertOne(createExceptionDocument(stored, '2026-03-24', { eventTitle: 'Own Title' }, { graphEventId: 'G-exc' }));
    await collection.insertOne(stored);
    const updatedEvent = { ...stored, calendarData: { ...stored.calendarData, locationDisplayNames: 'Hall' } };

    const ok = await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });
    const call = graphApiMock.getCallHistory('updateCalendarEvent')[0];
    expect(call.eventId).toBe('G-exc');
    expect(call.eventData.subject).toBe('Own Title'); // the child's override still wins
    expect(call.eventData.location.displayName).toBe('Hall');
    expect(ok.synced).toEqual([{ kind: 'exception', date: '2026-03-24', graphId: 'G-exc' }]);

    graphApiMock.setMockError('updateCalendarEvent', graphApiMock.graphError(503, 'busy'));
    const failed = await reconcilePublishedSeries({ event: stored, updatedEvent, editScope: null, recurrenceRewritten: false, deps: deps() });
    expect(failed.failed).toEqual([expect.objectContaining({ kind: 'exception', date: '2026-03-24' })]);
  });
});

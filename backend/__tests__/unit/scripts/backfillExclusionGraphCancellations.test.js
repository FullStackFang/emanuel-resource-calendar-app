/**
 * backfill-exclusion-graph-cancellations.js (BXC-1..4)
 */

const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createPublishedSeriesMaster, createAdditionDocument, createExceptionDocument } = require('../../__helpers__/eventFactory');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { runBackfill } = require('../../../backfill-exclusion-graph-cancellations');

describe('backfill-exclusion-graph-cancellations (BXC-1..4)', () => {
  let mongoClient, db, collection;

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('backfillExclusionGraph'));
    collection = db.collection(COLLECTIONS.EVENTS);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await collection.deleteMany({});
    graphApiMock.resetMocks();
  });

  // The live incident: an approved request excluded 10/14, Outlook kept it.
  async function seedIncident() {
    const master = createPublishedSeriesMaster({
      eventId: 'evt-request-1780078660390-6l4gmxc9j',
      eventTitle: "Dr. Alyssa Cady's Class",
      graphId: 'G-cady',
    });
    master.recurrence = { ...master.recurrence, range: { type: 'endDate', startDate: '2026-10-07', endDate: '2026-12-16' }, exclusions: ['2026-10-14'] };
    await collection.insertOne(master);
    return master;
  }

  const run = (mode, log = () => {}) => runBackfill({ collection, graphApi: graphApiMock, mode, log, delayMs: 0 });

  it('BXC-1: dry run lists the master, date and timezone, and deletes nothing', async () => {
    await seedIncident();
    graphApiMock.setMockResponse('getRecurringEventInstances', [{ id: 'inst-1014', start: { dateTime: '2026-10-14T18:00:00.0000000' } }]);
    const lines = [];

    const stats = await run('dry-run', l => lines.push(l));

    expect(stats.planned).toBe(1);
    const line = lines.find(l => l.includes('evt-request-1780078660390-6l4gmxc9j'));
    expect(line).toContain('2026-10-14');
    expect(line).toContain('America/New_York');
    expect(graphApiMock.getCallHistory('getRecurringEventInstances')[0].timeZone).toBe('America/New_York');
    graphApiMock.assertNotCalled('deleteCalendarEvent');
  });

  it('BXC-2: apply deletes and appends, verify then reports zero', async () => {
    const master = await seedIncident();
    graphApiMock.setMockResponse('getRecurringEventInstances', [{ id: 'inst-1014', start: { dateTime: '2026-10-14T18:00:00.0000000' } }]);

    const applied = await run('apply');
    expect(applied.applied).toBe(1);
    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['inst-1014']);
    const after = await collection.findOne({ _id: master._id });
    expect(after.graphData.cancelledOccurrences).toEqual([{ date: '2026-10-14', graphId: 'inst-1014' }]);

    // Graph no longer returns the cancelled instance.
    graphApiMock.setMockResponse('getRecurringEventInstances', []);
    const verified = await run('verify');
    expect(verified.stillPresent).toBe(0);
  });

  it('BXC-3: an excluded date with a child removes the child and its own Graph event', async () => {
    const master = await seedIncident();
    await collection.insertOne(createAdditionDocument(master, '2026-10-14', {}, { graphEventId: 'G-add-1014' }));

    await run('apply');

    const child = await collection.findOne({ seriesMasterEventId: master.eventId, occurrenceDate: '2026-10-14' });
    expect(child.isDeleted).toBe(true);
    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['G-add-1014']);
    expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(0);
  });

  it('BXC-5: an exception child with no graphEventId is removed AND its series instance cancelled', async () => {
    // Production 2026-10-08 (Kaiserman 11/19): the child was never linked to
    // Outlook, so deleting only the child left the instance in place.
    const master = await seedIncident();
    await collection.insertOne(createExceptionDocument(master, '2026-10-14', { eventTitle: 'Unlinked' }));
    graphApiMock.setMockResponse('getRecurringEventInstances', [{ id: 'inst-1014', start: { dateTime: '2026-10-14T18:00:00.0000000' } }]);

    await run('apply');

    const child = await collection.findOne({ seriesMasterEventId: master.eventId, occurrenceDate: '2026-10-14' });
    expect(child.isDeleted).toBe(true);
    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['inst-1014']);
    const after = await collection.findOne({ _id: master._id });
    expect(after.graphData.cancelledOccurrences).toEqual([{ date: '2026-10-14', graphId: 'inst-1014' }]);
  });

  it('BXC-4: a second run is a no-op; untethered masters are reported, not touched', async () => {
    await seedIncident();
    const untethered = createPublishedSeriesMaster({ eventTitle: 'Untethered', graphData: { id: undefined } });
    delete untethered.graphData.id;
    untethered.recurrence = { ...untethered.recurrence, exclusions: ['2026-03-17'] };
    await collection.insertOne(untethered);
    graphApiMock.setMockResponse('getRecurringEventInstances', []);

    const stats = await run('apply');

    expect(stats.applied).toBe(0);
    expect(stats.untethered).toBe(1);
    graphApiMock.assertNotCalled('deleteCalendarEvent');
  });
});

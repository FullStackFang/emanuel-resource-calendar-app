/**
 * Tests for time-of-day filtering in MCP search_events tool
 *
 * Verifies afterTime/beforeTime parameters filter events correctly
 * both at the MongoDB query level and via post-query safety net.
 */

const { setupTestDatabase, teardownTestDatabase, clearCollections } = require('../../__helpers__/testSetup');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const { MCPToolExecutor } = require('../../../services/mcpTools');

let db;
let executor;

beforeAll(async () => {
  ({ db } = await setupTestDatabase());
  executor = new MCPToolExecutor(db);
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearCollections();
});

// Helper to insert test events with known times
async function insertEvents(events) {
  const collection = db.collection(COLLECTIONS.EVENTS);
  const docs = events.map((e, i) => ({
    eventTitle: e.title || `Event ${i + 1}`,
    startDate: e.date || '2026-03-15',
    endDate: e.date || '2026-03-15',
    startDateTime: e.startDateTime || `${e.date || '2026-03-15'}T${e.startTime || '09:00'}:00`,
    endDateTime: e.endDateTime || `${e.date || '2026-03-15'}T${e.endTime || '10:00'}:00`,
    calendarData: {
      startTime: e.startTime || undefined,
      endTime: e.endTime || undefined
    },
    status: e.status || 'published',
    calendarOwner: 'TempleEventsSandbox@emanuelnyc.org',
    isDeleted: false,
    ...e.extra
  }));
  await collection.insertMany(docs);
}

describe('MCP search_events time-of-day filtering', () => {
  const baseInput = { startDate: '2026-03-15', endDate: '2026-03-15' };

  describe('afterTime parameter', () => {
    it('TSF-1: excludes events before afterTime', async () => {
      await insertEvents([
        { title: 'Early Morning', startTime: '07:00', endTime: '08:00' },
        { title: 'Afternoon', startTime: '14:00', endTime: '15:00' },
        { title: 'Evening', startTime: '19:00', endTime: '20:00' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '12:00'
      });

      expect(result.count).toBe(2);
      const titles = result.events.map(e => e.title);
      expect(titles).toContain('Afternoon');
      expect(titles).toContain('Evening');
      expect(titles).not.toContain('Early Morning');
    });

    it('TSF-2: includes events starting exactly at afterTime', async () => {
      await insertEvents([
        { title: 'Exact Match', startTime: '14:00', endTime: '15:00' },
        { title: 'Before', startTime: '13:59', endTime: '14:30' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '14:00'
      });

      expect(result.count).toBe(1);
      expect(result.events[0].title).toBe('Exact Match');
    });
  });

  describe('beforeTime parameter', () => {
    it('TSF-3: excludes events at or after beforeTime', async () => {
      await insertEvents([
        { title: 'Morning', startTime: '09:00', endTime: '10:00' },
        { title: 'Noon', startTime: '12:00', endTime: '13:00' },
        { title: 'Afternoon', startTime: '14:00', endTime: '15:00' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        beforeTime: '12:00'
      });

      expect(result.count).toBe(1);
      expect(result.events[0].title).toBe('Morning');
    });
  });

  describe('combined afterTime + beforeTime', () => {
    it('TSF-4: filters to a time window', async () => {
      await insertEvents([
        { title: 'Early', startTime: '08:00', endTime: '09:00' },
        { title: 'Mid Morning', startTime: '10:00', endTime: '11:00' },
        { title: 'Lunch', startTime: '12:30', endTime: '13:30' },
        { title: 'Afternoon', startTime: '15:00', endTime: '16:00' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '10:00',
        beforeTime: '14:00'
      });

      expect(result.count).toBe(2);
      const titles = result.events.map(e => e.title);
      expect(titles).toContain('Mid Morning');
      expect(titles).toContain('Lunch');
    });
  });

  describe('calendarData.startTime filtering', () => {
    it('TSF-5: filters events using calendarData.startTime (canonical field)', async () => {
      const collection = db.collection(COLLECTIONS.EVENTS);
      // Insert events with calendarData.startTime (real data shape)
      await collection.insertMany([
        {
          eventTitle: 'Morning Event',
          startDate: '2026-03-15',
          endDate: '2026-03-15',
          startDateTime: '2026-03-15T08:00:00',
          endDateTime: '2026-03-15T09:00:00',
          calendarData: { startTime: '08:00', endTime: '09:00' },
          status: 'published',
          calendarOwner: 'TempleEventsSandbox@emanuelnyc.org',
          isDeleted: false
        },
        {
          eventTitle: 'Afternoon Event',
          startDate: '2026-03-15',
          endDate: '2026-03-15',
          startDateTime: '2026-03-15T15:00:00',
          endDateTime: '2026-03-15T16:00:00',
          calendarData: { startTime: '15:00', endTime: '16:00' },
          status: 'published',
          calendarOwner: 'TempleEventsSandbox@emanuelnyc.org',
          isDeleted: false
        }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '12:00'
      });

      expect(result.count).toBe(1);
      expect(result.events[0].title).toBe('Afternoon Event');
    });
  });

  describe('no time params', () => {
    it('TSF-6: returns all events when no time filter is specified', async () => {
      await insertEvents([
        { title: 'Morning', startTime: '09:00', endTime: '10:00' },
        { title: 'Afternoon', startTime: '14:00', endTime: '15:00' },
        { title: 'Evening', startTime: '19:00', endTime: '20:00' }
      ]);

      const result = await executor.execute('search_events', baseInput);

      expect(result.count).toBe(3);
      expect(result.timeFilter).toBeUndefined();
    });
  });

  describe('response metadata', () => {
    it('TSF-7: includes timeFilter in response when time params are used', async () => {
      await insertEvents([
        { title: 'Test', startTime: '10:00', endTime: '11:00' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '09:00',
        beforeTime: '12:00'
      });

      expect(result.timeFilter).toEqual({
        afterTime: '09:00',
        beforeTime: '12:00'
      });
    });

    it('TSF-8: includes partial timeFilter when only one param is used', async () => {
      await insertEvents([
        { title: 'Test', startTime: '10:00', endTime: '11:00' }
      ]);

      const result = await executor.execute('search_events', {
        ...baseInput,
        afterTime: '14:00'
      });

      expect(result.timeFilter).toEqual({
        afterTime: '14:00',
        beforeTime: undefined
      });
    });
  });
});

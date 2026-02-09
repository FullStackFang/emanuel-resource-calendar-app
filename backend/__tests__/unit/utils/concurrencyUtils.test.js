/**
 * Unit tests for concurrencyUtils.js
 *
 * Tests the conditionalUpdate function for optimistic concurrency control.
 * Uses an in-memory MongoDB via testSetup to test real findOneAndUpdate behavior.
 */

const { ObjectId } = require('mongodb');
const { setupTestDatabase, teardownTestDatabase, clearCollections, getDb } = require('../../__helpers__/testSetup');
const { conditionalUpdate } = require('../../../utils/concurrencyUtils');

let db;
let collection;

beforeAll(async () => {
  const setup = await setupTestDatabase();
  db = setup.db;
  collection = db.collection('testConcurrency');
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await collection.deleteMany({});
});

describe('conditionalUpdate', () => {
  describe('version match success', () => {
    it('should update and increment _version when expected version matches', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 1, eventTitle: 'Test' };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved' } },
        { expectedVersion: 1 }
      );

      expect(result._version).toBe(2);
      expect(result.status).toBe('approved');
      expect(result.lastModifiedDateTime).toBeInstanceOf(Date);
    });
  });

  describe('version mismatch → 409', () => {
    it('should throw 409 when expected version does not match current version', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 3, eventTitle: 'Test' };
      await collection.insertOne(doc);

      await expect(
        conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { status: 'approved' } },
          { expectedVersion: 1 }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentVersion: 3,
          currentStatus: 'pending',
        }),
      });
    });
  });

  describe('status mismatch → 409', () => {
    it('should throw 409 when expected status does not match current status', async () => {
      const doc = { _id: new ObjectId(), status: 'approved', _version: 1, eventTitle: 'Test' };
      await collection.insertOne(doc);

      await expect(
        conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { rejectionReason: 'test' } },
          { expectedVersion: 1, expectedStatus: 'pending' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentStatus: 'approved',
        }),
      });
    });
  });

  describe('document not found → 404', () => {
    it('should throw 404 when document does not exist', async () => {
      const nonExistentId = new ObjectId();

      await expect(
        conditionalUpdate(
          collection,
          { _id: nonExistentId },
          { $set: { status: 'approved' } },
          { expectedVersion: 1 }
        )
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('null version (backward compatibility)', () => {
    it('should skip version check when expectedVersion is null', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 5, eventTitle: 'Test' };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved' } },
        { expectedVersion: null }
      );

      expect(result._version).toBe(6);
      expect(result.status).toBe('approved');
    });

    it('should skip version check when expectedVersion is undefined', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 2, eventTitle: 'Test' };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved' } },
        {}
      );

      expect(result._version).toBe(3);
      expect(result.status).toBe('approved');
    });
  });

  describe('combined version + status guard', () => {
    it('should succeed when both version and status match', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 1, eventTitle: 'Test' };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved', approvedAt: new Date() } },
        { expectedVersion: 1, expectedStatus: 'pending' }
      );

      expect(result._version).toBe(2);
      expect(result.status).toBe('approved');
    });

    it('should fail when version matches but status does not', async () => {
      const doc = { _id: new ObjectId(), status: 'rejected', _version: 1, eventTitle: 'Test' };
      await collection.insertOne(doc);

      await expect(
        conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { status: 'approved' } },
          { expectedVersion: 1, expectedStatus: 'pending' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentVersion: 1,
          currentStatus: 'rejected',
        }),
      });
    });
  });

  describe('$inc merging', () => {
    it('should merge _version increment with existing $inc fields', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 1, viewCount: 5 };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        {
          $set: { status: 'approved' },
          $inc: { viewCount: 1 }
        },
        { expectedVersion: 1 }
      );

      expect(result._version).toBe(2);
      expect(result.viewCount).toBe(6);
    });
  });

  describe('snapshotFields', () => {
    it('should include snapshot of specified fields on version conflict', async () => {
      const doc = {
        _id: new ObjectId(),
        status: 'approved',
        _version: 3,
        calendarData: {
          eventTitle: 'Board Meeting',
          startDate: '2026-03-01',
          startTime: '09:00',
        }
      };
      await collection.insertOne(doc);

      await expect(
        conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { status: 'rejected' } },
          {
            expectedVersion: 1,
            snapshotFields: [
              { key: 'eventTitle', path: 'calendarData.eventTitle' },
              { key: 'startDate', path: 'calendarData.startDate' },
              { key: 'startTime', path: 'calendarData.startTime' },
              { key: 'status', path: 'status' },
            ]
          }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          snapshot: {
            eventTitle: 'Board Meeting',
            startDate: '2026-03-01',
            startTime: '09:00',
            status: 'approved',
          }
        }),
      });
    });

    it('should not include snapshot when snapshotFields is not provided', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 2, eventTitle: 'Test' };
      await collection.insertOne(doc);

      try {
        await conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { status: 'approved' } },
          { expectedVersion: 1 }
        );
      } catch (err) {
        expect(err.statusCode).toBe(409);
        expect(err.details.snapshot).toBeUndefined();
      }
    });

    it('should return undefined for missing nested paths gracefully', async () => {
      const doc = {
        _id: new ObjectId(),
        status: 'pending',
        _version: 2,
        // No calendarData at all
      };
      await collection.insertOne(doc);

      await expect(
        conditionalUpdate(
          collection,
          { _id: doc._id },
          { $set: { status: 'approved' } },
          {
            expectedVersion: 1,
            snapshotFields: [
              { key: 'eventTitle', path: 'calendarData.eventTitle' },
              { key: 'status', path: 'status' },
            ]
          }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          snapshot: {
            eventTitle: undefined,
            status: 'pending',
          }
        }),
      });
    });
  });

  describe('lastModifiedDateTime always set', () => {
    it('should set lastModifiedDateTime even when not in original update', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 1 };
      await collection.insertOne(doc);

      const before = new Date();
      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved' } },
        { expectedVersion: 1 }
      );
      const after = new Date();

      expect(result.lastModifiedDateTime).toBeInstanceOf(Date);
      expect(result.lastModifiedDateTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.lastModifiedDateTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should set lastModifiedBy when modifiedBy option is provided', async () => {
      const doc = { _id: new ObjectId(), status: 'pending', _version: 1 };
      await collection.insertOne(doc);

      const result = await conditionalUpdate(
        collection,
        { _id: doc._id },
        { $set: { status: 'approved' } },
        { expectedVersion: 1, modifiedBy: 'admin@test.com' }
      );

      expect(result.lastModifiedBy).toBe('admin@test.com');
    });
  });
});

/**
 * Concurrency Integration Tests
 *
 * Tests optimistic concurrency control using the conditionalUpdate utility
 * directly against the in-memory MongoDB. These tests verify the _version
 * guard and status guard behavior across realistic event workflow scenarios.
 *
 * Uses the in-memory MongoDB via testSetup (same as concurrencyUtils.test.js)
 * to test real findOneAndUpdate behavior with the full conditionalUpdate function.
 */

const { ObjectId } = require('mongodb');
const { setupTestDatabase, teardownTestDatabase, getDb } = require('../../__helpers__/testSetup');
const { conditionalUpdate } = require('../../../utils/concurrencyUtils');
const {
  createPendingEvent,
  createPublishedEvent,
  createDeletedEvent,
  createRejectedEvent,
  insertEvent,
} = require('../../__helpers__/eventFactory');

let db;
let eventsCollection;

beforeAll(async () => {
  const setup = await setupTestDatabase();
  db = setup.db;
  eventsCollection = db.collection('templeEvents__Events');
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await eventsCollection.deleteMany({});
});

describe('Concurrency Integration Tests', () => {
  describe('C-1: Two publishers race', () => {
    it('first publisher succeeds, second gets 409', async () => {
      const event = createPendingEvent({ _version: 1 });
      await insertEvent(db, event);

      // First publisher succeeds
      const result1 = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'published', publishedBy: 'approver1@test.com' } },
        { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'approver1@test.com' }
      );

      expect(result1.status).toBe('published');
      expect(result1._version).toBe(2);

      // Second publisher fails with 409
      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'published', publishedBy: 'approver2@test.com' } },
          { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'approver2@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentVersion: 2,
          currentStatus: 'published',
        }),
      });
    });
  });

  describe('C-2: Publish vs cancel race', () => {
    it('one operation succeeds, the other gets 409', async () => {
      const event = createPendingEvent({ _version: 1 });
      await insertEvent(db, event);

      // Publisher succeeds first
      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'published', publishedBy: 'approver@test.com' } },
        { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'approver@test.com' }
      );

      expect(result.status).toBe('published');

      // Cancel attempt fails (status is no longer 'pending')
      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'cancelled', cancelledBy: 'user@test.com' } },
          { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'user@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentStatus: 'published',
        }),
      });
    });
  });

  describe('C-3: Two editors save simultaneously', () => {
    it('first editor succeeds, second gets 409', async () => {
      const event = createPublishedEvent({ _version: 1 });
      await insertEvent(db, event);

      // First editor saves
      const result1 = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'Editor 1 Title' } },
        { expectedVersion: 1, modifiedBy: 'editor1@test.com' }
      );

      expect(result1.eventTitle).toBe('Editor 1 Title');
      expect(result1._version).toBe(2);

      // Second editor tries to save based on version 1
      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { eventTitle: 'Editor 2 Title' } },
          { expectedVersion: 1, modifiedBy: 'editor2@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentVersion: 2,
        }),
      });

      // Verify first editor's changes persisted
      const finalEvent = await eventsCollection.findOne({ _id: event._id });
      expect(finalEvent.eventTitle).toBe('Editor 1 Title');
    });
  });

  describe('C-4: Edit request vs admin update race', () => {
    it('one operation succeeds, the other gets 409', async () => {
      const event = createPublishedEvent({ _version: 1 });
      await insertEvent(db, event);

      // Admin updates the event
      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'Admin Updated' } },
        { expectedVersion: 1, modifiedBy: 'admin@test.com' }
      );

      expect(result._version).toBe(2);

      // Requester tries to submit edit request with stale version
      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { pendingEditRequest: { reason: 'test' } } },
          { expectedVersion: 1, modifiedBy: 'requester@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe('C-5: Delete vs publish race', () => {
    it('one operation succeeds, the other gets 409', async () => {
      const event = createPendingEvent({ _version: 1 });
      await insertEvent(db, event);

      // Delete wins
      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'deleted', isDeleted: true } },
        { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'admin@test.com' }
      );

      expect(result.status).toBe('deleted');

      // Publish fails
      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'published' } },
          { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'approver@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          currentStatus: 'deleted',
        }),
      });
    });
  });

  describe('C-6: Missing _version (backward compatibility)', () => {
    it('should succeed when expectedVersion is null', async () => {
      const event = createPendingEvent({ _version: 5 });
      await insertEvent(db, event);

      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'published' } },
        { expectedVersion: null, modifiedBy: 'admin@test.com' }
      );

      expect(result.status).toBe('published');
      expect(result._version).toBe(6);
    });

    it('should succeed when no options provided', async () => {
      const event = createPendingEvent({ _version: 3 });
      await insertEvent(db, event);

      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'Updated' } },
        {}
      );

      expect(result.eventTitle).toBe('Updated');
      expect(result._version).toBe(4);
    });
  });

  describe('C-7: Wrong _version returns current state', () => {
    it('should include current version and status in 409 details', async () => {
      const event = createPublishedEvent({ _version: 7 });
      await insertEvent(db, event);

      try {
        await conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { eventTitle: 'Stale Update' } },
          { expectedVersion: 3, modifiedBy: 'user@test.com' }
        );
        fail('Should have thrown 409');
      } catch (err) {
        expect(err.statusCode).toBe(409);
        expect(err.details.code).toBe('VERSION_CONFLICT');
        expect(err.details.currentVersion).toBe(7);
        expect(err.details.currentStatus).toBe('published');
      }
    });
  });

  describe('C-8: Version increments correctly', () => {
    it('should increment 1 -> 2 -> 3 on successive updates', async () => {
      const event = createPendingEvent({ _version: 1 });
      await insertEvent(db, event);

      // Update 1: version 1 -> 2
      const result1 = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'First Update' } },
        { expectedVersion: 1 }
      );
      expect(result1._version).toBe(2);

      // Update 2: version 2 -> 3
      const result2 = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'Second Update' } },
        { expectedVersion: 2 }
      );
      expect(result2._version).toBe(3);

      // Update 3: version 3 -> 4
      const result3 = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { eventTitle: 'Third Update' } },
        { expectedVersion: 3 }
      );
      expect(result3._version).toBe(4);
    });
  });

  describe('C-9: Restore respects version', () => {
    it('should succeed with correct version on restore', async () => {
      const event = createDeletedEvent({ _version: 3, previousStatus: 'published' });
      await insertEvent(db, event);

      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'published', isDeleted: false } },
        { expectedVersion: 3, expectedStatus: 'deleted', modifiedBy: 'admin@test.com' }
      );

      expect(result.status).toBe('published');
      expect(result.isDeleted).toBe(false);
      expect(result._version).toBe(4);
    });

    it('should fail with stale version on restore', async () => {
      const event = createDeletedEvent({ _version: 3 });
      await insertEvent(db, event);

      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'published', isDeleted: false } },
          { expectedVersion: 1, expectedStatus: 'deleted', modifiedBy: 'admin@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          currentVersion: 3,
        }),
      });
    });
  });

  describe('C-10: Status guard prevents invalid transitions', () => {
    it('should prevent publishing a rejected event', async () => {
      const event = createRejectedEvent({ _version: 2 });
      await insertEvent(db, event);

      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'published' } },
          { expectedVersion: 2, expectedStatus: 'pending', modifiedBy: 'admin@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'VERSION_CONFLICT',
          currentStatus: 'rejected',
        }),
      });
    });

    it('should prevent rejecting a published event', async () => {
      const event = createPublishedEvent({ _version: 2 });
      await insertEvent(db, event);

      await expect(
        conditionalUpdate(
          eventsCollection,
          { _id: event._id },
          { $set: { status: 'rejected', rejectionReason: 'too late' } },
          { expectedVersion: 2, expectedStatus: 'pending', modifiedBy: 'admin@test.com' }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          currentStatus: 'published',
        }),
      });
    });

    it('should allow matching status guard to succeed', async () => {
      const event = createPendingEvent({ _version: 1 });
      await insertEvent(db, event);

      const result = await conditionalUpdate(
        eventsCollection,
        { _id: event._id },
        { $set: { status: 'rejected', rejectionReason: 'not suitable' } },
        { expectedVersion: 1, expectedStatus: 'pending', modifiedBy: 'admin@test.com' }
      );

      expect(result.status).toBe('rejected');
      expect(result._version).toBe(2);
    });
  });
});

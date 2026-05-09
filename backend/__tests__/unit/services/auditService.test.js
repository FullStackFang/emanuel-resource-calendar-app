/**
 * auditService Unit Tests
 *
 * Verifies the persistence-layer contract for audit-trail entries:
 *   - recordEvent / recordReservation route to the right collections
 *   - Errors are caught and logged but never propagated (audit must
 *     never break the main operation)
 *   - Both functions delegate entry-shape construction to auditBuilder
 */

const auditService = require('../../../services/auditService');

// Stub out the logger to keep test output clean.
jest.mock('../../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  isDebugEnabled: () => false,
}));

const logger = require('../../../utils/logger');

// Build a minimal mock db handle whose .collection(name) returns a
// per-collection mock with insertOne(). Each test checks which collection
// was hit and which entry was inserted.
function makeMockDb() {
  const collections = {};
  function getOrCreate(name) {
    if (!collections[name]) {
      collections[name] = {
        insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
      };
    }
    return collections[name];
  }
  return {
    db: { collection: jest.fn((name) => getOrCreate(name)) },
    collections,
  };
}

describe('auditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordEvent', () => {
    it('writes to templeEvents__EventAuditHistory with the built audit entry', async () => {
      const { db, collections } = makeMockDb();
      auditService.setDbConnection(db);

      await auditService.recordEvent({
        eventId: 'evt-1',
        userId: 'user-A',
        changeType: 'update',
        source: 'API',
        changeSet: [{ field: 'eventTitle', oldValue: 'Old', newValue: 'New' }],
        metadata: { reason: 'Manual edit' },
      });

      const collection = collections['templeEvents__EventAuditHistory'];
      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = collection.insertOne.mock.calls[0][0];
      expect(inserted.eventId).toBe('evt-1');
      expect(inserted.userId).toBe('user-A');
      expect(inserted.changeType).toBe('update');
      expect(inserted.source).toBe('API');
      expect(inserted.timestamp).toBeInstanceOf(Date);
      expect(inserted.changeSet).toEqual([
        { field: 'eventTitle', oldValue: 'Old', newValue: 'New' },
      ]);
      expect(inserted.metadata.reason).toBe('Manual edit');
    });

    it('catches and logs errors without propagating (audit must never break main op)', async () => {
      const failingDb = {
        collection: () => ({
          insertOne: jest.fn().mockRejectedValue(new Error('Cosmos rate limit')),
        }),
      };
      auditService.setDbConnection(failingDb);

      // Must NOT throw
      await expect(
        auditService.recordEvent({
          eventId: 'evt-fail',
          userId: 'user-A',
          changeType: 'update',
        })
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log event audit entry'),
        expect.any(Error)
      );
    });

    it('throws an explicit error when setDbConnection() was never called', async () => {
      // Reset state by passing null
      auditService.setDbConnection(null);

      // Internal error is caught by recordEvent's try/catch, then logged.
      // The function still resolves (audit must never break main op), but
      // the error message should make the bootstrap problem obvious.
      await auditService.recordEvent({ eventId: 'e', userId: 'u', changeType: 'create' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log event audit entry'),
        expect.objectContaining({ message: expect.stringContaining('setDbConnection') })
      );
    });
  });

  describe('recordReservation', () => {
    it('writes to templeEvents__ReservationAuditHistory with the built audit entry', async () => {
      const { db, collections } = makeMockDb();
      auditService.setDbConnection(db);

      await auditService.recordReservation({
        reservationId: 'res-1',
        userId: 'user-B',
        userEmail: 'b@example.com',
        changeType: 'publish',
        source: 'Approval Queue',
        changeSet: [{ field: 'status', oldValue: 'pending', newValue: 'published' }],
      });

      const collection = collections['templeEvents__ReservationAuditHistory'];
      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = collection.insertOne.mock.calls[0][0];
      expect(inserted.reservationId).toBe('res-1');
      expect(inserted.userId).toBe('user-B');
      expect(inserted.userEmail).toBe('b@example.com');
      expect(inserted.changeType).toBe('publish');
    });

    it('catches and logs errors without propagating', async () => {
      const failingDb = {
        collection: () => ({
          insertOne: jest.fn().mockRejectedValue(new Error('Network blip')),
        }),
      };
      auditService.setDbConnection(failingDb);

      await expect(
        auditService.recordReservation({
          reservationId: 'res-fail',
          userId: 'user-B',
          userEmail: 'b@example.com',
          changeType: 'reject',
        })
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log reservation audit entry'),
        expect.any(Error)
      );
    });
  });
});

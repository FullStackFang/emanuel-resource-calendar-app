/**
 * lifecycleEvents Unit Tests
 *
 * Verifies that afterStateChange:
 *   - Translates the (event, transition) signature into the legacy
 *     broadcaster's payload shape correctly
 *   - Pulls requesterEmail from event.roomReservationData.requestedBy.email
 *     when not explicitly provided
 *   - Catches and logs broadcaster errors without propagating them
 *   - No-ops when called before setBroadcaster() (bootstrap order issue)
 *   - No-ops when called without an action (bad usage guard)
 */

const lifecycleEvents = require('../../../services/lifecycleEvents');

jest.mock('../../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../../utils/logger');

describe('lifecycleEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('afterStateChange', () => {
    it('falls back to event._id when eventId is absent', () => {
      const broadcaster = jest.fn();
      lifecycleEvents.setBroadcaster(broadcaster);

      lifecycleEvents.afterStateChange(
        { _id: 'mongo-objectid' },
        { action: 'deleted' }
      );

      expect(broadcaster.mock.calls[0][0].eventId).toBe('mongo-objectid');
    });

    it('extracts requesterEmail from event.roomReservationData.requestedBy.email', () => {
      const broadcaster = jest.fn();
      lifecycleEvents.setBroadcaster(broadcaster);

      lifecycleEvents.afterStateChange(
        { eventId: 'evt-2', roomReservationData: { requestedBy: { email: 'req@x.com' } } },
        { action: 'rejected', actorEmail: 'admin@x.com' }
      );

      expect(broadcaster.mock.calls[0][0].requesterEmail).toBe('req@x.com');
    });

    it('explicit transition.requesterEmail overrides the event-derived one', () => {
      const broadcaster = jest.fn();
      lifecycleEvents.setBroadcaster(broadcaster);

      lifecycleEvents.afterStateChange(
        { eventId: 'evt-3', roomReservationData: { requestedBy: { email: 'derived@x.com' } } },
        { action: 'published', requesterEmail: 'override@x.com' }
      );

      expect(broadcaster.mock.calls[0][0].requesterEmail).toBe('override@x.com');
    });

    it('catches broadcaster errors and logs them without propagating', () => {
      const broadcaster = jest.fn(() => { throw new Error('SSE broker down'); });
      lifecycleEvents.setBroadcaster(broadcaster);

      // Must NOT throw
      expect(() => {
        lifecycleEvents.afterStateChange({ eventId: 'evt-x' }, { action: 'created' });
      }).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('afterStateChange failed'),
        expect.any(String)
      );
    });

    it('no-ops with a warning when broadcaster has not been wired', () => {
      lifecycleEvents.setBroadcaster(null);

      expect(() => {
        lifecycleEvents.afterStateChange({ eventId: 'evt-y' }, { action: 'created' });
      }).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('broadcaster not wired')
      );
    });

    it('no-ops with a warning when called without an action', () => {
      const broadcaster = jest.fn();
      lifecycleEvents.setBroadcaster(broadcaster);

      lifecycleEvents.afterStateChange({ eventId: 'evt-z' }, {});

      expect(broadcaster).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('called without action')
      );
    });
  });
});

/**
 * Unit tests for canAccessEventAttachments (authUtils)
 *
 * Regression coverage for the production 404 on
 * GET /api/events/:eventId/attachments: the endpoint formerly scoped the event
 * lookup by the logged-in user's id, so any non-owner (an admin/approver
 * reviewing someone else's evt-request) was denied. Access must now be granted
 * to staff, the requester (by email), and the owner (by OID).
 */

const { canAccessEventAttachments } = require('../../../utils/authUtils');

const REQUESTER_EMAIL = 'requester@external.com';
const REQUESTER_OID = 'oid-requester-123';

// An evt-request-* event: userId is the requester's OID, requestedBy.email is
// the canonical requester source.
function makeReservationEvent(overrides = {}) {
  return {
    eventId: 'evt-request-1778694307680-133rox5nc',
    userId: REQUESTER_OID,
    roomReservationData: {
      requestedBy: { email: REQUESTER_EMAIL, name: 'Reqs McGee' },
    },
    ...overrides,
  };
}

describe('canAccessEventAttachments', () => {
  describe('staff (approver-or-higher) — the reported 404 case', () => {
    it('grants an admin access to another user\'s reservation request', () => {
      const event = makeReservationEvent();
      const admin = { role: 'admin' };
      expect(
        canAccessEventAttachments(event, admin, 'admin@emanuelnyc.org', 'oid-admin')
      ).toBe(true);
    });

    it('grants an approver access to another user\'s reservation request', () => {
      const event = makeReservationEvent();
      const approver = { role: 'approver' };
      expect(
        canAccessEventAttachments(event, approver, 'approver@external.com', 'oid-approver')
      ).toBe(true);
    });

    it('grants access via legacy isAdmin flag', () => {
      const event = makeReservationEvent();
      const legacyAdmin = { isAdmin: true };
      expect(
        canAccessEventAttachments(event, legacyAdmin, 'legacy@emanuelnyc.org', 'oid-legacy')
      ).toBe(true);
    });
  });

  describe('requester (by email)', () => {
    it('grants the requester access to their own request', () => {
      const event = makeReservationEvent();
      const requester = { role: 'requester' };
      expect(
        canAccessEventAttachments(event, requester, REQUESTER_EMAIL, REQUESTER_OID)
      ).toBe(true);
    });

    it('matches requester email case-insensitively', () => {
      const event = makeReservationEvent();
      const requester = { role: 'requester' };
      expect(
        canAccessEventAttachments(event, requester, REQUESTER_EMAIL.toUpperCase(), 'oid-other')
      ).toBe(true);
    });

    it('grants the requester even when not present in the users collection (null user)', () => {
      const event = makeReservationEvent();
      expect(
        canAccessEventAttachments(event, null, REQUESTER_EMAIL, 'oid-mismatch')
      ).toBe(true);
    });
  });

  describe('owner (by OID)', () => {
    it('grants the owner access to an event that has a userId but no requestedBy', () => {
      const event = { eventId: 'evt-1', userId: 'oid-owner' };
      const requester = { role: 'requester' };
      expect(
        canAccessEventAttachments(event, requester, 'owner@external.com', 'oid-owner')
      ).toBe(true);
    });

    it('coerces userId/currentUserId types before comparing', () => {
      const event = { eventId: 'evt-1', userId: 12345 };
      expect(
        canAccessEventAttachments(event, { role: 'requester' }, 'x@external.com', '12345')
      ).toBe(true);
    });
  });

  describe('denied', () => {
    it('denies an unrelated requester (different email and OID, non-staff)', () => {
      const event = makeReservationEvent();
      const stranger = { role: 'requester' };
      expect(
        canAccessEventAttachments(event, stranger, 'stranger@external.com', 'oid-stranger')
      ).toBe(false);
    });

    it('denies a viewer with no relationship to the event', () => {
      const event = makeReservationEvent();
      const viewer = { role: 'viewer' };
      expect(
        canAccessEventAttachments(event, viewer, 'viewer@external.com', 'oid-viewer')
      ).toBe(false);
    });

    it('denies when the event is null', () => {
      expect(
        canAccessEventAttachments(null, { role: 'admin' }, 'admin@emanuelnyc.org', 'oid-admin')
      ).toBe(false);
    });

    it('does not grant on an empty-string OID matching a missing userId', () => {
      const event = { eventId: 'evt-1' }; // no userId, no requestedBy
      expect(
        canAccessEventAttachments(event, { role: 'requester' }, 'x@external.com', '')
      ).toBe(false);
    });
  });
});

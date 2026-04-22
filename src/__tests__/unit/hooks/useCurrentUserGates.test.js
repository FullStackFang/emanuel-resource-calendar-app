// src/__tests__/unit/hooks/useCurrentUserGates.test.js
import { describe, it, expect } from 'vitest';
import { deriveGates } from '../../../hooks/useCurrentUserGates';

const USER = 'owner@example.com';
const OTHER = 'other@example.com';

const PERMISSION_FIXTURES = {
  viewer: {
    canEditEvents: false,
    canApproveReservations: false,
    canDeleteEvents: false,
    canSubmitReservation: false,
    isAdmin: false,
    actualRole: 'viewer',
  },
  requester: {
    canEditEvents: false,
    canApproveReservations: false,
    canDeleteEvents: false,
    canSubmitReservation: true,
    isAdmin: false,
    actualRole: 'requester',
  },
  approver: {
    canEditEvents: true,
    canApproveReservations: true,
    canDeleteEvents: true,
    canSubmitReservation: true,
    isAdmin: false,
    actualRole: 'approver',
  },
  admin: {
    canEditEvents: true,
    canApproveReservations: true,
    canDeleteEvents: true,
    canSubmitReservation: true,
    isAdmin: true,
    actualRole: 'admin',
  },
};

const ROLES = ['viewer', 'requester', 'approver', 'admin'];
const STATUSES = ['draft', 'pending', 'published', 'rejected', 'deleted'];
const OWNERS = [true, false];
const EVENT_TYPES = ['singleInstance', 'seriesMaster', 'occurrence', 'exception', 'addition'];

function makeEvent({ status, eventType, isOwner }) {
  return {
    status,
    eventType,
    roomReservationData: {
      requestedBy: { email: isOwner ? USER : OTHER }
    }
  };
}

const accounts = [{ username: USER }];

describe('deriveGates — invariants', () => {
  describe('canEditRecurrence semantics', () => {
    it('singleInstance canEditRecurrence tracks canSave (promote-to-recurring path)', () => {
      // Viewer never: no canSave capability
      for (const status of STATUSES) {
        for (const isOwner of OWNERS) {
          const event = makeEvent({ status, eventType: 'singleInstance', isOwner });
          expect(
            deriveGates(event, PERMISSION_FIXTURES.viewer, accounts).canEditRecurrence,
            `viewer/${status}/owner=${isOwner}`
          ).toBe(false);
        }
      }
      // Admin/approver on editable statuses: yes
      for (const role of ['approver', 'admin']) {
        for (const status of ['draft', 'pending', 'published', 'rejected']) {
          const event = makeEvent({ status, eventType: 'singleInstance', isOwner: false });
          expect(
            deriveGates(event, PERMISSION_FIXTURES[role], accounts).canEditRecurrence,
            `${role}/${status}`
          ).toBe(true);
        }
        const deletedEvent = makeEvent({ status: 'deleted', eventType: 'singleInstance', isOwner: false });
        expect(
          deriveGates(deletedEvent, PERMISSION_FIXTURES[role], accounts).canEditRecurrence,
          `${role}/deleted`
        ).toBe(false);
      }
      // Requester on own draft/pending/rejected: yes; on own published: no (request-edit path)
      for (const status of ['draft', 'pending', 'rejected']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        expect(
          deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canEditRecurrence,
          `requester-own/${status}`
        ).toBe(true);
      }
      const pubOwn = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(pubOwn, PERMISSION_FIXTURES.requester, accounts).canEditRecurrence).toBe(false);
    });

    it.each(ROLES)('role=%s NEVER has canEditRecurrence on occurrence events (pattern is master-owned)', (role) => {
      for (const status of STATUSES) {
        for (const isOwner of OWNERS) {
          const event = makeEvent({ status, eventType: 'occurrence', isOwner });
          const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
          expect(gates.canEditRecurrence, `${role}/${status}/owner=${isOwner}`).toBe(false);
        }
      }
    });

    it('viewer NEVER has canEditRecurrence even on seriesMaster in any state', () => {
      for (const status of STATUSES) {
        for (const isOwner of OWNERS) {
          const event = makeEvent({ status, eventType: 'seriesMaster', isOwner });
          const gates = deriveGates(event, PERMISSION_FIXTURES.viewer, accounts);
          expect(gates.canEditRecurrence, `viewer/${status}/owner=${isOwner}`).toBe(false);
        }
      }
    });

    it('requester CANNOT edit recurrence on their OWN PUBLISHED series master (must request-edit)', () => {
      const event = makeEvent({ status: 'published', eventType: 'seriesMaster', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canEditRecurrence).toBe(false);
      expect(gates.canRequestEdit).toBe(true);
    });

    it('requester CAN edit recurrence on their own DRAFT/PENDING/REJECTED series master', () => {
      for (const status of ['draft', 'pending', 'rejected']) {
        const event = makeEvent({ status, eventType: 'seriesMaster', isOwner: true });
        const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        expect(gates.canEditRecurrence, status).toBe(true);
      }
    });

    it('requester CANNOT edit recurrence on someone ELSE\'s series master', () => {
      for (const status of STATUSES) {
        const event = makeEvent({ status, eventType: 'seriesMaster', isOwner: false });
        const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        expect(gates.canEditRecurrence, status).toBe(false);
      }
    });

    it.each(['approver', 'admin'])('%s CAN edit recurrence on any editable series master', (role) => {
      for (const status of ['draft', 'pending', 'published', 'rejected']) {
        for (const isOwner of OWNERS) {
          const event = makeEvent({ status, eventType: 'seriesMaster', isOwner });
          const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
          expect(gates.canEditRecurrence, `${role}/${status}/owner=${isOwner}`).toBe(true);
        }
      }
    });

    it.each(['approver', 'admin'])('%s CANNOT edit recurrence on deleted series master', (role) => {
      for (const isOwner of OWNERS) {
        const event = makeEvent({ status: 'deleted', eventType: 'seriesMaster', isOwner });
        const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
        expect(gates.canEditRecurrence, `${role}/owner=${isOwner}`).toBe(false);
      }
    });
  });

  describe('readOnly semantics', () => {
    it('viewer ALWAYS has readOnly=true on events they do not own', () => {
      for (const status of STATUSES) {
        for (const eventType of EVENT_TYPES) {
          const event = makeEvent({ status, eventType, isOwner: false });
          const gates = deriveGates(event, PERMISSION_FIXTURES.viewer, accounts);
          expect(gates.readOnly, `${status}/${eventType}`).toBe(true);
        }
      }
    });

    it('requester has readOnly=true on their OWN PUBLISHED event (request-edit path)', () => {
      for (const eventType of EVENT_TYPES) {
        const event = makeEvent({ status: 'published', eventType, isOwner: true });
        const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        expect(gates.readOnly, eventType).toBe(true);
      }
    });

    it('requester has readOnly=false on their OWN PENDING/REJECTED/DRAFT events', () => {
      for (const status of ['draft', 'pending', 'rejected']) {
        for (const eventType of EVENT_TYPES) {
          const event = makeEvent({ status, eventType, isOwner: true });
          const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
          expect(gates.readOnly, `${status}/${eventType}`).toBe(false);
        }
      }
    });

    it.each(['approver', 'admin'])('%s has readOnly=false on any editable status', (role) => {
      for (const status of ['draft', 'pending', 'published', 'rejected']) {
        for (const eventType of EVENT_TYPES) {
          for (const isOwner of OWNERS) {
            const event = makeEvent({ status, eventType, isOwner });
            const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
            expect(gates.readOnly, `${role}/${status}/${eventType}/owner=${isOwner}`).toBe(false);
          }
        }
      }
    });

    it.each(ROLES)('%s ALWAYS has readOnly=true on deleted events', (role) => {
      for (const eventType of EVENT_TYPES) {
        for (const isOwner of OWNERS) {
          const event = makeEvent({ status: 'deleted', eventType, isOwner });
          const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
          expect(gates.readOnly, `${role}/${eventType}/owner=${isOwner}`).toBe(true);
        }
      }
    });
  });

  describe('canDelete / canRestore', () => {
    it('requester CAN delete their OWN PENDING event (withdraw)', () => {
      const event = makeEvent({ status: 'pending', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canDelete).toBe(true);
    });

    it('requester CANNOT delete non-pending events or events they do not own', () => {
      for (const status of ['draft', 'published', 'rejected']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        expect(gates.canDelete, status).toBe(false);
      }
      const otherEvent = makeEvent({ status: 'pending', eventType: 'singleInstance', isOwner: false });
      const gates = deriveGates(otherEvent, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canDelete).toBe(false);
    });

    it('canRestore requires canDeleteEvents AND status=deleted', () => {
      const event = makeEvent({ status: 'deleted', eventType: 'singleInstance', isOwner: false });
      expect(deriveGates(event, PERMISSION_FIXTURES.viewer, accounts).canRestore).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRestore).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.approver, accounts).canRestore).toBe(true);
      expect(deriveGates(event, PERMISSION_FIXTURES.admin, accounts).canRestore).toBe(true);
    });
  });

  describe('canRequestEdit / canResubmit', () => {
    it('ONLY requester-role owners of published events can request edits', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.viewer, accounts).canRequestEdit).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit).toBe(true);
      expect(deriveGates(event, PERMISSION_FIXTURES.approver, accounts).canRequestEdit).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.admin, accounts).canRequestEdit).toBe(false);
    });

    it('canResubmit fires only for owner + rejected', () => {
      for (const role of ROLES) {
        const p = PERMISSION_FIXTURES[role];
        expect(
          deriveGates(makeEvent({ status: 'rejected', eventType: 'singleInstance', isOwner: true }), p, accounts).canResubmit
        ).toBe(true);
        expect(
          deriveGates(makeEvent({ status: 'rejected', eventType: 'singleInstance', isOwner: false }), p, accounts).canResubmit
        ).toBe(false);
        expect(
          deriveGates(makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true }), p, accounts).canResubmit
        ).toBe(false);
      }
    });
  });

  describe('recurrenceTabVisible — recurring variants always, single instances only when can promote', () => {
    it('recurring variants (seriesMaster/occurrence/exception/addition) show tab for every role and status', () => {
      for (const role of ROLES) {
        for (const status of STATUSES) {
          for (const isOwner of OWNERS) {
            for (const t of ['seriesMaster', 'occurrence', 'exception', 'addition']) {
              expect(
                deriveGates(makeEvent({ status, eventType: t, isOwner }), PERMISSION_FIXTURES[role], accounts).recurrenceTabVisible,
                `${role}/${t}/${status}/owner=${isOwner}`
              ).toBe(true);
            }
          }
        }
      }
    });

    it('single instance shows tab iff user can promote (canEditRecurrence=true)', () => {
      // Viewer: never
      for (const status of STATUSES) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: false });
        expect(deriveGates(event, PERMISSION_FIXTURES.viewer, accounts).recurrenceTabVisible, `viewer/${status}`).toBe(false);
      }
      // Approver on published single instance: yes (can promote)
      const adminEvent = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: false });
      expect(deriveGates(adminEvent, PERMISSION_FIXTURES.approver, accounts).recurrenceTabVisible).toBe(true);
      // Requester on OWN published single instance: no (request-edit flow, not direct promote)
      const reqOwn = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(reqOwn, PERMISSION_FIXTURES.requester, accounts).recurrenceTabVisible).toBe(false);
    });
  });

  describe('full matrix: deterministic (same input → same output)', () => {
    it('produces byte-identical gates for identical inputs across 100 calls', () => {
      const event = makeEvent({ status: 'pending', eventType: 'seriesMaster', isOwner: true });
      const first = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      for (let i = 0; i < 100; i++) {
        expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts)).toEqual(first);
      }
    });
  });
});

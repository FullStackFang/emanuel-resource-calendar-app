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

  describe('canRequestEdit / canRequestCancellation / canResubmit', () => {
    it('requester owner on own published event can request edit', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit).toBe(true);
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestCancellation).toBe(true);
    });

    it('admin and approver CANNOT request edit (they edit directly)', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.approver, accounts).canRequestEdit).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.admin, accounts).canRequestEdit).toBe(false);
    });

    it('viewer cannot request edit even on own published event (no canSubmitReservation)', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.viewer, accounts).canRequestEdit).toBe(false);
    });

    it('requester cannot request edit on non-published statuses', () => {
      for (const status of ['draft', 'pending', 'rejected', 'deleted']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        expect(
          deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit,
          status
        ).toBe(false);
      }
    });

    it('ownerless events (imported from Graph sync) allow any requester to request edit', () => {
      // Events with no roomReservationData.requestedBy.email are open for
      // community stewardship per the pre-refactor Calendar logic.
      const event = {
        status: 'published',
        eventType: 'singleInstance',
        // no roomReservationData at all
      };
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit).toBe(true);
    });

    it('department colleague can request edit on teammate\'s published event', () => {
      const event = {
        status: 'published',
        eventType: 'singleInstance',
        roomReservationData: { requestedBy: { email: 'teammate@example.com' } },
        creatorDepartment: 'membership',
      };
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: 'membership' };
      expect(deriveGates(event, deptRequester, accounts).canRequestEdit).toBe(true);
    });

    it('requester without dept-match cannot request edit on someone else\'s published event', () => {
      const event = {
        status: 'published',
        eventType: 'singleInstance',
        roomReservationData: { requestedBy: { email: 'someone@example.com' } },
      };
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit).toBe(false);
    });

    it('canRequestEdit BLOCKED when an edit request is already pending', () => {
      // Regression of a pre-refactor Calendar bug that MyReservations caught:
      // don't let user request a second edit while one is pending.
      const event = {
        ...makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true }),
        pendingEditRequest: { status: 'pending' },
      };
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canRequestEdit).toBe(false);
    });

    it('canRequestCancellation BLOCKED when a cancellation is already pending', () => {
      const event = {
        ...makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true }),
        pendingCancellationRequest: { status: 'pending' },
      };
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canRequestEdit).toBe(true); // edit still allowed
      expect(gates.canRequestCancellation).toBe(false); // cancellation blocked
    });

    it('canRequestEdit BLOCKED while in edit-request mode (already composing)', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(gates.canRequestEdit).toBe(false);
    });

    it('canRequestEdit BLOCKED while viewing an existing edit request preview', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isViewingEditRequest: true });
      expect(gates.canRequestEdit).toBe(false);
    });

    it('canResubmit: owner-requester on own rejected event', () => {
      const event = makeEvent({ status: 'rejected', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canResubmit).toBe(true);
    });

    it('canResubmit: dept colleague on teammate\'s rejected event (unified with Calendar pre-refactor)', () => {
      const event = {
        status: 'rejected',
        eventType: 'singleInstance',
        roomReservationData: { requestedBy: { email: 'teammate@example.com' } },
        creatorDepartment: 'membership',
      };
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: 'membership' };
      expect(deriveGates(event, deptRequester, accounts).canResubmit).toBe(true);
    });

    it('canResubmit: excluded for admins and approvers (they use direct publish path)', () => {
      const event = makeEvent({ status: 'rejected', eventType: 'singleInstance', isOwner: true });
      expect(deriveGates(event, PERMISSION_FIXTURES.approver, accounts).canResubmit).toBe(false);
      expect(deriveGates(event, PERMISSION_FIXTURES.admin, accounts).canResubmit).toBe(false);
    });

    it('canResubmit: excluded on non-rejected statuses', () => {
      for (const status of ['draft', 'pending', 'published', 'deleted']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        expect(
          deriveGates(event, PERMISSION_FIXTURES.requester, accounts).canResubmit,
          status
        ).toBe(false);
      }
    });
  });

  describe('canSavePendingEdit / canSaveRejectedEdit (non-admin owner-edit handlers)', () => {
    it('owner-requester can save edits to own pending event', () => {
      const event = makeEvent({ status: 'pending', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canSavePendingEdit).toBe(true);
      expect(gates.canSaveRejectedEdit).toBe(false);
    });

    it('owner-requester can save edits to own rejected event', () => {
      const event = makeEvent({ status: 'rejected', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canSavePendingEdit).toBe(false);
      expect(gates.canSaveRejectedEdit).toBe(true);
    });

    it('dept colleague can save edits on teammate\'s pending/rejected events', () => {
      for (const status of ['pending', 'rejected']) {
        const event = {
          status,
          eventType: 'singleInstance',
          roomReservationData: { requestedBy: { email: 'teammate@example.com' } },
          creatorDepartment: 'membership',
        };
        const deptRequester = { ...PERMISSION_FIXTURES.requester, department: 'membership' };
        const gates = deriveGates(event, deptRequester, accounts);
        const gateKey = status === 'pending' ? 'canSavePendingEdit' : 'canSaveRejectedEdit';
        expect(gates[gateKey], `dept colleague on ${status}`).toBe(true);
      }
    });

    it('admin and approver do NOT get the owner-edit handler (they use direct save)', () => {
      for (const role of ['approver', 'admin']) {
        for (const status of ['pending', 'rejected']) {
          const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
          const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts);
          expect(gates.canSavePendingEdit, `${role}/${status}`).toBe(false);
          expect(gates.canSaveRejectedEdit, `${role}/${status}`).toBe(false);
        }
      }
    });

    it('neither gate fires on draft/published/deleted', () => {
      for (const status of ['draft', 'published', 'deleted']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        expect(gates.canSavePendingEdit, status).toBe(false);
        expect(gates.canSaveRejectedEdit, status).toBe(false);
      }
    });
  });

  describe('isViewingEditRequest forces read-only (even for editors)', () => {
    it('viewing an edit request preview disables canSave for every role', () => {
      for (const role of ROLES) {
        const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
        const gates = deriveGates(event, PERMISSION_FIXTURES[role], accounts, { isViewingEditRequest: true });
        expect(gates.canSave, `${role}`).toBe(false);
        expect(gates.readOnly, `${role}`).toBe(true);
        expect(gates.canEditRecurrence, `${role}`).toBe(false);
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

  describe('edit-request mode (modal context)', () => {
    it('requester on own published single-instance can canSave + canEditRecurrence in edit-request mode', () => {
      // Core use case: requester wants to propose adding recurrence to their
      // own previously-published single-instance event via edit-request flow.
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      const direct = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(direct.canSave, 'direct edit blocked (published)').toBe(false);
      expect(direct.canEditRecurrence, 'direct recurrence edit blocked').toBe(false);
      expect(direct.readOnly, 'direct readOnly').toBe(true);

      const proposing = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(proposing.canSave, 'edit-request unlocks save').toBe(true);
      expect(proposing.canEditRecurrence, 'edit-request unlocks recurrence proposal').toBe(true);
      expect(proposing.readOnly, 'edit-request makes form editable').toBe(false);
    });

    it('requester on own published seriesMaster can propose recurrence changes in edit-request mode', () => {
      const event = makeEvent({ status: 'published', eventType: 'seriesMaster', isOwner: true });
      const proposing = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(proposing.canSave).toBe(true);
      expect(proposing.canEditRecurrence).toBe(true);
      expect(proposing.readOnly).toBe(false);
    });

    it('non-owner CANNOT use edit-request mode to edit someone else\'s event', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: false });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(gates.canSave).toBe(false);
      expect(gates.canEditRecurrence).toBe(false);
      expect(gates.readOnly).toBe(true);
    });

    it('viewer CANNOT use edit-request mode (no canSubmitReservation)', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.viewer, accounts, { isEditRequestMode: true });
      expect(gates.canSave).toBe(false);
      expect(gates.canEditRecurrence).toBe(false);
    });

    it('edit-request mode is only meaningful on published events', () => {
      // On non-published statuses, the direct-edit path already works for
      // owners; edit-request should not give extra powers or change behavior.
      for (const status of ['draft', 'pending', 'rejected']) {
        const event = makeEvent({ status, eventType: 'singleInstance', isOwner: true });
        const direct = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
        const proposing = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
        expect(proposing.canSave, `${status}: same as direct`).toBe(direct.canSave);
      }
    });

    it('edit-request mode cannot resurrect a deleted event', () => {
      const event = makeEvent({ status: 'deleted', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(gates.canSave).toBe(false);
    });
  });

  describe('department-match editing (requester peers collaborate on pending/rejected)', () => {
    const SAME_DEPT = 'membership';
    const DIFF_DEPT = 'communications';
    const makeEventWithDept = ({ status, eventType, isOwner, creatorDepartment }) => ({
      ...makeEvent({ status, eventType, isOwner }),
      creatorDepartment,
    });

    it('requester with matching department CAN edit a teammate\'s pending event', () => {
      const event = makeEventWithDept({
        status: 'pending',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: SAME_DEPT };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(true);
      expect(gates.readOnly).toBe(false);
    });

    it('requester with matching department CAN edit a teammate\'s rejected event', () => {
      const event = makeEventWithDept({
        status: 'rejected',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: SAME_DEPT };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(true);
    });

    it('requester with mismatched department CANNOT edit a colleague\'s pending event', () => {
      const event = makeEventWithDept({
        status: 'pending',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: DIFF_DEPT,
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: SAME_DEPT };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(false);
      expect(gates.readOnly).toBe(true);
    });

    it('requester with NO department cannot inherit dept-match edit rights', () => {
      const event = makeEventWithDept({
        status: 'pending',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      // No department field set on the user
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canSave).toBe(false);
    });

    it('department-match does NOT apply to PUBLISHED events (request-edit flow required)', () => {
      const event = makeEventWithDept({
        status: 'published',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: SAME_DEPT };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(false);
    });

    it('department-match does NOT apply to DRAFT events (owner-only visible)', () => {
      const event = makeEventWithDept({
        status: 'draft',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: SAME_DEPT };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(false);
    });

    it('department comparison is case-insensitive and trims whitespace', () => {
      const event = makeEventWithDept({
        status: 'pending',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: ' Membership ',
      });
      const deptRequester = { ...PERMISSION_FIXTURES.requester, department: 'MEMBERSHIP' };
      const gates = deriveGates(event, deptRequester, accounts);
      expect(gates.canSave).toBe(true);
    });

    it('viewer with matching department still CANNOT edit (no canSubmitReservation)', () => {
      const event = makeEventWithDept({
        status: 'pending',
        eventType: 'singleInstance',
        isOwner: false,
        creatorDepartment: SAME_DEPT,
      });
      const deptViewer = { ...PERMISSION_FIXTURES.viewer, department: SAME_DEPT };
      const gates = deriveGates(event, deptViewer, accounts);
      expect(gates.canSave).toBe(false);
    });
  });
});

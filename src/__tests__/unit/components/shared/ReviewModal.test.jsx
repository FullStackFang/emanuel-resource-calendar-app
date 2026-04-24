// src/__tests__/unit/components/shared/ReviewModal.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock LoadingSpinner for test isolation
vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner">Loading...</div>
}));

// Mock DraftSaveDialog
vi.mock('../../../../components/shared/DraftSaveDialog', () => ({
  default: () => null
}));

// Mock usePermissions hook
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: false,
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: false,
    canEditEvents: false,
    canDeleteEvents: false,
    canApproveReservations: false,
    canEditField: () => false,
    department: null,
    departmentEditableFields: [],
    canEditDepartmentFields: false,
    permissionsLoading: false,
    isSimulating: false,
    simulatedRoleName: null,
    isActualAdmin: false,
    actualRole: 'viewer'
  }),
  default: () => ({
    isAdmin: false,
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: false,
    canEditEvents: false,
    canDeleteEvents: false,
    canApproveReservations: false,
    canEditField: () => false,
    department: null,
    departmentEditableFields: [],
    canEditDepartmentFields: false,
    permissionsLoading: false,
    isSimulating: false,
    simulatedRoleName: null,
    isActualAdmin: false,
    actualRole: 'viewer'
  })
}));

import ReviewModal from '../../../../components/shared/ReviewModal';

describe('ReviewModal', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Test Modal',
    onClose: vi.fn(),
  };

  describe('Recurrence tab visibility', () => {
    it('should disable the Recurrence tab for exception documents with no recurrence', () => {
      // canEditRecurrence=true surfaces the tab; exception eventType flags it disabled.
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{ eventType: 'exception', _id: 'exc-1' }}
          canEditRecurrence={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).toHaveClass('disabled');
    });

    it('should disable the Recurrence tab for addition documents with no recurrence', () => {
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{ eventType: 'addition', _id: 'add-1' }}
          canEditRecurrence={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).toHaveClass('disabled');
    });

    it('should show enabled Recurrence tab for series masters', () => {
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{
            eventType: 'seriesMaster',
            _id: 'master-1',
            recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' } }
          }}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).not.toHaveClass('disabled');
    });

    it('should show enabled Recurrence tab for single instances (can create recurrence)', () => {
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{ eventType: 'singleInstance', _id: 'single-1' }}
          canEditRecurrence={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).not.toHaveClass('disabled');
    });

    it('should HIDE the Recurrence tab entirely for non-recurring event when canEditRecurrence is false (prevents faux-editable UI)', () => {
      // Regression test for the pre-fix bug where canEditRecurrence defaulted to true,
      // surfacing the tab to viewers/requesters who couldn't actually save changes.
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{ eventType: 'singleInstance', _id: 'single-2' }}
          canEditRecurrence={false}
        >
          <div>Content</div>
        </ReviewModal>
      );
      expect(screen.queryByText('Recurrence')).toBeNull();
    });

    it('shows enabled Recurrence tab in creation mode when canEditRecurrence=true', () => {
      // Regression: creation modals (NewReservationModal, Calendar event creation,
      // App AI-chat) mount ReviewModal directly and must pass canEditRecurrence={true}.
      // Without it, the default (false) hides the tab from requesters creating events.
      render(
        <ReviewModal
          {...defaultProps}
          mode="create"
          canEditRecurrence={true}
          reservation={null}
        >
          <div>Content</div>
        </ReviewModal>
      );
      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).not.toHaveClass('disabled');
    });

    it('should not disable Recurrence tab for exceptions that have recurrence data', () => {
      render(
        <ReviewModal
          {...defaultProps}
          reservation={{
            eventType: 'exception',
            _id: 'exc-2',
            recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' } }
          }}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const tab = screen.getByText('Recurrence');
      expect(tab).toBeInTheDocument();
      expect(tab.closest('.event-type-tab')).not.toHaveClass('disabled');
    });
  });

  describe('seriesMasterBanner (shown on recurring series children)', () => {
    // Contract: when the opened item is an exception/addition/occurrence the
    // gate layer sets onApprove/onReject/onApproveEditRequest/etc. to null.
    // ReviewModal then surfaces the info strip (always) and the Open Series
    // Master button (when onOpenMaster is wired).

    it('renders the info strip when seriesMasterBanner.visible is true', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isPending
          itemStatus="pending"
          // onApprove/onReject intentionally omitted — mirrors the gate layer
          // nulling them out for series children.
          seriesMasterBanner={{ visible: true, onOpenMaster: vi.fn() }}
        >
          <div>Content</div>
        </ReviewModal>
      );

      expect(screen.getByText(/recurring series.*actions are on the master/i)).toBeInTheDocument();
    });

    it('renders the "Open Series Master" button when onOpenMaster is provided, and clicks it', async () => {
      const onOpenMaster = vi.fn();
      render(
        <ReviewModal
          {...defaultProps}
          isPending
          itemStatus="pending"
          seriesMasterBanner={{ visible: true, onOpenMaster }}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const btn = screen.getByRole('button', { name: /open series master/i });
      btn.click();
      expect(onOpenMaster).toHaveBeenCalledTimes(1);
    });

    it('hides the "Open Series Master" button when onOpenMaster is null (master unreachable) but keeps the info strip', () => {
      // Real-world: viewer has the child in memory but the master is outside
      // the currently-loaded window, so allEvents lookup would fail.
      render(
        <ReviewModal
          {...defaultProps}
          isPending
          itemStatus="pending"
          seriesMasterBanner={{ visible: true, onOpenMaster: null }}
        >
          <div>Content</div>
        </ReviewModal>
      );

      expect(screen.getByText(/recurring series.*actions are on the master/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open series master/i })).toBeNull();
    });

    it('renders NEITHER strip NOR button when seriesMasterBanner is null (regression guard — masters/singles unaffected)', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isPending
          itemStatus="pending"
          onApprove={vi.fn()}
          seriesMasterBanner={null}
        >
          <div>Content</div>
        </ReviewModal>
      );

      expect(screen.queryByText(/recurring series.*actions are on the master/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /open series master/i })).toBeNull();
      // Sanity: Publish still renders because onApprove is present and we are
      // not a requester-only viewer.
      expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument();
    });
  });

  describe('Submit Request button (draft mode)', () => {
    it('should be disabled when isFormValid is false', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isDraft={true}
          onSubmitDraft={vi.fn()}
          isFormValid={false}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const submitButton = screen.getByRole('button', { name: /submit request/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be enabled when isFormValid is true', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isDraft={true}
          onSubmitDraft={vi.fn()}
          isFormValid={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const submitButton = screen.getByRole('button', { name: /submit request/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('should be disabled when isSaving is true', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isDraft={true}
          onSubmitDraft={vi.fn()}
          isFormValid={true}
          isSaving={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const submitButton = screen.getByRole('button', { name: /submitting/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be disabled when savingDraft is true', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isDraft={true}
          onSubmitDraft={vi.fn()}
          isFormValid={true}
          savingDraft={true}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const submitButton = screen.getByRole('button', { name: /submit request/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be disabled when form is invalid', () => {
      render(
        <ReviewModal
          {...defaultProps}
          isDraft={true}
          onSubmitDraft={vi.fn()}
          isFormValid={false}
        >
          <div>Content</div>
        </ReviewModal>
      );

      const submitButton = screen.getByRole('button', { name: /submit request/i });
      expect(submitButton).toBeDisabled();
    });
  });
});

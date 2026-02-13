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

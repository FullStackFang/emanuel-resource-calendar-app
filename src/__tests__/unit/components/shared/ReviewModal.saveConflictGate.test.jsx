// ReviewModal — hard-conflict gating of Save vs Approve.
//
// Regression for the field report where approvers could remove a room from a
// pending series occurrence in the UI but could not save it, while admins
// could. Root cause: `hardConflictBlocks = hasSchedulingConflicts && !isAdmin`
// disabled the Save button whenever the SchedulingAssistant saw ANY hard
// conflict on the viewed day — including pre-existing collisions unrelated to
// the change being made (and even changes that REDUCE the conflict). The
// server is the authority on save conflicts (409 SchedulingConflict on the
// general path; no check at all on the occurrence path), so the client must
// not pre-empt it. Approve/Publish is where publishing into a conflict is
// decided, and that gate is deliberately kept (see FPC-3).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner">Loading...</div>,
}));
vi.mock('../../../../components/shared/DraftSaveDialog', () => ({
  default: () => null,
}));

const mockPermissions = { isAdmin: false, canApproveReservations: true };
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

import ReviewModal from '../../../../components/shared/ReviewModal';

// A pending item under review by an approver, with a change made and a hard
// conflict reported by the SchedulingAssistant.
const baseProps = {
  isOpen: true,
  title: 'Review',
  onClose: vi.fn(),
  mode: 'review',
  isPending: true,
  itemStatus: 'pending',
  hasChanges: true,
  isFormValid: true,
  hasSchedulingConflicts: true,
  onSave: vi.fn(),
  onApprove: vi.fn(),
  onCancelApprove: vi.fn(),
};

describe('ReviewModal Save button under a hard scheduling conflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isAdmin = false;
    mockPermissions.canApproveReservations = true;
  });

  it('SCG-1: a non-admin approver can still Save (the server decides conflicts)', () => {
    render(
      <ReviewModal {...baseProps}>
        <div>Content</div>
      </ReviewModal>
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    expect(save).not.toHaveAttribute('data-tooltip', 'Resolve the scheduling conflict before continuing');
  });

  it('SCG-2: a non-admin approver is still blocked from Approve/Publish', () => {
    render(
      <ReviewModal {...baseProps}>
        <div>Content</div>
      </ReviewModal>
    );

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('SCG-3: an admin can Save (unchanged behavior)', () => {
    mockPermissions.isAdmin = true;
    render(
      <ReviewModal {...baseProps}>
        <div>Content</div>
      </ReviewModal>
    );

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('SCG-4: the other Save disablers still apply for a non-admin (no changes)', () => {
    render(
      <ReviewModal {...baseProps} hasChanges={false}>
        <div>Content</div>
      </ReviewModal>
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('data-tooltip', 'Make a change first to enable this action');
  });
});

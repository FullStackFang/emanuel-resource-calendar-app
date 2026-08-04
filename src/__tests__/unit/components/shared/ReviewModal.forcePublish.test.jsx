// ReviewModal — 'Publish Anyway?' force-confirm rendering. The hook arms
// isApproveForceConfirming only for admins; the modal adds a defense-in-depth
// isAdmin gate so a stray armed flag can never show the override to a
// non-admin (mirrors the hardConflictBlocks computation at ~line 212).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner">Loading...</div>,
}));
vi.mock('../../../../components/shared/DraftSaveDialog', () => ({
  default: () => null,
}));

const mockPermissions = { isAdmin: true, canApproveReservations: true };
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

import ReviewModal from '../../../../components/shared/ReviewModal';

const baseProps = {
  isOpen: true,
  title: 'Review',
  onClose: vi.fn(),
  mode: 'review',
  isPending: true,
  onApprove: vi.fn(),
  onCancelApprove: vi.fn(),
};

describe('ReviewModal force-publish confirm state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isAdmin = true;
    mockPermissions.canApproveReservations = true;
  });

  it('FPC-1: admin sees "Publish Anyway?" with the warning confirm styling when armed', () => {
    render(
      <ReviewModal {...baseProps} isApproveForceConfirming hasSchedulingConflicts>
        <div>Content</div>
      </ReviewModal>
    );

    const btn = screen.getByRole('button', { name: 'Publish Anyway?' });
    expect(btn).toHaveClass('confirming');
    expect(btn).toHaveClass('force-confirming');
    expect(btn).not.toBeDisabled();
  });

  it('FPC-2: without the armed flag the button reads Publish', () => {
    render(
      <ReviewModal {...baseProps}>
        <div>Content</div>
      </ReviewModal>
    );

    const btn = screen.getByRole('button', { name: 'Publish' });
    expect(btn).not.toHaveClass('force-confirming');
  });

  it('FPC-3: a non-admin never sees the force state even if the flag leaks through', () => {
    mockPermissions.isAdmin = false;
    render(
      <ReviewModal {...baseProps} isApproveForceConfirming hasSchedulingConflicts>
        <div>Content</div>
      </ReviewModal>
    );

    expect(screen.queryByRole('button', { name: 'Publish Anyway?' })).toBeNull();
    // Non-admin with a hard conflict stays blocked (hardConflictBlocks)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('FPC-4: the cancel affordance renders alongside the armed button', () => {
    render(
      <ReviewModal {...baseProps} isApproveForceConfirming>
        <div>Content</div>
      </ReviewModal>
    );

    // The modal may render via a portal — query the whole document
    const armedBtn = screen.getByRole('button', { name: 'Publish Anyway?' });
    const cancelX = armedBtn.parentElement.querySelector('.publish-cancel-x');
    expect(cancelX).not.toBeNull();
  });
});

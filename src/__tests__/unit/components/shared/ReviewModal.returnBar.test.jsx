// ReviewModal — conflict-resolution return bar. Renders only when the hook
// recorded a navigationOrigin (a conflict-driven navigation happened), names
// the event being returned to, states what is being resolved and how many
// conflicts remain, and hands activation to the guard-aware onReturnToOrigin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
};

const ORIGIN = {
  item: { _id: 'series-1' },
  title: 'Torah Class',
  occurrenceDate: '2026-09-09',
  outstandingConflictCount: 3,
};

describe('ReviewModal return bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RB-1: no origin, no bar', () => {
    render(
      <ReviewModal {...baseProps} onReturnToOrigin={vi.fn()}>
        <div>Content</div>
      </ReviewModal>
    );

    expect(screen.queryByTestId('review-return-bar')).toBeNull();
  });

  it('RB-2: names the originating event, the occurrence, and the outstanding count', () => {
    render(
      <ReviewModal {...baseProps} navigationOrigin={ORIGIN} onReturnToOrigin={vi.fn()}>
        <div>Content</div>
      </ReviewModal>
    );

    const bar = screen.getByTestId('review-return-bar');
    expect(bar).toHaveTextContent('Torah Class');
    expect(bar).toHaveTextContent('Sep 9');
    expect(bar).toHaveTextContent('3 conflicts remaining');
  });

  it('RB-3: activating the bar calls the return handler', () => {
    const onReturnToOrigin = vi.fn();
    render(
      <ReviewModal {...baseProps} navigationOrigin={ORIGIN} onReturnToOrigin={onReturnToOrigin}>
        <div>Content</div>
      </ReviewModal>
    );

    fireEvent.click(screen.getByTestId('review-return-bar'));
    expect(onReturnToOrigin).toHaveBeenCalledTimes(1);
  });

  it('RB-4: renders without context fields and uses the singular for one conflict', () => {
    const { rerender } = render(
      <ReviewModal
        {...baseProps}
        navigationOrigin={{ item: { _id: 'x' }, title: 'Bare Origin', occurrenceDate: null, outstandingConflictCount: null }}
        onReturnToOrigin={vi.fn()}
      >
        <div>Content</div>
      </ReviewModal>
    );
    expect(screen.getByTestId('review-return-bar')).toHaveTextContent('Bare Origin');

    rerender(
      <ReviewModal
        {...baseProps}
        navigationOrigin={{ ...ORIGIN, outstandingConflictCount: 1 }}
        onReturnToOrigin={vi.fn()}
      >
        <div>Content</div>
      </ReviewModal>
    );
    expect(screen.getByTestId('review-return-bar')).toHaveTextContent('1 conflict remaining');
  });
});

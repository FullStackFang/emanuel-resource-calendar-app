// src/__tests__/unit/components/ConflictDialog.hardConflict.test.jsx
//
// Part 4: staff "Save Anyway" override of a hard scheduling conflict. The new
// `hard_conflict` ConflictDialog variant must show a clear heading, the conflict
// message, and a "Save Anyway" button wired to onConfirm (the force resend) — and
// must NOT offer that button when no override is available (onConfirm absent).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictDialog from '../../../components/shared/ConflictDialog';

const baseProps = {
  isOpen: true,
  conflictType: 'hard_conflict',
  eventTitle: 'Kingdon Wedding',
  details: { message: 'This conflicts: 5th Avenue Sanctuary is booked Jun 18 (Hold). Save anyway?' },
};

describe('ConflictDialog — hard_conflict (Save Anyway) variant', () => {
  it('renders the scheduling-conflict heading and the conflict message', () => {
    render(<ConflictDialog {...baseProps} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText('Scheduling Conflict')).toBeTruthy();
    expect(screen.queryByText(/5th Avenue Sanctuary is booked Jun 18/)).toBeTruthy();
  });

  it('shows a "Save Anyway" button that calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConflictDialog {...baseProps} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Save Anyway'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a Cancel button that calls onClose', () => {
    const onClose = vi.fn();
    render(<ConflictDialog {...baseProps} onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT render "Save Anyway" when no override is available (onConfirm absent)', () => {
    render(<ConflictDialog {...baseProps} onClose={vi.fn()} />);
    expect(screen.queryByText('Save Anyway')).toBeNull();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConflictDialog {...baseProps} isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});

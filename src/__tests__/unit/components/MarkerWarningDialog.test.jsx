// MarkerWarningDialog — blocking submit-time holiday/closure confirmation.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useScrollLock', () => ({ default: () => {} }));

import MarkerWarningDialog from '../../../components/shared/MarkerWarningDialog';

const markers = [
  { _id: 'w1', type: 'officeClosed', name: 'Office Closed', startDate: '2026-12-24', endDate: '2026-12-26', warnOnReservation: true },
];

describe('MarkerWarningDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MarkerWarningDialog isOpen={false} markers={markers} date="2026-12-25" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the flagged marker and the formatted date', () => {
    render(
      <MarkerWarningDialog isOpen markers={markers} date="2026-12-25" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Office Closed: Office Closed/);
    expect(dialog).toHaveTextContent(/Dec 25, 2026/);
  });

  it('fires onConfirm for Submit Anyway and onCancel for Cancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <MarkerWarningDialog isOpen markers={markers} date="2026-12-25" onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('button', { name: /submit anyway/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while submitting', () => {
    render(
      <MarkerWarningDialog isOpen markers={markers} date="2026-12-25" onConfirm={vi.fn()} onCancel={vi.fn()} submitting />
    );
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
  });
});

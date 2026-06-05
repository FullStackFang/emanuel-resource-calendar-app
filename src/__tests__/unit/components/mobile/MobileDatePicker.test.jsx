// src/__tests__/unit/components/mobile/MobileDatePicker.test.jsx
//
// Locks the mobile month-grid date picker:
//  - opens as a dialog showing the month of the initial date
//  - prev/next month navigation moves the displayed month (without selecting)
//  - tapping a day fires onSelect with that calendar date and closes
//  - "Jump to today" selects today and closes
//  - event dots render for dates present in eventDates
//
// useScrollLock is mocked (its body-lock side effect is covered elsewhere).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../hooks/useScrollLock', () => ({ default: vi.fn() }));

import MobileDatePicker from '../../../../components/mobile/MobileDatePicker';

describe('MobileDatePicker', () => {
  let onSelect;
  let onClose;

  beforeEach(() => {
    onSelect = vi.fn();
    onClose = vi.fn();
  });

  const renderPicker = (extra = {}) =>
    render(
      <MobileDatePicker
        isOpen
        initialDate={new Date(2026, 5, 15)} // June 15, 2026
        eventDates={new Set(['2026-06-20'])}
        onSelect={onSelect}
        onClose={onClose}
        {...extra}
      />
    );

  it('renders nothing when closed', () => {
    const { container } = render(
      <MobileDatePicker
        isOpen={false}
        initialDate={new Date(2026, 5, 15)}
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.mobile-datepicker-sheet')).toBeNull();
  });

  it('opens as a dialog showing the initial month', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog', { name: /choose date/i });
    expect(within(dialog).getByText('June 2026')).toBeTruthy();
  });

  it('navigates to the next and previous month without selecting', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText('July 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByText('May 2026')).toBeTruthy();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('selects a tapped day and closes', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /June 22, 2026/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0][0];
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(5);
    expect(picked.getDate()).toBe(22);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selects across a month boundary after navigating', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    fireEvent.click(screen.getByRole('button', { name: /July 4, 2026/i }));

    const picked = onSelect.mock.calls[0][0];
    expect(picked.getMonth()).toBe(6);
    expect(picked.getDate()).toBe(4);
  });

  it('renders an event dot for dates present in eventDates', () => {
    renderPicker();
    const dayWithEvent = screen.getByRole('button', { name: /June 20, 2026/i });
    expect(dayWithEvent.querySelector('.mobile-datepicker-dot')).toBeTruthy();

    const dayWithout = screen.getByRole('button', { name: /June 21, 2026/i });
    expect(dayWithout.querySelector('.mobile-datepicker-dot')).toBeNull();
  });

  it('jumps to today and closes', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /jump to today/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0][0];
    const today = new Date();
    expect(picked.getFullYear()).toBe(today.getFullYear());
    expect(picked.getMonth()).toBe(today.getMonth());
    expect(picked.getDate()).toBe(today.getDate());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const { container } = renderPicker();
    fireEvent.click(container.querySelector('.mobile-datepicker-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('MobileDatePicker — quick month/year jump', () => {
  let onSelect;
  let onClose;

  beforeEach(() => {
    onSelect = vi.fn();
    onClose = vi.fn();
  });

  const renderPicker = (extra = {}) =>
    render(
      <MobileDatePicker
        isOpen
        initialDate={new Date(2026, 5, 15)} // June 15, 2026
        eventDates={new Set()}
        onSelect={onSelect}
        onClose={onClose}
        {...extra}
      />
    );

  it('opens the 12-month grid when the header title is tapped', () => {
    renderPicker();
    // Day grid is showing first.
    expect(screen.getByRole('button', { name: /June 15, 2026/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /choose month/i }));

    // All twelve months for the current year are now reachable in one view.
    expect(screen.getByRole('button', { name: 'January 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'December 2026' })).toBeTruthy();
    // The day grid is gone while the month grid is up.
    expect(screen.queryByRole('button', { name: /June 15, 2026/i })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('steps the year in the month grid without selecting', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose month/i }));

    fireEvent.click(screen.getByRole('button', { name: /next year/i }));
    expect(screen.getByRole('button', { name: 'December 2027' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /previous year/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous year/i }));
    expect(screen.getByRole('button', { name: 'December 2025' })).toBeTruthy();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('jumps to a distant month in a few taps, then selects a day there', () => {
    renderPicker();
    // June 2026 -> December 2027 in three taps: title, next-year, December.
    fireEvent.click(screen.getByRole('button', { name: /choose month/i }));
    fireEvent.click(screen.getByRole('button', { name: /next year/i }));
    fireEvent.click(screen.getByRole('button', { name: 'December 2027' }));

    // Back in the day grid for the chosen month — no selection emitted yet.
    expect(screen.getByText('December 2027')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /December 25, 2027/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0][0];
    expect(picked.getFullYear()).toBe(2027);
    expect(picked.getMonth()).toBe(11);
    expect(picked.getDate()).toBe(25);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('re-opens on the day grid even after the month grid was used', () => {
    const { rerender } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose month/i }));
    expect(screen.getByRole('button', { name: 'January 2026' })).toBeTruthy();

    // Close, then re-open on a new date — should land on the day grid, not months.
    rerender(
      <MobileDatePicker
        isOpen={false}
        initialDate={new Date(2026, 5, 15)}
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    rerender(
      <MobileDatePicker
        isOpen
        initialDate={new Date(2026, 8, 10)} // September 10, 2026
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    expect(screen.getByRole('button', { name: /September 10, 2026/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'January 2026' })).toBeNull();
  });
});

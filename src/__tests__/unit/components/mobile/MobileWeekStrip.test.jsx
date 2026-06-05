// src/__tests__/unit/components/mobile/MobileWeekStrip.test.jsx
//
// Locks two mobile week-strip behaviors:
//  1. The month label is a button that opens the date picker, and picking a
//     date there calls onDateSelect.
//  2. The "Today" pill lives in the centered header group (next to the label),
//     NOT absolutely positioned over the next-week chevron. This is the
//     structural guard against the tap-target collision that previously made
//     it impossible to keep paging forward.
//
// useScrollLock (used by the embedded picker) is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../hooks/useScrollLock', () => ({ default: vi.fn() }));

import MobileWeekStrip from '../../../../components/mobile/MobileWeekStrip';

describe('MobileWeekStrip', () => {
  let onDateSelect;

  beforeEach(() => {
    onDateSelect = vi.fn();
  });

  it('renders the month label as a button that opens the date picker', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)} // June 3, 2026
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    const label = screen.getByRole('button', { name: /June 2026/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(label);
    expect(screen.getByRole('dialog', { name: /choose date/i })).toBeTruthy();
  });

  it('selecting a date in the picker calls onDateSelect', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /June 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: /June 18, 2026/i }));

    expect(onDateSelect).toHaveBeenCalledTimes(1);
    const picked = onDateSelect.mock.calls[0][0];
    expect(picked.getMonth()).toBe(5);
    expect(picked.getDate()).toBe(18);
    // picker closes after a selection
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('omits the Today pill while the current week is in view', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date()}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('places the Today pill in the centered group, not over the next chevron', () => {
    // A date far from "now" guarantees the Today affordance is shown.
    render(
      <MobileWeekStrip
        selectedDate={new Date(2030, 0, 15)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    const center = todayBtn.closest('.mobile-week-header-center');
    expect(center).toBeTruthy();

    // The next-week chevron must NOT share the centered group — that overlap was
    // the original bug. It stays a separate header child pinned to the edge.
    const nextBtn = screen.getByRole('button', { name: /next week/i });
    expect(center.contains(nextBtn)).toBe(false);

    // The tappable label lives alongside Today inside the centered group.
    expect(within(center).getByRole('button', { name: /January 2030/i })).toBeTruthy();
  });

  it('advances a week when the next chevron is tapped', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
    const next = onDateSelect.mock.calls[0][0];
    expect(next.getDate()).toBe(10); // June 3 + 7
  });
});

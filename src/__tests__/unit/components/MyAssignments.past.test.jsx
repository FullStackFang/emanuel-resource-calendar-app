// MyAssignments.past.test.jsx
//
// The collapsed Past section. The list is read forward in time, so days that
// have gone by are folded away by default behind one toggle, newest first when
// opened; the featured card is always the soonest UPCOMING day, never a past
// one. "Today" is the device's local date — a day dated today is upcoming
// until midnight, which is what an evening-service usher needs.
//
// Test IDs: MAP-1 to MAP-6

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

let mockQuery;
const useMyAssignments = vi.fn(() => mockQuery);
vi.mock('../../../hooks/useSchedulingSheets', () => ({
  useMyAssignments: (...args) => useMyAssignments(...args),
}));
vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));
vi.mock('../../../components/shared/EmptyStateRefreshButton', () => ({
  default: () => <button type="button">Refresh</button>,
}));

import MyAssignments from '../../../components/MyAssignments';

const assignment = (over = {}) => ({
  dayId: 'd1', sheetId: 's1', sheetName: '2026 High Holy Days',
  date: '2026-09-11', dayTitle: 'Erev Rosh Hashanah',
  rowLabel: 'Ushers', columnName: 'Erev Service',
  callTime: '16:00', begins: '16:30', ends: '19:00',
  location: null, note: null,
  ...over,
});

const resolved = (data) => ({ data, isPending: false, isFetching: false, isError: false, refetch: vi.fn() });

const pastToggle = () => screen.queryByRole('button', { name: /past assignments/i });

beforeEach(() => {
  // Local noon on 2026-09-08. Only Date is faked so React/RTL timers run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0));
  useMyAssignments.mockClear();
  mockQuery = resolved([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MyAssignments — past section', () => {
  it('MAP-1: asks the hook for a bounded window of past days', () => {
    render(<MyAssignments />);

    expect(useMyAssignments).toHaveBeenCalledWith({ pastDays: 90 });
  });

  it('MAP-2: past days are folded away until the toggle is opened; upcoming days are not', () => {
    mockQuery = resolved([
      assignment({ date: '2026-08-30', dayTitle: 'Selichot' }),
      assignment({ date: '2026-09-05', dayTitle: 'Shabbat' }),
      assignment({ date: '2026-09-11' }),
    ]);

    render(<MyAssignments />);

    expect(screen.getByTestId('assignment-day-2026-09-11')).toBeInTheDocument();
    expect(screen.queryByTestId('assignment-day-2026-08-30')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assignment-day-2026-09-05')).not.toBeInTheDocument();

    const toggle = pastToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2 days');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('assignment-day-2026-08-30')).toBeInTheDocument();
    expect(screen.getByTestId('assignment-day-2026-09-05')).toBeInTheDocument();
  });

  it('MAP-3: opened past days are newest first, marked past, and never tagged Next', () => {
    mockQuery = resolved([
      assignment({ date: '2026-08-30', dayTitle: 'Selichot' }),
      assignment({ date: '2026-09-05', dayTitle: 'Shabbat' }),
      assignment({ date: '2026-09-11' }),
    ]);

    render(<MyAssignments />);
    fireEvent.click(pastToggle());

    const past = screen.getByTestId('my-assignments-past');
    const cards = within(past).getAllByTestId(/^assignment-day-/);
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'assignment-day-2026-09-05',
      'assignment-day-2026-08-30',
    ]);
    for (const card of cards) {
      expect(card).toHaveClass('ma-card-past');
      expect(card).not.toHaveClass('ma-card-feature');
      expect(within(card).queryByText('Next')).not.toBeInTheDocument();
    }
  });

  it('MAP-4: the featured card is the soonest UPCOMING day, even when a past day is nearer', () => {
    mockQuery = resolved([
      assignment({ date: '2026-09-07', dayTitle: 'Yesterday' }),
      assignment({ date: '2026-09-08', dayTitle: 'Today' }),
      assignment({ date: '2026-09-20', dayTitle: 'Kol Nidre' }),
    ]);

    render(<MyAssignments />);

    // Today counts as upcoming until midnight.
    expect(screen.getByTestId('assignment-day-2026-09-08')).toHaveClass('ma-card-feature');
    expect(screen.getByTestId('assignment-day-2026-09-20')).not.toHaveClass('ma-card-feature');
    expect(screen.queryByTestId('assignment-day-2026-09-07')).not.toBeInTheDocument();
  });

  it('MAP-5: only past assignments: the upcoming empty state AND the past toggle both render', () => {
    mockQuery = resolved([assignment({ date: '2026-08-30' })]);

    render(<MyAssignments />);

    expect(screen.getByTestId('my-assignments-empty')).toHaveTextContent(/no upcoming assignments/i);
    expect(document.querySelector('.ma-card-feature')).toBeNull();
    expect(pastToggle()).toBeInTheDocument();
  });

  it('MAP-6: no past assignments, no toggle', () => {
    mockQuery = resolved([assignment({ date: '2026-09-11' })]);

    render(<MyAssignments />);

    expect(pastToggle()).toBeNull();
    expect(screen.queryByTestId('my-assignments-past')).not.toBeInTheDocument();
  });
});

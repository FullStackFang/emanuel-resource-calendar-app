// MyAssignments.layout.test.jsx
//
// The day-card layout: the soonest day is featured full-width, later days flow
// in a grid. What matters behaviourally is which day gets the emphasis and
// that a featured day carrying more than one post shows ALL of them — the
// failure mode being a second post on the next morning silently disappearing
// because the featured card only rendered the first.
//
// The loading/empty/error contract is covered by MyAssignments.firstPaint
// (MAFP) and is deliberately not retested here.
//
// Test IDs: MAL-1 to MAL-7

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

let mockQuery;
vi.mock('../../../hooks/useSchedulingSheets', () => ({
  useMyAssignments: () => mockQuery,
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

beforeEach(() => {
  mockQuery = resolved([]);
});

describe('MyAssignments — day-card layout', () => {
  it('MAL-1: the soonest day is the featured card, later days are not', () => {
    mockQuery = resolved([
      assignment({ date: '2026-09-20', dayTitle: 'Kol Nidre', columnName: 'Evening' }),
      assignment({ date: '2026-09-11' }),
    ]);

    render(<MyAssignments />);

    const first = screen.getByTestId('assignment-day-2026-09-11');
    const later = screen.getByTestId('assignment-day-2026-09-20');
    expect(first).toHaveClass('ma-card-feature');
    expect(within(first).getByText('Next')).toBeInTheDocument();
    expect(later).not.toHaveClass('ma-card-feature');
    expect(within(later).queryByText('Next')).not.toBeInTheDocument();
  });

  // The input is not guaranteed sorted; the grouping sorts by date, and the
  // feature must follow that order rather than array position.
  it('MAL-2: ordering comes from the date, not the response order', () => {
    mockQuery = resolved([
      assignment({ date: '2026-12-25', dayTitle: 'Later' }),
      assignment({ date: '2026-09-11', dayTitle: 'Sooner' }),
    ]);

    render(<MyAssignments />);

    expect(screen.getByTestId('assignment-day-2026-09-11')).toHaveClass('ma-card-feature');
    expect(screen.getByTestId('assignment-day-2026-12-25')).not.toHaveClass('ma-card-feature');
  });

  // The failure this guards: a featured day rendering only its first post and
  // dropping the rest of that morning.
  it('MAL-3: a featured day with several posts shows every one of them', () => {
    mockQuery = resolved([
      assignment({ columnName: 'RH Morning', callTime: '09:00' }),
      assignment({ columnName: 'Family Service', callTime: '13:15' }),
      assignment({ columnName: 'Erev Service', callTime: '16:00' }),
    ]);

    render(<MyAssignments />);

    const featured = screen.getByTestId('assignment-day-2026-09-11');
    expect(within(featured).getAllByTestId('assignment-item')).toHaveLength(3);
    expect(featured).toHaveTextContent('RH Morning');
    expect(featured).toHaveTextContent('Family Service');
    expect(featured).toHaveTextContent('Erev Service');
    expect(within(featured).getByText('3 posts')).toBeInTheDocument();
  });

  it('MAL-4: the featured call time is rendered verbatim, never parsed', () => {
    // Sheet call times are free text; splitting on '/' to find a 'primary'
    // would silently hide half of what the events office wrote.
    mockQuery = resolved([assignment({ callTime: 'HD 4:30pm / Reg 4:45pm' })]);

    render(<MyAssignments />);

    expect(screen.getByTestId('assignment-calltime')).toHaveTextContent('Call HD 4:30pm / Reg 4:45pm');
  });

  it('MAL-5: location and note render only when the sheet recorded them', () => {
    mockQuery = resolved([
      assignment({ location: '5th Ave Sanctuary', note: 'North door' }),
      assignment({ date: '2026-09-20', location: null, note: null }),
    ]);

    render(<MyAssignments />);

    const featured = screen.getByTestId('assignment-day-2026-09-11');
    expect(featured).toHaveTextContent('5th Ave Sanctuary');
    expect(featured).toHaveTextContent('North door');

    const later = screen.getByTestId('assignment-day-2026-09-20');
    expect(later.querySelector('.ma-slot-note')).toBeNull();
  });

  // Two workbooks can both schedule the same calendar day; they stay separate
  // cards because the grouping key is (date, sheetId).
  it('MAL-6: the same date in two workbooks stays two cards', () => {
    mockQuery = resolved([
      assignment({ sheetId: 's1', sheetName: 'High Holy Days' }),
      assignment({ sheetId: 's2', sheetName: 'Sukkot' }),
    ]);

    render(<MyAssignments />);

    expect(screen.getAllByTestId('assignment-day-2026-09-11')).toHaveLength(2);
  });

  // A day with no call time must not render an empty emphasis slot.
  it('MAL-7: a featured day without a call time omits the call block', () => {
    mockQuery = resolved([assignment({ callTime: null, begins: '18:00', ends: '21:00' })]);

    render(<MyAssignments />);

    const featured = screen.getByTestId('assignment-day-2026-09-11');
    expect(within(featured).queryByTestId('assignment-calltime')).not.toBeInTheDocument();
    expect(featured).toHaveTextContent('18:00');
  });
});

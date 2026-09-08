// MyAssignments.select.test.jsx
//
// Day cards are tappable but not actionable: a tap highlights ONE day card
// with a border and nothing else happens. It lets a reader mark their place
// without the page pretending it can open or change anything. The unit is
// the DAY — an earlier cut made every row a toggle, which carved a card into
// competing boxes. Single selection, tap again to clear, keyboard-operable
// like any toggle button.
//
// Test IDs: MAS-1 to MAS-6

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
  date: '2099-09-11', dayTitle: 'Erev Rosh Hashanah',
  rowLabel: 'Ushers', columnName: 'Erev Service',
  callTime: '16:00', begins: '16:30', ends: '19:00',
  location: null, note: null,
  ...over,
});

const resolved = (data) => ({ data, isPending: false, isFetching: false, isError: false, refetch: vi.fn() });

const cards = () => screen.getAllByTestId(/^assignment-day-/);
const pressed = (el) => el.getAttribute('aria-pressed');

beforeEach(() => {
  mockQuery = resolved([
    assignment({ columnName: 'Erev Service' }),
    assignment({ columnName: 'Reception', callTime: '20:00' }),
    assignment({ date: '2099-09-20', dayTitle: 'Kol Nidre', columnName: 'Evening' }),
    assignment({ date: '2099-09-27', dayTitle: 'Sukkot', columnName: 'Morning' }),
  ]);
});

describe('MyAssignments — tap a day to highlight it', () => {
  it('MAS-1: every day card (featured and later) is a toggle button, none pressed', () => {
    render(<MyAssignments />);

    const all = cards();
    expect(all).toHaveLength(3);
    for (const el of all) {
      expect(el).toHaveAttribute('role', 'button');
      expect(el).toHaveAttribute('tabindex', '0');
      expect(pressed(el)).toBe('false');
      expect(el).not.toHaveClass('ma-selected');
    }
  });

  it('MAS-2: the rows inside a card are NOT individually pressable', () => {
    render(<MyAssignments />);

    for (const row of screen.getAllByTestId('assignment-item')) {
      expect(row).not.toHaveAttribute('role');
      expect(row).not.toHaveAttribute('aria-pressed');
    }
  });

  it('MAS-3: a tap highlights that day', () => {
    render(<MyAssignments />);

    fireEvent.click(cards()[1]);

    expect(pressed(cards()[1])).toBe('true');
    expect(cards()[1]).toHaveClass('ma-selected');
    expect(pressed(cards()[0])).toBe('false');
  });

  it('MAS-4: selection is single — tapping another day moves it, the featured day included', () => {
    render(<MyAssignments />);

    fireEvent.click(cards()[2]);
    fireEvent.click(cards()[0]);

    expect(pressed(cards()[2])).toBe('false');
    expect(pressed(cards()[0])).toBe('true');
    expect(cards()[0]).toHaveClass('ma-card-feature');
    expect(document.querySelectorAll('.ma-selected')).toHaveLength(1);
  });

  it('MAS-5: tapping the highlighted day clears it', () => {
    render(<MyAssignments />);

    fireEvent.click(cards()[0]);
    fireEvent.click(cards()[0]);

    expect(pressed(cards()[0])).toBe('false');
    expect(document.querySelectorAll('.ma-selected')).toHaveLength(0);
  });

  it('MAS-6: Enter and Space toggle from the keyboard', () => {
    render(<MyAssignments />);

    fireEvent.keyDown(cards()[1], { key: 'Enter' });
    expect(pressed(cards()[1])).toBe('true');

    fireEvent.keyDown(cards()[1], { key: ' ' });
    expect(pressed(cards()[1])).toBe('false');
  });
});

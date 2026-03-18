// src/__tests__/unit/components/RecurrenceTabContent.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock react-datepicker (inline calendar)
vi.mock('react-datepicker', () => ({
  default: ({ onChange, dayClassName }) => (
    <div data-testid="mock-datepicker">Calendar</div>
  ),
}));
vi.mock('react-datepicker/dist/react-datepicker.css', () => ({}));

// Mock RecurrencePatternModal
vi.mock('../../../components/RecurrencePatternModal', () => ({
  default: ({ isOpen, onSave, onClose }) =>
    isOpen ? (
      <div data-testid="recurrence-modal">
        <button onClick={() => onSave({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { startDate: '2026-03-16', type: 'noEnd' } })}>
          Save Pattern
        </button>
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

// Mock CalendarIcons
vi.mock('../../../components/shared/CalendarIcons', () => ({
  RecurringIcon: ({ size }) => <span data-testid="recurring-icon">icon</span>,
}));

// Mock config
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import RecurrenceTabContent from '../../../components/RecurrenceTabContent';

const weeklyPattern = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
  range: { startDate: '2026-03-16', endDate: '2026-04-15', type: 'endDate' },
  additions: ['2026-03-20'],
  exclusions: ['2026-03-23'],
};

const defaultProps = {
  recurrencePattern: null,
  onRecurrencePatternChange: vi.fn(),
  showRecurrenceModal: false,
  onShowRecurrenceModal: vi.fn(),
  reservation: { _id: 'evt1', eventId: 'evt1' },
  formData: { startDate: '2026-03-16', startTime: '10:00', endDate: '2026-03-16', endTime: '11:00', requestedRooms: [] },
  apiToken: 'test-token',
  editScope: null,
  readOnly: false,
};

describe('RecurrenceTabContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ totalOccurrences: 0, conflictingOccurrences: 0, conflicts: [] }),
    });
  });

  // ─── Empty State ─────────────────────────────────────────

  describe('Empty State', () => {
    it('renders empty state when no recurrence pattern exists', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      expect(screen.getByText('No Recurring Schedule')).toBeInTheDocument();
      expect(screen.getByText(/one-time event/i)).toBeInTheDocument();
    });

    it('shows Create Recurrence button when user can edit', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      expect(screen.getByRole('button', { name: /create recurrence/i })).toBeInTheDocument();
    });

    it('hides Create Recurrence button when readOnly', () => {
      render(<RecurrenceTabContent {...defaultProps} readOnly={true} />);
      expect(screen.queryByRole('button', { name: /create recurrence/i })).not.toBeInTheDocument();
    });

    it('opens RecurrencePatternModal when Create Recurrence is clicked', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /create recurrence/i }));
      expect(defaultProps.onShowRecurrenceModal).toHaveBeenCalledWith(true);
    });

    it('renders the modal when showRecurrenceModal is true', () => {
      render(<RecurrenceTabContent {...defaultProps} showRecurrenceModal={true} />);
      expect(screen.getByTestId('recurrence-modal')).toBeInTheDocument();
    });
  });

  // ─── Management View ─────────────────────────────────────

  describe('Management View', () => {
    it('renders two-column layout when recurrence pattern exists', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      expect(container.querySelector('.recurrence-tab-management')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-left')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-right')).toBeInTheDocument();
    });

    it('displays pattern summary text', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      // formatRecurrenceSummary for weekly with Mon, Wed should contain day abbreviations
      expect(screen.getByText(/occurs every/i)).toBeInTheDocument();
    });

    it('shows occurrence count stats', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      // The pattern card stats section shows "N occurrences"
      const statsSection = container.querySelector('.recurrence-tab-pattern-stats');
      expect(statsSection.textContent).toMatch(/\d+ occurrences/);
    });

    it('shows addition and exclusion counts', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByText(/\+1 added/i)).toBeInTheDocument();
      expect(screen.getByText(/1 excluded/i)).toBeInTheDocument();
    });

    it('renders Edit Pattern button', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /edit pattern/i })).toBeInTheDocument();
    });

    it('renders mini-calendar', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByTestId('mock-datepicker')).toBeInTheDocument();
    });

    it('renders Remove Recurrence button', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /remove recurrence/i })).toBeInTheDocument();
    });

    it('hides edit controls when readOnly', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />);
      expect(screen.queryByRole('button', { name: /edit pattern/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /remove recurrence/i })).not.toBeInTheDocument();
    });
  });

  // ─── Occurrence List ─────────────────────────────────────

  describe('Occurrence List', () => {
    it('renders occurrence rows for pattern dates', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const patternRows = container.querySelectorAll('.recurrence-occ-row--pattern');
      expect(patternRows.length).toBeGreaterThan(0);
    });

    it('renders addition rows with green styling', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const addedRows = container.querySelectorAll('.recurrence-occ-row--added');
      expect(addedRows.length).toBe(1);
    });

    it('renders excluded rows with strikethrough', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const excludedRows = container.querySelectorAll('.recurrence-occ-row--excluded');
      expect(excludedRows.length).toBe(1);
    });

    it('shows Remove action on added rows', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      // At least one Remove button (for the addition) — filter out 'Remove Recurrence'
      const additionRemove = removeButtons.filter(b => b.textContent === 'Remove');
      expect(additionRemove.length).toBe(1);
    });

    it('shows Restore action on excluded rows', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    });

    it('calls onRecurrencePatternChange when Remove addition is clicked', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      const removeButtons = screen.getAllByRole('button', { name: /^Remove$/i });
      fireEvent.click(removeButtons[0]);
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalledWith(
        expect.objectContaining({ additions: [] })
      );
    });

    it('calls onRecurrencePatternChange when Restore exclusion is clicked', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      fireEvent.click(screen.getByRole('button', { name: /restore/i }));
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalledWith(
        expect.objectContaining({ exclusions: [] })
      );
    });
  });

  // ─── Filter Bar ──────────────────────────────────────────

  describe('Filter Bar', () => {
    it('renders all filter options', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Added$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Excluded$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /conflicts/i })).toBeInTheDocument();
    });

    it('All filter is active by default', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const allBtn = container.querySelector('.recurrence-tab-filter.active');
      expect(allBtn.textContent).toBe('All');
    });

    it('clicking Added filter shows only addition rows', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      fireEvent.click(screen.getByRole('button', { name: /^Added$/i }));
      const rows = container.querySelectorAll('.recurrence-occ-row');
      expect(rows.length).toBe(1);
      expect(rows[0].classList.contains('recurrence-occ-row--added')).toBe(true);
    });

    it('clicking Excluded filter shows only excluded rows', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      fireEvent.click(screen.getByRole('button', { name: /^Excluded$/i }));
      const rows = container.querySelectorAll('.recurrence-occ-row');
      expect(rows.length).toBe(1);
      expect(rows[0].classList.contains('recurrence-occ-row--excluded')).toBe(true);
    });
  });

  // ─── Remove Recurrence (Two-Click Confirm) ──────────────

  describe('Remove Recurrence', () => {
    it('first click changes to Confirm state', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      const btn = screen.getByRole('button', { name: /remove recurrence/i });
      fireEvent.click(btn);
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    });

    it('second click clears recurrence pattern', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      const btn = screen.getByRole('button', { name: /remove recurrence/i });
      fireEvent.click(btn); // first click — confirm state
      fireEvent.click(screen.getByRole('button', { name: /confirm/i })); // second click — remove
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalledWith(null);
    });
  });
});

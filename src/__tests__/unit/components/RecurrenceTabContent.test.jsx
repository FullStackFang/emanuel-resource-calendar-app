// src/__tests__/unit/components/RecurrenceTabContent.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock react-datepicker (inline calendar)
vi.mock('react-datepicker', () => ({
  default: ({ onChange, dayClassName }) => (
    <div data-testid="mock-datepicker">Calendar</div>
  ),
}));
vi.mock('react-datepicker/dist/react-datepicker.css', () => ({}));

// Mock DatePickerInput
vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange, ...props }) => (
    <input data-testid="date-picker-input" value={value || ''} onChange={onChange} {...props} />
  ),
}));

// Mock CalendarIcons
vi.mock('../../../components/shared/CalendarIcons', () => ({
  RecurringIcon: ({ size }) => <span data-testid="recurring-icon">icon</span>,
}));

// Mock config
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock LocationContext (component calls useRooms() during render)
vi.mock('../../../context/LocationContext', () => ({
  useRooms: () => ({ rooms: [], getLocationName: (id) => id }),
  useLocations: () => ({ locations: [], rooms: [], getLocationName: (id) => id }),
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
      json: () => Promise.resolve([]),
    });
  });

  // ─── Inline Editor (No Pattern) ─────────────────────────

  describe('Inline Editor - No Pattern', () => {
    it('renders two-column layout even when no pattern exists', () => {
      const { container } = render(<RecurrenceTabContent {...defaultProps} />);
      expect(container.querySelector('.recurrence-tab-management')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-left')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-right')).toBeInTheDocument();
    });

    it('renders inline editor fields when no pattern exists', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      // Frequency selector should be present
      expect(screen.getByDisplayValue(/week/i)).toBeInTheDocument();
      // Calendar should be present
      expect(screen.getByTestId('mock-datepicker')).toBeInTheDocument();
    });

    it('shows Create Recurrence button when no pattern and user can edit', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      expect(screen.getByRole('button', { name: /create recurrence/i })).toBeInTheDocument();
    });

    it('hides Create Recurrence button when readOnly', () => {
      render(<RecurrenceTabContent {...defaultProps} readOnly={true} />);
      expect(screen.queryByRole('button', { name: /create recurrence/i })).not.toBeInTheDocument();
    });

    it('calls onRecurrencePatternChange when Create Recurrence is clicked', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /create recurrence/i }));
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalled();
      const call = defaultProps.onRecurrencePatternChange.mock.calls[0][0];
      expect(call).toHaveProperty('pattern');
      expect(call).toHaveProperty('range');
      expect(call.pattern.type).toBe('weekly');
    });

    it('shows empty hint in right column when no pattern exists', () => {
      render(<RecurrenceTabContent {...defaultProps} />);
      expect(screen.getByText(/configure a recurrence pattern/i)).toBeInTheDocument();
    });
  });

  // ─── Inline Editor (With Pattern) ──────────────────────

  describe('Inline Editor - With Pattern', () => {
    it('renders two-column layout when recurrence pattern exists', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      expect(container.querySelector('.recurrence-tab-management')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-left')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-right')).toBeInTheDocument();
    });

    it('populates editor fields from existing pattern', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      // Frequency should show 'weekly'
      expect(screen.getByDisplayValue(/week/i)).toBeInTheDocument();
    });

    it('renders calendar with correct styling classes', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByTestId('mock-datepicker')).toBeInTheDocument();
    });

    it('shows occurrence stats', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const stats = container.querySelector('.recurrence-editor-stats');
      expect(stats).toBeInTheDocument();
      expect(stats.textContent).toMatch(/\d+ occurrences/);
    });

    it('shows addition and exclusion counts', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByText(/\+1 added/i)).toBeInTheDocument();
      expect(screen.getByText(/1 excluded/i)).toBeInTheDocument();
    });

    it('does NOT render the deleted RecurrencePatternModal (guard against accidental re-introduction)', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.queryByTestId('recurrence-modal')).not.toBeInTheDocument();
    });

    it('renders Remove Recurrence button', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /remove recurrence/i })).toBeInTheDocument();
    });

    it('hides edit controls when readOnly', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />);
      expect(screen.queryByRole('button', { name: /remove recurrence/i })).not.toBeInTheDocument();
    });
  });

  // ─── Exceptions-Only List ─────────────────────────────────

  describe('Exceptions-Only List', () => {
    it('shows only exceptions (added/excluded), not plain pattern dates', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      // Should NOT have any pattern-only rows
      const patternRows = container.querySelectorAll('.recurrence-occ-row--pattern');
      expect(patternRows.length).toBe(0);
      // Should have added and excluded rows
      const addedRows = container.querySelectorAll('.recurrence-occ-row--added');
      const excludedRows = container.querySelectorAll('.recurrence-occ-row--excluded');
      expect(addedRows.length).toBe(1);
      expect(excludedRows.length).toBe(1);
    });

    it('displays Exceptions header with count', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByText(/Exceptions \(2\)/)).toBeInTheDocument();
    });

    it('displays total pattern occurrences as subtitle', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByText(/occurrences total/)).toBeInTheDocument();
    });

    it('shows empty state when no exceptions exist', () => {
      const patternNoExceptions = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { startDate: '2026-03-16', endDate: '2026-04-15', type: 'endDate' },
        additions: [],
        exclusions: [],
      };
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={patternNoExceptions} />);
      expect(screen.getByText(/No exceptions/)).toBeInTheDocument();
    });

    it('does not render filter tabs', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      expect(container.querySelector('.recurrence-tab-filters')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^All$/i })).not.toBeInTheDocument();
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
      const { container } = render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      const additionRemove = container.querySelectorAll('.recurrence-occ-action--remove');
      expect(additionRemove.length).toBe(1);
    });

    it('shows Restore action on excluded rows', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    });

    it('calls onRecurrencePatternChange when Remove addition is clicked', () => {
      const { container } = render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      defaultProps.onRecurrencePatternChange.mockClear();
      const removeBtn = container.querySelector('.recurrence-occ-action--remove');
      fireEvent.click(removeBtn);
      const matchingCall = defaultProps.onRecurrencePatternChange.mock.calls.find(
        call => call[0]?.additions && call[0].additions.length === 0
      );
      expect(matchingCall).toBeTruthy();
    });

    it('calls onRecurrencePatternChange when Restore exclusion is clicked', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />);
      fireEvent.click(screen.getByRole('button', { name: /restore/i }));
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalledWith(
        expect.objectContaining({ exclusions: [] })
      );
    });

    it('shows customized indicator on rows with occurrence overrides', () => {
      const reservationWithOverrides = {
        ...defaultProps.reservation,
        occurrenceOverrides: [{ occurrenceDate: '2026-03-16', eventTitle: 'Custom Title' }],
      };
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} reservation={reservationWithOverrides} />
      );
      const customized = container.querySelectorAll('.recurrence-occ-customized');
      expect(customized.length).toBeGreaterThan(0);
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
      fireEvent.click(btn);
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
      expect(defaultProps.onRecurrencePatternChange).toHaveBeenCalledWith(null);
    });
  });

  // ─── Occurrence Detail Editing ──────────────────────────

  describe('Occurrence Detail Editing', () => {
    it('clicking occurrence row opens detail view', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      // Click the first row (added or excluded)
      const rows = container.querySelectorAll('.recurrence-occ-main');
      expect(rows.length).toBeGreaterThan(0);
      fireEvent.click(rows[0]);
      // Should show back button (icon-only, identified by class)
      expect(container.querySelector('.recurrence-back-btn')).toBeInTheDocument();
    });

    it('detail view shows editable fields for non-excluded occurrence', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      // Click the added row (not excluded)
      const addedRow = container.querySelector('.recurrence-occ-row--added .recurrence-occ-main');
      fireEvent.click(addedRow);
      const detailFields = container.querySelector('.recurrence-detail-fields');
      expect(detailFields).toBeInTheDocument();
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Start Time')).toBeInTheDocument();
      expect(screen.getByText('End Time')).toBeInTheDocument();
    });

    it('back to list returns to occurrence list', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const rows = container.querySelectorAll('.recurrence-occ-main');
      fireEvent.click(rows[0]);
      fireEvent.click(container.querySelector('.recurrence-back-btn'));
      expect(container.querySelector('.recurrence-tab-list-header')).toBeInTheDocument();
    });

    it('back to list does not throw any errors (regression: setShowSecondaryTimes orphan)', () => {
      // React swallows errors thrown in event handlers and logs them via console.error.
      // Spy on console.error to catch any uncaught reference errors during the round-trip.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const rows = container.querySelectorAll('.recurrence-occ-main');
      fireEvent.click(rows[0]);
      fireEvent.click(container.querySelector('.recurrence-back-btn'));
      // No React-logged errors (e.g., ReferenceError) should have surfaced
      const errorMessages = errorSpy.mock.calls.map(args => String(args[0])).join('\n');
      expect(errorMessages).not.toMatch(/setShowSecondaryTimes is not defined/);
      expect(errorMessages).not.toMatch(/ReferenceError/);
      errorSpy.mockRestore();
    });

    it('excluded occurrence shows restore action, no editable fields', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} />
      );
      const excludedRow = container.querySelector('.recurrence-occ-row--excluded .recurrence-occ-main');
      fireEvent.click(excludedRow);
      expect(screen.getByText(/excluded from the series/i)).toBeInTheDocument();
      expect(container.querySelector('.recurrence-detail-fields')).not.toBeInTheDocument();
    });
  });

  describe('readOnly / occurrence view (requirement C)', () => {
    it('renders plain-text summary and no editable controls when editScope is thisEvent (AC-C1)', () => {
      const { container, queryByTestId } = render(
        <RecurrenceTabContent
          {...defaultProps}
          recurrencePattern={weeklyPattern}
          editScope="thisEvent"
        />
      );
      // Summary element is present
      const summary = container.querySelector('.recurrence-readonly-summary');
      expect(summary).toBeInTheDocument();
      // Summary text matches compact formatter output
      expect(summary.textContent).toContain('Weekly on Mondays and Wednesdays');
      // Calendar editor is NOT rendered (absence of the mocked DatePicker)
      expect(queryByTestId('mock-datepicker')).not.toBeInTheDocument();
      // Occurrence list pane also absent (full editor replaced)
      expect(container.querySelector('.recurrence-tab-right')).not.toBeInTheDocument();
    });

    it('renders full disabled UI (not compact summary) when readOnly=true and editScope is not thisEvent', () => {
      const { container, queryByTestId } = render(
        <RecurrenceTabContent
          {...defaultProps}
          recurrencePattern={weeklyPattern}
          readOnly={true}
        />
      );
      // Full UI should be rendered (calendar, occurrence list) — NOT the compact summary
      expect(container.querySelector('.recurrence-readonly-summary')).not.toBeInTheDocument();
      expect(queryByTestId('mock-datepicker')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-management')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-left')).toBeInTheDocument();
      expect(container.querySelector('.recurrence-tab-right')).toBeInTheDocument();
    });

    it('disables all form controls when readOnly=true', () => {
      const { container } = render(
        <RecurrenceTabContent
          {...defaultProps}
          recurrencePattern={weeklyPattern}
          readOnly={true}
        />
      );
      // Frequency selector should be disabled
      const frequencySelect = container.querySelector('.recurrence-editor-frequency');
      expect(frequencySelect).toBeDisabled();
      // Interval input should be disabled
      const intervalInput = container.querySelector('.recurrence-editor-interval');
      expect(intervalInput).toBeDisabled();
      // Day-of-week buttons should be disabled
      const dayButtons = container.querySelectorAll('.recurrence-day-circle');
      dayButtons.forEach(btn => expect(btn).toBeDisabled());
    });

    it('hides Create/Remove Recurrence buttons when readOnly=true', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />);
      expect(screen.queryByRole('button', { name: /remove recurrence/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create recurrence/i })).not.toBeInTheDocument();
    });

    it('hides edit pencil icon on occurrence rows when readOnly=true', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />
      );
      expect(container.querySelector('.recurrence-occ-edit-hint')).not.toBeInTheDocument();
    });

    it('hides action buttons (Remove/Restore) on occurrence rows when readOnly=true', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />
      );
      expect(container.querySelector('.recurrence-occ-action--remove')).not.toBeInTheDocument();
      expect(container.querySelector('.recurrence-occ-action--restore')).not.toBeInTheDocument();
    });

    it('shows occurrence list with exceptions visible when readOnly=true', () => {
      const { container } = render(
        <RecurrenceTabContent {...defaultProps} recurrencePattern={weeklyPattern} readOnly={true} />
      );
      // Exception rows should be visible
      expect(container.querySelectorAll('.recurrence-occ-row--added').length).toBe(1);
      expect(container.querySelectorAll('.recurrence-occ-row--excluded').length).toBe(1);
      expect(screen.getByText(/Exceptions \(2\)/)).toBeInTheDocument();
    });

    it('renders full editable editor when editScope is null and readOnly is false (AC-C3 regression)', () => {
      const { container, queryByTestId } = render(
        <RecurrenceTabContent
          {...defaultProps}
          recurrencePattern={weeklyPattern}
          editScope={null}
          readOnly={false}
        />
      );
      expect(container.querySelector('.recurrence-readonly-summary')).not.toBeInTheDocument();
      expect(queryByTestId('mock-datepicker')).toBeInTheDocument();
    });

    it('summary includes additions/exclusions tail when editScope=thisEvent', () => {
      const { container } = render(
        <RecurrenceTabContent
          {...defaultProps}
          recurrencePattern={weeklyPattern}
          editScope="thisEvent"
        />
      );
      const summary = container.querySelector('.recurrence-readonly-summary');
      // weeklyPattern has additions=['2026-03-20'], exclusions=['2026-03-23']
      expect(summary.textContent).toMatch(/\+1 added/);
      expect(summary.textContent).toMatch(/1 excluded/);
    });

    it('shows no-pattern message for readOnly users viewing non-recurring events', () => {
      render(<RecurrenceTabContent {...defaultProps} recurrencePattern={null} readOnly={true} />);
      expect(screen.getByText('This event does not have a recurrence pattern.')).toBeInTheDocument();
      expect(screen.queryByText(/configure a recurrence pattern/i)).not.toBeInTheDocument();
    });
  });

});

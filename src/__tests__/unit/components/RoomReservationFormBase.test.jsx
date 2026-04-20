// src/__tests__/unit/components/RoomReservationFormBase.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock all heavy child components to isolate the form base
vi.mock('../../../components/SchedulingAssistant', () => ({
  default: () => <div data-testid="scheduling-assistant" />,
}));
vi.mock('../../../components/TimePickerInput', () => ({
  default: ({ value, onChange, ...props }) => (
    <input data-testid={`time-picker-${props.name || 'unknown'}`} value={value || ''} onChange={onChange} />
  ),
}));
vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange, ...props }) => (
    <input data-testid="date-picker-input" value={value || ''} onChange={onChange} />
  ),
}));
vi.mock('../../../components/LocationListSelect', () => ({
  default: () => <div data-testid="location-list-select" />,
}));
vi.mock('../../../components/MultiDatePicker', () => ({
  default: () => <div data-testid="multi-date-picker" />,
}));
vi.mock('../../../components/OffsiteLocationModal', () => ({
  default: () => null,
}));
vi.mock('../../../components/CategorySelectorModal', () => ({
  default: () => null,
}));
vi.mock('../../../components/ServicesSelectorModal', () => ({
  default: () => null,
}));
vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));
vi.mock('../../../components/shared/CalendarIcons', () => ({
  RecurringIcon: () => <span data-testid="recurring-icon">icon</span>,
}));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../context/LocationContext', () => ({
  useRooms: () => ({ rooms: [], getLocationName: (id) => id }),
}));
vi.mock('../../../hooks/useCategoriesQuery', () => ({
  useBaseCategoriesQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'admin', canEditEvents: true }),
}));
vi.mock('../../../utils/textUtils', () => ({
  extractTextFromHtml: (html) => html || '',
}));
vi.mock('../../../utils/appTimeUtils', () => ({
  formatTimeString: (t) => t || '',
}));
vi.mock('../../../utils/eventTransformers', () => ({
  getSeriesMasterDisplayDates: () => ({ displayStartDate: '2026-04-01', displayEndDate: '2026-04-30' }),
}));
vi.mock('../../../utils/timeClampUtils', () => ({
  clampEventTimesToReservation: vi.fn(),
  expandReservationToContainOperationalTimes: vi.fn(),
  clampOperationalTimesToReservation: vi.fn(),
  validateTimeOrdering: () => [],
}));
vi.mock('../../../components/RoomReservationForm.css', () => ({}));

import RoomReservationFormBase from '../../../components/RoomReservationFormBase';

describe('RoomReservationFormBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TDZ Regression (validateTimes) ────────────────────────

  it('renders without TDZ crash when editScope is allEvents (series master)', () => {
    // This test reproduces the ReferenceError: Cannot access 'validateTimes' before initialization
    // that occurred when opening a series master event from the calendar.
    expect(() => {
      render(
        <RoomReservationFormBase
          initialData={{
            eventTitle: 'Weekly Staff Meeting',
            startDate: '2026-04-01',
            endDate: '2026-04-01',
            startTime: '10:00',
            endTime: '11:00',
          }}
          editScope="allEvents"
          showAllTabs={false}
          activeTab="details"
        />
      );
    }).not.toThrow();
  });

  it('renders without TDZ crash with default props (single event)', () => {
    expect(() => {
      render(<RoomReservationFormBase />);
    }).not.toThrow();
  });
});

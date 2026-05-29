// src/__tests__/unit/components/RoomReservationFormBase.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
vi.mock('../../../components/ClergySelectorModal', () => ({
  default: () => null,
}));
vi.mock('../../../components/preview/MecEventPreviewPanel', () => ({
  default: () => null,
}));
vi.mock('../../../components/ServicesSelectorModal', () => ({
  default: () => null,
  ServicesContent: () => null,
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
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: vi.fn(),
  }),
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
  usePermissions: () => ({ role: 'admin', canEditEvents: true, isAdmin: true, canEditField: () => true }),
}));
vi.mock('../../../utils/textUtils', () => ({
  extractTextFromHtml: (html) => html || '',
}));
vi.mock('../../../utils/appTimeUtils', () => ({
  formatTimeString: (t) => t || '',
}));
vi.mock('../../../utils/eventTransformers', () => ({
  getSeriesMasterDisplayDates: () => ({ displayStartDate: '2026-04-01', displayEndDate: '2026-04-30' }),
  getEventRecurrence: (data) => data?.recurrence || null,
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

  // ─── Recurrence Change Banner (Details tab) ────────────────
  // When viewing an edit request that modifies the recurrence pattern, the
  // Details tab must surface that change so the approver doesn't have to
  // open the Recurrence tab to discover it.

  const weeklyMonday = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
    range: { type: 'noEnd', startDate: '2026-04-20' },
  };
  const weeklyMonWed = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
    range: { type: 'noEnd', startDate: '2026-04-20' },
  };
  const baseEditRequestProps = {
    initialData: { eventTitle: 'Yoga', startDate: '2026-04-20', endDate: '2026-04-20', startTime: '09:00', endTime: '10:00' },
    showAllTabs: false,
    activeTab: 'details',
    isViewingEditRequest: true,
  };

  it('renders the recurrence change banner when recurrence differs from original', () => {
    render(
      <RoomReservationFormBase
        {...baseEditRequestProps}
        initialData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonWed }}
        originalData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonday }}
      />
    );
    const banner = screen.getByTestId('recurrence-change-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Recurrence');
    expect(banner.textContent).toContain('Monday');
    expect(banner.textContent).toContain('Wednesday');
  });

  it('does not render the banner when recurrence is unchanged', () => {
    render(
      <RoomReservationFormBase
        {...baseEditRequestProps}
        initialData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonday }}
        originalData={{ ...baseEditRequestProps.initialData, recurrence: { ...weeklyMonday } }}
      />
    );
    expect(screen.queryByTestId('recurrence-change-banner')).toBeNull();
  });

  it('does not render the banner outside edit-request modes', () => {
    render(
      <RoomReservationFormBase
        initialData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonWed }}
        originalData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonday }}
        showAllTabs={false}
        activeTab="details"
        // No isEditRequestMode, no isViewingEditRequest → showDiffMode is false
      />
    );
    expect(screen.queryByTestId('recurrence-change-banner')).toBeNull();
  });

  it('renders banner with "(none)" old text when promoting a single event to recurring', () => {
    render(
      <RoomReservationFormBase
        {...baseEditRequestProps}
        initialData={{ ...baseEditRequestProps.initialData, recurrence: weeklyMonday }}
        originalData={{ ...baseEditRequestProps.initialData, recurrence: null }}
      />
    );
    const banner = screen.getByTestId('recurrence-change-banner');
    expect(banner.textContent).toContain('(none)');
    expect(banner.textContent).toContain('Monday');
  });

  // ─── Floor Plan Upload (Additional Info tab) ───────────────
  // The floor plan upload must persist through the shared attachment pipeline
  // (POST /events/:eventId/attachments with isFloorPlan), not just preview.

  describe('floor plan upload', () => {
    const additionalTabProps = {
      showAllTabs: false,
      activeTab: 'additional',
      apiToken: 'test-token',
    };

    beforeEach(() => {
      // jsdom lacks object-URL support — stub it for the <img> preview path.
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
      // Default: no existing attachments (load effect finds no floor plan).
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ attachments: [] }),
      }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uploads the selected file with the isFloorPlan flag once the event is saved', async () => {
      global.fetch = vi.fn(async (url, opts) => {
        if (opts?.method === 'POST') {
          return { ok: true, json: async () => ({ attachment: { id: 'att-1', isFloorPlan: true } }) };
        }
        return { ok: true, json: async () => ({ attachments: [] }) };
      });

      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventId: 'evt-1', eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
        />
      );

      const input = screen.getByTestId('floor-plan-upload');
      expect(input.disabled).toBe(false);

      const file = new File(['plan-bytes'], 'floor-plan.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        const postCall = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
        expect(postCall).toBeTruthy();
        expect(postCall[0]).toBe('http://localhost:3001/api/events/evt-1/attachments');
        const body = postCall[1].body;
        expect(body.get('isFloorPlan')).toBe('true');
        expect(body.get('file')).toBeInstanceOf(File);
      });

      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalled());
    });

    it('rejects a non-image file (PDF) without uploading', async () => {
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ attachments: [] }) }));
      mockShowError.mockClear();
      mockShowSuccess.mockClear();

      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventId: 'evt-1', eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
        />
      );

      const input = screen.getByTestId('floor-plan-upload');
      const pdf = new File(['%PDF-1.7'], 'layout.pdf', { type: 'application/pdf' });
      fireEvent.change(input, { target: { files: [pdf] } });

      await waitFor(() => expect(mockShowError).toHaveBeenCalled());
      // A rejected file type must never reach the upload endpoint.
      const postCall = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(postCall).toBeUndefined();
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('blocks upload and guides the user when the reservation is unsaved', () => {
      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
        />
      );

      const input = screen.getByTestId('floor-plan-upload');
      // Guard is enforced at the UI level: input disabled, save-first hint shown.
      expect(input.disabled).toBe(true);
      expect(screen.getByText(/Save the reservation first to upload a floor plan/i)).toBeTruthy();
      // No upload POST should ever fire without an event id.
      const postCall = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(postCall).toBeUndefined();
    });

    it('loads and previews an existing floor plan on open', async () => {
      global.fetch = vi.fn(async (url) => {
        if (typeof url === 'string' && url.endsWith('/events/evt-1/attachments')) {
          return {
            ok: true,
            json: async () => ({
              attachments: [
                { id: 'att-9', fileName: 'existing-plan.pdf', isFloorPlan: true, downloadUrl: '/files/gridfs-9' },
              ],
            }),
          };
        }
        // The /files/:id blob fetch
        return { ok: true, blob: async () => new Blob(['x'], { type: 'application/pdf' }) };
      });

      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventId: 'evt-1', eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
        />
      );

      await waitFor(() => expect(screen.getByText('existing-plan.pdf')).toBeTruthy());
    });
  });
});

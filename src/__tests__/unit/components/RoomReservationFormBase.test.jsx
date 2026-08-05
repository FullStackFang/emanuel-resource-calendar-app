// src/__tests__/unit/components/RoomReservationFormBase.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock all heavy child components to isolate the form base.
// The SchedulingAssistant probe exposes the series-mode contract
// (scheduling-assistant-series-mode): the effective selectedDate and the
// `series` prop's occurrences/handlers, with buttons to drive selection,
// skip, restore, and the assistant's day-conflict report.
vi.mock('../../../components/SchedulingAssistant', () => ({
  default: (props) => (
    <div
      data-testid="scheduling-assistant"
      data-selected-date={props.selectedDate || ''}
      data-series-present={String(!!props.series)}
      data-series-view-date={props.series?.viewDate || ''}
      data-series-occurrences={JSON.stringify(props.series?.occurrences || [])}
      data-series-read-only={String(!!props.series?.readOnly)}
      data-series-has-skip={String(!!props.series?.onSkipOccurrence)}
      data-series-has-restore={String(!!props.series?.onRestoreOccurrence)}
      data-series-has-open={String(!!props.series?.onOpenBlockingEvent)}
      data-series-exclusions={JSON.stringify(props.series?.recurrencePattern?.exclusions || [])}
    >
      <button type="button" data-testid="sa-select-0317" onClick={() => props.series?.onSelectDate?.('2026-03-17')} />
      <button type="button" data-testid="sa-select-0310" onClick={() => props.series?.onSelectDate?.('2026-03-10')} />
      <button type="button" data-testid="sa-series-skip" onClick={() => props.series?.onSkipOccurrence?.('2026-03-17')} />
      <button type="button" data-testid="sa-restore-0317" onClick={() => props.series?.onRestoreOccurrence?.('2026-03-17')} />
      <button type="button" data-testid="sa-restore-0331" onClick={() => props.series?.onRestoreOccurrence?.('2026-03-31')} />
      <button type="button" data-testid="sa-report-conflict" onClick={() => props.onConflictChange?.(true, 2)} />
      <button
        type="button"
        data-testid="sa-series-open"
        onClick={() => props.series?.onOpenBlockingEvent?.(
          { id: 'c1', eventTitle: 'Existing Meeting' },
          { occurrenceDate: '2026-03-17', outstandingConflictCount: props.series?.conflictingOccurrences }
        )}
      />
    </div>
  ),
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
// Probe rather than null — the clergy tests assert that both entry points
// drive the SAME single mounted modal instance, which needs its open state
// observable. The clear button lets tests save an empty assignment through
// the modal contract (the only clear path since the Additional Information
// clergy block was removed).
vi.mock('../../../components/ClergySelectorModal', () => ({
  default: ({ isOpen, onSave, onClose }) => (
    <div data-testid="clergy-modal-probe" data-open={String(!!isOpen)}>
      <button
        type="button"
        data-testid="clergy-modal-probe-clear"
        onClick={() => {
          onSave({ assignedRabbi: [], assignedCantor: [] });
          onClose();
        }}
      />
    </div>
  ),
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
// Mutable so individual tests can flip the effective role. Reset to admin in
// the floor-plan describe's beforeEach. The `mock` prefix lets vitest hoist it
// alongside the (hoisted) vi.mock factory without a ReferenceError.
const mockAdminPermissions = { role: 'admin', canEditEvents: true, canApproveReservations: true, isAdmin: true, canEditField: () => true };
const mockViewerPermissions = { role: 'viewer', canEditEvents: false, canApproveReservations: false, isAdmin: false, canEditField: () => false };
let mockPermissions = mockAdminPermissions;
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
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
// Probe the advisory instead of running its real TanStack query (no QueryClient
// in these renders). Exposes the props the base feeds it so we can assert wiring.
vi.mock('../../../components/shared/ReservationMarkerAdvisory', () => ({
  default: ({ apiToken, date }) => (
    <div data-testid="marker-advisory-probe" data-api-token={apiToken || ''} data-date={date || ''} />
  ),
}));
// The standalone RecurringConflictSummary panel is retired
// (scheduling-assistant-series-mode): its data flow now runs through the
// useRecurringConflicts hook into the assistant's `series` prop, both probed
// below.

// Controllable useRecurringConflicts return — the form base consumes the hook
// to build the assistant's `series` prop; the hook's own behavior is locked in
// useRecurringConflicts.test.jsx. `mock` prefix for vitest hoisting.
const mockDefaultConflictsReturn = () => ({
  data: { totalOccurrences: 12, conflictingOccurrences: 2 },
  occurrences: [
    { date: '2026-03-10', state: 'clear', pending: false },
    { date: '2026-03-17', state: 'conflicted', pending: false },
    { date: '2026-03-24', state: 'conflicted', pending: false },
    { date: '2026-03-31', state: 'clear', pending: false },
  ],
  conflictedDates: ['2026-03-17', '2026-03-24'],
  conflicts: [],
  totalOccurrences: 12,
  conflictingOccurrences: 2,
  skipRefused: false,
  loading: false,
  error: null,
  retry: () => {},
  lastKnownBlockers: {},
});
let mockConflictsReturn = mockDefaultConflictsReturn();
// The hook's inputs ARE the request contract the retired panel used to
// receive as props — captured here so threading tests can assert them.
let mockConflictsInputs = null;
vi.mock('../../../hooks/useRecurringConflicts', () => ({
  useRecurringConflicts: (inputs) => {
    mockConflictsInputs = inputs;
    return mockConflictsReturn;
  },
}));

import RoomReservationFormBase from '../../../components/RoomReservationFormBase';

describe('RoomReservationFormBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConflictsReturn = mockDefaultConflictsReturn();
    mockConflictsInputs = null;
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

  // ─── Marker Advisory Wiring ────────────────────────────────
  // The warnOnReservation advisory lives in the shared base form so every entry
  // point (new-booking route, New Reservation modal, review/edit) renders it.
  // It must receive the LIVE selected date and the apiToken with no threading.

  it('feeds the live selected date and apiToken to the marker advisory', async () => {
    render(
      <RoomReservationFormBase
        apiToken="tok-123"
        initialData={{ eventTitle: 'Gala', startDate: '2026-12-25', endDate: '2026-12-25' }}
        showAllTabs={false}
        activeTab="details"
      />
    );

    await waitFor(() => {
      const probe = screen.getByTestId('marker-advisory-probe');
      expect(probe.getAttribute('data-date')).toBe('2026-12-25');
      expect(probe.getAttribute('data-api-token')).toBe('tok-123');
    });
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
      // Default every floor-plan test to a fully-loaded admin.
      mockPermissions = mockAdminPermissions;
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

    it('keeps the dropzone enabled for an admin even when the form is read-only on a published reservation', () => {
      // Repro: admins/approvers must never be locked out of the floor plan.
      // The floor-plan upload is a standalone attachment op (not the OCC form
      // save), so the form-wide read-only/published lock must not disable it.
      mockPermissions = mockAdminPermissions;

      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventId: 'evt-1', eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
          readOnly
          reservationStatus="published"
        />
      );

      const input = screen.getByTestId('floor-plan-upload');
      expect(input.disabled).toBe(false);
      expect(screen.getByText(/Click to upload or drag & drop/i)).toBeTruthy();
    });

    it('locks the dropzone with an explanatory message for a user without edit authority', () => {
      // A viewer on a published reservation should NOT see the misleading
      // "Click to upload" prompt — the disabled state must explain itself.
      mockPermissions = mockViewerPermissions;

      render(
        <RoomReservationFormBase
          {...additionalTabProps}
          initialData={{ eventId: 'evt-1', eventTitle: 'Gala', startDate: '2026-05-01', endDate: '2026-05-01' }}
          readOnly
          reservationStatus="published"
        />
      );

      const input = screen.getByTestId('floor-plan-upload');
      expect(input.disabled).toBe(true);
      expect(screen.getByText(/Floor plan editing is locked/i)).toBeTruthy();
      // The misleading upbeat prompt must not appear while locked.
      expect(screen.queryByText(/Click to upload or drag & drop/i)).toBeNull();
    });
  });

  // ─── Reassign Owner (Additional Info tab, Submitter Information) ───────────
  // roomReservationData.requestedBy is the canonical ownership field. Approvers
  // transfer it via PUT /admin/events/:id/reassign; nobody else sees the control.

  describe('reassign owner control', () => {
    const OWNER = { name: 'Emily Assistant', email: 'emily@emanuelnyc.org' };
    const USERS = [
      { _id: 'u-emily', displayName: 'Emily Assistant', email: 'emily@emanuelnyc.org', effectiveRole: 'requester' },
      { _id: 'u-jeannette', displayName: 'Jeannette Assistant', email: 'jeannette@emanuelnyc.org', effectiveRole: 'requester' },
      { _id: 'u-rachel', displayName: 'Rachel Klein', email: 'rachel@emanuelnyc.org', effectiveRole: 'approver' },
    ];

    const reassignProps = {
      showAllTabs: false,
      activeTab: 'additional',
      apiToken: 'test-token',
      currentReservationId: 'evt-mongo-1',
      eventVersion: 4,
      initialData: {
        eventId: 'evt-1',
        eventTitle: 'Gala',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        requesterName: OWNER.name,
        requesterEmail: OWNER.email,
      },
    };

    /** Route the form base's attachment load, the user list, and the PUT. */
    function mockApi({ reassignResponse } = {}) {
      return vi.fn(async (url, opts) => {
        if (opts?.method === 'PUT' && String(url).includes('/reassign')) {
          return reassignResponse ?? {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              _version: 5,
              requestedBy: { name: 'Jeannette Assistant', email: 'jeannette@emanuelnyc.org' },
            }),
          };
        }
        if (String(url).endsWith('/users')) {
          return { ok: true, status: 200, json: async () => USERS };
        }
        return { ok: true, status: 200, json: async () => ({ attachments: [] }) };
      });
    }

    beforeEach(() => {
      mockPermissions = mockAdminPermissions;
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
      global.fetch = mockApi();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const usersCalls = () =>
      global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/users'));
    const reassignCalls = () =>
      global.fetch.mock.calls.filter(([u, o]) => o?.method === 'PUT' && String(u).includes('/reassign'));

    it('RA-1: renders the Reassign affordance for an approver', () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      expect(screen.getByTestId('reassign-owner-trigger')).toBeTruthy();
    });

    it('RA-2: does not render for a user without canApproveReservations', () => {
      mockPermissions = mockViewerPermissions;
      render(<RoomReservationFormBase {...reassignProps} />);
      expect(screen.queryByTestId('reassign-owner-trigger')).toBeNull();
      // The cell header falls back to the plain static label.
      expect(screen.getByText('Requester')).toBeTruthy();
    });

    it('RA-3: does not render before the reservation has been saved', () => {
      render(<RoomReservationFormBase {...reassignProps} currentReservationId={null} />);
      expect(screen.queryByTestId('reassign-owner-trigger')).toBeNull();
      expect(screen.getByText('Requester')).toBeTruthy();
    });

    it('RA-4: fetches the user list lazily on first open, and only once', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);

      // Nothing approver-gated fires just because the tab rendered.
      expect(usersCalls()).toHaveLength(0);

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(usersCalls()).toHaveLength(1));

      // Close and reopen — the list is already loaded.
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-picker')).toBeTruthy());
      expect(usersCalls()).toHaveLength(1);
    });

    it('RA-5: excludes the current owner from the selectable list', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));

      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());
      expect(screen.getByTestId('reassign-owner-option-u-rachel')).toBeTruthy();
      expect(screen.queryByTestId('reassign-owner-option-u-emily')).toBeNull();
    });

    it('RA-6: filters the list by name and email', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());

      fireEvent.change(screen.getByTestId('reassign-owner-search'), { target: { value: 'rachel@' } });
      expect(screen.getByTestId('reassign-owner-option-u-rachel')).toBeTruthy();
      expect(screen.queryByTestId('reassign-owner-option-u-jeannette')).toBeNull();

      fireEvent.change(screen.getByTestId('reassign-owner-search'), { target: { value: 'Jeannette' } });
      expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy();
      expect(screen.queryByTestId('reassign-owner-option-u-rachel')).toBeNull();
    });

    it('RA-7: first click confirms, second click sends the request', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());

      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));

      const commit = screen.getByTestId('reassign-owner-commit');
      expect(commit.textContent).toMatch(/Reassign/i);

      // First click arms the confirmation — no request yet.
      fireEvent.click(commit);
      expect(screen.getByTestId('reassign-owner-commit').textContent).toMatch(/Confirm\?/i);
      expect(reassignCalls()).toHaveLength(0);

      // Second click commits.
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));

      await waitFor(() => expect(reassignCalls()).toHaveLength(1));
      const [url, opts] = reassignCalls()[0];
      expect(url).toBe('http://localhost:3001/api/admin/events/evt-mongo-1/reassign');
      expect(JSON.parse(opts.body)).toEqual({ targetUserId: 'u-jeannette', expectedVersion: 4 });
    });

    it('RA-8: success shows a toast, updates the requester cell, and reports the new version', async () => {
      const onOwnershipChanged = vi.fn();
      render(<RoomReservationFormBase {...reassignProps} onOwnershipChanged={onOwnershipChanged} />);

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());
      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));

      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalled());

      // The Submitter Information grid now names the new owner.
      await waitFor(() => expect(screen.getByText('Jeannette Assistant')).toBeTruthy());
      expect(screen.queryByText(OWNER.name)).toBeNull();

      expect(onOwnershipChanged).toHaveBeenCalledWith(
        expect.objectContaining({ _version: 5 })
      );
      // Picker closes on success.
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();
    });

    it('RA-9: a 409 shows a one-line error and asks the parent to refresh — no ConflictDialog', async () => {
      const onOwnershipChanged = vi.fn();
      global.fetch = mockApi({
        reassignResponse: {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'This event was modified by another user. Please refresh and try again.',
            code: 'CONFLICT',
            details: { code: 'VERSION_CONFLICT', currentVersion: 7 },
          }),
        },
      });

      render(<RoomReservationFormBase {...reassignProps} onOwnershipChanged={onOwnershipChanged} />);

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());
      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));

      await waitFor(() => expect(screen.getByTestId('reassign-owner-error')).toBeTruthy());
      expect(screen.getByTestId('reassign-owner-error').textContent).toMatch(/changed/i);

      // Parent is asked to reload; ownership did not move locally. The name
      // also appears in the pending-transfer summary, so target the cell.
      await waitFor(() => expect(onOwnershipChanged).toHaveBeenCalledWith(null));
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(
        screen.getAllByText(OWNER.name).some(el => el.className.includes('info-cell-value'))
      ).toBe(true);
    });

    it('RA-10: a non-409 failure surfaces an error and leaves ownership unchanged', async () => {
      global.fetch = mockApi({
        reassignResponse: {
          ok: false,
          status: 400,
          json: async () => ({ error: 'That user already owns this event', code: 'ALREADY_OWNER' }),
        },
      });

      render(<RoomReservationFormBase {...reassignProps} />);

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());
      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));
      fireEvent.click(screen.getByTestId('reassign-owner-commit'));

      await waitFor(() => expect(mockShowError).toHaveBeenCalled());
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(
        screen.getAllByText(OWNER.name).some(el => el.className.includes('info-cell-value'))
      ).toBe(true);
    });

    // ── Collapsed trigger, centered modal ──
    // At rest: one line, nothing but the trigger. Open: a centered modal
    // (category-modal pattern), at most five matches with the overflow
    // counted, never scrolled. Selecting collapses the search to the
    // pending transfer.

    it('RA-11: nothing but the trigger renders at rest; opening renders the search', () => {
      render(<RoomReservationFormBase {...reassignProps} />);

      expect(screen.queryByTestId('reassign-owner-search')).toBeNull();
      expect(screen.queryByTestId('reassign-owner-commit')).toBeNull();
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      expect(screen.getByTestId('reassign-owner-search')).toBeTruthy();
    });

    it('RA-12: matches are capped at five and the overflow count is stated; typing narrows', async () => {
      const MANY_USERS = [
        { _id: 'u-emily', displayName: 'Emily Assistant', email: 'emily@emanuelnyc.org' },
        ...Array.from({ length: 8 }, (_, i) => ({
          _id: `u-extra-${i}`,
          displayName: `Extra Person ${i}`,
          email: `extra${i}@emanuelnyc.org`,
        })),
      ];
      global.fetch = vi.fn(async (url) => {
        if (String(url).endsWith('/users')) {
          return { ok: true, status: 200, json: async () => MANY_USERS };
        }
        return { ok: true, status: 200, json: async () => ({ attachments: [] }) };
      });

      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-extra-0')).toBeTruthy());

      // 8 non-owner users match, 5 shown, 3 counted — and no scroll container
      expect(screen.getAllByTestId(/^reassign-owner-option-/)).toHaveLength(5);
      const overflow = screen.getByTestId('reassign-owner-overflow');
      expect(overflow.textContent).toMatch(/3 more/i);
      expect(overflow.textContent).toMatch(/typ/i);

      // Typing narrows below the cap; the overflow line disappears
      fireEvent.change(screen.getByTestId('reassign-owner-search'), { target: { value: 'Extra Person 7' } });
      expect(screen.getAllByTestId(/^reassign-owner-option-/)).toHaveLength(1);
      expect(screen.queryByTestId('reassign-owner-overflow')).toBeNull();
    });

    it('RA-13: selecting a user collapses the search to the pending transfer', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());

      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));

      // The result list and search give way to the pending transfer
      expect(screen.queryByTestId('reassign-owner-search')).toBeNull();
      expect(screen.queryByTestId('reassign-owner-option-u-rachel')).toBeNull();
      const pending = screen.getByTestId('reassign-owner-pending');
      expect(pending.textContent).toContain('Emily Assistant');
      expect(pending.textContent).toContain('Jeannette Assistant');
      expect(screen.getByTestId('reassign-owner-commit')).toBeTruthy();

      // The way back to the search
      fireEvent.click(screen.getByTestId('reassign-owner-change'));
      expect(screen.getByTestId('reassign-owner-search')).toBeTruthy();
      expect(screen.queryByTestId('reassign-owner-pending')).toBeNull();
    });

    // ── Centered modal presentation ──
    // The picker opens in a category-modal overlay so it never reflows the
    // Submitter Information grid. Every close route (Cancel, X, ESC, overlay)
    // resets picker state.

    it('RA-14: opening renders a centered modal; Cancel closes it and resets the selection', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-option-u-jeannette')).toBeTruthy());

      // The picker lives inside the shared modal chrome, not the grid cell.
      const picker = screen.getByTestId('reassign-owner-picker');
      expect(picker.closest('.category-modal-overlay')).toBeTruthy();
      expect(picker.closest('.reassign-owner-modal')).toBeTruthy();
      expect(screen.getByText('Reassign Owner')).toBeTruthy();

      // Select someone, then Cancel — reopening must show a fresh search,
      // not the stale pending transfer.
      fireEvent.click(screen.getByTestId('reassign-owner-option-u-jeannette'));
      expect(screen.getByTestId('reassign-owner-pending')).toBeTruthy();
      fireEvent.click(screen.getByTestId('reassign-owner-cancel'));
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-search')).toBeTruthy());
      expect(screen.queryByTestId('reassign-owner-pending')).toBeNull();
    });

    it('RA-15: the X button and ESC both close the modal', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-picker')).toBeTruthy());
      fireEvent.click(screen.getByTestId('reassign-owner-close'));
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();

      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-picker')).toBeTruthy());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();
    });

    it('RA-16: clicking the overlay closes; clicking inside the modal does not', async () => {
      render(<RoomReservationFormBase {...reassignProps} />);
      fireEvent.click(screen.getByTestId('reassign-owner-trigger'));
      await waitFor(() => expect(screen.getByTestId('reassign-owner-picker')).toBeTruthy());

      // A click inside the dialog is not a dismissal.
      fireEvent.click(screen.getByTestId('reassign-owner-picker'));
      expect(screen.getByTestId('reassign-owner-picker')).toBeTruthy();

      const overlay = screen.getByTestId('reassign-owner-picker').closest('.category-modal-overlay');
      fireEvent.click(overlay);
      expect(screen.queryByTestId('reassign-owner-picker')).toBeNull();
    });
  });

  // ─── Clergy edit from the Submitter Information grid ───────────────────────
  // The Additional Information clergy button/summary block is gone; on this
  // tab the grid's Edit link is the entry point. It drives the same single
  // mounted ClergySelectorModal and the same state as the Event Details
  // button, so the two cannot disagree.

  describe('clergy edit from the submitter grid', () => {
    const clergyProps = {
      showAllTabs: false,
      apiToken: 'test-token',
      initialData: {
        eventId: 'evt-1',
        eventTitle: 'Gala',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
      },
    };

    beforeEach(() => {
      mockPermissions = mockAdminPermissions;
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ attachments: [] }) }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('CG-1: the Edit link opens the shared clergy modal', () => {
      render(<RoomReservationFormBase {...clergyProps} activeTab="additional" />);
      // The modal is mounted once at the component root and is closed initially.
      expect(screen.getByTestId('clergy-modal-probe').dataset.open).toBe('false');
      fireEvent.click(screen.getByTestId('clergy-edit-submitter'));
      expect(screen.getByTestId('clergy-modal-probe').dataset.open).toBe('true');
    });

    it('CG-2: the old Additional Information clergy block is gone', () => {
      render(
        <RoomReservationFormBase
          {...clergyProps}
          activeTab="additional"
          initialData={{
            ...clergyProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
          }}
        />
      );
      expect(screen.queryByTestId('clergy-button-additional')).toBeNull();
      expect(screen.queryByTestId('clergy-summary-additional')).toBeNull();
    });

    it('CG-3: the Edit link is absent when the form fields are disabled, but the display remains', () => {
      render(
        <RoomReservationFormBase
          {...clergyProps}
          activeTab="additional"
          readOnly
          reservationStatus="published"
          initialData={{
            ...clergyProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
          }}
        />
      );
      expect(screen.queryByTestId('clergy-edit-submitter')).toBeNull();
      // The header falls back to the plain static label; the display stays.
      const cell = screen.getByTestId('clergy-cell-submitter');
      expect(cell.textContent).toContain('Clergy');
      expect(cell.textContent).toContain('Rabbi Cohen');
    });

    it('CG-4: an assignment shows in the grid here and in the details tab summary', () => {
      const withRabbi = {
        ...clergyProps.initialData,
        assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
      };

      const { unmount } = render(
        <RoomReservationFormBase {...clergyProps} initialData={withRabbi} activeTab="additional" />
      );
      expect(screen.getByTestId('clergy-cell-submitter').textContent).toContain('Rabbi Cohen');
      unmount();

      // Same state object drives the details tab summary.
      render(<RoomReservationFormBase {...clergyProps} initialData={withRabbi} activeTab="details" />);
      expect(screen.getByText(/Rabbi: Rabbi Cohen/)).toBeTruthy();
    });
  });

  // ─── Clergy row in Submitter Information ──────────────────────────────────
  // Always rendered as a full-width row with Rabbis | Cantors sub-columns, so
  // "nobody assigned" (an em-dash per column) is distinguishable from a load
  // failure. The display itself is inert; only the Edit link opens the modal.

  describe('clergy cell in submitter information', () => {
    const cellProps = {
      showAllTabs: false,
      activeTab: 'additional',
      apiToken: 'test-token',
      initialData: {
        eventId: 'evt-1',
        eventTitle: 'Gala',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
      },
    };

    beforeEach(() => {
      mockPermissions = mockAdminPermissions;
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ attachments: [] }) }));
    });

    it('CLS-1: renders unconditionally with both columns dashed when nobody is assigned', () => {
      render(<RoomReservationFormBase {...cellProps} />);

      const cell = screen.getByTestId('clergy-cell-submitter');
      expect(cell.textContent).toContain('Clergy');
      expect(screen.getByTestId('clergy-col-rabbi').textContent).toContain('—');
      expect(screen.getByTestId('clergy-col-cantor').textContent).toContain('—');
    });

    it('CLS-2: each person renders in their role column', () => {
      render(
        <RoomReservationFormBase
          {...cellProps}
          initialData={{
            ...cellProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
            assignedCantor: [{ id: 'c1', displayName: 'Cantor Levy' }],
          }}
        />
      );

      const rabbiCol = screen.getByTestId('clergy-col-rabbi');
      const cantorCol = screen.getByTestId('clergy-col-cantor');
      expect(rabbiCol.textContent).toContain('Rabbis');
      expect(rabbiCol.textContent).toContain('Rabbi Cohen');
      expect(cantorCol.textContent).toContain('Cantors');
      expect(cantorCol.textContent).toContain('Cantor Levy');
      expect(screen.getByTestId('clergy-cell-submitter').textContent).not.toContain('—');
    });

    it('CLS-3: multiple people in one role render as separate entries', () => {
      render(
        <RoomReservationFormBase
          {...cellProps}
          initialData={{
            ...cellProps.initialData,
            assignedRabbi: [
              { id: 'r1', displayName: 'Rabbi Cohen' },
              { id: 'r2', displayName: 'Rabbi Stein' },
            ],
          }}
        />
      );

      const entries = screen.getAllByTestId(/^clergy-cell-entry-/);
      expect(entries).toHaveLength(2);
      expect(entries[0].textContent).toContain('Rabbi Cohen');
      expect(entries[1].textContent).toContain('Rabbi Stein');
    });

    it('CLS-4: an unassigned role keeps its column, dashed and empty', () => {
      render(
        <RoomReservationFormBase
          {...cellProps}
          initialData={{
            ...cellProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
          }}
        />
      );

      expect(screen.getByTestId('clergy-col-rabbi').textContent).toContain('Rabbi Cohen');
      const cantorCol = screen.getByTestId('clergy-col-cantor');
      expect(cantorCol.textContent).toContain('—');
      expect(screen.queryAllByTestId(/^clergy-cell-entry-cantor-/)).toHaveLength(0);
    });

    it('CLS-5: clicking the display area opens no selector and changes no form state', () => {
      const onDataChange = vi.fn();
      render(
        <RoomReservationFormBase
          {...cellProps}
          onDataChange={onDataChange}
          initialData={{
            ...cellProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
          }}
        />
      );

      fireEvent.click(screen.getByTestId('clergy-col-rabbi'));
      fireEvent.click(screen.getByTestId('clergy-cell-entry-rabbi-r1'));

      expect(screen.getByTestId('clergy-modal-probe').getAttribute('data-open')).toBe('false');
      expect(onDataChange).not.toHaveBeenCalled();
    });

    it('CLS-6: follows the shared form state with no separate synchronization', async () => {
      render(
        <RoomReservationFormBase
          {...cellProps}
          initialData={{
            ...cellProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
          }}
        />
      );
      expect(screen.getByTestId('clergy-cell-submitter').textContent).toContain('Rabbi Cohen');

      // Saving an empty assignment through the shared modal updates the same
      // arrays the columns read — no bridge code involved.
      fireEvent.click(screen.getByTestId('clergy-edit-submitter'));
      fireEvent.click(screen.getByTestId('clergy-modal-probe-clear'));

      await waitFor(() => {
        expect(screen.getByTestId('clergy-col-rabbi').textContent).toContain('—');
      });
      expect(screen.queryAllByTestId(/^clergy-cell-entry-/)).toHaveLength(0);
    });
  });

  // ─── Recurring Conflict Panel Mount (details tab) ──────────
  // The approver must see WHICH occurrences conflict before deciding. The
  // panel mounts below the SchedulingAssistant whenever a recurrence with
  // pattern + range is active and at least one room is selected, in both
  // readOnly (review modal) and editable (form) modes.

  describe('series conflicts threading (hook inputs + assistant series prop)', () => {
    const weeklyRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
    };
    const recurringInitialData = {
      eventTitle: 'Weekly Class',
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      startTime: '14:00',
      endTime: '15:00',
      requestedRooms: ['room-1'],
      recurrence: weeklyRecurrence,
    };

    it('RCP-1: the hook receives the resolved recurrence, room ids, calendar owner, and datetimes; the assistant gets a series prop', async () => {
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          defaultCalendar="templeeventssandbox@emanuelnyc.org"
          showAllTabs={false}
          activeTab="details"
        />
      );

      await waitFor(() => {
        expect(mockConflictsInputs).not.toBeNull();
        expect(mockConflictsInputs.recurrence?.pattern?.type).toBe('weekly');
        expect(mockConflictsInputs.roomIds).toEqual(['room-1']);
        expect(mockConflictsInputs.calendarOwner).toBe('templeeventssandbox@emanuelnyc.org');
        expect(mockConflictsInputs.startDateTime).toBe('2026-03-10T14:00:00');
        expect(mockConflictsInputs.endDateTime).toBe('2026-03-10T15:00:00');
        expect(screen.getByTestId('scheduling-assistant').getAttribute('data-series-present')).toBe('true');
      });
    });

    it('RCP-2: no series prop for a non-recurring event', async () => {
      render(
        <RoomReservationFormBase
          initialData={{ ...recurringInitialData, recurrence: undefined }}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('scheduling-assistant').getAttribute('data-series-present')).toBe('false');
      });
    });

    it('RCP-3: no series prop when no room is selected', async () => {
      render(
        <RoomReservationFormBase
          initialData={{ ...recurringInitialData, requestedRooms: [] }}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('scheduling-assistant').getAttribute('data-series-present')).toBe('false');
      });
    });

    it('RCP-4: readOnly mode follows the disabled-fields state of the form', async () => {
      mockPermissions = mockViewerPermissions;
      try {
        render(
          <RoomReservationFormBase
            initialData={recurringInitialData}
            apiToken="tok-123"
            readOnly
            showAllTabs={false}
            activeTab="details"
          />
        );

        await waitFor(() => {
          expect(mockConflictsInputs?.readOnly).toBe(true);
          expect(screen.getByTestId('scheduling-assistant').getAttribute('data-series-read-only')).toBe('true');
        });
      } finally {
        mockPermissions = mockAdminPermissions;
      }
    });
  });

  // ─── Conflict skip handler (design D1: form-state mutation, no endpoint) ──
  // Skipping a date adds it to recurrence.exclusions through the same
  // notify sequence every other control uses. The changed recurrence prop is
  // what re-runs the panel's signature-keyed conflict check — no explicit
  // refetch call exists anywhere in this path.

  describe('conflict skip handler', () => {
    const weeklyRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
    };
    const recurringInitialData = {
      eventTitle: 'Weekly Class',
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      startTime: '14:00',
      endTime: '15:00',
      requestedRooms: ['room-1'],
      recurrence: weeklyRecurrence,
    };

    const saSeriesReady = async () => {
      await waitFor(() => {
        expect(screen.getByTestId('scheduling-assistant').getAttribute('data-series-present')).toBe('true');
      });
    };

    it('SKP-1: skip adds the date to recurrence.exclusions, marks the form dirty, and the conflicts hook sees the change', async () => {
      const onDataChange = vi.fn();
      const onHasChangesChange = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onDataChange={onDataChange}
          onHasChangesChange={onHasChangesChange}
        />
      );
      await saSeriesReady();

      fireEvent.click(screen.getByTestId('sa-series-skip'));

      // The hook's recurrence input (part of its fetch signature) now carries
      // the exclusion — that IS the re-check trigger, no refetch call needed.
      await waitFor(() => {
        expect(mockConflictsInputs.recurrence?.exclusions).toContain('2026-03-17');
        expect(mockConflictsInputs.pendingSkippedDates).toEqual(['2026-03-17']);
      });
      expect(onDataChange).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence: expect.objectContaining({ exclusions: ['2026-03-17'] }),
        })
      );
      expect(onHasChangesChange).toHaveBeenCalledWith(true);
    });

    it('SKP-2: skipping the same date twice adds it once', async () => {
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
        />
      );
      await saSeriesReady();

      fireEvent.click(screen.getByTestId('sa-series-skip'));
      fireEvent.click(screen.getByTestId('sa-series-skip'));

      await waitFor(() => {
        expect(mockConflictsInputs.recurrence?.exclusions).toEqual(['2026-03-17']);
      });
    });

    it('SKP-3: no skip or restore handler is offered when the form fields are disabled; navigation remains', async () => {
      mockPermissions = mockViewerPermissions;
      try {
        render(
          <RoomReservationFormBase
            initialData={recurringInitialData}
            apiToken="tok-123"
            readOnly
            showAllTabs={false}
            activeTab="details"
          />
        );

        await waitFor(() => {
          const probe = screen.getByTestId('scheduling-assistant');
          expect(probe.getAttribute('data-series-has-skip')).toBe('false');
          expect(probe.getAttribute('data-series-has-restore')).toBe('false');
        });
      } finally {
        mockPermissions = mockAdminPermissions;
      }
    });

    it('SKP-4: the blocking-event navigation callback threads through to the assistant series prop', async () => {
      const onOpenBlockingEvent = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onOpenBlockingEvent={onOpenBlockingEvent}
        />
      );
      await saSeriesReady();

      fireEvent.click(screen.getByTestId('sa-series-open'));

      expect(onOpenBlockingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
        { occurrenceDate: '2026-03-17', outstandingConflictCount: 2 }
      );
    });
  });

  // ─── Series view date + restore (scheduling-assistant-series-mode) ──────
  // The occurrence band's selection drives a view date OWNED BY THE FORM BASE
  // and distinct from formData.startDate — browsing occurrences retargets the
  // assistant without rescheduling the series or dirtying the form. Restore
  // is the mirror of skip: it removes a date from recurrence.exclusions
  // (pending or saved) through the same dirty-marking path, and the
  // signature-keyed conflict refetch is what re-checks it — no free pass.

  describe('series view date and restore', () => {
    const weeklyRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
    };
    const recurringInitialData = {
      eventTitle: 'Weekly Class',
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      startTime: '14:00',
      endTime: '15:00',
      requestedRooms: ['room-1'],
      recurrence: weeklyRecurrence,
    };

    beforeEach(() => {
      mockConflictsReturn = mockDefaultConflictsReturn();
    });

    const saProbe = () => screen.getByTestId('scheduling-assistant');

    it('SVD-1: selecting an occurrence retargets the assistant date without touching the form', async () => {
      const onHasChangesChange = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onHasChangesChange={onHasChangesChange}
        />
      );
      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-10'));
      // Series masters display the series range in the (read-only) date
      // pickers; the invariant is that browsing never changes what they show.
      const dateFieldValuesBefore = screen.getAllByTestId('date-picker-input').map(i => i.value);

      fireEvent.click(screen.getByTestId('sa-select-0317'));

      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-17'));
      expect(screen.getAllByTestId('date-picker-input').map(i => i.value)).toEqual(dateFieldValuesBefore);
      expect(onHasChangesChange).not.toHaveBeenCalledWith(true);
    });

    it('SVD-2: the view date resets when the recurrence stops containing it', async () => {
      const { rerender } = render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
        />
      );
      await waitFor(() => screen.getByTestId('sa-select-0317'));
      fireEvent.click(screen.getByTestId('sa-select-0317'));
      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-17'));

      // The recurrence no longer expands 2026-03-17 (e.g. pattern edited)
      mockConflictsReturn = {
        ...mockDefaultConflictsReturn(),
        occurrences: mockDefaultConflictsReturn().occurrences.filter(o => o.date !== '2026-03-17'),
        conflictedDates: ['2026-03-24'],
      };
      rerender(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
        />
      );

      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-10'));
    });

    it('SVD-3: the day-conflict report is suppressed while browsing a non-start date', async () => {
      const onConflictChange = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onConflictChange={onConflictChange}
        />
      );
      await waitFor(() => screen.getByTestId('sa-report-conflict'));

      // On the form's own day the report passes through
      fireEvent.click(screen.getByTestId('sa-report-conflict'));
      expect(onConflictChange).toHaveBeenCalledTimes(1);

      // Browsing another occurrence: the report must not reach the parent
      fireEvent.click(screen.getByTestId('sa-select-0317'));
      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-17'));
      fireEvent.click(screen.getByTestId('sa-report-conflict'));
      expect(onConflictChange).toHaveBeenCalledTimes(1);

      // Back on the start date the report passes through again
      fireEvent.click(screen.getByTestId('sa-select-0310'));
      await waitFor(() => expect(saProbe().getAttribute('data-selected-date')).toBe('2026-03-10'));
      fireEvent.click(screen.getByTestId('sa-report-conflict'));
      expect(onConflictChange).toHaveBeenCalledTimes(2);
    });

    it('RST-1: restore removes a pending exclusion and marks the form dirty', async () => {
      const onDataChange = vi.fn();
      const onHasChangesChange = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={recurringInitialData}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onDataChange={onDataChange}
          onHasChangesChange={onHasChangesChange}
        />
      );
      await waitFor(() => {
        expect(saProbe().getAttribute('data-series-present')).toBe('true');
      });

      fireEvent.click(screen.getByTestId('sa-series-skip'));
      await waitFor(() => {
        expect(JSON.parse(saProbe().getAttribute('data-series-exclusions'))).toContain('2026-03-17');
      });

      fireEvent.click(screen.getByTestId('sa-restore-0317'));
      await waitFor(() => {
        expect(JSON.parse(saProbe().getAttribute('data-series-exclusions'))).toEqual([]);
      });
      expect(onDataChange).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence: expect.objectContaining({ exclusions: [] }),
        })
      );
      expect(onHasChangesChange).toHaveBeenCalledWith(true);
    });

    it('RST-2: restore also removes a previously saved exclusion', async () => {
      const onHasChangesChange = vi.fn();
      render(
        <RoomReservationFormBase
          initialData={{
            ...recurringInitialData,
            recurrence: { ...weeklyRecurrence, exclusions: ['2026-03-31'] },
          }}
          apiToken="tok-123"
          showAllTabs={false}
          activeTab="details"
          onHasChangesChange={onHasChangesChange}
        />
      );
      await waitFor(() => {
        expect(JSON.parse(saProbe().getAttribute('data-series-exclusions'))).toEqual(['2026-03-31']);
      });

      fireEvent.click(screen.getByTestId('sa-restore-0331'));

      await waitFor(() => {
        expect(JSON.parse(saProbe().getAttribute('data-series-exclusions'))).toEqual([]);
      });
      expect(onHasChangesChange).toHaveBeenCalledWith(true);
    });
  });
});

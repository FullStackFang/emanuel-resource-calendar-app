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
// Probe rather than null — the clergy tests assert that both tabs drive the
// SAME single mounted modal instance, which needs its open state observable.
vi.mock('../../../components/ClergySelectorModal', () => ({
  default: ({ isOpen }) => <div data-testid="clergy-modal-probe" data-open={String(!!isOpen)} />,
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
    });

    it('RA-3: does not render before the reservation has been saved', () => {
      render(<RoomReservationFormBase {...reassignProps} currentReservationId={null} />);
      expect(screen.queryByTestId('reassign-owner-trigger')).toBeNull();
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

      // Parent is asked to reload; ownership did not move locally.
      await waitFor(() => expect(onOwnershipChanged).toHaveBeenCalledWith(null));
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(screen.getByText(OWNER.name)).toBeTruthy();
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
      expect(screen.getByText(OWNER.name)).toBeTruthy();
    });
  });

  // ─── Clergy on the Additional Information tab ──────────────────────────────
  // Redundant by design: the same button and summary as the Event Details tab,
  // sharing one modal instance and one piece of state so they cannot disagree.

  describe('clergy control on the additional tab', () => {
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

    it('CL-1: renders a Clergy button on the Additional Information tab', () => {
      render(<RoomReservationFormBase {...clergyProps} activeTab="additional" />);
      expect(screen.getByTestId('clergy-button-additional')).toBeTruthy();
    });

    it('CL-2: the button opens the same shared modal the details tab uses', () => {
      render(<RoomReservationFormBase {...clergyProps} activeTab="additional" />);
      // The modal is mounted once at the component root and is closed initially.
      expect(screen.getByTestId('clergy-modal-probe').dataset.open).toBe('false');
      fireEvent.click(screen.getByTestId('clergy-button-additional'));
      expect(screen.getByTestId('clergy-modal-probe').dataset.open).toBe('true');
    });

    it('CL-3: an assignment made from either tab is reflected on the other', () => {
      const withRabbi = {
        ...clergyProps.initialData,
        assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
      };

      const { unmount } = render(
        <RoomReservationFormBase {...clergyProps} initialData={withRabbi} activeTab="additional" />
      );
      expect(screen.getByTestId('clergy-summary-additional').textContent).toContain('Rabbi Cohen');
      unmount();

      // Same state object drives the details tab summary.
      render(<RoomReservationFormBase {...clergyProps} initialData={withRabbi} activeTab="details" />);
      expect(screen.getByText(/Rabbi: Rabbi Cohen/)).toBeTruthy();
    });

    it('CL-4: Clear on the additional tab empties both clergy arrays', () => {
      const onDataChange = vi.fn();
      render(
        <RoomReservationFormBase
          {...clergyProps}
          initialData={{
            ...clergyProps.initialData,
            assignedRabbi: [{ id: 'r1', displayName: 'Rabbi Cohen' }],
            assignedCantor: [{ id: 'c1', displayName: 'Cantor Levy' }],
          }}
          activeTab="additional"
          onDataChange={onDataChange}
        />
      );

      fireEvent.click(screen.getByTestId('clergy-clear-additional'));
      expect(screen.queryByTestId('clergy-summary-additional')).toBeNull();
    });

    it('CL-5: the button is disabled when the form fields are disabled', () => {
      render(
        <RoomReservationFormBase
          {...clergyProps}
          activeTab="additional"
          readOnly
          reservationStatus="published"
        />
      );
      expect(screen.getByTestId('clergy-button-additional').disabled).toBe(true);
    });
  });
});

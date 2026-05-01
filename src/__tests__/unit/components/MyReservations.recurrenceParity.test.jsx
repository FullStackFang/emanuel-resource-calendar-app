// src/__tests__/unit/components/MyReservations.recurrenceParity.test.jsx
//
// R-12 (entry-point parity): MyReservations must present the same
// RecurringScopeDialog as Calendar when the user clicks View Details on a
// recurring series master. Without this gate, list-view clicks silently
// defaulted to `allEvents` scope, hiding the thisEvent path and breaking
// parity with Calendar's well-tested flow.
//
// Companion tests for ReservationRequests and EventManagement live alongside
// (recurrenceParity.test.jsx in each). The isRecurringSeriesMaster helper is
// duplicated identically across the three components — a future refactor can
// hoist it into a shared util once the audit-plan's Plan 2 lands.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Module-level mocks (mirror MyReservations.recurringCard.test.jsx) ───────

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'test@test.com', PRODUCTION_CALENDAR: 'prod@test.com' },
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token', user: { name: 'Test User', email: 'test@test.com' } }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../context/LocationContext', () => ({
  useRooms: () => ({
    rooms: [],
    getRoomDetails: () => ({ name: 'Sanctuary', location: '' }),
    loading: false,
  }),
  useLocations: () => ({ locations: [], rooms: [], getLocationName: (id) => id }),
}));

vi.mock('../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canApproveReservations: false,
    isAdmin: false,
    permissionsLoading: false,
    canEditEvents: false,
    canDeleteEvents: false,
    canSubmitReservation: true,
  }),
}));

vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));

vi.mock('../../../hooks/useDataRefreshBus', () => ({
  useDataRefreshBus: () => {},
  dispatchRefresh: vi.fn(),
}));

vi.mock('../../../components/shared/EventReviewExperience', () => ({ default: () => null }));
vi.mock('../../../components/shared/LoadingSpinner', () => ({ default: () => <div data-testid='loading-spinner' /> }));
vi.mock('../../../components/shared/FreshnessIndicator', () => ({ default: () => null }));
vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input data-testid='date-picker-input' value={value || ''} onChange={onChange || vi.fn()} placeholder={placeholder} readOnly />
  ),
}));

vi.mock('../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

const openModalSpy = vi.fn();
vi.mock('../../../hooks/useEventReviewExperience', () => ({
  useEventReviewExperience: () => ({
    isOpen: false,
    currentItem: null,
    editableData: null,
    selectedEvent: null,
    isDraft: false,
    isEditRequestMode: false,
    isViewingEditRequest: false,
    isCancellationRequestMode: false,
    openModal: openModalSpy,
    closeModal: vi.fn(),
    navigateToEvent: vi.fn(),
    handleSave: vi.fn(),
    handlePublish: vi.fn(),
    handleReject: vi.fn(),
    handleDelete: vi.fn(),
    handleRestore: vi.fn(),
    handleSaveDraft: vi.fn(),
    handleSubmitDraft: vi.fn(),
    handleSavePendingEdit: vi.fn(),
    handleSaveRejectedEdit: vi.fn(),
    handleOwnerEdit: vi.fn(),
    isSavingOwnerEdit: false,
    savingEvent: false,
    publishingEvent: false,
    rejectingEvent: false,
    deletingEvent: false,
    restoringEvent: false,
    savingDraft: false,
    submittingDraft: false,
    confirmDeleteId: null,
    confirmRestoreId: null,
    setConfirmDeleteId: vi.fn(),
    setConfirmRestoreId: vi.fn(),
    hasChanges: false,
    setHasChanges: vi.fn(),
    eventVersion: null,
    conflictInfo: null,
    schedulingConflictInfo: null,
    setSchedulingConflictInfo: vi.fn(),
  }),
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseRequester = {
  roomReservationData: { requestedBy: { name: 'Test User', email: 'test@test.com' } },
  requestedRooms: [],
  locations: [],
  categories: [],
  status: 'published',
  submittedAt: '2026-04-15T10:00:00Z',
  lastModifiedDateTime: '2026-04-15T10:00:00Z',
};

const singleEvent = {
  ...baseRequester,
  _id: 'evt-single',
  eventId: 'evt-single',
  eventType: 'singleInstance',
  eventTitle: 'One-Off Concert',
  startDate: '2026-04-22',
  startTime: '19:00',
  endDate: '2026-04-22',
  endTime: '21:00',
};

const seriesMasterEvent = {
  ...baseRequester,
  _id: 'evt-series',
  eventId: 'evt-series',
  eventType: 'seriesMaster',
  eventTitle: 'Weekly Yoga',
  startDate: '2026-04-06',
  startTime: '09:00',
  endDate: '2026-04-06',
  endTime: '10:00',
  recurrence: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
    range: { type: 'endDate', startDate: '2026-04-06', endDate: '2026-06-29' },
    additions: [],
    exclusions: [],
  },
};

function mountWithEvents(events) {
  currentAuthFetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/events/list')) {
      return Promise.resolve({ ok: true, json: async () => ({ events }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ─── Component import (after mocks) ──────────────────────────────────────────

import MyReservations from '../../../components/MyReservations';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MyReservations recurrence-parity (R-12)', () => {
  beforeEach(() => {
    currentAuthFetch = vi.fn();
    openModalSpy.mockReset();
  });

  it('R-12a: View Details on a singleInstance event opens the modal directly (no scope dialog)', async () => {
    mountWithEvents([singleEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('One-Off Concert')).toBeInTheDocument();
    });

    const viewDetailsBtn = screen.getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    // Modal opened directly with the reservation; no scope dialog rendered
    expect(openModalSpy).toHaveBeenCalledTimes(1);
    expect(openModalSpy).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-single' }));
    // RecurringScopeDialog should NOT be open — its dialog has role=dialog or contains 'Edit Recurring Event'
    expect(screen.queryByText(/this event only/i)).toBeNull();
    expect(screen.queryByText(/all events in the series/i)).toBeNull();
  });

  it('R-12b: View Details on a seriesMaster opens the RecurringScopeDialog instead of calling openModal directly', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Weekly Yoga')).toBeInTheDocument();
    });

    const viewDetailsBtn = screen.getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    // Critical parity assertion: modal NOT opened directly
    expect(openModalSpy).not.toHaveBeenCalled();

    // Scope dialog now visible — assert by the unique "Continue" button which
    // only the RecurringScopeDialog renders.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    });
    // And the radio options for both scopes are present
    expect(screen.getByText('This event only')).toBeInTheDocument();
    expect(screen.getByText('All events in the series')).toBeInTheDocument();
  });

  it('R-12c: choosing All Events in the dialog calls openModal with editScope: allEvents', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Weekly Yoga')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /view details/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    });

    // Select "All events in the series" then click Continue
    const allEventsRadio = screen.getByRole('radio', { name: /all events in the series/i });
    fireEvent.click(allEventsRadio);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    expect(openModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-series' }),
      expect.objectContaining({ editScope: 'allEvents' })
    );
  });
});

// src/__tests__/unit/components/MyReservations.recurrenceParity.test.jsx
//
// R-12 (entry-point parity): MyReservations operates at the request/series
// level. View Details on a recurring series master MUST open the review modal
// directly with editScope: 'allEvents' — the RecurringScopeDialog does NOT
// appear here. The thisEvent scope is reachable only through the inline
// Recurrence Exceptions table on the same card (covered separately in
// MyReservations.recurringCard.test.jsx).
//
// This mirrors the parity contract enforced by ReservationRequests.jsx (R-13).
// Only Calendar (where users click an occurrence on a date cell) presents the
// thisEvent vs allEvents choice — that ambiguity does not exist when clicking
// a request from a list.

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

  it('R-12a: View Details on a singleInstance event opens the modal directly with no editScope option', async () => {
    mountWithEvents([singleEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('One-Off Concert')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    const [openedEvent, openedOptions] = openModalSpy.mock.calls[0];
    expect(openedEvent.eventId).toBe('evt-single');
    expect(openedOptions).toBeUndefined();

    // No scope dialog rendered
    expect(screen.queryByText(/this event only/i)).toBeNull();
    expect(screen.queryByText(/all events in the series/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
  });

  it('R-12b: View Details on a seriesMaster opens the modal directly with editScope: allEvents (no scope dialog)', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Weekly Yoga')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    // Critical parity assertion: modal opens directly with editScope: 'allEvents'
    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    const [openedEvent, openedOptions] = openModalSpy.mock.calls[0];
    expect(openedEvent._id).toBe('evt-series');
    expect(openedOptions).toEqual({ editScope: 'allEvents' });

    // The instance-level choice is NOT presented at the master level
    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('This event only')).not.toBeInTheDocument();
    expect(screen.queryByText('All events in the series')).not.toBeInTheDocument();
  });

  it('R-12c: View Details on a recurring event detected via recurrence.pattern (no eventType) also opens with editScope: allEvents', async () => {
    // Defensive case: legacy/edge events that lack eventType but have a
    // populated recurrence block must still be treated as series masters by
    // the isRecurringSeriesMaster helper.
    const legacyMaster = {
      ...seriesMasterEvent,
      _id: 'evt-legacy',
      eventId: 'evt-legacy',
      eventTitle: 'Legacy Recurring Class',
      eventType: undefined,
    };
    mountWithEvents([legacyMaster]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Legacy Recurring Class')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    const [, openedOptions] = openModalSpy.mock.calls[0];
    expect(openedOptions).toEqual({ editScope: 'allEvents' });
  });
});

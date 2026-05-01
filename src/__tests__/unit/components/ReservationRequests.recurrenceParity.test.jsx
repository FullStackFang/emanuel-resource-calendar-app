// src/__tests__/unit/components/ReservationRequests.recurrenceParity.test.jsx
//
// R-13 (intentional divergence from Calendar/MyReservations parity):
// In the Approval Queue, approval is always a series-level action, and pending
// masters have no published children to override. So clicking View Details on
// a recurring series master MUST skip the RecurringScopeDialog and open the
// review modal directly with editScope: 'allEvents'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
  useAuth: () => ({
    apiToken: 'test-token',
    graphToken: 'test-graph-token',
    user: { name: 'Test User', email: 'admin@test.com' },
  }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../context/LocationContext', () => ({
  useRooms: () => ({
    rooms: [],
    getRoomDetails: () => ({ name: 'Sanctuary', location: '' }),
    getLocationName: (id) => id,
    getRoomName: (id) => id,
    loading: false,
  }),
  useLocations: () => ({ locations: [], rooms: [], getLocationName: (id) => id }),
}));

vi.mock('../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canApproveReservations: true,
    isAdmin: false,
    permissionsLoading: false,
    canEditEvents: true,
    canDeleteEvents: false,
    canCreateEvents: false,
    canViewCalendar: true,
    canSubmitReservation: true,
    canEditField: () => false,
    role: 'approver',
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
vi.mock('../../../components/shared/DiscardChangesDialog', () => ({ default: () => null }));
vi.mock('../../../components/EditRequestComparison', () => ({ default: () => null }));
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
    openModal: openModalSpy,
    closeModal: vi.fn(),
    navigateToEvent: vi.fn(),
    handleSave: vi.fn(),
    handlePublish: vi.fn(),
    handleReject: vi.fn(),
    handleDelete: vi.fn(),
    handleRestore: vi.fn(),
    handleSavePendingEdit: vi.fn(),
    handleSaveRejectedEdit: vi.fn(),
    handleOwnerEdit: vi.fn(),
    isSavingOwnerEdit: false,
    savingEvent: false,
    publishingEvent: false,
    rejectingEvent: false,
    deletingEvent: false,
    restoringEvent: false,
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

const seriesMasterEvent = {
  _id: 'evt-rr-series',
  eventId: 'evt-rr-series',
  eventType: 'seriesMaster',
  eventTitle: 'Approval Queue Yoga Series',
  status: 'pending',
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
  roomReservationData: { requestedBy: { name: 'Requester', email: 'requester@test.com' } },
  requestedRooms: [],
  locations: [],
  categories: [],
  submittedAt: '2026-04-15T10:00:00Z',
  lastModifiedDateTime: '2026-04-15T10:00:00Z',
};

function mountWithEvents(events) {
  currentAuthFetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/events/list')) {
      return Promise.resolve({ ok: true, json: async () => ({ events, total: events.length }) });
    }
    if (url.includes('/calendars')) {
      return Promise.resolve({ ok: true, json: async () => ({ calendars: [] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

import ReservationRequests from '../../../components/ReservationRequests';

describe('ReservationRequests recurrence-parity (R-13)', () => {
  beforeEach(() => {
    currentAuthFetch = vi.fn();
    openModalSpy.mockReset();
  });

  it("R-13: View Details on a seriesMaster opens the modal directly with editScope: 'allEvents' (no scope dialog)", async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<ReservationRequests />);

    await waitFor(() => {
      expect(screen.getByText('Approval Queue Yoga Series')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    const [openedEvent, openedOptions] = openModalSpy.mock.calls[0];
    expect(openedEvent._id).toBe('evt-rr-series');
    expect(openedOptions).toEqual({ editScope: 'allEvents' });

    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('All events in the series')).not.toBeInTheDocument();
    expect(screen.queryByText(/this event is part of a series/i)).not.toBeInTheDocument();
  });

  it('R-13b: View Details on a non-recurring reservation opens the modal directly with no editScope option', async () => {
    const nonRecurring = {
      ...seriesMasterEvent,
      _id: 'evt-rr-single',
      eventId: 'evt-rr-single',
      eventType: 'singleInstance',
      eventTitle: 'Approval Queue Single Event',
      recurrence: undefined,
    };
    mountWithEvents([nonRecurring]);
    render(<ReservationRequests />);

    await waitFor(() => {
      expect(screen.getByText('Approval Queue Single Event')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    await waitFor(() => {
      expect(openModalSpy).toHaveBeenCalledTimes(1);
    });
    const [, openedOptions] = openModalSpy.mock.calls[0];
    expect(openedOptions).toBeUndefined();
  });
});

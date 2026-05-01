// src/__tests__/unit/components/EventManagement.recurrenceParity.test.jsx
//
// R-14 (entry-point parity): EventManagement must present the same
// RecurringScopeDialog as Calendar when the user clicks View Details on a
// recurring series master in the admin browse view. EventManagement was
// the most-divergent entry point — its em-details-modal bypassed
// EventReviewExperience entirely, so the restore-via-Recurrence-tab UI was
// previously unreachable from there.

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
  useAuth: () => ({ apiToken: 'test-token', user: { name: 'Admin', email: 'admin@test.com' } }),
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
    isAdmin: true,
    canApproveReservations: true,
    canEditEvents: true,
    canDeleteEvents: true,
    permissionsLoading: false,
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
vi.mock('../../../components/shared/ConflictDialog', () => ({ default: () => null }));
vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input data-testid='date-picker-input' value={value || ''} onChange={onChange || vi.fn()} placeholder={placeholder} readOnly />
  ),
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
  }),
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

const seriesMasterEvent = {
  _id: 'evt-em-series',
  eventId: 'evt-em-series',
  eventType: 'seriesMaster',
  status: 'published',
  calendarData: {
    eventTitle: 'Admin Browse Yoga Series',
    startDate: '2026-04-06',
    startTime: '09:00',
    endDate: '2026-04-06',
    endTime: '10:00',
    locations: [],
    locationDisplayNames: [],
  },
  recurrence: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
    range: { type: 'endDate', startDate: '2026-04-06', endDate: '2026-06-29' },
    additions: [],
    exclusions: [],
  },
  roomReservationData: { requestedBy: { name: 'Requester', email: 'r@test.com' } },
  submittedAt: '2026-04-15T10:00:00Z',
  lastModifiedDateTime: '2026-04-15T10:00:00Z',
};

function mountWithEvents(events) {
  currentAuthFetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/events/list/counts')) {
      return Promise.resolve({ ok: true, json: async () => ({ total: events.length, published: 1, pending: 0, rejected: 0, deleted: 0, draft: 0 }) });
    }
    if (url.includes('/events/list')) {
      return Promise.resolve({ ok: true, json: async () => ({ events, total: events.length, totalPages: 1 }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

import EventManagement from '../../../components/EventManagement';

describe('EventManagement recurrence-parity (R-14)', () => {
  beforeEach(() => {
    currentAuthFetch = vi.fn();
    openModalSpy.mockReset();
  });

  it('R-14: View Details on a seriesMaster opens the RecurringScopeDialog (NOT the em-details-modal)', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<EventManagement />);

    await waitFor(() => {
      expect(screen.getByText('Admin Browse Yoga Series')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view details/i }));

    // Dialog appears (Continue button), em-details-modal does NOT (no "Event Details" h2)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    });
    expect(screen.queryByText('Event Details')).toBeNull();
    // openModal not called yet — happens only after Continue click
    expect(openModalSpy).not.toHaveBeenCalled();
  });
});

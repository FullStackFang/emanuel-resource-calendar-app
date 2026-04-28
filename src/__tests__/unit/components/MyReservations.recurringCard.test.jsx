// src/__tests__/unit/components/MyReservations.recurringCard.test.jsx
//
// Verifies the recurring-series aggregation UI on My Reservations cards:
//   - Series-master cards show a recurrence pattern pill and (when there are
//     deviations) an override-count chip with chevron.
//   - Clicking the chip toggles a collapsible list of modified / cancelled /
//     added occurrences.
//   - Singleton (non-master) cards render none of the above.
//   - The "When" line on a series master shows the series range, not the
//     first-occurrence date.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

// ─── Module-level mocks ──────────────────────────────────────────────────────

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

// transformEventsToFlatStructure: pass-through (test fixtures are already flat)
vi.mock('../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

// Module-level openModal spy so individual tests can assert on it after
// clicking a popover row. Reset in beforeEach.
//
// useEventReviewExperience returns useReviewModal's values via a spread
// (...reviewModal), so all modal fields (openModal, isOpen, currentItem, ...)
// are top-level on the returned object — NOT nested under a `reviewModal` key.
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
  eventTitle: 'Singleton Bingo Night',
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
    additions: ['2026-05-30'],
    exclusions: ['2026-05-25'],
  },
  occurrenceOverrides: [
    { occurrenceDate: '2026-04-20', startTime: '09:30', endTime: '10:30' },
    { occurrenceDate: '2026-05-30', startTime: '11:00' }, // matches additions[]
  ],
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

describe('MyReservations recurring-series card', () => {
  beforeEach(() => {
    currentAuthFetch = vi.fn();
    openModalSpy.mockReset();
  });

  it('renders no recurrence pill or exceptions section for a singleInstance event', async () => {
    mountWithEvents([singleEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Singleton Bingo Night')).toBeInTheDocument();
    });

    expect(document.querySelector('.mr-recurrence-pill')).toBeNull();
    expect(document.querySelector('.exceptions-section')).toBeNull();
    expect(document.querySelector('.exceptions-table')).toBeNull();
  });

  it('renders pattern pill, exceptions header, and series range for a seriesMaster with mixed deviations', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Weekly Yoga')).toBeInTheDocument();
    });

    // Pattern pill — text shape is "Weekly on Mondays, 4/6/2026 – 6/29/2026"
    // (formatRecurrenceSummaryCompact uses numeric date format).
    const pill = document.querySelector('.mr-recurrence-pill');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toMatch(/Weekly on Mondays/);
    expect(pill.textContent).toMatch(/4\/6\/2026/);
    expect(pill.textContent).toMatch(/6\/29\/2026/);

    // Typographic header inside the master card naming the relationship
    // and showing the count of deviations.
    const title = document.querySelector('.exceptions-title');
    const count = document.querySelector('.exceptions-count');
    expect(title).not.toBeNull();
    expect(count).not.toBeNull();
    expect(title.textContent).toMatch(/Recurrence Exceptions/);
    expect(count.textContent).toBe('3');

    // Series range replaces the per-occurrence "When" line on a master.
    // The card shows "Apr 6, 2026 – Jun 29, 2026" instead of "Mon, Apr 6 · 9:00 AM…"
    const dateNodes = document.querySelectorAll('.mr-date');
    expect(dateNodes.length).toBeGreaterThan(0);
    const masterWhen = dateNodes[0].textContent;
    expect(masterWhen).toMatch(/Apr 6, 2026/);
    expect(masterWhen).toMatch(/Jun 29, 2026/);
    expect(masterWhen).not.toMatch(/Mon,/);
  });

  it('renders the exceptions table always-visible (no toggle), with rows in date order and correct kind classes', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    // Exceptions table is visible immediately on first paint — no chip click required.
    const table = await waitFor(() => {
      const t = document.querySelector('.exceptions-table');
      if (!t) throw new Error('exceptions table not yet rendered');
      return t;
    });

    const rows = table.querySelectorAll('.exceptions-row');
    // 1 modified + 1 cancelled + 1 added
    expect(rows).toHaveLength(3);

    // Sorted by occurrenceDate ascending — Apr 20 (modified), May 25 (cancelled), May 30 (added)
    expect(rows[0].classList.contains('modified')).toBe(true);
    expect(rows[0].textContent).toMatch(/Apr 20/);
    expect(rows[0].textContent).toMatch(/Time changed/);

    expect(rows[1].classList.contains('cancelled')).toBe(true);
    expect(rows[1].textContent).toMatch(/May 25/);
    expect(rows[1].textContent).toMatch(/Cancelled/);

    expect(rows[2].classList.contains('added')).toBe(true);
    expect(rows[2].textContent).toMatch(/May 30/);
    expect(rows[2].textContent).toMatch(/Added occurrence/);
  });

  it('clicking a modified row opens the review modal with a virtual occurrence and editScope thisEvent', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      if (!document.querySelector('.exceptions-table')) throw new Error('exceptions table not yet rendered');
    });

    const modifiedRow = document.querySelector('.exceptions-row.modified');
    expect(modifiedRow).not.toBeNull();
    // Non-cancelled rows expose role="button" so they're keyboard-focusable.
    expect(modifiedRow.getAttribute('role')).toBe('button');
    expect(modifiedRow.getAttribute('tabindex')).toBe('0');

    fireEvent.click(modifiedRow);

    expect(openModalSpy).toHaveBeenCalledTimes(1);
    const [item, options] = openModalSpy.mock.calls[0];
    expect(item).toMatchObject({
      isRecurringOccurrence: true,
      hasOccurrenceOverride: true,
      eventType: 'occurrence',
      occurrenceDate: '2026-04-20',
      masterEventId: 'evt-series',
      seriesMasterEventId: 'evt-series',
      // Override values applied on top of master
      startTime: '09:30',
      endTime: '10:30',
    });
    expect(item.startDateTime).toBe('2026-04-20T09:30:00');
    expect(options).toEqual({ editScope: 'thisEvent' });
  });

  it('clicking an added row opens the modal with isAdHocAddition flagged', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      if (!document.querySelector('.exceptions-table')) throw new Error('exceptions table not yet rendered');
    });

    const addedRow = document.querySelector('.exceptions-row.added');
    expect(addedRow).not.toBeNull();
    fireEvent.click(addedRow);

    expect(openModalSpy).toHaveBeenCalledTimes(1);
    const [item, options] = openModalSpy.mock.calls[0];
    expect(item).toMatchObject({
      isRecurringOccurrence: true,
      isAdHocAddition: true,
      occurrenceDate: '2026-05-30',
      // Addition's override startTime applied
      startTime: '11:00',
    });
    expect(options).toEqual({ editScope: 'thisEvent' });
  });

  it('cancelled rows are not interactive and do not open the modal', async () => {
    mountWithEvents([seriesMasterEvent]);
    render(<MyReservations />);

    await waitFor(() => {
      if (!document.querySelector('.exceptions-table')) throw new Error('exceptions table not yet rendered');
    });

    const cancelledRow = document.querySelector('.exceptions-row.cancelled');
    expect(cancelledRow).not.toBeNull();
    // Cancelled rows do not expose role/tabindex — they're inert.
    expect(cancelledRow.getAttribute('role')).toBeNull();
    expect(cancelledRow.getAttribute('tabindex')).toBeNull();

    fireEvent.click(cancelledRow);
    expect(openModalSpy).not.toHaveBeenCalled();
  });

  it('renders the pattern pill but no exceptions section for a seriesMaster with no deviations', async () => {
    const cleanMaster = {
      ...seriesMasterEvent,
      _id: 'evt-clean',
      eventId: 'evt-clean',
      eventTitle: 'Clean Series',
      occurrenceOverrides: [],
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'endDate', startDate: '2026-04-07', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
    };

    mountWithEvents([cleanMaster]);
    render(<MyReservations />);

    await waitFor(() => {
      expect(screen.getByText('Clean Series')).toBeInTheDocument();
    });

    expect(document.querySelector('.mr-recurrence-pill')).not.toBeNull();
    expect(document.querySelector('.exceptions-section')).toBeNull();
    expect(document.querySelector('.exceptions-table')).toBeNull();
  });
});

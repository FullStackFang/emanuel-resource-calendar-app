// Integration seam test: RoomReservationFormBase + the REAL
// useRecurringConflicts hook (fetch mocked at the network layer only).
// The main form-base suite mocks the hook and the hook suite runs
// standalone, so the wiring between them was previously untested — this is
// the seam where the '[Hold] Test Fang Recurrence 8/9 #1' regression
// (conflicted series reading as all-clear) would live if it is frontend.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Same heavy-child mocks as the main suite, EXCEPT useRecurringConflicts —
// the real hook must run.
vi.mock('../../../components/SchedulingAssistant', () => ({
  default: (props) => (
    <div
      data-testid="scheduling-assistant"
      data-series-present={String(!!props.series)}
      data-series-occurrences={JSON.stringify(props.series?.occurrences || [])}
      data-series-conflicting={String(props.series?.conflictingOccurrences ?? '')}
      data-series-error={props.series?.error || ''}
      data-series-loading={String(!!props.series?.loading)}
      data-series-has-data={String(!!props.series?.hasData)}
    />
  ),
}));
vi.mock('../../../components/TimePickerInput', () => ({
  default: ({ value, onChange, ...props }) => (
    <input data-testid={`time-picker-${props.name || 'unknown'}`} value={value || ''} onChange={onChange} />
  ),
}));
vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange }) => <input data-testid="date-picker-input" value={value || ''} onChange={onChange} />,
}));
vi.mock('../../../components/LocationListSelect', () => ({ default: () => null }));
vi.mock('../../../components/MultiDatePicker', () => ({ default: () => null }));
vi.mock('../../../components/OffsiteLocationModal', () => ({ default: () => null }));
vi.mock('../../../components/CategorySelectorModal', () => ({ default: () => null }));
vi.mock('../../../components/ClergySelectorModal', () => ({ default: () => null }));
vi.mock('../../../components/preview/MecEventPreviewPanel', () => ({ default: () => null }));
vi.mock('../../../components/ServicesSelectorModal', () => ({ default: () => null, ServicesContent: () => null }));
vi.mock('../../../components/shared/LoadingSpinner', () => ({ default: () => null }));
vi.mock('../../../components/shared/CalendarIcons', () => ({ RecurringIcon: () => null }));
vi.mock('../../../components/shared/ReservationMarkerAdvisory', () => ({ default: () => null }));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
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
  usePermissions: () => ({ role: 'admin', canEditEvents: true, canApproveReservations: true, isAdmin: true, canEditField: () => true }),
}));
vi.mock('../../../utils/textUtils', () => ({ extractTextFromHtml: (html) => html || '' }));
vi.mock('../../../utils/appTimeUtils', () => ({ formatTimeString: (t) => t || '' }));
// eventTransformers is REAL in this suite: INT-3 feeds an actual saved draft
// document through the actual transform, because that is the seam where the
// live bug hid (reservation-times-only drafts transform to empty event times).
vi.mock('../../../utils/timeClampUtils', () => ({
  clampEventTimesToReservation: vi.fn(),
  expandReservationToContainOperationalTimes: vi.fn(),
  clampOperationalTimesToReservation: vi.fn(),
  validateTimeOrdering: () => [],
}));
vi.mock('../../../components/RoomReservationForm.css', () => ({}));

import RoomReservationFormBase from '../../../components/RoomReservationFormBase';
import { transformEventToFlatStructure } from '../../../utils/eventTransformers';
import draftSeriesDoc from '../../__fixtures__/draft-series-repro.json';

// The real backend response shape for the reported scenario: daily series
// Aug 10-14, RS Staff meeting (published) blocking Aug 11 in the same room.
const BLOCKED_RESPONSE = {
  totalOccurrences: 5,
  conflictingOccurrences: 1,
  cleanOccurrences: 4,
  conflicts: [{
    occurrenceDate: '2026-08-11',
    occurrenceStart: '2026-08-11T11:30:00',
    occurrenceEnd: '2026-08-11T12:30:00',
    hardConflicts: [{
      id: 'rs-staff',
      eventTitle: 'RS Staff meeting.',
      startDateTime: '2026-08-11T11:00:00',
      endDateTime: '2026-08-11T13:00:00',
      roomNames: ['66th St., 4th Floor Conference Room'],
      status: 'published',
      requestedBy: null,
    }],
    softConflicts: [],
  }],
  allOccurrences: [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
  ].map(d => ({ occurrenceDate: d, startDateTime: `${d}T11:30:00`, endDateTime: `${d}T12:30:00` })),
};

const initialData = {
  eventTitle: '[Hold] Test Fang Recurrence 8/9 #1',
  startDate: '2026-08-10',
  endDate: '2026-08-10',
  startTime: '11:30',
  endTime: '12:30',
  requestedRooms: ['room-66-4th'],
  recurrence: {
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: '2026-08-10', endDate: '2026-08-14' },
    exclusions: [],
    additions: [],
  },
};

describe('RoomReservationFormBase × real useRecurringConflicts (integration seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('INT-1: a conflicted series reaches the assistant as a blocked series prop', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => BLOCKED_RESPONSE }));

    render(
      <RoomReservationFormBase
        initialData={initialData}
        apiToken="tok-123"
        defaultCalendar="templeevents@emanuelnyc.org"
        showAllTabs={false}
        activeTab="details"
      />
    );

    // The editable form debounces 1200ms before fetching; wait through it.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/rooms/recurring-conflicts');
    const body = JSON.parse(opts.body);
    expect(body.startDateTime).toBe('2026-08-10T11:30:00');
    expect(body.endDateTime).toBe('2026-08-10T12:30:00');
    expect(body.roomIds).toEqual(['room-66-4th']);
    expect(body.recurrence.pattern.type).toBe('daily');
    expect(body.calendarOwner).toBe('templeevents@emanuelnyc.org');

    await waitFor(() => {
      const probe = screen.getByTestId('scheduling-assistant');
      expect(probe.getAttribute('data-series-conflicting')).toBe('1');
      expect(probe.getAttribute('data-series-has-data')).toBe('true');
      const occurrences = JSON.parse(probe.getAttribute('data-series-occurrences'));
      expect(occurrences).toHaveLength(5);
      expect(occurrences.find(o => o.date === '2026-08-11')?.state).toBe('conflicted');
    }, { timeout: 5000 });
  });

  it('INT-2: a failing conflict check surfaces as error + no data, never as a clear series', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }));

    render(
      <RoomReservationFormBase
        initialData={initialData}
        apiToken="tok-expired"
        defaultCalendar="templeevents@emanuelnyc.org"
        showAllTabs={false}
        activeTab="details"
      />
    );

    await waitFor(() => {
      const probe = screen.getByTestId('scheduling-assistant');
      expect(probe.getAttribute('data-series-error')).toBe('Unauthorized');
      expect(probe.getAttribute('data-series-has-data')).toBe('false');
    }, { timeout: 5000 });
  });

  it('INT-3: a reservation-times-only draft (real saved document) still gets its conflict check, windowed on the reservation times', async () => {
    // The live bug: this draft has calendarData.startTime/endTime = null
    // (reservation window only, 11:30-12:30) — the transform deliberately
    // leaves event times empty, and the conflict window must fall back to the
    // reservation times instead of silently never fetching.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => BLOCKED_RESPONSE }));

    const flat = transformEventToFlatStructure(draftSeriesDoc);
    expect(flat.startTime).toBe('');            // the deliberate no-leak behavior
    expect(flat.reservationStartTime).toBe('11:30');

    render(
      <RoomReservationFormBase
        initialData={flat}
        apiToken="tok-123"
        defaultCalendar="templeevents@emanuelnyc.org"
        showAllTabs={false}
        activeTab="details"
      />
    );

    // The conflicts fetch is behind the edit-mode 1200ms debounce, and this
    // fixture also triggers an immediate attachments fetch (it has an
    // eventId) — wait for the conflicts call specifically.
    await waitFor(() => {
      expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('recurring-conflicts'))).toBe(true);
    }, { timeout: 5000 });

    const conflictCall = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('recurring-conflicts'));
    expect(conflictCall).toBeTruthy();
    const body = JSON.parse(conflictCall[1].body);
    expect(body.startDateTime).toBe('2026-08-09T11:30:00');
    expect(body.endDateTime).toBe('2026-08-09T12:30:00');
    expect(body.roomIds).toEqual(['6912551f9a0bc143b144438b']);
    expect(body.recurrence?.pattern?.type).toBe('weekly');
  });
});

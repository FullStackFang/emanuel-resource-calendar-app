// useEventCreation — holiday/office-closure submit warning gate.
//
// A requester submitting a request on a warnOnReservation date must be
// interrupted by a blocking confirmation BEFORE the POST. "Submit Anyway"
// proceeds; "Cancel" returns to the form without submitting. A non-flagged date
// submits normally with no interruption.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const warnMarker = {
  _id: 'w1', type: 'officeClosed', name: 'Office Closed',
  startDate: '2026-12-24', endDate: '2026-12-26', warnOnReservation: true,
};

let mockMarkers = [warnMarker];
const authFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [{ username: 'req@temple.org', name: 'Req User' }] }),
}));
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ canCreateEvents: false, canSubmitReservation: true }),
}));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => authFetch,
}));
vi.mock('../../../hooks/useCalendarMarkersQuery', () => ({
  useCalendarMarkersQuery: () => ({ data: mockMarkers }),
}));
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../../hooks/useDataRefreshBus', () => ({
  dispatchRefresh: vi.fn(),
}));
vi.mock('../../../utils/eventPayloadBuilder', () => ({
  buildGraphFields: () => ({}),
  buildInternalFields: () => ({}),
  buildDraftPayload: () => ({}),
  buildRequesterPayload: () => ({ eventTitle: 'X' }),
}));
vi.mock('../../../utils/eventCreationDecision', () => ({
  resolveCreationPlan: () => ({}),
  collapseRecurringEndDate: () => null,
}));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import { useEventCreation } from '../../../hooks/useEventCreation';

const setup = (formData) => {
  const onSuccess = vi.fn();
  const { result } = renderHook(() =>
    useEventCreation({ apiToken: 'tok', selectedCalendarId: 'cal-1', availableCalendars: [], onSuccess })
  );
  act(() => result.current.setFormDataReady(() => formData));
  return result;
};

const requestCall = () =>
  authFetch.mock.calls.find(([url]) => typeof url === 'string' && url.endsWith('/events/request'));

describe('useEventCreation — marker submit warning', () => {
  beforeEach(() => {
    authFetch.mockClear();
    mockMarkers = [warnMarker];
  });

  it('interrupts submit with a warning on a flagged date, then submits on confirm', async () => {
    const result = setup({ startDate: '2026-12-25', eventTitle: 'Gala' });

    // First click → in-button confirm, no POST.
    await act(async () => { await result.current.handleSave(); });
    expect(result.current.pendingMarkerWarning).toBeNull();

    // Second click → blocking warning is raised, still no POST.
    await act(async () => { await result.current.handleSave(); });
    expect(result.current.pendingMarkerWarning).toBeTruthy();
    expect(result.current.pendingMarkerWarning.markers[0].name).toBe('Office Closed');
    expect(requestCall()).toBeUndefined();

    // Submit Anyway → warning clears and the request is POSTed.
    await act(async () => { await result.current.confirmMarkerWarning(); });
    expect(result.current.pendingMarkerWarning).toBeNull();
    expect(requestCall()).toBeTruthy();
  });

  it('cancel dismisses the warning without submitting', async () => {
    const result = setup({ startDate: '2026-12-25', eventTitle: 'Gala' });

    await act(async () => { await result.current.handleSave(); });
    await act(async () => { await result.current.handleSave(); });
    expect(result.current.pendingMarkerWarning).toBeTruthy();

    await act(async () => { result.current.cancelMarkerWarning(); });
    expect(result.current.pendingMarkerWarning).toBeNull();
    expect(requestCall()).toBeUndefined();
  });

  it('submits normally with no warning when the date is not flagged', async () => {
    const result = setup({ startDate: '2026-06-01', eventTitle: 'Picnic' });

    await act(async () => { await result.current.handleSave(); });
    await act(async () => { await result.current.handleSave(); });

    expect(result.current.pendingMarkerWarning).toBeNull();
    expect(requestCall()).toBeTruthy();
  });
});

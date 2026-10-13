// useReviewModal — an edit request is anchored to the document the user
// opened (its _id), and the residual partial-failure message no longer
// promises a 're-apply' action that does not exist (ETI-F1..F2).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../hooks/useDataRefreshBus', () => ({
  dispatchRefresh: vi.fn(),
}));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const createEditRequest = vi.fn(async () => ({ editRequestId: 'edit-req-1', requestId: 'edit-req-1', _version: 1 }));
const approveEditRequestRaw = vi.fn();
vi.mock('../../../services/editRequestsApi', () => ({
  createEditRequest: (...args) => createEditRequest(...args),
  approveEditRequestRaw: (...args) => approveEditRequestRaw(...args),
  rejectEditRequest: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: false, canApproveReservations: true, canCreateEvents: true }),
}));

const mockFetch = vi.fn(async (url) => {
  if (url.includes('/version')) return jsonResponse(200, { _version: 3 });
  return jsonResponse(200, {});
});
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetch,
}));

import { useReviewModal } from '../../../hooks/useReviewModal';

// A production copy of an imported event: _id is unique, eventId is shared
// with a sandbox duplicate.
const PRODUCTION_ITEM = {
  _id: '6a016e8add9b17efe3387812',
  eventId: 'rssched--1999849151',
  status: 'published',
  eventTitle: 'Celebration of Culture',
  eventType: 'singleInstance',
  _version: 3,
};
const EDIT_REQUEST = { _id: 'er-1', _version: 1 };

describe('useReviewModal edit-request target identity', () => {
  let onError;
  beforeEach(() => {
    vi.clearAllMocks();
    onError = vi.fn();
  });

  const setup = () => renderHook(() => useReviewModal({
    apiToken: 'tok', graphToken: null, onSuccess: vi.fn(), onError, onWarning: vi.fn(), selectedCalendarId: '',
  }));

  it('ETI-F1: submit sends the opened document _id as eventObjectId', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openModal(PRODUCTION_ITEM); });
    act(() => { result.current.setFormDataGetter(() => ({ eventTitle: 'Streicker: Thomas Friedman' })); });

    // two-click confirmation
    await act(async () => { await result.current.handleSubmitEditRequest(null); });
    await act(async () => { await result.current.handleSubmitEditRequest(null); });

    expect(createEditRequest).toHaveBeenCalledTimes(1);
    const payload = createEditRequest.mock.calls[0][1];
    expect(payload.eventObjectId).toBe(PRODUCTION_ITEM._id);
    expect(payload.eventId).toBe(PRODUCTION_ITEM.eventId);
  });

  it('ETI-F2: the residual partial-failure message does not promise a re-apply action', async () => {
    approveEditRequestRaw.mockResolvedValue(jsonResponse(409, {
      error: 'CONFLICT',
      partialFailure: true,
      compensationRequired: true,
      editRequestApproved: true,
      details: { code: 'VERSION_CONFLICT' },
    }));
    const { result } = setup();
    await act(async () => { await result.current.openModal(PRODUCTION_ITEM); });

    let outcome;
    await act(async () => { await result.current.handleApproveEditRequest(null, EDIT_REQUEST); });
    await act(async () => { outcome = await result.current.handleApproveEditRequest(null, EDIT_REQUEST); });

    expect(outcome.error).toBe('PARTIAL_FAILURE');
    expect(onError).toHaveBeenCalledTimes(1);
    const message = onError.mock.calls[0][0];
    expect(message).not.toMatch(/re-?apply/i);
    expect(message).not.toMatch(/concurrently/i);
    expect(message).toMatch(/approved/i);
  });
});

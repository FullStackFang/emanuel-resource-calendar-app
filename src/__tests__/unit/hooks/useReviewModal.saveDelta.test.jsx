// useReviewModal.handleSave — the save-time delta 409 surfaces the server's
// message verbatim (save-conflict-delta-gate task 7.3). handleSave already
// prefers `data.message` over its client fallback (line ~872); this locks that
// the new delta wording ("...introduces N new scheduling conflict(s)") reaches
// the onError toast rather than the generic count string. No code change was
// needed — this is the regression guard for the wording contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('../../../services/editRequestsApi', () => ({
  createEditRequest: vi.fn(),
  approveEditRequestRaw: vi.fn(),
  rejectEditRequest: vi.fn(),
}));

const mockPermissions = { isAdmin: false, canApproveReservations: true, canCreateEvents: true };
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// Route: /version → fresh (matches item._version); the bare PUT /admin/events/:id
// (the save) → the queued delta 409.
let saveResponses = [];
const mockFetch = vi.fn(async (url) => {
  if (url.includes('/version')) return jsonResponse(200, { _version: 1 });
  if (/\/admin\/events\/[^/]+$/.test(url)) {
    return saveResponses.length > 1 ? saveResponses.shift() : saveResponses[0];
  }
  return jsonResponse(200, {});
});
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetch,
}));

import { useReviewModal } from '../../../hooks/useReviewModal';

const DELTA_409 = jsonResponse(409, {
  error: 'SchedulingConflict',
  conflictTier: 'hard',
  message: 'Cannot save: this change introduces 1 new scheduling conflict(s)',
  hardConflicts: [{ id: 'c1', eventTitle: 'Introduced Neighbour' }],
  preexistingConflicts: [{ id: 'c2', eventTitle: 'Carried Neighbour' }],
  softConflicts: [],
  conflicts: [{ id: 'c1', eventTitle: 'Introduced Neighbour' }],
  deltaGate: true,
  canForce: true,
  forceField: 'forceUpdate',
  _version: 1,
});

const PENDING_ITEM = {
  _id: 'evt-1',
  status: 'pending',
  eventTitle: 'Class',
  eventType: 'singleInstance',
  _version: 1,
};

describe('useReviewModal.handleSave delta 409 wording', () => {
  let onError;
  beforeEach(() => {
    vi.clearAllMocks();
    onError = vi.fn();
    saveResponses = [];
    mockPermissions.isAdmin = false;
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = () =>
    renderHook(() => useReviewModal({
      apiToken: 'tok',
      graphToken: null,
      onSuccess: vi.fn(),
      onError,
      selectedCalendarId: '',
    }));

  it('surfaces the server delta message on a save 409', async () => {
    saveResponses = [DELTA_409];
    const { result } = setup();

    await act(async () => { await result.current.openModal(PENDING_ITEM); });
    await act(async () => { result.current.updateData({ eventTitle: 'Class edited' }); });
    // First click arms the two-step confirmation, second executes the save.
    await act(async () => { await result.current.handleSave(); });
    await act(async () => { await result.current.handleSave(); });

    expect(onError).toHaveBeenCalledWith(
      'Cannot save: this change introduces 1 new scheduling conflict(s)',
      expect.any(Array),
    );
  });
});

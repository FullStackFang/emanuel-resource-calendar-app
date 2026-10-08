// useReviewModal.handleApproveEditRequest — an approval whose Outlook sync
// partly failed still succeeds, but the approver is warned to re-save
// (edit-request-approval-graph-sync task 4.8).

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

const approveEditRequestRaw = vi.fn();
vi.mock('../../../services/editRequestsApi', () => ({
  createEditRequest: vi.fn(),
  approveEditRequestRaw: (...args) => approveEditRequestRaw(...args),
  rejectEditRequest: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: false, canApproveReservations: true, canCreateEvents: true }),
}));

const mockFetch = vi.fn(async (url) => {
  if (url.includes('/version')) return jsonResponse(200, { _version: 1 });
  return jsonResponse(200, {});
});
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetch,
}));

import { useReviewModal } from '../../../hooks/useReviewModal';

const PUBLISHED_ITEM = { _id: 'evt-1', status: 'published', eventTitle: 'Class', eventType: 'seriesMaster', _version: 1 };
const EDIT_REQUEST = { _id: 'er-1', _version: 1 };

describe('useReviewModal approval Outlook-sync warning (ERW-1..3)', () => {
  let onWarning;
  let onSuccess;
  beforeEach(() => {
    vi.clearAllMocks();
    onWarning = vi.fn();
    onSuccess = vi.fn();
  });

  const setup = () => renderHook(() => useReviewModal({
    apiToken: 'tok', graphToken: null, onSuccess, onError: vi.fn(), onWarning, selectedCalendarId: '',
  }));

  async function approveTwice(result) {
    await act(async () => { await result.current.openModal(PUBLISHED_ITEM); });
    // First click arms the in-button confirmation, second approves.
    await act(async () => { await result.current.handleApproveEditRequest(null, EDIT_REQUEST); });
    let outcome;
    await act(async () => { outcome = await result.current.handleApproveEditRequest(null, EDIT_REQUEST); });
    return outcome;
  }

  it('ERW-1: warns with the failed count when graphSync.failed is non-empty', async () => {
    approveEditRequestRaw.mockResolvedValue(jsonResponse(200, {
      success: true, graphSync: { synced: [], failed: [{ kind: 'master' }, { kind: 'exclusion' }], cancelledExclusions: [] },
    }));
    const { result } = setup();

    const outcome = await approveTwice(result);

    expect(outcome.success).toBe(true);
    expect(onWarning).toHaveBeenCalledWith('Approved. Outlook update failed for 2 item(s); re-save to retry.');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('ERW-2: no warning when every item synced', async () => {
    approveEditRequestRaw.mockResolvedValue(jsonResponse(200, {
      success: true, graphSync: { synced: [{ kind: 'master' }], failed: [], cancelledExclusions: [] },
    }));
    const { result } = setup();

    await approveTwice(result);

    expect(onWarning).not.toHaveBeenCalled();
  });

  it('ERW-3: no warning when the response predates graphSync', async () => {
    approveEditRequestRaw.mockResolvedValue(jsonResponse(200, { success: true }));
    const { result } = setup();

    await approveTwice(result);

    expect(onWarning).not.toHaveBeenCalled();
  });
});

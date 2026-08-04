// useReviewModal — admin force-publish affordance (revives the dead canForce
// path). After a hard-conflict 409 with { canForce, forceField }, an ADMIN's
// Publish button arms into 'Publish Anyway?' (isApproveForceConfirming) and
// the next handleApprove call resends with [forceField]: true, skipping the
// normal two-step confirmation (the armed state IS the confirmation).
// Non-admin approvers never arm — they get the blocking toast only, matching
// the backend 403 and the draft-path policy.

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

// Mutable permissions so tests flip admin vs approver
const mockPermissions = {
  isAdmin: true,
  canCreateEvents: true,
  canSubmitReservation: true,
};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

// Route-based fetch: /version returns fresh, /publish shifts a response queue
let publishResponses = [];
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const mockFetch = vi.fn(async (url) => {
  if (url.includes('/version')) return jsonResponse(200, { _version: 1 });
  if (url.includes('/publish')) {
    return publishResponses.length > 1 ? publishResponses.shift() : publishResponses[0];
  }
  return jsonResponse(200, {});
});
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetch,
}));

import { useReviewModal } from '../../../hooks/useReviewModal';

const HARD_409 = jsonResponse(409, {
  error: 'SchedulingConflict',
  conflictTier: 'hard',
  message: 'Cannot publish: 2 of 12 occurrence(s) have scheduling conflicts',
  recurringConflicts: { totalOccurrences: 12, conflictingOccurrences: 2, conflicts: [] },
  hardConflicts: [{ id: 'c1', eventTitle: 'Existing', occurrenceDate: '2026-03-17' }],
  softConflicts: [],
  conflicts: [{ id: 'c1', eventTitle: 'Existing', occurrenceDate: '2026-03-17' }],
  canForce: true,
  forceField: 'forcePublish',
  _version: 1,
});

const PENDING_ITEM = {
  _id: 'evt-1',
  status: 'pending',
  eventTitle: 'Weekly Class',
  eventType: 'singleInstance',
  _version: 1,
};

const publishCalls = () =>
  mockFetch.mock.calls.filter(([url]) => url.includes('/publish'));

async function openAndApproveTwice(result) {
  await act(async () => { await result.current.openModal(PENDING_ITEM); });
  // First click: two-step confirmation
  await act(async () => { await result.current.handleApprove(); });
  // Second click: real request, hits the mocked 409
  let outcome;
  await act(async () => { outcome = await result.current.handleApprove(); });
  return outcome;
}

describe('useReviewModal force-publish affordance', () => {
  let onError;

  beforeEach(() => {
    vi.clearAllMocks();
    onError = vi.fn();
    publishResponses = [];
    mockPermissions.isAdmin = true;
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

  it('FP-1: admin arms into the force-confirm state after a hard 409 with canForce', async () => {
    publishResponses = [HARD_409];
    const { result } = setup();

    const outcome = await openAndApproveTwice(result);

    expect(outcome.success).toBe(false);
    expect(outcome.canForce).toBe(true);
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(true);
    // Toast carries the server message (occurrence counts), not a client paraphrase
    expect(onError).toHaveBeenCalledWith(
      'Cannot publish: 2 of 12 occurrence(s) have scheduling conflicts',
      expect.any(Array)
    );
  });

  it('FP-2: the armed click resends the approve request with forcePublish: true', async () => {
    publishResponses = [HARD_409, jsonResponse(200, { success: true, _version: 2 })];
    const { result } = setup();

    await openAndApproveTwice(result);
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(true);

    // Armed click: no extra two-step confirmation, resends with the force field
    await act(async () => { await result.current.handleApprove(); });

    const calls = publishCalls();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0][1].body).forcePublish).toBe(false);
    expect(JSON.parse(calls[1][1].body).forcePublish).toBe(true);
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(false);
  });

  it('FP-3: a non-admin approver never arms — toast only, next click is a fresh confirm cycle', async () => {
    mockPermissions.isAdmin = false;
    publishResponses = [HARD_409];
    const { result } = setup();

    const outcome = await openAndApproveTwice(result);

    expect(outcome.success).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(false);

    // Next click re-enters the normal two-step confirmation, no force resend
    let third;
    await act(async () => { third = await result.current.handleApprove(); });
    expect(third.needsConfirmation).toBe(true);
    expect(publishCalls()).toHaveLength(1);
  });

  it('FP-4: the armed state persists until acted on, and cancel clears it', async () => {
    publishResponses = [HARD_409];
    const { result, rerender } = setup();

    await openAndApproveTwice(result);
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(true);

    // No auto-reset: still armed across re-renders
    rerender();
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(true);

    // The cancel affordance disarms without any request
    act(() => { result.current.getReviewModalProps().onCancelApprove(); });
    expect(result.current.getReviewModalProps().isApproveForceConfirming).toBe(false);
    expect(publishCalls()).toHaveLength(1);
  });
});

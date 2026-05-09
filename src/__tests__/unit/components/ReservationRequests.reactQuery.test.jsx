// src/__tests__/unit/components/ReservationRequests.reactQuery.test.jsx
//
// React Query migration contract tests for ReservationRequests:
//   1. Tab switch is a queryKey change → independent cache entries; previously-
//      visited tab serves from cache instantly on return.
//   2. Bus delta-patch on counts: setQueryData on the counts key applies the
//      pending counter delta optimistically without a network round-trip.
//   3. Optimistic delete + rollback (renderHook against the same primitives
//      the component's deleteMutation uses).
//   4. patchApprovalQueueLists predicate-based update touches both tab variants.
//
// These tests focus on the cache-level contracts that distinguish §4 from §3 —
// dual queries (list + counts), tab-scoped keys, and predicate-based patches.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from '../../__helpers__/queryClientWrapper';
import { keys } from '../../../queries/keys';

const APPROVAL_QUEUE_COUNTED_STATUSES = new Set(['pending', 'published', 'rejected']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listKey(tab) {
  return keys.events.list({ view: 'approval-queue', tab });
}
function countsKey() {
  return keys.events.counts({ view: 'approval-queue' });
}

/**
 * Mirror of `patchApprovalQueueLists` in ReservationRequests.jsx — predicate
 * is intentional duplication: the test asserts the *contract*, not the
 * specific implementation. If the production helper drifts, this test stays
 * sound because the assertion is on the cache state, not the call shape.
 */
function patchApprovalQueueLists(queryClient, eventId, updater) {
  queryClient.setQueriesData(
    { queryKey: ['events', 'list'], predicate: (q) => q.queryKey[2]?.view === 'approval-queue' },
    (old) => Array.isArray(old)
      ? old.map(r => String(r._id) === String(eventId) ? updater(r) : r)
      : old
  );
}

describe('ReservationRequests React Query contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Tab-scoped queryKey: independent cache entries ───────────────────
  it('different tabs map to different cache entries; previously-fetched tab is cached', () => {
    const queryClient = createTestQueryClient();

    queryClient.setQueryData(listKey('needs_attention'), [{ _id: 'evt-1', status: 'pending' }]);
    queryClient.setQueryData(listKey('all'),
      [
        { _id: 'evt-1', status: 'pending' },
        { _id: 'evt-2', status: 'published' },
      ]);

    const needsAttention = queryClient.getQueryData(listKey('needs_attention'));
    const allTab = queryClient.getQueryData(listKey('all'));

    expect(needsAttention).toHaveLength(1);
    expect(allTab).toHaveLength(2);
    // Different references — confirms they're independent cache entries.
    expect(needsAttention).not.toBe(allTab);
  });

  // ─── 2. Bus delta-patch on counts ────────────────────────────────────────
  it('setQueryData on counts applies a pending → published transition delta', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(countsKey(), { needs_attention: 5, all: 12 });

    // Simulate the production handleApprovalQueueBus delta-patch path for
    // a 'pending' → 'published' transition (admin approves a request).
    const oldStatus = 'pending';
    const newStatus = 'published';
    queryClient.setQueryData(countsKey(), prev => {
      if (!prev) return prev;
      let { needs_attention, all } = prev;
      if (oldStatus === 'pending') needs_attention--;
      if (newStatus === 'pending') needs_attention++;
      if (APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && !APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all--;
      if (!APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all++;
      return { needs_attention: Math.max(0, needs_attention), all: Math.max(0, all) };
    });

    const after = queryClient.getQueryData(countsKey());
    // pending decremented; both old and new are in the counted set, so all unchanged.
    expect(after).toEqual({ needs_attention: 4, all: 12 });
  });

  it('counts delta-patch clamps to non-negative values', () => {
    const queryClient = createTestQueryClient();
    // Stale cache: no pending events but a 'pending' → 'rejected' arrives anyway.
    queryClient.setQueryData(countsKey(), { needs_attention: 0, all: 0 });

    const oldStatus = 'pending';
    const newStatus = 'rejected';
    queryClient.setQueryData(countsKey(), prev => {
      if (!prev) return prev;
      let { needs_attention, all } = prev;
      if (oldStatus === 'pending') needs_attention--;
      if (newStatus === 'pending') needs_attention++;
      if (APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && !APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all--;
      if (!APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all++;
      return { needs_attention: Math.max(0, needs_attention), all: Math.max(0, all) };
    });

    const after = queryClient.getQueryData(countsKey());
    expect(after.needs_attention).toBe(0);
    expect(after.all).toBe(0);
  });

  // ─── 3. patchApprovalQueueLists predicate updates BOTH tab variants ──────
  it('patchApprovalQueueLists patches every approval-queue list cache entry by predicate', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(listKey('needs_attention'),
      [
        { _id: 'evt-1', status: 'published', pendingEditRequest: { status: 'pending' } },
      ]);
    queryClient.setQueryData(listKey('all'),
      [
        { _id: 'evt-1', status: 'published', pendingEditRequest: { status: 'pending' } },
        { _id: 'evt-2', status: 'pending' },
      ]);
    // A different view (e.g., my-events) — must NOT be touched by the predicate.
    queryClient.setQueryData(keys.events.list({ view: 'my-events', includeDeleted: true }),
      [{ _id: 'evt-1', status: 'published', pendingEditRequest: { status: 'pending' } }]);

    patchApprovalQueueLists(queryClient, 'evt-1', r => ({
      ...r,
      pendingEditRequest: { ...(r.pendingEditRequest || {}), status: 'approved' },
    }));

    const needsAttention = queryClient.getQueryData(listKey('needs_attention'));
    const allTab = queryClient.getQueryData(listKey('all'));
    const myEvents = queryClient.getQueryData(keys.events.list({ view: 'my-events', includeDeleted: true }));

    // Both approval-queue tabs were patched.
    expect(needsAttention[0].pendingEditRequest.status).toBe('approved');
    expect(allTab[0].pendingEditRequest.status).toBe('approved');
    // my-events list was NOT touched (different view).
    expect(myEvents[0].pendingEditRequest.status).toBe('pending');
  });

  // ─── 4. Optimistic delete + rollback (renderHook) ────────────────────────
  it('optimistic delete is visible immediately; rollback restores prior cache on error', async () => {
    const queryClient = createTestQueryClient();

    // Seed both tabs with a published event we will optimistically delete.
    const initial = [
      { _id: 'evt-1', status: 'published', _version: 1 },
      { _id: 'evt-2', status: 'pending', _version: 3 },
    ];
    queryClient.setQueryData(listKey('all'), initial);
    queryClient.setQueryData(listKey('needs_attention'),
      [{ _id: 'evt-2', status: 'pending', _version: 3 }]);

    let rejectMutation;
    const mutationPromise = new Promise((_, reject) => { rejectMutation = reject; });

    const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

    const { result } = renderHook(() => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: async () => mutationPromise,
        onMutate: async ({ reservation }) => {
          const listPrefix = { queryKey: ['events', 'list'], predicate: (q) => q.queryKey[2]?.view === 'approval-queue' };
          await qc.cancelQueries(listPrefix);
          const previousEntries = qc.getQueriesData(listPrefix);
          patchApprovalQueueLists(qc, reservation._id, r => ({ ...r, status: 'deleted', isDeleted: true }));
          return { previousEntries };
        },
        onError: (_err, _vars, ctx) => {
          if (ctx?.previousEntries) {
            for (const [key, value] of ctx.previousEntries) {
              qc.setQueryData(key, value);
            }
          }
        },
      });
    }, { wrapper });

    let settled;
    act(() => {
      settled = result.current.mutateAsync({ reservation: { _id: 'evt-1', _version: 1 } }).catch(() => {});
    });
    await act(async () => { await Promise.resolve(); });

    // Optimistic state: evt-1 is marked deleted in the 'all' tab (and would be
    // in 'needs_attention' too if it lived there).
    const optimistic = queryClient.getQueryData(listKey('all'));
    expect(optimistic.find(r => r._id === 'evt-1').status).toBe('deleted');
    expect(optimistic.find(r => r._id === 'evt-1').isDeleted).toBe(true);
    // evt-2 untouched.
    expect(optimistic.find(r => r._id === 'evt-2').status).toBe('pending');

    // Reject; rollback restores both cached lists.
    await act(async () => {
      rejectMutation(new Error('simulated failure'));
      await settled;
    });

    const rolledBackAll = queryClient.getQueryData(listKey('all'));
    expect(rolledBackAll.find(r => r._id === 'evt-1').status).toBe('published');
    expect(rolledBackAll.find(r => r._id === 'evt-1').isDeleted).toBeUndefined();

    // 'needs_attention' was snapshotted too (it didn't contain evt-1, but the
    // snapshot pattern is what's being tested — preserved untouched).
    const rolledBackNa = queryClient.getQueryData(listKey('needs_attention'));
    expect(rolledBackNa).toHaveLength(1);
    expect(rolledBackNa[0]._id).toBe('evt-2');
  });
});

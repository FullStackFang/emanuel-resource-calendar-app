// useSchedulingSheets — the optimistic cell write.
//
// The bug this locks: the in-cell editor closes the instant it commits, so a
// cell painted only from the server response goes BLANK for the length of the
// round trip. Every entry flashed. Cell writes are ungated last-write-wins per
// cell (backend design D2), so the local paint cannot disagree with a version
// the server would have refused — which is what makes patching the cache the
// honest fix rather than a hopeful one.
//
// Test IDs: OCW-*

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

let authFetch;
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => authFetch,
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'token' }),
}));

import { useSchedulingSheetMutations } from '../../../hooks/useSchedulingSheets';
import { keys } from '../../../queries/keys';

const SHEET_ID = 's1';
const PERSON = { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null };
const CELL = { segments: [PERSON], note: null };

const loadedSheet = () => ({
  _id: SHEET_ID,
  name: '2026 High Holy Days',
  days: [{ _id: 'd1', date: '2026-09-11', _version: 3, cells: {}, taggedEmails: [] }],
});

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** A fetch whose response this test resolves by hand, so the in-flight window is observable. */
function deferredFetch() {
  let settle;
  const fetchImpl = vi.fn(() => new Promise((resolve, reject) => { settle = { resolve, reject }; }));
  return { fetchImpl, ok: () => settle.resolve({ ok: true, json: async () => ({ ok: true }) }), fail: () => settle.reject(new Error('offline')) };
}

const cellsInCache = () =>
  queryClient.getQueryData(keys.schedulingSheets.detail(SHEET_ID)).days[0].cells;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(keys.schedulingSheets.detail(SHEET_ID), loadedSheet());
});

describe('useSchedulingSheetMutations — optimistic cell writes', () => {
  it('OCW-1: the cell is in the cache while the request is still in flight', async () => {
    const deferred = deferredFetch();
    authFetch = deferred.fetchImpl;
    const { result } = renderHook(() => useSchedulingSheetMutations(SHEET_ID), { wrapper });

    act(() => {
      result.current.updateCell.mutate({ dayId: 'd1', rowId: 'rUshers', colId: 'c1', cell: CELL });
    });

    // The whole point: no blank frame. The person is on screen before the
    // server has said anything at all.
    await waitFor(() => expect(cellsInCache()['rUshers:c1']).toEqual(CELL));
    expect(deferred.fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => { deferred.ok(); });
    // Still there after the round trip; the settle invalidation refetches
    // rather than blanking.
    expect(cellsInCache()['rUshers:c1']).toEqual(CELL);
  });

  it('OCW-2: a failed write rolls the cache back instead of leaving a phantom assignment', async () => {
    const deferred = deferredFetch();
    authFetch = deferred.fetchImpl;
    const { result } = renderHook(() => useSchedulingSheetMutations(SHEET_ID), { wrapper });

    act(() => {
      result.current.updateCell.mutate({ dayId: 'd1', rowId: 'rUshers', colId: 'c1', cell: CELL });
    });
    await waitFor(() => expect(cellsInCache()['rUshers:c1']).toEqual(CELL));

    await act(async () => { deferred.fail(); });

    await waitFor(() => expect(cellsInCache()['rUshers:c1']).toBeUndefined());
  });

  it('OCW-3: the patch is scoped to the one cell, so a second edit does not undo the first', async () => {
    authFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const { result } = renderHook(() => useSchedulingSheetMutations(SHEET_ID), { wrapper });

    await act(async () => {
      result.current.updateCell.mutate({ dayId: 'd1', rowId: 'rUshers', colId: 'c1', cell: CELL });
    });
    await act(async () => {
      result.current.updateCell.mutate({ dayId: 'd1', rowId: 'rBegins', colId: 'c1', cell: { segments: [{ type: 'text', text: '16:30' }], note: null } });
    });

    await waitFor(() => {
      expect(Object.keys(cellsInCache()).sort()).toEqual(['rBegins:c1', 'rUshers:c1']);
    });
  });
});

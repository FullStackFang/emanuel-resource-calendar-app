// src/__tests__/unit/utils/listLoadingState.test.js
//
// Locks the shared list-view loading-primitive convention (the one written in
// prose in CLAUDE.md "React Query loading primitives"). deriveListLoadingState
// is the single, tested definition that every auto-firing list view derives its
// loading/empty gating from, so the "first-paint blank flash" bug class cannot
// reopen one component at a time.
//
// The states a TanStack Query result moves through (the fields we read):
//   disabled / never fetched : { isPending: true,  isFetching: false, fetchStatus: 'idle' }
//   first load in flight     : { isPending: true,  isFetching: true,  fetchStatus: 'fetching' }
//   loaded (settled)         : { isPending: false, isFetching: false, fetchStatus: 'idle' }
//   silent background refetch: { isPending: false, isFetching: true,  fetchStatus: 'fetching' }

import { describe, it, expect } from 'vitest';
import { deriveListLoadingState } from '../../../utils/listLoadingState';

const idlePending      = { isPending: true,  isFetching: false, fetchStatus: 'idle' };
const fetchingFirst    = { isPending: true,  isFetching: true,  fetchStatus: 'fetching' };
const settled          = { isPending: false, isFetching: false, fetchStatus: 'idle' };
const silentRefetching = { isPending: false, isFetching: true,  fetchStatus: 'fetching' };

describe('deriveListLoadingState', () => {
  it('isFirstLoad is true in the pending && idle tick (the window the anti-pattern misses)', () => {
    // This is the one-tick window right after `enabled` flips true, before the
    // fetch starts. Gating on TanStack `isLoading` (= isPending && isFetching)
    // would be FALSE here and flash the empty state; isPending is true.
    const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(idlePending);
    expect(isFirstLoad).toBe(true);
    expect(isSilentRefreshing).toBe(false);
  });

  it('isFirstLoad is true while the first fetch is in flight', () => {
    expect(deriveListLoadingState(fetchingFirst).isFirstLoad).toBe(true);
  });

  it('isFirstLoad is false once the query has settled', () => {
    const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(settled);
    expect(isFirstLoad).toBe(false);
    expect(isSilentRefreshing).toBe(false);
  });

  it('isSilentRefreshing is true only during a background refetch over existing data', () => {
    const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(silentRefetching);
    expect(isFirstLoad).toBe(false);
    expect(isSilentRefreshing).toBe(true);
  });

  it('anti-pattern guard: isLoading (isPending && isFetching) disagrees with isFirstLoad on the idle tick', () => {
    // Documents WHY the convention exists. If a future refactor swaps
    // isFirstLoad for isLoading, this expectation makes the divergence explicit.
    const isLoading = idlePending.isPending && idlePending.isFetching; // = false
    expect(isLoading).toBe(false);
    expect(deriveListLoadingState(idlePending).isFirstLoad).toBe(true);
  });

  describe('enabled gate (for views that skip the fetch on some tabs/filters)', () => {
    it('defaults enabled=true so isFirstLoad tracks isPending (MyReservations / EventManagement)', () => {
      expect(deriveListLoadingState(idlePending).isFirstLoad).toBe(true);
    });

    it('enabled=false forces isFirstLoad false so the empty/prompt state can render (ReservationRequests all-tab)', () => {
      // Without this, a query that is intentionally never fetched keeps
      // isPending: true forever and would show a perpetual spinner.
      expect(deriveListLoadingState(idlePending, { enabled: false }).isFirstLoad).toBe(false);
    });

    // EventSearch usage pattern. `enabled` is a user action (the Search button),
    // not auto-fire-on-token, so its idle state is the "enter criteria" prompt.
    // The component computes `isSearching = isFirstLoad` with
    // `enabled: shouldRunSearch && !!apiToken` and gates the results pane on
    // `isSearching || isFetching`. These cases lock that fix (the old code gated
    // on `isLoading`, which is false on the idle tick and flashed
    // "No events found").
    describe('EventSearch search-button pattern', () => {
      it('no search requested → isSearching false (renders the "enter criteria" prompt, not a spinner)', () => {
        // shouldRunSearch=false → enabled=false, even though the query reports
        // isPending while disabled.
        expect(deriveListLoadingState(idlePending, { enabled: false }).isFirstLoad).toBe(false);
      });

      it('search requested, pending && idle tick → isSearching true (shows "Searching...", no empty flash)', () => {
        // The moment shouldRunSearch flips true the query is enabled but the
        // fetch has not started (isFetching false). isLoading would be false
        // here; isFirstLoad is true.
        expect(deriveListLoadingState(idlePending, { enabled: true }).isFirstLoad).toBe(true);
      });

      it('search resolved → isSearching false (results or genuine "No events found" can render)', () => {
        expect(deriveListLoadingState(settled, { enabled: true }).isFirstLoad).toBe(false);
      });
    });
  });

  describe('secondary (counts) query', () => {
    it('a silent counts refetch surfaces as isSilentRefreshing even when the list is settled', () => {
      const { isSilentRefreshing } = deriveListLoadingState(settled, { countsQuery: silentRefetching });
      expect(isSilentRefreshing).toBe(true);
    });

    it('does NOT gate isFirstLoad — only the primary list query does (behavior-preserving for EventManagement)', () => {
      // EventManagement: loading = eventsQuery.isPending, NOT counts. A pending
      // counts query must not extend the first-load spinner.
      const { isFirstLoad } = deriveListLoadingState(settled, { countsQuery: idlePending });
      expect(isFirstLoad).toBe(false);
    });
  });

  it('handles a missing/null query defensively', () => {
    expect(deriveListLoadingState(null)).toEqual({ isFirstLoad: false, isSilentRefreshing: false });
    expect(deriveListLoadingState(undefined)).toEqual({ isFirstLoad: false, isSilentRefreshing: false });
  });
});

// src/__tests__/__helpers__/mockAuthFetch.js
//
// Shared test helper for views whose loadX callbacks use AbortController.
// Provides a controllable fetch mock plus event-shape factory used by the
// race-condition tests (ReservationRequests.race, MyReservations.race).
//
// The mock honors AbortSignal: if the signal is aborted before the resolver
// fires, the promise rejects with AbortError — exactly as real fetch behaves,
// allowing the component's catch block to swallow it.

import { vi } from 'vitest';

/**
 * Returns a vi.fn() that respects AbortSignal plus helpers to resolve the
 * Nth pending call with either a list-shaped body ({ events }) or an arbitrary
 * body. Tests typically capture the index of a call by URL and resolve it on
 * demand, controlling timing across overlapping in-flight requests.
 */
export function makeControllableAuthFetch() {
  const pendingCalls = [];

  const authFetch = vi.fn().mockImplementation((_url, options = {}) => {
    const { signal } = options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      pendingCalls.push({ resolve, reject });
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });

  function resolveCall(index, events = []) {
    const entry = pendingCalls[index];
    if (!entry) throw new Error(`No pending call at index ${index}`);
    entry.resolve({ ok: true, json: async () => ({ events }) });
  }

  function resolveCallWith(index, body) {
    const entry = pendingCalls[index];
    if (!entry) throw new Error(`No pending call at index ${index}`);
    entry.resolve({ ok: true, json: async () => body });
  }

  function pendingCount() {
    return pendingCalls.length;
  }

  return { authFetch, resolveCall, resolveCallWith, pendingCount };
}

/**
 * Shape compatible with both ReservationRequests and MyReservations row
 * rendering. Tests assert on `eventTitle: 'Event N'`.
 */
export function makeEvents(count) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `evt-${i}`,
    eventId: `evt-${i}`,
    status: 'pending',
    eventTitle: `Event ${i}`,
    startDate: '2026-04-20',
    startTime: '10:00',
    endDate: '2026-04-20',
    endTime: '11:00',
    requestedRooms: [],
    locations: [],
    categories: [],
    roomReservationData: { requestedBy: { name: 'Test User', email: 'test@test.com' } },
  }));
}

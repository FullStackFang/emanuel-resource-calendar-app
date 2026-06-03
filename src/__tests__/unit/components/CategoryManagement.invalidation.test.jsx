// src/__tests__/unit/components/CategoryManagement.invalidation.test.jsx
//
// Locks Part B of the category-rename fix: after renaming a category in
// CategoryManagement, the TanStack caches that mirror category data must be
// invalidated so event-backed list views and the search filter refetch and
// show the new name (instead of staying stale until a manual reload).
//
// This drives the REAL rename UI (Edit -> change name -> Save -> Confirm Save)
// and asserts the seeded queries actually transition to isInvalidated — not a
// spy on invalidateQueries. The backend propagation itself is covered by
// backend/__tests__/integration/categoryRename.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { createTestQueryClient, withQueryClient } from '../../__helpers__/queryClientWrapper';
import { keys } from '../../../queries/keys';

// ─── Static mocks (CategoryManagement's only module deps) ────────────────────
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../hooks/usePolling', () => ({
  usePolling: vi.fn(), // disable the 5-min background refresh in tests
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

import CategoryManagement from '../../../components/CategoryManagement';

const EVENTS_LIST_KEY = keys.events.list({ view: 'admin-browse' });

describe('CategoryManagement — rename invalidates event-backed caches', () => {
  let client;
  let putCalls;

  beforeEach(() => {
    putCalls = [];
    let currentName = 'Concert';

    // Deterministic fetch: GET returns the (current) category list; PUT renames.
    global.fetch = vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();

      if (url.includes('/categories/') && method === 'PUT') {
        putCalls.push(JSON.parse(opts.body));
        currentName = JSON.parse(opts.body).name;
        return { ok: true, json: async () => ({ _id: 'c1', name: currentName }) };
      }
      if (url.endsWith('/categories') && method === 'GET') {
        return {
          ok: true,
          json: async () => [
            { _id: 'c1', name: currentName, color: '#3b6eb8', description: 'Music', displayOrder: 1, type: 'event', allowedConcurrentCategories: [] },
          ],
        };
      }
      return { ok: true, json: async () => [] };
    });

    // Seed the caches a renamed category should invalidate, as inactive entries.
    client = createTestQueryClient();
    client.setQueryData(EVENTS_LIST_KEY, [{ eventId: 'e1', calendarData: { categories: ['Concert'] } }]);
    client.setQueryData(keys.baseCategories.all(), [{ _id: 'c1', name: 'Concert' }]);
    client.setQueryData(keys.distinctEventCategories.all(), ['Concert']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates events + category caches after a successful rename', async () => {
    render(<CategoryManagement apiToken="test-token" />, { wrapper: withQueryClient(client) });

    // Card renders once the initial GET resolves.
    await screen.findByText('Concert');

    // Pre-condition: nothing invalidated yet.
    expect(client.getQueryState(EVENTS_LIST_KEY)?.isInvalidated).toBe(false);

    // Open the edit modal and rename Concert -> Live Music.
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const nameInput = await screen.findByPlaceholderText('Enter category name');
    fireEvent.change(nameInput, { target: { value: 'Live Music' } });

    // Two-click confirm: Save Changes -> Confirm Save.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm save/i }));

    // The PUT fired with the new name...
    await waitFor(() => expect(putCalls).toEqual([expect.objectContaining({ name: 'Live Music' })]));

    // ...and every event-backed / category cache is now invalidated, so the
    // list views and search filter will refetch the renamed value.
    await waitFor(() => {
      expect(client.getQueryState(EVENTS_LIST_KEY)?.isInvalidated).toBe(true);
      expect(client.getQueryState(keys.baseCategories.all())?.isInvalidated).toBe(true);
      expect(client.getQueryState(keys.distinctEventCategories.all())?.isInvalidated).toBe(true);
    });
  });
});

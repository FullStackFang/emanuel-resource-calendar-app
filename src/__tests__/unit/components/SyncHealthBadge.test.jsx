// Sync Health scheduled-run surfaces (edit-request-approval-graph-sync 6.4):
// the nav badge counts only actionable categories, and the report shows the
// last automatic run (SHB-1..4).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({ usePermissions: () => mockPermissions }));
vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ apiToken: 'tok' }) }));
vi.mock('../../../config/config', () => ({ default: { API_BASE_URL: 'http://localhost:3001/api' } }));
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

let latest = null;
const respond = (url) => {
  if (String(url).includes('/sync-health/latest')) {
    return Promise.resolve({ ok: true, json: async () => ({ latest }) });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => (url) => respond(url),
}));

import Navigation from '../../../components/Navigation';
import SyncHealthReport from '../../../components/SyncHealthReport';

const withQuery = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

const approver = {
  canViewCalendar: true, canSubmitReservation: true, canApproveReservations: true,
  canManageUsers: false, canManageCalendarMarkers: false, isAdmin: false,
};

describe('Sync Health scheduled-run surfaces (SHB-1..4)', () => {
  beforeEach(() => {
    mockPermissions = { ...approver };
    global.fetch = vi.fn().mockImplementation(respond);
  });

  it('SHB-1: the badge sums missing + should-not-be + failed deletion only', async () => {
    latest = { counts: { missingFromOutlook: 1, shouldNotBeInOutlook: 2, untracked: 40, untethered: 3, failedDeletion: 0 } };
    withQuery(<Navigation />);
    expect(await screen.findByTestId('sync-health-badge')).toHaveTextContent('3');
  });

  it('SHB-2: no badge when only chronic categories are non-zero', async () => {
    latest = { counts: { missingFromOutlook: 0, shouldNotBeInOutlook: 0, untracked: 40, untethered: 0, failedDeletion: 0 } };
    withQuery(<Navigation />);
    // Let the query resolve before asserting absence.
    await waitFor(() => expect(screen.getByRole('link', { name: /Sync Health/ })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('sync-health-badge')).not.toBeInTheDocument();
  });

  it('SHB-3: the report shows the last automatic run and an error line', async () => {
    latest = {
      ranAt: '2026-10-08T12:01:00.000Z', error: true,
      errorAt: '2026-10-08T18:01:00.000Z', errorMessage: 'Graph down',
      counts: { shouldNotBeInOutlook: 1 },
    };
    withQuery(<SyncHealthReport apiToken="tok" />);
    expect(await screen.findByText(/Last automatic run:/)).toHaveTextContent(new Date(latest.ranAt).toLocaleString());
    expect(screen.getByRole('alert')).toHaveTextContent(/last automatic run failed.*Graph down/i);
  });

  it('SHB-4: the report says so when nothing has run yet', async () => {
    latest = null;
    withQuery(<SyncHealthReport apiToken="tok" />);
    expect(await screen.findByText('No automatic run yet')).toBeInTheDocument();
  });
});

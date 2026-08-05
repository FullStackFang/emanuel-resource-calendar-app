// src/__tests__/unit/components/ConflictReport.route.test.jsx
//
// Route guard + navigation IA for the room conflict report.
//
// The guard predicate is shared with the sync health report via
// RequireApproverReport rather than duplicated — two copies of "admin or
// approver" would have to be kept in sync by hand, and the failure mode of
// them disagreeing is a report that is reachable by the wrong audience.
//
// The guard is a UX redirect only; GET /api/admin/reports/conflicts enforces
// the same rule server-side and is authoritative. CRR-3 asserts that a
// non-approver never even mounts the component.
//
// Test IDs: CRR-1 to CRR-5

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: null }),
}));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

let mockEffectivePermissions = {};
vi.mock('../../../context/RoleSimulationContext', () => ({
  useRoleSimulation: () => ({ effectivePermissions: mockEffectivePermissions }),
  useRoleSimulationSafe: () => ({ effectivePermissions: mockEffectivePermissions }),
}));

import { useRoleSimulation } from '../../../context/RoleSimulationContext';
import Navigation from '../../../components/Navigation';

// A local copy of App.jsx's RequireApproverReport predicate. Importing App.jsx
// would drag in MSAL, SSE, and the whole lazy route table. CRR-6 closes the gap
// this copy leaves open by asserting against App.jsx's source that both report
// routes really do share one guard.
function RequireApproverReport({ children }) {
  const { effectivePermissions } = useRoleSimulation();
  if (!effectivePermissions.isAdmin && !effectivePermissions.canApproveReservations) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function renderGuardedRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin/reports/conflicts']}>
      <Routes>
        <Route path="/" element={<div data-testid="home" />} />
        <Route
          path="/admin/reports/conflicts"
          element={
            <RequireApproverReport>
              <div data-testid="conflict-report-route" />
            </RequireApproverReport>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const baseViewer = {
  canViewCalendar: true,
  canSubmitReservation: false,
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  isAdmin: false,
};

beforeEach(() => {
  mockPermissions = { ...baseViewer };
  mockEffectivePermissions = { isAdmin: false, canApproveReservations: false };
});

describe('ConflictReport route guard', () => {
  it('CRR-1: an approver reaches the report', () => {
    mockEffectivePermissions = { isAdmin: false, canApproveReservations: true };
    renderGuardedRoute();
    expect(screen.getByTestId('conflict-report-route')).toBeInTheDocument();
  });

  it('CRR-2: an administrator reaches the report', () => {
    mockEffectivePermissions = { isAdmin: true, canApproveReservations: false };
    renderGuardedRoute();
    expect(screen.getByTestId('conflict-report-route')).toBeInTheDocument();
  });

  it('CRR-3: a user with neither permission is redirected away', () => {
    mockEffectivePermissions = { isAdmin: false, canApproveReservations: false };
    renderGuardedRoute();
    expect(screen.queryByTestId('conflict-report-route')).not.toBeInTheDocument();
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
});

describe('ConflictReport navigation entry', () => {
  it('CRR-4: an approver who is not an admin gets a top-level entry', () => {
    mockPermissions = { ...baseViewer, canApproveReservations: true };
    render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /Room Conflicts/ });
    expect(link.getAttribute('href')).toBe('/admin/reports/conflicts');
    // Same treatment as Sync Health — the two reports share an audience.
    expect(screen.getByRole('link', { name: /Sync Health/ })).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('CRR-5: a plain requester gets no entry at all', () => {
    mockPermissions = { ...baseViewer, canSubmitReservation: true };
    render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /Room Conflicts/ })).not.toBeInTheDocument();
  });
});

describe('ConflictReport guard is shared, not duplicated', () => {
  it('CRR-6: both report routes are wrapped by the same guard in App.jsx', async () => {
    // Structural, because the predicate copy above cannot catch someone
    // reintroducing a second guard. Two copies of "admin or approver" drifting
    // apart means one report becomes reachable by the wrong audience.
    // Vite's ?raw import, not node:fs — under jsdom `import.meta.url` is an
    // http: URL and readFileSync rejects it, and resolving from process.cwd()
    // would couple the test to where the runner was launched.
    const source = (await import('../../../App.jsx?raw')).default;

    expect(source).toContain('function RequireApproverReport');
    expect(source).not.toContain('function RequireSyncHealth');

    const guarded = [...source.matchAll(/<RequireApproverReport>/g)];
    expect(guarded.length).toBe(2);
    expect(source).toMatch(/path="\/admin\/sync-health"[^\n]*RequireApproverReport/);
    expect(source).toMatch(/path="\/admin\/reports\/conflicts"[^\n]*RequireApproverReport/);
  });
});

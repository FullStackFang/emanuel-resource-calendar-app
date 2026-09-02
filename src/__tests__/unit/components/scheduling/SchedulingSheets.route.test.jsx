// SchedulingSheets.route.test.jsx
//
// Route guard + navigation IA for the Scheduling Sheets workbook and the
// My Assignments view (task 6.1). The guard is a UX redirect only — the
// backend requireAssignmentManager gate is authoritative. /my-assignments is
// deliberately UNGUARDED: the schedule email's CTA lands any authenticated
// user there.
//
// Test IDs: SSR-1 to SSR-7

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

let mockPermissions = {};
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('../../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: null }),
}));
vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

let mockEffectivePermissions = {};
vi.mock('../../../../context/RoleSimulationContext', () => ({
  useRoleSimulation: () => ({ effectivePermissions: mockEffectivePermissions }),
  useRoleSimulationSafe: () => ({ effectivePermissions: mockEffectivePermissions }),
}));

import { useRoleSimulation } from '../../../../context/RoleSimulationContext';
import Navigation from '../../../../components/Navigation';

// Local copy of App.jsx's RequireSchedulingSheets predicate (importing App.jsx
// drags in MSAL and the whole route table). SSR-6 closes the copy-drift gap
// with a source assertion, same pattern as CRR-6.
function RequireSchedulingSheets({ children }) {
  const { effectivePermissions } = useRoleSimulation();
  if (!effectivePermissions.canManageAssignments) return <Navigate to="/" replace />;
  return children;
}

function renderGuardedRoute(initialEntry = '/admin/scheduling-sheets') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div data-testid="home" />} />
        <Route
          path="/admin/scheduling-sheets"
          element={
            <RequireSchedulingSheets>
              <div data-testid="scheduling-sheets-route" />
            </RequireSchedulingSheets>
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
  canManageAssignments: false,
  isAdmin: false,
};

beforeEach(() => {
  mockPermissions = { ...baseViewer };
  mockEffectivePermissions = { canManageAssignments: false, isAdmin: false };
});

describe('SchedulingSheets route guard', () => {
  it('SSR-1: an events-department member reaches the workbook', () => {
    mockEffectivePermissions = { canManageAssignments: true, isAdmin: false };
    renderGuardedRoute();
    expect(screen.getByTestId('scheduling-sheets-route')).toBeInTheDocument();
  });

  it('SSR-2: an administrator reaches the workbook', () => {
    mockEffectivePermissions = { canManageAssignments: true, isAdmin: true };
    renderGuardedRoute();
    expect(screen.getByTestId('scheduling-sheets-route')).toBeInTheDocument();
  });

  it('SSR-3: a non-manager is redirected away and never mounts the page', () => {
    renderGuardedRoute();
    expect(screen.queryByTestId('scheduling-sheets-route')).not.toBeInTheDocument();
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('SSR-3b: the deep-link form (?sheet&date) goes through the same guard', () => {
    mockEffectivePermissions = { canManageAssignments: true, isAdmin: false };
    renderGuardedRoute('/admin/scheduling-sheets?sheet=abc123&date=2026-09-11');
    expect(screen.getByTestId('scheduling-sheets-route')).toBeInTheDocument();
  });
});

describe('SchedulingSheets navigation entries', () => {
  it('SSR-4: an events-dept non-admin gets the top-level Scheduling Sheets link with a department tag', () => {
    mockPermissions = { ...baseViewer, canManageAssignments: true, canManageCalendarMarkers: true, department: 'events' };
    render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /Scheduling Sheets/ });
    expect(link.getAttribute('href')).toBe('/admin/scheduling-sheets');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('SSR-5: a plain requester gets My Assignments but not Scheduling Sheets', () => {
    mockPermissions = { ...baseViewer, canSubmitReservation: true };
    render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /My Assignments/ }).getAttribute('href')).toBe('/my-assignments');
    expect(screen.queryByRole('link', { name: /Scheduling Sheets/ })).not.toBeInTheDocument();
  });
});

describe('App.jsx wiring (source assertions)', () => {
  it('SSR-6: the workbook route is wrapped by RequireSchedulingSheets and reads canManageAssignments', async () => {
    const source = (await import('../../../../App.jsx?raw')).default;

    expect(source).toContain('function RequireSchedulingSheets');
    expect(source).toContain('effectivePermissions.canManageAssignments');
    expect(source).toMatch(/path="\/admin\/scheduling-sheets"[^\n]*RequireSchedulingSheets/);
  });

  it('SSR-7: /my-assignments is routed WITHOUT a guard (the email CTA lands any user there)', async () => {
    const source = (await import('../../../../App.jsx?raw')).default;
    const routeLine = source.split('\n').find((l) => l.includes('path="/my-assignments"'));
    expect(routeLine).toBeDefined();
    expect(routeLine).not.toMatch(/Require/);
  });
});

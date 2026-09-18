// src/__tests__/unit/components/EmailTestAdmin.access.test.jsx
//
// Email Management access (EMA-1..7), openspec/changes/schedule-email-template-editing D3:
//   - approvers reach the page but see the Templates tab ONLY, and the page
//     never requests the admin-only /admin/email/config (it would 403);
//   - admins keep both tabs;
//   - the route is guarded on canEditEmailTemplates (requesters redirected);
//   - non-admin approvers get a top-level nav link; admins keep theirs in the
//     Admin dropdown.
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({ usePermissions: () => mockPermissions }));
vi.mock('react-quill-new', () => ({ default: () => <textarea aria-label="Email body" /> }));
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ apiToken: null }) }));
let mockEffectivePermissions = {};
vi.mock('../../../context/RoleSimulationContext', () => ({
  useRoleSimulation: () => ({ effectivePermissions: mockEffectivePermissions }),
  useRoleSimulationSafe: () => ({ effectivePermissions: mockEffectivePermissions }),
}));

import { useRoleSimulation } from '../../../context/RoleSimulationContext';
import EmailTestAdmin from '../../../components/EmailTestAdmin';
import Navigation from '../../../components/Navigation';

const baseViewer = {
  canViewCalendar: true,
  canSubmitReservation: false,
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  canManageAssignments: false,
  canEditEmailTemplates: false,
  isAdmin: false,
};
const approver = { ...baseViewer, canSubmitReservation: true, canApproveReservations: true, canManageUsers: true, canManageAssignments: true, canEditEmailTemplates: true };
const admin = { ...approver, isAdmin: true };

let fetchMock;
beforeEach(() => {
  mockPermissions = { ...baseViewer };
  mockEffectivePermissions = {};
  fetchMock = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.endsWith('/templates') ? { templates: [{ id: 't1', name: 'Template One', subject: 's', body: 'b' }] } : { enabled: true }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Email Management tabs', () => {
  it('EMA-1: a non-admin approver sees only the Templates tab and never requests /config', async () => {
    mockPermissions = approver;
    render(<EmailTestAdmin apiToken="tok" />);
    expect(await screen.findByRole('button', { name: 'Template One' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings & Test' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/email/config'))).toBe(false);
  });

  it('EMA-2: an admin sees both tabs and the settings load', async () => {
    mockPermissions = admin;
    render(<EmailTestAdmin apiToken="tok" />);
    expect(screen.getByRole('button', { name: 'Settings & Test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email Templates' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/email/config'))).toBe(true)
    );
  });
});

// Local copy of App.jsx's guard (importing App.jsx drags in MSAL and the whole
// lazy route table); EMA-5 asserts App.jsx really wires this predicate.
function RequireEmailTemplates({ children }) {
  const { effectivePermissions } = useRoleSimulation();
  if (!effectivePermissions.canEditEmailTemplates) return <Navigate to="/" replace />;
  return children;
}
const renderGuarded = () =>
  render(
    <MemoryRouter initialEntries={['/admin/email-test']}>
      <Routes>
        <Route path="/" element={<div data-testid="home" />} />
        <Route path="/admin/email-test" element={<RequireEmailTemplates><div data-testid="email-admin" /></RequireEmailTemplates>} />
      </Routes>
    </MemoryRouter>
  );

describe('Email Management route guard', () => {
  it('EMA-3: an approver reaches the page', () => {
    mockEffectivePermissions = { canEditEmailTemplates: true };
    renderGuarded();
    expect(screen.getByTestId('email-admin')).toBeInTheDocument();
  });

  it('EMA-4: a requester is redirected', () => {
    mockEffectivePermissions = { canEditEmailTemplates: false };
    renderGuarded();
    expect(screen.queryByTestId('email-admin')).not.toBeInTheDocument();
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('EMA-5: App.jsx wraps /admin/email-test in RequireEmailTemplates on canEditEmailTemplates', async () => {
    const source = (await import('../../../App.jsx?raw')).default;
    expect(source).toContain('function RequireEmailTemplates');
    expect(source).toContain('effectivePermissions.canEditEmailTemplates');
    expect(source).toMatch(/path="\/admin\/email-test"[^\n]*RequireEmailTemplates/);
  });
});

describe('Email Management navigation entry', () => {
  const renderNav = () => render(<MemoryRouter><Navigation /></MemoryRouter>);

  it('EMA-6: a non-admin approver gets a top-level Email Management link', () => {
    mockPermissions = approver;
    renderNav();
    expect(screen.getByRole('link', { name: 'Email Management' }).getAttribute('href')).toBe('/admin/email-test');
  });

  it('EMA-7: a requester gets no link; an admin gets no top-level duplicate', () => {
    mockPermissions = { ...baseViewer, canSubmitReservation: true };
    renderNav();
    expect(screen.queryByRole('link', { name: 'Email Management' })).not.toBeInTheDocument();
    cleanup();

    mockPermissions = admin;
    renderNav();
    // Admin's entry lives in the collapsed Admin dropdown.
    expect(screen.queryByRole('link', { name: 'Email Management' })).not.toBeInTheDocument();
  });
});

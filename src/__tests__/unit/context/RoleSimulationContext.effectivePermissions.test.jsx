// src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx
//
// Regression test for the "User Management gone from Admin section" bug.
//
// Symptom: an admin (not simulating a role) saw no User Management entry in the
// Admin dropdown, and approvers saw no top-level User Management link.
//
// Root cause: getEffectivePermissions() resolves permissions through TWO branches
// that must return the same shape:
//   - simulating  -> ROLE_TEMPLATES[role].permissions (includes canManageUsers)
//   - not simulating -> a field-by-field rebuild from the backend's actualPermissions
// The actual-permissions rebuild whitelisted each flag by name and was never
// updated when canManageUsers was added, so effectivePermissions.canManageUsers
// came back undefined for every real (non-simulated) session. Navigation.jsx
// gates the User Management link on canManageUsers, so it vanished.
//
// usePermissions.contract.test.jsx could not catch this because it MOCKS
// useRoleSimulation and injects effectivePermissions directly — the break is one
// layer deeper, in how the context BUILDS effectivePermissions from the backend
// response. This test exercises the real provider against a mocked backend.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { InteractionStatus } from '@azure/msal-browser';

const h = vi.hoisted(() => {
  const fetchPermissions = vi.fn();
  const acquireTokenSilent = vi.fn();
  const getActiveAccount = vi.fn();
  const account = { homeAccountId: 'home-1', username: 'admin@test.com' };
  const instance = { acquireTokenSilent, getActiveAccount };
  const msal = { instance, accounts: [account], inProgress: 'none' };
  return { fetchPermissions, acquireTokenSilent, getActiveAccount, account, instance, msal };
});

vi.mock('@azure/msal-react', () => ({
  useMsal: () => h.msal,
}));

vi.mock('../../../services/permissionService', () => ({
  fetchPermissions: h.fetchPermissions,
  clearPermissionCache: vi.fn(),
}));

vi.mock('../../../config/authConfig', () => ({
  apiRequest: { scopes: ['api://test/access_as_user'] },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

import { RoleSimulationProvider } from '../../../context/RoleSimulationContext';
import { usePermissions } from '../../../hooks/usePermissions';

// Backend /users/me/permissions payloads (full flag set, as the server returns).
const ADMIN = {
  role: 'admin',
  canViewCalendar: true,
  canSubmitReservation: true,
  canCreateEvents: true,
  canEditEvents: true,
  canDeleteEvents: true,
  canApproveReservations: true,
  canViewAllReservations: true,
  canGenerateReservationTokens: true,
  canManageUsers: true,
  canManageCalendarMarkers: true,
  isAdmin: true,
  department: null,
  departmentEditableFields: [],
};
const APPROVER = { ...ADMIN, role: 'approver', isAdmin: false, canManageCalendarMarkers: false };
const REQUESTER = {
  ...ADMIN,
  role: 'requester',
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  isAdmin: false,
};
const EVENTS_VIEWER = {
  ...REQUESTER,
  role: 'viewer',
  canSubmitReservation: false,
  department: 'events',
  canManageCalendarMarkers: true,
};

function Probe() {
  const { canManageUsers, canManageCalendarMarkers } = usePermissions();
  return (
    <>
      <span data-testid="canManageUsers">{String(canManageUsers)}</span>
      <span data-testid="canManageCalendarMarkers">{String(canManageCalendarMarkers)}</span>
    </>
  );
}

function renderProvider() {
  return render(
    <RoleSimulationProvider>
      <Probe />
    </RoleSimulationProvider>
  );
}

describe('RoleSimulationContext effective permissions passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.msal.inProgress = InteractionStatus.None;
    h.msal.accounts = [h.account];
    h.getActiveAccount.mockReturnValue(h.account);
    h.acquireTokenSilent.mockResolvedValue({ accessToken: 'tok-abc' });
  });

  afterEach(() => {
    cleanup();
  });

  it('EP-1: forwards canManageUsers=true for a real admin (not simulating)', async () => {
    h.fetchPermissions.mockResolvedValue(ADMIN);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageUsers').textContent).toBe('true')
    );
  });

  it('EP-2: forwards canManageUsers=true for a real approver (not simulating)', async () => {
    h.fetchPermissions.mockResolvedValue(APPROVER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageUsers').textContent).toBe('true')
    );
  });

  it('EP-3: forwards canManageUsers=false for a real requester', async () => {
    h.fetchPermissions.mockResolvedValue(REQUESTER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageUsers').textContent).toBe('false')
    );
  });

  it('EP-4: forwards canManageCalendarMarkers=true for a real Events-dept viewer', async () => {
    h.fetchPermissions.mockResolvedValue(EVENTS_VIEWER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageCalendarMarkers').textContent).toBe('true')
    );
  });

  it('EP-5: forwards canManageCalendarMarkers=false for a real requester', async () => {
    h.fetchPermissions.mockResolvedValue(REQUESTER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageCalendarMarkers').textContent).toBe('false')
    );
  });
});

// src/__tests__/unit/context/RoleSimulationContext.refresh.test.jsx
//
// Regression test for the "role change doesn't take effect until reload" bug.
//
// Symptom: an admin changes a user's role (e.g. Viewer -> Requester) but the
// affected user still can't submit requests. Root cause: RoleSimulationContext
// fetched permissions exactly once on mount and never again for the lifetime of
// the page (the effect's dep array has nothing that changes during a session,
// and there was no polling / refocus / manual refresh). The submit UI is gated
// on canSubmitReservation, so the user stayed stuck on their stale role.
//
// The fix: a reusable loadPermissions(), re-run on tab refocus and on an
// interval via usePolling (forceRefresh to bypass the 5-min permission cache),
// plus an exposed refreshPermissions() action. A *background* refresh that
// fails must NOT downgrade an already-resolved user to viewer.
//
// usePolling is intentionally left UNMOCKED so the real visibility-aware
// refocus path is exercised end to end.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { InteractionStatus } from '@azure/msal-browser';

// Hoisted mocks so the vi.mock factories can reference them.
const h = vi.hoisted(() => {
  const fetchPermissions = vi.fn();
  const acquireTokenSilent = vi.fn();
  const getActiveAccount = vi.fn();
  const account = { homeAccountId: 'home-1', username: 'user@test.com' };
  const instance = { acquireTokenSilent, getActiveAccount };
  // inProgress is reset to InteractionStatus.None in beforeEach.
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

import { RoleSimulationProvider, useRoleSimulation } from '../../../context/RoleSimulationContext';
import { usePermissions } from '../../../hooks/usePermissions';

const VIEWER = {
  role: 'viewer',
  canViewCalendar: true,
  canSubmitReservation: false,
  isAdmin: false,
  department: null,
  departmentEditableFields: [],
};
const REQUESTER = {
  role: 'requester',
  canViewCalendar: true,
  canSubmitReservation: true,
  isAdmin: false,
  department: null,
  departmentEditableFields: [],
};

// Probe exposes the live permission state and captures refreshPermissions().
const captured = {};
function Probe() {
  const perms = usePermissions();
  const ctx = useRoleSimulation();
  captured.refreshPermissions = ctx.refreshPermissions;
  return (
    <div>
      <span data-testid="role">{perms.actualRole}</span>
      <span data-testid="submit">{String(perms.canSubmitReservation)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <RoleSimulationProvider>
      <Probe />
    </RoleSimulationProvider>
  );
}

describe('RoleSimulationContext live permission refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.msal.inProgress = InteractionStatus.None;
    h.msal.accounts = [h.account];
    h.getActiveAccount.mockReturnValue(h.account);
    h.acquireTokenSilent.mockResolvedValue({ accessToken: 'tok-abc' });
    h.fetchPermissions.mockResolvedValue(VIEWER);
  });

  afterEach(() => {
    cleanup();
  });

  it('RS-1: reflects the backend role on initial load (cache allowed)', async () => {
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('viewer'));
    expect(screen.getByTestId('submit').textContent).toBe('false');
    // First load may use the cache.
    expect(h.fetchPermissions).toHaveBeenCalledWith('tok-abc', false);
  });

  it('RS-2: refreshPermissions() picks up a role change without a reload', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('viewer'));

    // Admin promotes the user on the backend.
    h.fetchPermissions.mockResolvedValue(REQUESTER);

    await act(async () => {
      await captured.refreshPermissions();
    });

    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('requester'));
    expect(screen.getByTestId('submit').textContent).toBe('true');
    // A refresh MUST bypass the cache so the new role is seen immediately.
    expect(h.fetchPermissions).toHaveBeenLastCalledWith('tok-abc', true);
  });

  it('RS-3: a tab refocus triggers a forced re-fetch and updates the role', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('viewer'));

    h.fetchPermissions.mockResolvedValue(REQUESTER);

    // User switches back to the tab — usePolling's visibility handler fires.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(
      () => expect(screen.getByTestId('role').textContent).toBe('requester'),
      { timeout: 2000 }
    );
    expect(screen.getByTestId('submit').textContent).toBe('true');
    expect(h.fetchPermissions).toHaveBeenLastCalledWith('tok-abc', true);
  });

  it('RS-4: a failed background refresh keeps the last good role (no downgrade)', async () => {
    h.fetchPermissions.mockResolvedValue(REQUESTER);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('requester'));

    // Background refresh fails (e.g. transient token/network blip).
    h.acquireTokenSilent.mockRejectedValueOnce(new Error('network blip'));

    await act(async () => {
      await captured.refreshPermissions();
    });

    // Must stay requester — a transient failure cannot hide the user's UI.
    expect(screen.getByTestId('role').textContent).toBe('requester');
    expect(screen.getByTestId('submit').textContent).toBe('true');
  });
});

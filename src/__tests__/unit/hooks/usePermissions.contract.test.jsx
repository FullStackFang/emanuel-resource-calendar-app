// src/__tests__/unit/hooks/usePermissions.contract.test.jsx
//
// Locks the public CONTRACT of usePermissions() — specifically the fields that
// consumers destructure but the hook historically forgot to forward from
// useRoleSimulation():
//
//   - `role`           -> effective role string (simulatedRole || actualRole).
//                         UserAdmin.jsx reads `{ role: callerRole }` to drive the
//                         user-management role cap. When this was undefined,
//                         canManageTarget(undefined, ...) returned false and
//                         EVERY user row locked to "Admin only" — an approver
//                         could not edit even a viewer.
//   - `canManageUsers` -> Navigation.jsx surfaces User Management off this flag.
//
// These regressions slipped past component tests because those tests MOCK
// usePermissions and supply the fields directly, masking the missing forward.
// This test exercises the real hook against a mocked context to lock the wiring.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Controlled stand-in for the RoleSimulation context the hook reads from.
let mockSim;
vi.mock('../../../context/RoleSimulationContext', () => ({
  useRoleSimulation: () => mockSim,
}));

import { usePermissions } from '../../../hooks/usePermissions';

const PERMS = (overrides = {}) => ({
  canViewCalendar: true,
  canSubmitReservation: true,
  canCreateEvents: true,
  canEditEvents: true,
  canDeleteEvents: true,
  canApproveReservations: true,
  canManageUsers: true,
  isAdmin: false,
  ...overrides,
});

function simState(overrides = {}) {
  return {
    effectivePermissions: PERMS(),
    isSimulating: false,
    simulatedRole: null,
    simulatedRoleName: null,
    isActualAdmin: false,
    actualRole: 'approver',
    actualDepartment: null,
    departmentEditableFields: [],
    canEditDepartmentFields: false,
    permissionsLoading: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockSim = simState();
});

describe('usePermissions() contract', () => {
  it('forwards `role` as the actual role when not simulating', () => {
    mockSim = simState({ actualRole: 'approver', simulatedRole: null });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.role).toBe('approver');
  });

  it('forwards `role` as the simulated role when simulating', () => {
    mockSim = simState({
      actualRole: 'admin',
      simulatedRole: 'viewer',
      isSimulating: true,
      effectivePermissions: PERMS({ canManageUsers: false, isAdmin: false }),
    });
    const { result } = renderHook(() => usePermissions());
    // Effective role drives the UI cap, so simulation must win.
    expect(result.current.role).toBe('viewer');
  });

  it('forwards `canManageUsers` from effective permissions', () => {
    mockSim = simState({ effectivePermissions: PERMS({ canManageUsers: true }) });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canManageUsers).toBe(true);

    mockSim = simState({ effectivePermissions: PERMS({ canManageUsers: false }) });
    const { result: r2 } = renderHook(() => usePermissions());
    expect(r2.current.canManageUsers).toBe(false);
  });
});

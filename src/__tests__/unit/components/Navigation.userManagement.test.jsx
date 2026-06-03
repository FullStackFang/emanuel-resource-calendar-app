// src/__tests__/unit/components/Navigation.userManagement.test.jsx
//
// Locks the User Management navigation IA for approvers vs admins.
//
// Background: approvers have `canManageUsers: true` (capped to viewer/requester
// in userManagementPolicy.js) but `isAdmin: false`. Previously the nav buried
// User Management inside an "Admin" dropdown AND `usePermissions()` never
// forwarded `canManageUsers`, so the flag was `undefined` in Navigation.jsx and
// the dropdown only ever surfaced for admins.
//
// Desired behavior (this test):
//   - Approver (canManageUsers && !isAdmin): sees a TOP-LEVEL "User Management"
//     link, and does NOT see the "Admin" dropdown (which only holds admin tools
//     they can't use).
//   - Admin (isAdmin): sees the "Admin" dropdown; User Management lives inside
//     it (revealed on expand), and there is NO duplicate top-level link.
//   - Requester (no canManageUsers, no isAdmin): sees neither.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mutable permissions mock ────────────────────────────────────────────────
let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

// ─── Static dependency mocks (nav side-effects are irrelevant here) ───────────
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

import Navigation from '../../../components/Navigation';

const baseViewer = {
  canViewCalendar: true,
  canSubmitReservation: false,
  canApproveReservations: false,
  canManageUsers: false,
  isAdmin: false,
};

function renderNav() {
  return render(
    <MemoryRouter>
      <Navigation />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockPermissions = { ...baseViewer };
});

describe('Navigation — User Management IA', () => {
  it('approver: shows a top-level User Management link and no Admin dropdown', () => {
    mockPermissions = {
      ...baseViewer,
      canSubmitReservation: true,
      canApproveReservations: true,
      canManageUsers: true,
      isAdmin: false,
    };
    renderNav();

    // Top-level link present and points at the route
    const link = screen.getByRole('link', { name: 'User Management' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/admin/users');

    // No "Admin" dropdown toggle for approvers
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('admin: shows Admin dropdown containing User Management, no duplicate top-level link', () => {
    mockPermissions = {
      ...baseViewer,
      canSubmitReservation: true,
      canApproveReservations: true,
      canManageUsers: true,
      isAdmin: true,
    };
    renderNav();

    // Admin dropdown toggle present
    const adminToggle = screen.getByText('Admin');
    expect(adminToggle).toBeInTheDocument();

    // Collapsed: User Management not yet rendered (so no duplicate top-level link)
    expect(screen.queryByRole('link', { name: 'User Management' })).not.toBeInTheDocument();

    // Expand the dropdown -> User Management appears inside it
    fireEvent.click(adminToggle);
    const link = screen.getByRole('link', { name: 'User Management' });
    expect(link.getAttribute('href')).toBe('/admin/users');
    // Admin-only sibling also present once expanded
    expect(screen.getByRole('link', { name: 'Location Management' })).toBeInTheDocument();
  });

  it('requester: shows neither the Admin dropdown nor a User Management link', () => {
    mockPermissions = {
      ...baseViewer,
      canSubmitReservation: true,
      canApproveReservations: false,
      canManageUsers: false,
      isAdmin: false,
    };
    renderNav();

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'User Management' })).not.toBeInTheDocument();
  });
});

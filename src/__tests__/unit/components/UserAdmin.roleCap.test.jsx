// src/__tests__/unit/components/UserAdmin.roleCap.test.jsx
//
// Locks the approver role-cap UI in UserAdmin:
//  - An approver sees approver/admin rows LOCKED (no Edit/Delete, "Admin only").
//  - An approver editing a manageable row gets a role <select> capped to
//    Viewer/Requester (no Approver/Admin options).
//  - An admin sees every row editable with the full role list.
// Backend enforcement is covered by userManagementApprover.test.js; this guards
// the client affordances so the UI never offers a 403-ing action.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [{ username: 'caller@test.com' }] }),
}));

vi.mock('../../../hooks/useDepartments', () => ({ default: () => ({ departments: [] }) }));
vi.mock('../../../hooks/useRoleTypes', () => ({ default: () => ({ roleTypes: [] }) }));

let currentRole = 'approver';
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ role: currentRole }),
}));

import UserAdmin from '../../../components/UserAdmin';

const USER_LIST = [
  { _id: 'u-viewer', email: 'viewer@test.com', displayName: 'Vera Viewer', effectiveRole: 'viewer', role: 'viewer' },
  { _id: 'u-requester', email: 'requester@test.com', displayName: 'Rita Requester', effectiveRole: 'requester', role: 'requester' },
  { _id: 'u-approver', email: 'approver@test.com', displayName: 'Andy Approver', effectiveRole: 'approver', role: 'approver' },
  { _id: 'u-admin', email: 'admin@test.com', displayName: 'Adam Admin', effectiveRole: 'admin', role: 'admin' },
];

function mockUserListFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => USER_LIST,
  })));
}

const cardFor = (name) => screen.getByText(name).closest('.user-card');

describe('UserAdmin role cap', () => {
  beforeEach(() => {
    mockUserListFetch();
  });

  it('locks approver/admin rows and caps the role select for an approver caller', async () => {
    currentRole = 'approver';
    render(<UserAdmin apiToken="tok" />);

    await waitFor(() => expect(screen.getByText('Vera Viewer')).toBeInTheDocument());

    // Manageable rows expose Edit; privileged rows are locked.
    expect(within(cardFor('Vera Viewer')).getByText('Edit')).toBeInTheDocument();
    expect(within(cardFor('Rita Requester')).getByText('Edit')).toBeInTheDocument();
    expect(within(cardFor('Andy Approver')).queryByText('Edit')).toBeNull();
    expect(within(cardFor('Andy Approver')).getByText('Admin only')).toBeInTheDocument();
    expect(within(cardFor('Adam Admin')).queryByText('Edit')).toBeNull();
    expect(within(cardFor('Adam Admin')).getByText('Admin only')).toBeInTheDocument();

    // Editing a manageable row offers only viewer/requester roles.
    fireEvent.click(within(cardFor('Vera Viewer')).getByText('Edit'));
    expect(screen.getByRole('option', { name: 'Viewer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Requester' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Approver' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Admin' })).toBeNull();
  });

  it('lets an admin caller edit every row with the full role list', async () => {
    currentRole = 'admin';
    render(<UserAdmin apiToken="tok" />);

    await waitFor(() => expect(screen.getByText('Adam Admin')).toBeInTheDocument());

    for (const name of ['Vera Viewer', 'Rita Requester', 'Andy Approver', 'Adam Admin']) {
      expect(within(cardFor(name)).getByText('Edit')).toBeInTheDocument();
    }
    expect(screen.queryByText('Admin only')).toBeNull();

    fireEvent.click(within(cardFor('Andy Approver')).getByText('Edit'));
    for (const role of ['Viewer', 'Requester', 'Approver', 'Admin']) {
      expect(screen.getByRole('option', { name: role })).toBeInTheDocument();
    }
  });
});

// src/__tests__/unit/components/UserAdmin.editor.test.jsx
//
// Locks the draft-copy editor (design.md D5).
//
// The defect it replaces: `handleInputChange` wrote THROUGH to the shared
// `users` array and `Cancel` only flipped `editingRows[userId]`, so an
// abandoned edit stayed on screen until reload. The fix is structural rather
// than a revert path — the editor owns a `draft`, nothing outside it is
// written until a save resolves, and so Cancel has nothing to restore.
//
// UAE-1 is therefore the test that must fail if anyone reintroduces a
// write-through. Mutation-checked: see task 10.5 in the change's tasks.md.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [{ username: 'caller@test.com' }] }),
}));

vi.mock('../../../hooks/useDepartments', () => ({
  default: () => ({
    departments: [
      { key: '', name: 'None', description: '' },
      { key: 'it', name: 'IT', description: 'Information Technology' },
    ],
  }),
}));

vi.mock('../../../hooks/useRoleTypes', () => ({
  default: () => ({
    roleTypes: [
      { key: '', name: 'None', description: '' },
      { key: 'staff', name: 'Staff', description: 'Temple staff' },
    ],
  }),
}));

const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showError, showWarning: vi.fn() }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'admin' }),
}));

import UserAdmin from '../../../components/UserAdmin';

const TARGET = {
  _id: 'r1',
  email: 'rita@test.com',
  displayName: 'Rita Requester',
  effectiveRole: 'requester',
  role: 'requester',
  department: 'it',
  roleType: 'staff',
  title: 'Analyst',
  lastLogin: null,
  preferences: { defaultView: 'week', startOfWeek: 'Sunday' },
};

const OTHER = {
  _id: 'v1',
  email: 'vera@test.com',
  displayName: 'Vera Viewer',
  effectiveRole: 'viewer',
  role: 'viewer',
};

// A fetch that serves the list on GET and lets each mutating call be shaped
// per-test. Every call is recorded so "no request fired" is assertable.
function installFetch({ onMutate } = {}) {
  const fn = vi.fn(async (url, init) => {
    const method = init?.method || 'GET';
    if (method === 'GET') {
      return { ok: true, json: async () => [TARGET, OTHER] };
    }
    return onMutate ? onMutate(url, init) : { ok: true, json: async () => TARGET };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const mutatingCalls = (fn) => fn.mock.calls.filter(([, init]) => (init?.method || 'GET') !== 'GET');

const renderRoster = () => render(<UserAdmin apiToken="tok" />, { wrapper: withQueryClient() });

const rowFor = (name) => screen.getByText(name).closest('.ua-entry');

async function openEditorFor(name) {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  fireEvent.click(within(rowFor(name)).getByText('Edit'));
  return rowFor(name);
}

describe('UserAdmin inline editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // UAE-1: THE cancel-reverts test. Three fields edited, then cancelled; the
  // row must read exactly as it did, and nothing may have been sent.
  it('UAE-1: cancelling discards every edited field and sends no request', async () => {
    const fetchFn = installFetch();
    renderRoster();

    const row = await openEditorFor('Rita Requester');

    fireEvent.change(within(row).getByLabelText('Display Name'), { target: { value: 'Renamed Person' } });
    fireEvent.change(within(row).getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.change(within(row).getByLabelText('Title'), { target: { value: 'Chief of Staff' } });

    fireEvent.click(within(row).getByText('Cancel'));

    // The editor is gone and the row behind it was never touched.
    const after = rowFor('Rita Requester');
    expect(after.querySelector('.ua-editor')).toBeNull();
    expect(within(after).getByText('Rita Requester')).toBeInTheDocument();
    expect(within(after).getByText('Requester')).toBeInTheDocument();
    expect(within(after).getByText('Analyst')).toBeInTheDocument();
    expect(screen.queryByText('Renamed Person')).not.toBeInTheDocument();
    expect(screen.queryByText('Chief of Staff')).not.toBeInTheDocument();

    expect(mutatingCalls(fetchFn)).toHaveLength(0);
  });

  // UAE-2: reopening after a cancel must show the ORIGINAL values, not the
  // abandoned draft. A draft that survives its own cancel is the same bug
  // wearing a different hat.
  it('UAE-2: reopening after a cancel shows the original values', async () => {
    installFetch();
    renderRoster();

    let row = await openEditorFor('Rita Requester');
    fireEvent.change(within(row).getByLabelText('Display Name'), { target: { value: 'Scribbled' } });
    fireEvent.click(within(row).getByText('Cancel'));

    row = await openEditorFor('Rita Requester');
    expect(within(row).getByLabelText('Display Name').value).toBe('Rita Requester');
    expect(within(row).getByLabelText('Title').value).toBe('Analyst');
  });

  it('UAE-3: the roster stays visible while the editor is open', async () => {
    installFetch();
    renderRoster();

    const row = await openEditorFor('Rita Requester');

    expect(row.querySelector('.ua-editor')).not.toBeNull();
    // The neighbouring row is still rendered — the editor expanded beneath
    // its own row rather than replacing the list.
    expect(screen.getByText('Vera Viewer')).toBeInTheDocument();
    expect(document.querySelectorAll('.ua-entry')).toHaveLength(2);
  });

  it('UAE-4: only one editor is open at a time', async () => {
    installFetch();
    renderRoster();

    await openEditorFor('Rita Requester');
    await openEditorFor('Vera Viewer');

    expect(document.querySelectorAll('.ua-editor')).toHaveLength(1);
    expect(rowFor('Vera Viewer').querySelector('.ua-editor')).not.toBeNull();
    expect(rowFor('Rita Requester').querySelector('.ua-editor')).toBeNull();
  });

  it('UAE-5: the editor exposes the account fields plus its calendar preferences as secondary', async () => {
    installFetch();
    renderRoster();

    const row = await openEditorFor('Rita Requester');

    for (const label of ['Display Name', 'Email', 'Role', 'Department', 'Organizational Role', 'Title']) {
      expect(within(row).getByLabelText(label)).toBeInTheDocument();
    }
    // Preferences moved OUT of the roster row and into the editor, under a
    // subheading marking them secondary.
    expect(within(row).getByText("This user's calendar preferences")).toBeInTheDocument();
    expect(within(row).getByLabelText('Default View')).toBeInTheDocument();
    expect(within(row).getByLabelText('Week Starts On')).toBeInTheDocument();
  });

  it('UAE-6: saving sends the draft, closes the editor, and raises a success toast', async () => {
    const saved = { ...TARGET, displayName: 'Rita Renamed', role: 'approver', effectiveRole: 'approver' };
    const fetchFn = installFetch({
      onMutate: async () => ({ ok: true, json: async () => saved }),
    });
    renderRoster();

    const row = await openEditorFor('Rita Requester');
    fireEvent.change(within(row).getByLabelText('Display Name'), { target: { value: 'Rita Renamed' } });
    fireEvent.change(within(row).getByLabelText('Role'), { target: { value: 'approver' } });

    await act(async () => {
      fireEvent.click(within(row).getByText('Save'));
    });

    const [url, init] = mutatingCalls(fetchFn)[0];
    expect(url).toContain('/users/r1');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.displayName).toBe('Rita Renamed');
    expect(body.role).toBe('approver');

    await waitFor(() => expect(showSuccess).toHaveBeenCalled());
    expect(document.querySelector('.ua-editor')).toBeNull();
  });

  // UAE-7: a failed save must not throw the administrator's typing away.
  it('UAE-7: a failed save keeps the editor open with the entered values intact', async () => {
    installFetch({
      onMutate: async () => ({ ok: false, statusText: 'Conflict', json: async () => ({ error: 'Email already in use' }) }),
    });
    renderRoster();

    const row = await openEditorFor('Rita Requester');
    fireEvent.change(within(row).getByLabelText('Display Name'), { target: { value: 'Rita Renamed' } });

    await act(async () => {
      fireEvent.click(within(row).getByText('Save'));
    });

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(showSuccess).not.toHaveBeenCalled();

    const stillOpen = rowFor('Rita Requester');
    expect(stillOpen.querySelector('.ua-editor')).not.toBeNull();
    expect(within(stillOpen).getByLabelText('Display Name').value).toBe('Rita Renamed');
  });
});

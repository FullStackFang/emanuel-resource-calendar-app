// src/__tests__/unit/components/UserAdmin.filters.test.jsx
//
// Locks the roster's filter surface: the role tabs narrow the list, their
// counts describe the DIRECTORY rather than the filtered view, the filters
// compose, Clear restores everything, and the result count tracks what is
// actually on screen.
//
// The counts assertion is the load-bearing one. A count that shrinks as you
// type tells the administrator nothing the result count does not already, and
// makes the tabs useless as a navigation aid — see design.md D2.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

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
      { key: 'clergy', name: 'Clergy', description: 'Clergy staff' },
    ],
  }),
}));

vi.mock('../../../hooks/useRoleTypes', () => ({
  default: () => ({
    roleTypes: [
      { key: '', name: 'None', description: '' },
      { key: 'rabbi', name: 'Rabbi', description: 'Rabbinical staff' },
      { key: 'staff', name: 'Staff', description: 'Temple staff' },
    ],
  }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'admin' }),
}));

import UserAdmin from '../../../components/UserAdmin';

// `?raw` yields an empty string for CSS under vitest's stylesheet handling, so
// the rules are read straight off disk (same technique as SSI-23).
const adminCss = readFileSync(resolve(process.cwd(), 'src/components/UserAdmin.css'), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

// Two admins, one approver, two requesters, one viewer. Departments, org
// roles, titles and activity vary so every filter has something to bite on.
const USER_LIST = [
  { _id: 'a1', email: 'adam@test.com', displayName: 'Adam Admin', effectiveRole: 'admin', role: 'admin', department: 'it', roleType: 'staff', title: 'Systems Lead', lastLogin: daysAgo(2) },
  { _id: 'a2', email: 'ada@test.com', displayName: 'Ada Admin', effectiveRole: 'admin', role: 'admin', department: 'clergy', roleType: 'rabbi', title: 'Senior Rabbi', lastLogin: daysAgo(200) },
  { _id: 'p1', email: 'andy@test.com', displayName: 'Andy Approver', effectiveRole: 'approver', role: 'approver', department: 'it', roleType: 'staff', title: 'Program Director', lastLogin: daysAgo(3) },
  { _id: 'r1', email: 'rita@test.com', displayName: 'Rita Requester', effectiveRole: 'requester', role: 'requester', department: 'clergy', roleType: 'rabbi', title: 'Associate Rabbi', lastLogin: daysAgo(120) },
  { _id: 'r2', email: 'bea@test.com', displayName: 'Bea Requester', effectiveRole: 'requester', role: 'requester', department: 'it', roleType: 'staff', title: 'Analyst', lastLogin: daysAgo(5) },
  { _id: 'v1', email: 'vera@example.org', displayName: 'Vera Viewer', effectiveRole: 'viewer', role: 'viewer', department: '', roleType: '', title: '', lastLogin: null },
];

// Held so "no request fired" is assertable without reaching for `global`,
// which is not a defined identifier under this project's ESLint env.
let fetchMock;

function mockUserListFetch(list = USER_LIST) {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => list }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderRoster = () => render(<UserAdmin apiToken="tok" />, { wrapper: withQueryClient() });

const rowNames = () =>
  Array.from(document.querySelectorAll('.ua-entry .ua-name')).map((n) => n.textContent.replace('You', '').trim());

const tab = (label) => screen.getByRole('tab', { name: new RegExp(`^${label}`) });
const tabCount = (label) => within(tab(label)).getByText(/^\d+$/).textContent;
const resultCount = () => document.querySelector('.rr-filter-results').textContent.trim();
const search = () => screen.getByLabelText('Search users');

async function ready() {
  await waitFor(() => expect(screen.getByText('Vera Viewer')).toBeInTheDocument());
}

describe('UserAdmin roster filters', () => {
  beforeEach(() => {
    mockUserListFetch();
  });

  // UAF-1: the default view is everything, in the pre-existing display order
  // (role rank, then name) that administrators already know.
  it('UAF-1: renders every account in role-then-name order by default', async () => {
    renderRoster();
    await ready();

    expect(rowNames()).toEqual([
      'Ada Admin',
      'Adam Admin',
      'Andy Approver',
      'Bea Requester',
      'Rita Requester',
      'Vera Viewer',
    ]);
    expect(resultCount()).toBe('6 of 6');
  });

  it('UAF-2: the role tabs carry the directory counts', async () => {
    renderRoster();
    await ready();

    expect(tabCount('Everyone')).toBe('6');
    expect(tabCount('Administrators')).toBe('2');
    expect(tabCount('Approvers')).toBe('1');
    expect(tabCount('Requesters')).toBe('2');
    expect(tabCount('Viewers')).toBe('1');
  });

  it('UAF-3: selecting a role tab narrows the roster to that role', async () => {
    renderRoster();
    await ready();

    fireEvent.click(tab('Requesters'));

    expect(rowNames()).toEqual(['Bea Requester', 'Rita Requester']);
    expect(resultCount()).toBe('2 of 6');
  });

  // UAF-4 is the D2 assertion. Searching narrows the ROWS; the tab counts
  // must not move, because they describe the directory.
  it('UAF-4: tab counts stay stable while a search narrows the rows', async () => {
    renderRoster();
    await ready();

    fireEvent.change(search(), { target: { value: 'rita' } });

    expect(rowNames()).toEqual(['Rita Requester']);
    expect(resultCount()).toBe('1 of 6');
    expect(tabCount('Everyone')).toBe('6');
    expect(tabCount('Administrators')).toBe('2');
    expect(tabCount('Requesters')).toBe('2');
  });

  it('UAF-5: search matches a title, not only a name or email', async () => {
    renderRoster();
    await ready();

    fireEvent.change(search(), { target: { value: 'analyst' } });

    expect(rowNames()).toEqual(['Bea Requester']);
  });

  it('UAF-6: the matched substring is marked in the row', async () => {
    renderRoster();
    await ready();

    fireEvent.change(search(), { target: { value: 'analy' } });

    const marks = Array.from(document.querySelectorAll('.ua-entry mark.ua-mark')).map((m) => m.textContent);
    expect(marks).toContain('Analy');
  });

  // UAF-18/19 are the same defect from two sides. `.ua-name` is a flex row so
  // the 'You' badge can sit beside the name -- but Highlight emits one element
  // PER SEGMENT, and every segment promoted to a flex item picks up the
  // container's gap. Searching 'n' turned 'Kavan Monte' into 'Kava n Monte'.
  it('UAF-18: highlighted name segments stay inside one flex item', async () => {
    renderRoster();
    await ready();

    fireEvent.change(search(), { target: { value: 'da' } });

    const name = document.querySelector('.ua-entry .ua-name');
    // Guards the fixture: without a real split there is nothing to regress.
    expect(name.querySelectorAll('mark.ua-mark').length).toBeGreaterThan(0);
    expect(name.querySelector('.ua-name-text').childElementCount).toBeGreaterThan(1);

    // The flex container itself may hold only the text wrapper and the badge.
    const stray = Array.from(name.children).filter(
      (el) => !el.classList.contains('ua-name-text') && !el.classList.contains('ua-you-badge')
    );
    expect(stray).toEqual([]);
  });

  it('UAF-19: name truncation lives on the text wrapper, not the flex row', () => {
    // jsdom applies no stylesheets, so the cascade is asserted at the source.
    // text-overflow does nothing on a flex container -- a long name has to
    // ellipsise on the inner span or it is simply clipped mid-letter.
    const rule = adminCss.slice(
      adminCss.indexOf('.ua-name-text {'),
      adminCss.indexOf('.ua-you-badge {')
    );
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('text-overflow: ellipsis');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('min-width: 0');
  });

  it('UAF-7: role tab, department, and activity compose', async () => {
    renderRoster();
    await ready();

    fireEvent.click(tab('Requesters'));
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'it' } });
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'active' } });

    expect(rowNames()).toEqual(['Bea Requester']);
    expect(resultCount()).toBe('1 of 6');
  });

  it('UAF-8: never-signed-in is its own bucket, distinct from dormant', async () => {
    renderRoster();
    await ready();

    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'never' } });
    expect(rowNames()).toEqual(['Vera Viewer']);

    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'dormant' } });
    expect(rowNames()).toEqual(['Ada Admin', 'Rita Requester']);
  });

  it('UAF-9: sorting by activity puts never-signed-in accounts last', async () => {
    renderRoster();
    await ready();

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'activity' } });

    expect(rowNames()).toEqual([
      'Adam Admin',
      'Andy Approver',
      'Bea Requester',
      'Rita Requester',
      'Ada Admin',
      'Vera Viewer',
    ]);
  });

  // UAF-10: the Clear pill and result count occupy their space even when no
  // filter is engaged, so engaging one does not shift the controls beside it.
  it('UAF-10: the filter actions box is hidden-but-laid-out until a filter engages', async () => {
    renderRoster();
    await ready();

    const actions = document.querySelector('.rr-filter-actions');
    expect(actions.className).toContain('hidden');

    fireEvent.change(search(), { target: { value: 'rita' } });
    expect(document.querySelector('.rr-filter-actions').className).not.toContain('hidden');
  });

  it('UAF-11: an engaged filter group is marked active', async () => {
    renderRoster();
    await ready();

    const group = screen.getByLabelText('Department').closest('.rr-status-filter');
    expect(group.className).not.toContain('active');

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'it' } });
    expect(screen.getByLabelText('Department').closest('.rr-status-filter').className).toContain('active');
  });

  it('UAF-12: Clear resets every filter and restores the full roster', async () => {
    renderRoster();
    await ready();

    fireEvent.click(tab('Requesters'));
    fireEvent.change(search(), { target: { value: 'bea' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'it' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name_desc' } });
    expect(rowNames()).toEqual(['Bea Requester']);

    fireEvent.click(screen.getByText('Clear'));

    expect(rowNames()).toHaveLength(6);
    expect(resultCount()).toBe('6 of 6');
    expect(search().value).toBe('');
    expect(screen.getByLabelText('Department').value).toBe('');
    expect(screen.getByLabelText('Sort').value).toBe('role_name');
    expect(tab('Everyone').getAttribute('aria-selected')).toBe('true');
  });

  // UAF-13: filtered-to-nothing is NOT the empty-directory message, and the
  // recovery offered is clearing the filters — refetching is not what
  // excluded these rows.
  it('UAF-13: filtering to nothing offers to clear the filters, not to refresh', async () => {
    renderRoster();
    await ready();

    fireEvent.change(search(), { target: { value: 'nobody-by-this-name' } });

    expect(screen.getByText('No accounts match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Clear all filters'));
    expect(rowNames()).toHaveLength(6);
  });

  it('UAF-14: calendar preferences never appear in a roster row', async () => {
    mockUserListFetch([
      { ...USER_LIST[0], preferences: { defaultView: 'month', startOfWeek: 'Monday' } },
    ]);
    renderRoster();
    await waitFor(() => expect(screen.getByText('Adam Admin')).toBeInTheDocument());

    const row = document.querySelector('.ua-entry .ua-row');
    expect(row.textContent).not.toMatch(/Month|Monday/);
  });

  it('UAF-15: absent department, org role, and title render explicit placeholders', async () => {
    renderRoster();
    await ready();

    const veraRow = screen.getByText('Vera Viewer').closest('.ua-entry');
    expect(within(veraRow).getByText('No department')).toBeInTheDocument();
    expect(within(veraRow).getByText('No org role')).toBeInTheDocument();
    expect(within(veraRow).getByText('No title')).toBeInTheDocument();
    expect(within(veraRow).getByText('Never signed in')).toBeInTheDocument();
  });

  it('UAF-16: the signed-in user is marked and offers no delete control', async () => {
    mockUserListFetch([
      { _id: 'me', email: 'caller@test.com', displayName: 'Cal Caller', effectiveRole: 'admin', role: 'admin' },
      ...USER_LIST,
    ]);
    renderRoster();
    await waitFor(() => expect(screen.getByText('Cal Caller')).toBeInTheDocument());

    const ownRow = screen.getByText('Cal Caller').closest('.ua-entry');
    expect(ownRow.className).toContain('current-user');
    expect(within(ownRow).getByText('You')).toBeInTheDocument();
    expect(within(ownRow).queryByText('Delete')).toBeNull();

    // A row that is not the caller's still offers one.
    const otherRow = screen.getByText('Adam Admin').closest('.ua-entry');
    expect(within(otherRow).getByText('Delete')).toBeInTheDocument();
  });

  it('UAF-17: delete arms on the first click and sends nothing until the second', async () => {
    renderRoster();
    await ready();

    const row = screen.getByText('Adam Admin').closest('.ua-entry');
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(within(row).getByText('Delete'));

    expect(within(row).getByText('Confirm?')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    // The armed state can be abandoned without sending anything.
    fireEvent.click(within(row).getByLabelText('Cancel delete'));
    expect(within(row).getByText('Delete')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});

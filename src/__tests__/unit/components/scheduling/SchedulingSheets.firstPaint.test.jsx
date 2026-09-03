// SchedulingSheets.firstPaint.test.jsx
//
// The workbook page's loading contract (task 6.8): `loading` binds to
// deriveListLoadingState().isFirstLoad on the workbook-list query, the
// empty-workbook state renders only after a genuine resolve (and auto-opens
// the creation panel, design D8 #7), and a loaded workbook lands on the grid
// with day tabs.
//
// Test IDs: SSFP-1 to SSFP-7

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api', CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'sandbox@x.org', PRODUCTION_CALENDAR: 'prod@x.org' } },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'token' }),
}));
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, canManageAssignments: true }),
}));
vi.mock('../../../../hooks/useLocationsQuery', () => ({
  useLocationsQuery: () => ({ data: [] }),
}));
vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
let mockListQuery;
let mockDetailQuery;
vi.mock('../../../../hooks/useSchedulingSheets', () => ({
  useSchedulingSheetList: () => mockListQuery,
  useSchedulingSheet: () => mockDetailQuery,
  useSheetUserLookup: () => ({ data: [] }),
  useSchedulingSheetMutations: () => ({
    createSheet: noopMutation(),
    renameSheet: noopMutation(),
    deleteSheet: noopMutation(),
    createDay: noopMutation(),
    deleteDay: noopMutation(),
    updateStructure: noopMutation(),
    updateCell: noopMutation(),
    sendSchedules: noopMutation(),
  }),
}));

import SchedulingSheets from '../../../../components/scheduling/SchedulingSheets';

const DAY = {
  _id: 'd1', date: '2099-09-11', title: 'Erev RH', _version: 1,
  rows: [{ id: 'r1', label: 'Location', kind: 'starter' }],
  columns: [], cells: {}, taggedEmails: [], emailLog: [], emailStatus: [],
};

function renderPage(entry = '/') {
  // The linkable-events query fetches via global fetch; keep it pending — this
  // suite is about the LIST query's loading states.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SchedulingSheets />
    </MemoryRouter>,
    { wrapper: withQueryClient() }
  );
}

describe('SchedulingSheets — first paint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetailQuery = { data: null, isFetching: false, isPending: false, refetch: vi.fn() };
  });

  // The pending && idle tick — isPending true, isFetching false, so TanStack's
  // isLoading is false. A gate bound to isLoading would flash the
  // 'no scheduling sheets yet' empty state (and auto-open the creation panel)
  // at a manager whose workbooks simply have not loaded yet.
  it('SSFP-1: pending && idle holds the spinner, never the empty workbook state', () => {
    mockListQuery = { data: undefined, isPending: true, isFetching: false, isError: false, refetch: vi.fn() };
    renderPage();

    expect(screen.getByTestId('scheduling-sheets-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-sheet-panel')).not.toBeInTheDocument();
  });

  it('SSFP-2: a genuine empty resolve auto-opens the New Scheduling Sheet panel', () => {
    mockListQuery = { data: [], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    renderPage();

    expect(screen.getByTestId('new-sheet-panel')).toBeInTheDocument();
  });

  it('SSFP-3: a background refetch never re-shows the empty state over loaded sheets', () => {
    mockListQuery = { data: [], isPending: false, isFetching: true, isError: false, refetch: vi.fn() };
    renderPage();

    // Silent refresh with no data yet: neither spinner-less empty nor panel.
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
  });

  it('SSFP-4: a loaded workbook renders the day tab and the grid card', () => {
    const sheet = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };
    mockListQuery = { data: [sheet], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: { ...sheet, days: [DAY] }, isFetching: false, isPending: false, refetch: vi.fn() };
    renderPage();

    expect(screen.getByTestId('day-tab-2099-09-11')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-card')).toBeInTheDocument();
    expect(screen.getByTestId('day-title')).toHaveTextContent('Erev RH');
  });

  // The list and the detail are INDEPENDENT queries. A deep link (?sheet=&date=)
  // loads the detail without the list ever having succeeded, so the list can be
  // empty — or failed — while a fully populated sheet is on screen. Printing
  // 'No scheduling sheets yet' over that sheet is incoherent, and worse, the
  // auto-open effect then throws the creation panel at someone mid-edit.
  it('SSFP-5: an empty list never claims an empty workbook while a sheet is open', () => {
    const sheet = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };
    mockListQuery = { data: [], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: { ...sheet, days: [DAY] }, isFetching: false, isPending: false, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(screen.getByTestId('sheet-card')).toBeInTheDocument();
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-sheet-panel')).not.toBeInTheDocument();
  });

  it('SSFP-6: a failed list reports the failure, never "no scheduling sheets yet"', () => {
    mockListQuery = {
      data: undefined, isPending: false, isFetching: false,
      isError: true, error: new Error('Could not load scheduling sheets'), refetch: vi.fn(),
    };
    renderPage();

    expect(screen.getByTestId('workbook-list-error')).toBeInTheDocument();
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
    // A failed read must not auto-open the creation panel at someone who
    // already has workbooks the app simply could not fetch.
    expect(screen.queryByTestId('new-sheet-panel')).not.toBeInTheDocument();
  });

  it('SSFP-7: a deep-linked sheet still resolving holds the empty state back', () => {
    mockListQuery = { data: [], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: null, isFetching: true, isPending: true, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-sheet-panel')).not.toBeInTheDocument();
  });
});

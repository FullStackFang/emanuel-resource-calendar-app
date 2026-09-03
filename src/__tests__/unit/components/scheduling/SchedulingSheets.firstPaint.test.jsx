// SchedulingSheets.firstPaint.test.jsx
//
// The workbook page's loading contract (task 6.8): `loading` binds to
// deriveListLoadingState().isFirstLoad on the workbook-list query, the
// empty-workbook state renders only after a genuine resolve (and auto-opens
// the creation panel, design D8 #7), and a loaded workbook lands on the grid
// with day tabs.
//
// Test IDs: SSFP-1 to SSFP-12

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
// Surface the props: 'the same loading wheel as the rest of the app' IS the
// variant/text contract (LoadingSpinner renders the shared RoseSpinner either
// way), so the variant is what these tests must assert.
// `size` is surfaced because it was half of the 'the wheels are different'
// bug: Calendar renders ROSE_DEFAULT_SIZE (64) and this page was passing 40.
vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: ({ variant = 'default', text = '', className = '', size }) => (
    <div
      data-testid="loading-spinner"
      data-variant={variant}
      data-text={text}
      data-classname={className}
      data-size={size === undefined ? 'default' : String(size)}
    />
  ),
}));

// The veil is always mounted and class-toggled (so it fades), so presence
// proves nothing — 'visible' vs 'hidden' is the assertion.
const veil = (screenApi) =>
  screenApi.getAllByTestId('loading-spinner').find((el) => el.dataset.variant === 'overlay');

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
  it('SSFP-1: pending && idle holds the loading veil, never the empty workbook state', () => {
    mockListQuery = { data: undefined, isPending: true, isFetching: false, isError: false, refetch: vi.fn() };
    renderPage();

    expect(veil(screen)).toHaveAttribute('data-classname', 'visible initial');
    expect(veil(screen)).toHaveAttribute('data-text', 'Loading scheduling sheets...');
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-sheet-panel')).not.toBeInTheDocument();
  });

  // The whole point of the rework: ONE loading element, one position, one size.
  // A second gate elsewhere on the page put the wheel at a different height.
  it('SSFP-12: every loading state uses the one veil, at the default wheel size', () => {
    const listed = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };

    mockListQuery = { data: undefined, isPending: true, isFetching: false, isError: false, refetch: vi.fn() };
    const first = renderPage();
    expect(screen.getAllByTestId('loading-spinner')).toHaveLength(1);
    expect(veil(screen)).toHaveAttribute('data-size', 'default');
    first.unmount();

    mockListQuery = { data: [listed], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: null, isFetching: true, isPending: true, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');
    expect(screen.getAllByTestId('loading-spinner')).toHaveLength(1);
    expect(veil(screen)).toHaveAttribute('data-size', 'default');
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

  // Picking a sheet swaps the detail query's key, so `sheet` goes null while the
  // new one loads. Without a gate the content region simply blanks. The app's
  // convention for a content-region gate is the card-variant spinner rendered
  // BELOW the page chrome (EventManagement keeps its tab bar) — not an early
  // return that takes the picker away with it.
  it('SSFP-8: selecting a sheet shows the standard card spinner under the page chrome', () => {
    const listed = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };
    mockListQuery = { data: [listed], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: null, isFetching: true, isPending: true, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(veil(screen)).toHaveAttribute('data-classname', 'visible');
    expect(veil(screen)).toHaveAttribute('data-text', 'Loading sheet...');
    // The chrome stays put underneath: this is a veil, not a page replacement.
    expect(screen.getByTestId('workbook-picker')).toBeInTheDocument();
    expect(screen.getByTestId('day-tabs')).toBeInTheDocument();
  });

  it('SSFP-10: a resolved sheet leaves the veil mounted but hidden, so it can fade', () => {
    const listed = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };
    mockListQuery = { data: [listed], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: { ...listed, days: [DAY] }, isFetching: false, isPending: false, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(veil(screen)).toHaveAttribute('data-classname', 'hidden');
    expect(screen.getByTestId('sheet-card')).toBeInTheDocument();
  });

  // Cell writes invalidate the sheet detail on EVERY save. Veiling on a plain
  // background refetch would flash the whole page on each keystroke-save, so
  // the veil is gated on isPending only, never on isFetching.
  it('SSFP-11: a background refetch of the open sheet never raises the veil', () => {
    const listed = { _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: DAY.date, title: DAY.title }] };
    mockListQuery = { data: [listed], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: { ...listed, days: [DAY] }, isFetching: true, isPending: false, refetch: vi.fn() };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(veil(screen)).toHaveAttribute('data-classname', 'hidden');
    expect(screen.getByTestId('sheet-card')).toBeInTheDocument();
  });

  it('SSFP-9: a sheet that fails to load says so instead of rendering blank', () => {
    const listed = { _id: 's1', name: '2099 High Holy Days', days: [] };
    mockListQuery = { data: [listed], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = {
      data: null, isFetching: false, isPending: false,
      isError: true, error: new Error('Could not load the scheduling sheet'), refetch: vi.fn(),
    };
    renderPage('/?sheet=s1&date=2099-09-11');

    expect(screen.getByTestId('sheet-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workbook-empty')).not.toBeInTheDocument();
  });
});

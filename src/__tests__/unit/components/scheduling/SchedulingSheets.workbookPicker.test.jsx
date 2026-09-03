// SchedulingSheets.workbookPicker.test.jsx
//
// The workbook picker's dismissal contract and the per-workbook Duplicate
// action.
//
// Dismissal: both popovers in the top bar (the workbook picker and the day
// sheet's '...' menu) were open-until-clicked-again. Nothing closed them when
// attention moved elsewhere on the page, so the picker hung over the grid, and
// the '...' menu could sit there with a destructive 'Confirm?' still armed.
//
// Duplicate: cloning a workbook needs NO new endpoint — POST
// /api/scheduling-sheets already takes copyFromSheetId and maps the source's
// days onto sorted seedDates in order. Duplicate therefore opens the ordinary
// New Sheet panel with name / seed dates / copy-from prefilled, so the dates
// stay editable (a duplicate is usually 'same structure, next year').
//
// Test IDs: SSWP-1 to SSWP-8

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api', CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'sandbox@x.org', PRODUCTION_CALENDAR: 'prod@x.org' } },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../utils/logger.js', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
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
let createSheetMutation;
vi.mock('../../../../hooks/useSchedulingSheets', () => ({
  useSchedulingSheetList: () => mockListQuery,
  useSchedulingSheet: () => mockDetailQuery,
  useSheetUserLookup: () => ({ data: [], refetch: vi.fn() }),
  useSchedulingSheetMutations: () => ({
    createSheet: createSheetMutation,
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

// Dates deliberately OUT of chronological order: the list endpoint sorts them,
// but the prefill must not depend on that — copyFromSheetId maps source days
// onto seedDates in order, so an unsorted seed list mis-pairs every day.
const SHEET_A = {
  _id: 's1',
  name: '2099 High Holy Days',
  days: [
    { _id: 'd2', date: '2099-09-20', title: 'Yom Kippur' },
    { _id: 'd1', date: '2099-09-11', title: 'Erev RH' },
  ],
};
const SHEET_B = { _id: 's2', name: '2099 Passover', days: [{ _id: 'd3', date: '2099-04-01', title: null }] };

function renderPage() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  return render(
    <MemoryRouter>
      <SchedulingSheets />
    </MemoryRouter>,
    { wrapper: withQueryClient() }
  );
}

describe('SchedulingSheets — workbook picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSheetMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    mockListQuery = { data: [SHEET_A, SHEET_B], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = {
      data: { ...SHEET_A, days: [DAY] },
      isPending: false, isFetching: false, isError: false, refetch: vi.fn(),
    };
  });

  it('SSWP-1: a mousedown outside the picker closes it', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('workbook-picker'));
    expect(screen.getByTestId('workbook-menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('workbook-menu')).not.toBeInTheDocument();
  });

  // The guard has to be a containment test, not a blanket document listener —
  // clicking a workbook row inside the menu must still reach its own handler.
  it('SSWP-2: a mousedown inside the menu leaves it open', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('workbook-picker'));

    fireEvent.mouseDown(screen.getByTestId('workbook-menu'));
    expect(screen.getByTestId('workbook-menu')).toBeInTheDocument();
  });

  it('SSWP-3: Escape closes the picker', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('workbook-picker'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('workbook-menu')).not.toBeInTheDocument();
  });

  // The '...' menu holds two-step destructive actions. Left open with a
  // 'Confirm?' armed, the next stray click on it deletes a day.
  it('SSWP-4: an outside mousedown closes the sheet menu and disarms its confirm', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('sheet-menu-button'));
    fireEvent.click(screen.getByTestId('delete-day-button'));
    expect(screen.getByTestId('delete-day-button')).toHaveTextContent('Confirm?');

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('sheet-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sheet-menu-button'));
    expect(screen.getByTestId('delete-day-button')).toHaveTextContent('Delete day');
  });

  it('SSWP-5: the trigger reports its expanded state', () => {
    renderPage();
    const trigger = screen.getByTestId('workbook-picker');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('SSWP-6: Duplicate opens the new-sheet panel prefilled from that workbook', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('workbook-picker'));
    fireEvent.click(screen.getByTestId('duplicate-sheet-s2'));

    expect(screen.queryByTestId('workbook-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-sheet-panel')).toBeInTheDocument();
    expect(screen.getByTestId('new-sheet-name')).toHaveValue('2099 Passover (Copy)');
    expect(screen.getByTestId('new-sheet-copyfrom')).toHaveValue('s2');
  });

  // The payload is the real assertion: an unsorted seed list would land the
  // source's day structures against the wrong dates server-side.
  it('SSWP-7: the duplicate carries the source dates, sorted, with copyFromSheetId', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('workbook-picker'));
    fireEvent.click(screen.getByTestId('duplicate-sheet-s1'));
    fireEvent.click(screen.getByTestId('create-sheet-button'));

    expect(createSheetMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '2099 High Holy Days (Copy)',
        seedDates: ['2099-09-11', '2099-09-20'],
        copyFromSheetId: 's1',
      }),
      expect.anything()
    );
  });

  // jsdom applies no stylesheets, so the dropdown's width is invisible to any
  // behavioural test — the source assertion is the only thing that can catch a
  // regression back to the cramped 280px column.
  it('SSWP-8: the dropdown is given real width in the stylesheet', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/scheduling/SchedulingSheets.css'),
      'utf8'
    );
    const block = css.slice(css.indexOf('.ss-workbook-menu {'));
    const minWidth = /min-width:\s*(\d+)px/.exec(block);
    expect(minWidth).not.toBeNull();
    expect(Number(minWidth[1])).toBeGreaterThanOrEqual(360);
  });
});

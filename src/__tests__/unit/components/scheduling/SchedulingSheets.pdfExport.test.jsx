// SchedulingSheets.pdfExport.test.jsx
//
// The printer button exports the WHOLE workbook as a landscape PDF. All the
// rendering logic lives in schedulingSheetPdf.js (covered by its own suite);
// what this file locks is the wiring: what the page hands the generator, that
// a download actually fires, and that both the truncated and failed cases are
// reported honestly instead of looking like success.
//
// Test IDs: SSPE-1 to SSPE-6

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

const showSuccess = vi.fn();
const showError = vi.fn();
const generateSchedulingSheetPdf = vi.fn();

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api', CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'sandbox@x.org', PRODUCTION_CALENDAR: 'prod@x.org' } },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ apiToken: 'token' }) }));
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showError, showWarning: vi.fn() }),
}));
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, canManageAssignments: true }),
}));
vi.mock('../../../../hooks/useLocationsQuery', () => ({ useLocationsQuery: () => ({ data: [] }) }));
vi.mock('../../../../utils/schedulingSheetPdf', () => ({ generateSchedulingSheetPdf }));

const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
let mockListQuery;
let mockDetailQuery;
vi.mock('../../../../hooks/useSchedulingSheets', () => ({
  useSchedulingSheetList: () => mockListQuery,
  useSchedulingSheet: () => mockDetailQuery,
  useSheetUserLookup: () => ({ data: [], refetch: vi.fn() }),
  useSchedulingSheetMutations: () => ({
    createSheet: noopMutation(), renameSheet: noopMutation(), deleteSheet: noopMutation(),
    createDay: noopMutation(), deleteDay: noopMutation(), updateStructure: noopMutation(),
    updateCell: noopMutation(), sendSchedules: noopMutation(),
  }),
}));

import SchedulingSheets from '../../../../components/scheduling/SchedulingSheets';

const ROWS = [{ id: 'r1', label: 'Location', kind: 'starter' }];
const day = (id, date, title) => ({
  _id: id, date, title, _version: 1,
  rows: ROWS, columns: [], cells: {}, taggedEmails: [], emailLog: [], emailStatus: [],
});

const SHEET = {
  _id: 's1',
  name: '2099 High Holy Days',
  days: [day('d1', '2099-09-11', 'Erev RH'), day('d2', '2099-09-12', 'RH Day 1')],
};

function renderPage() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  return render(
    <MemoryRouter initialEntries={['/?sheet=s1&date=2099-09-11']}>
      <SchedulingSheets />
    </MemoryRouter>,
    { wrapper: withQueryClient() }
  );
}

const clickExport = async () => {
  await act(async () => { fireEvent.click(screen.getByTestId('export-pdf-button')); });
};

describe('SchedulingSheets - PDF export', () => {
  let clickSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListQuery = { data: [{ _id: 's1', name: SHEET.name, days: SHEET.days }], isPending: false, isFetching: false, isError: false, refetch: vi.fn() };
    mockDetailQuery = { data: SHEET, isFetching: false, isPending: false, refetch: vi.fn() };
    generateSchedulingSheetPdf.mockReturnValue({
      blob: new Blob(['pdf']), blobUrl: 'blob:mock',
      fileName: 'emanu-el-scheduling-2099-high-holy-days-2099-09-11.pdf',
      dayCount: 2, omittedDays: 0,
    });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
    // jsdom would otherwise attempt a real navigation on the download anchor.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  // The button used to call window.print(), which printed only the day on
  // screen. The whole workbook is the unit now.
  it('SSPE-1: hands the generator the whole workbook, not just the open day', async () => {
    renderPage();
    await clickExport();

    expect(generateSchedulingSheetPdf).toHaveBeenCalledTimes(1);
    const arg = generateSchedulingSheetPdf.mock.calls[0][0];
    expect(arg.sheet.days).toHaveLength(2);
    expect(arg.sheet.name).toBe('2099 High Holy Days');
    // The drift flag needs live events; an absent map would silently mark
    // every linked column as 'no longer exists'.
    expect(arg.liveEventsById).toBeInstanceOf(Map);
  });

  it('SSPE-2: downloads the generated file under the generator filename', async () => {
    renderPage();
    await clickExport();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const link = clickSpy.mock.instances[0];
    expect(link.download).toBe('emanu-el-scheduling-2099-high-holy-days-2099-09-11.pdf');
    expect(link.href).toContain('blob:mock');
    expect(link.isConnected).toBe(false); // cleaned up after the click
  });

  it('SSPE-3: reports how many days were exported', async () => {
    renderPage();
    await clickExport();

    expect(showSuccess).toHaveBeenCalledWith(expect.stringContaining('2 days'));
    expect(showError).not.toHaveBeenCalled();
  });

  // A capped workbook that reports plain success would let a manager hand out
  // a binder missing days without ever knowing.
  it('SSPE-4: says so when the day cap left days out', async () => {
    generateSchedulingSheetPdf.mockReturnValue({
      blob: new Blob(['pdf']), blobUrl: 'blob:mock', fileName: 'x.pdf', dayCount: 31, omittedDays: 4,
    });
    renderPage();
    await clickExport();

    const message = showSuccess.mock.calls[0][0];
    expect(message).toContain('first 31 days');
    expect(message).toContain('4 more');
  });

  it('SSPE-5: surfaces a generator failure and leaves the button usable', async () => {
    generateSchedulingSheetPdf.mockImplementation(() => { throw new Error('boom'); });
    renderPage();
    await clickExport();

    expect(showError).toHaveBeenCalledWith(expect.stringContaining('Could not generate'));
    expect(showSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('export-pdf-button')).not.toBeDisabled();
  });

  // The button is icon-only now (an inline SVG, per CalendarIcons' convention).
  // The emoji it replaced was acting as the accessible name, so dropping it
  // without an aria-label would leave screen readers announcing an empty
  // button - a silent regression no visual check would catch.
  it('SSPE-7: the icon-only button still exposes an accessible name', async () => {
    renderPage();

    const button = screen.getByRole('button', { name: /export scheduling sheet as pdf/i });
    expect(button).toBe(screen.getByTestId('export-pdf-button'));
    expect(button.textContent).toBe('');       // no text label to fall back on
    expect(button.querySelector('svg')).toBeTruthy();
  });

  it('SSPE-6: a workbook with no days cannot be exported', async () => {
    mockDetailQuery = { data: { ...SHEET, days: [] }, isFetching: false, isPending: false, refetch: vi.fn() };
    renderPage();

    expect(screen.queryByTestId('export-pdf-button')).not.toBeInTheDocument();
    expect(generateSchedulingSheetPdf).not.toHaveBeenCalled();
  });
});

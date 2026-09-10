// SchedulingSheets.calendarWarning.test.jsx
//
// The page-level half of the calendar attachment (task 5.2): `sendSchedules`
// surfaces a server `calendarWarning` as its own warning toast, separately
// from the PDF's `attachmentWarning`. The two attachments fail independently,
// so folding them into one message would leave a sender unable to tell WHICH
// artifact is missing from thirty people's mail.
//
// Test IDs: SEP-9 to SEP-11, SPS-1 to SPS-2 (PDF day scope)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: {
      DEFAULT_MODE: 'sandbox',
      SANDBOX_CALENDAR: 'sandbox@x.org',
      PRODUCTION_CALENDAR: 'prod@x.org',
    },
  },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ apiToken: 'token' }) }));
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, canManageAssignments: true }),
}));
vi.mock('../../../../hooks/useLocationsQuery', () => ({ useLocationsQuery: () => ({ data: [] }) }));

// jsPDF and its embedded faces are a frontend-only, ~900-line layout; the PDF
// is not what this suite is about. Stubbed so the send reaches the mutation.
// A SPY rather than a fixed stub, so a test can assert which days were handed
// to the renderer — that is the whole question for a day-scoped send.
const generateSchedulingSheetPdf = vi.hoisted(() => vi.fn());
vi.mock('../../../../utils/schedulingSheetPdf', () => ({ generateSchedulingSheetPdf }));

const pdfResult = (omittedDays = 0) => ({
  blob: { arrayBuffer: async () => new ArrayBuffer(4) },
  blobUrl: 'blob:stub',
  fileName: 'sheet.pdf',
  omittedDays,
});

const showWarning = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showWarning, showError }),
}));

const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
let sendMutateAsync;
vi.mock('../../../../hooks/useSchedulingSheets', () => ({
  useSchedulingSheetList: () => ({
    data: [{ _id: 's1', name: '2099 High Holy Days', days: [{ _id: 'd1', date: '2099-09-11', title: 'Erev RH' }] }],
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSchedulingSheet: () => ({ data: SHEET, isPending: false, isFetching: false, refetch: vi.fn() }),
  useSheetUserLookup: () => ({ data: [] }),
  useSchedulingSheetMutations: () => ({
    createSheet: noopMutation(),
    renameSheet: noopMutation(),
    deleteSheet: noopMutation(),
    createDay: noopMutation(),
    deleteDay: noopMutation(),
    updateStructure: noopMutation(),
    updateCell: noopMutation(),
    sendSchedules: { mutate: vi.fn(), mutateAsync: sendMutateAsync, isPending: false },
  }),
}));

import SchedulingSheets from '../../../../components/scheduling/SchedulingSheets';

const DAY = {
  _id: 'd1',
  sheetId: 's1',
  date: '2099-09-11',
  title: 'Erev RH',
  _version: 3,
  rows: [
    { id: 'rLoc', label: 'Location', kind: 'starter' },
    { id: 'rUshers', label: 'Ushers', kind: 'custom' },
  ],
  columns: [{ id: 'c1', name: 'Erev Service' }],
  cells: {
    'rUshers:c1': {
      segments: [{ type: 'person', userId: 'u1', name: 'Sarah', email: 'sarah@x.org', placeholder: false, callTimeOverride: null }],
      note: null,
    },
  },
  taggedEmails: ['sarah@x.org'],
  emailLog: [],
  emailStatus: [],
};
// A second day carrying a DIFFERENT person, so a selection that is wrong in
// either direction changes both the roster and the PDF's day list.
const DAY2 = {
  ...DAY,
  _id: 'd2',
  date: '2099-09-20',
  title: 'Kol Nidre',
  _version: 5,
  cells: {
    'rUshers:c1': {
      segments: [{ type: 'person', userId: 'u2', name: 'Ben', email: 'ben@x.org', placeholder: false, callTimeOverride: null }],
      note: null,
    },
  },
  taggedEmails: ['ben@x.org'],
};
const SHEET = { _id: 's1', name: '2099 High Holy Days', days: [DAY, DAY2] };

async function sendOnce(outcome) {
  sendMutateAsync.mockResolvedValue(outcome);
  render(
    <MemoryRouter initialEntries={['/?sheet=s1&date=2099-09-11']}>
      <SchedulingSheets />
    </MemoryRouter>,
    { wrapper: withQueryClient() }
  );

  fireEvent.click(screen.getByTestId('email-schedules-button'));
  const button = await screen.findByTestId('send-schedules-button');
  fireEvent.click(button); // arms the confirm
  fireEvent.click(button); // sends
  await screen.findByTestId('send-results');
}

describe('SchedulingSheets — calendar attachment warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMutateAsync = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    // buildSchedulePdfAttachment revokes the object URL it never downloads;
    // jsdom does not implement it.
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() });
    generateSchedulingSheetPdf.mockReturnValue(pdfResult(0));
  });

  it('SEP-9: a server calendarWarning raises its own warning toast', async () => {
    await sendOnce({
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: true,
      calendarAttached: false,
      calendarWarning: 'The calendar attachment could not be generated and was not attached.',
    });

    await waitFor(() =>
      expect(showWarning).toHaveBeenCalledWith('The calendar attachment could not be generated and was not attached.')
    );
  });

  it('SEP-10: a clean send warns about nothing', async () => {
    await sendOnce({
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: true,
      calendarAttached: true,
    });

    expect(showWarning).not.toHaveBeenCalled();
  });

  // Both attachments can fail in the same send, and a sender needs to know
  // that BOTH are missing — not just whichever the code checked first.
  it('SEP-11: a PDF failure and a calendar failure are reported separately', async () => {
    await sendOnce({
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: false,
      attachmentWarning: 'The schedule PDF was not valid base64 and was not attached.',
      calendarAttached: false,
      calendarWarning: 'The calendar attachment could not be generated and was not attached.',
    });

    await waitFor(() => expect(showWarning).toHaveBeenCalledTimes(2));
    expect(showWarning).toHaveBeenCalledWith('The schedule PDF was not valid base64 and was not attached.');
    expect(showWarning).toHaveBeenCalledWith('The calendar attachment could not be generated and was not attached.');
  });

  // ── PDF scope ───────────────────────────────────────────────────────────────
  // The attachment used to be built from the WHOLE workbook regardless of what
  // was being emailed, so a one-day send arrived with every day's grid: the body
  // said one thing and the attachment beside it said another.

  it('SPS-1: the emailed PDF is built from only the selected days', async () => {
    await sendOnce({
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: true,
      calendarAttached: true,
    });

    // The panel opens on the active day alone, so the renderer must see ONLY it.
    expect(generateSchedulingSheetPdf).toHaveBeenCalledTimes(1);
    const passed = generateSchedulingSheetPdf.mock.calls[0][0].sheet;
    expect(passed.days.map((d) => d._id)).toEqual(['d1']);
    // ...and the untouched workbook still carries both days.
    expect(SHEET.days).toHaveLength(2);
  });

  it('SPS-2: a selection the renderer cannot cover is refused, never silently trimmed', async () => {
    // The generator TRUNCATES past its day cap and notes it on the cover, which
    // is right for a print button and wrong for a send: a selected day missing
    // from the attachment misrepresents what was emailed.
    generateSchedulingSheetPdf.mockReturnValue(pdfResult(3));

    await sendOnce({
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: false,
      calendarAttached: true,
    });

    // The send still goes out — the body is self-contained — but the sender is
    // told the PDF was dropped and why.
    await waitFor(() => expect(showWarning).toHaveBeenCalled());
    expect(showWarning.mock.calls.map((c) => c[0]).join(' ')).toMatch(/fewer days/i);
    expect(sendMutateAsync.mock.calls[0][0]).not.toHaveProperty('attachment');
  });
});

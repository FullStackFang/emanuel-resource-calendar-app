// SchedulingSheets.calendarWarning.test.jsx
//
// The page-level half of the calendar attachment (task 5.2): `sendSchedules`
// surfaces a server `calendarWarning` as its own warning toast, separately
// from the PDF's `attachmentWarning`. The two attachments fail independently,
// so folding them into one message would leave a sender unable to tell WHICH
// artifact is missing from thirty people's mail.
//
// Test IDs: SEP-9 to SEP-11

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
vi.mock('../../../../utils/schedulingSheetPdf', () => ({
  generateSchedulingSheetPdf: () => ({
    blob: { arrayBuffer: async () => new ArrayBuffer(4) },
    blobUrl: 'blob:stub',
    fileName: 'sheet.pdf',
  }),
}));

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
const SHEET = { _id: 's1', name: '2099 High Holy Days', days: [DAY] };

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
});

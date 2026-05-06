// src/__tests__/unit/components/RschedImport.test.jsx
//
// Frontend smoke tests for the rsched import wizard.
//
// Scope: permission gate, sessions list rendering, upload modal toggle,
// status filter tabs, two-step confirm pattern (commit/discard).
//
// Backend behavior (parsing, upsert, conflicts) is covered by
// backend/__tests__/integration/rschedImport/*.test.js — these tests cover
// only the React component logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
let mockIsAdmin = true;
let mockFetchImpl = vi.fn();

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: {
      DEFAULT_MODE: 'sandbox',
      SANDBOX_CALENDAR: 'sandbox@test.com',
      PRODUCTION_CALENDAR: 'prod@test.com',
    },
  },
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: mockIsAdmin }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetchImpl,
}));

import RschedImport from '../../../components/RschedImport';

function makeRes(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  mockIsAdmin = true;
  mockShowSuccess.mockReset();
  mockShowError.mockReset();
  mockFetchImpl = vi.fn().mockImplementation((url) => {
    if (typeof url === 'string' && url.endsWith('/admin/rsched-import/sessions')) {
      return Promise.resolve(
        makeRes({
          sessions: [
            {
              sessionId: 'sess-1',
              uploadedAt: '2026-04-01T00:00:00Z',
              calendarOwner: 'sandbox@emanuelnyc.org',
              csvFilename: 'rsched.csv',
              dateRangeStart: '2026-04-01',
              dateRangeEnd: '2026-04-30',
              rowCount: 25,
              statusBreakdown: { staged: 20, conflict: 3, unmatched_location: 2 },
            },
          ],
        }),
      );
    }
    return Promise.resolve(makeRes({}));
  });
});

describe('RschedImport — permission gate', () => {
  it('renders Access Denied for non-admins', () => {
    mockIsAdmin = false;
    render(<RschedImport />);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });
});

describe('RschedImport — sessions list', () => {
  it('shows the existing session row', async () => {
    render(<RschedImport />);
    await waitFor(() => {
      expect(screen.getByText('rsched.csv')).toBeInTheDocument();
    });
    expect(screen.getByText('sandbox@emanuelnyc.org')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // rowCount
  });

  it('shows the empty-state message when there are no sessions', async () => {
    mockFetchImpl = vi.fn().mockResolvedValue(makeRes({ sessions: [] }));
    render(<RschedImport />);
    await waitFor(() => {
      expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
    });
  });

  it('toggles the upload modal on +Upload click', async () => {
    render(<RschedImport />);
    await waitFor(() => screen.getByText('+ Upload CSV'));
    fireEvent.click(screen.getByText('+ Upload CSV'));
    expect(screen.getByText('Upload rsched CSV')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Upload rsched CSV')).not.toBeInTheDocument();
  });
});

describe('RschedImport — session view', () => {
  beforeEach(() => {
    mockFetchImpl = vi.fn().mockImplementation((url, opts) => {
      const u = String(url);
      if (u.endsWith('/admin/rsched-import/sessions')) {
        return Promise.resolve(
          makeRes({
            sessions: [
              {
                sessionId: 'sess-1',
                uploadedAt: '2026-04-01T00:00:00Z',
                calendarOwner: 'sandbox@test.com',
                csvFilename: 'rsched.csv',
                dateRangeStart: '2026-04-01',
                dateRangeEnd: '2026-04-30',
                rowCount: 3,
                statusBreakdown: { staged: 3 },
              },
            ],
          }),
        );
      }
      if (u.endsWith('/admin/rsched-import/sessions/sess-1')) {
        return Promise.resolve(
          makeRes({
            sessionId: 'sess-1',
            calendarOwner: 'sandbox@test.com',
            csvFilename: 'rsched.csv',
            dateRangeStart: '2026-04-01',
            dateRangeEnd: '2026-04-30',
            rowCount: 3,
            statusBreakdown: { staged: 3 },
          }),
        );
      }
      if (u.includes('/admin/rsched-import/sessions/sess-1/rows')) {
        return Promise.resolve(
          makeRes({
            total: 3,
            page: 1,
            pageSize: 50,
            rows: [
              {
                _id: 'row-1',
                rsId: 1,
                eventTitle: 'Torah Study',
                startDateTime: '2026-04-02T09:00:00',
                endDateTime: '2026-04-02T10:15:00',
                locationDisplayNames: '6th Floor Lounge',
                rsKey: '602',
                status: 'staged',
              },
              {
                _id: 'row-2',
                rsId: 2,
                eventTitle: 'Conflict Event',
                startDateTime: '2026-04-03T10:00:00',
                endDateTime: '2026-04-03T11:00:00',
                locationDisplayNames: 'Main Sanctuary',
                rsKey: 'TPL',
                status: 'conflict',
                conflictReason: '1 hard conflict',
              },
              {
                _id: 'row-3',
                rsId: 3,
                eventTitle: 'Skipped Item',
                startDateTime: '2026-04-04T10:00:00',
                endDateTime: '2026-04-04T11:00:00',
                locationDisplayNames: '602',
                rsKey: '602',
                status: 'skipped',
              },
            ],
          }),
        );
      }
      if (opts?.method === 'DELETE') {
        return Promise.resolve(makeRes({ deleted: 3 }));
      }
      return Promise.resolve(makeRes({}));
    });
  });

  it('shows committal action buttons after opening a session', async () => {
    render(<RschedImport />);
    await waitFor(() => screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => screen.getByText('Validate'));
    expect(screen.getByText('Commit to MongoDB')).toBeInTheDocument();
    expect(screen.getByText('Publish to Outlook')).toBeInTheDocument();
    expect(screen.getByText('Discard session')).toBeInTheDocument();
  });

  it('uses two-step confirm: first click sets confirm, second click executes', async () => {
    render(<RschedImport />);
    await waitFor(() => screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => screen.getByText('Discard session'));

    fireEvent.click(screen.getByText('Discard session'));
    expect(screen.getByText('Confirm discard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirm discard'));
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith(
        expect.stringContaining('Discarded session'),
      );
    });
  });

  it('escape key resets confirm states', async () => {
    render(<RschedImport />);
    await waitFor(() => screen.getByText('Open'));
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => screen.getByText('Commit to MongoDB'));

    fireEvent.click(screen.getByText('Commit to MongoDB'));
    expect(screen.getByText('Confirm commit')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Confirm commit')).not.toBeInTheDocument();
    });
  });
});

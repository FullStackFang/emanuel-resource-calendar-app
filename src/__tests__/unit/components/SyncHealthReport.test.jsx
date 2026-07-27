import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SyncHealthReport from '../../../components/SyncHealthReport';

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncHealthReport apiToken="test-token" />
    </QueryClientProvider>
  );
};

const respondWith = (body) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
};

describe('SyncHealthReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The idle state is a legitimate prompt, NOT a spinner — this page's
  // `enabled` is a deliberate user action (the Run Check button).
  it('shows the idle prompt before the first run and does not fetch', () => {
    respondWith({ window: {}, calendars: [] });
    renderPage();

    expect(screen.getByRole('button', { name: /run check/i })).toBeInTheDocument();
    expect(screen.getByText(/choose a date range/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders an all-green banner when a calendar has no findings', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org',
        calendarId: null,
        error: null,
        counts: { appExpected: 12, outlookFound: 12, matched: 12 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText(/app and outlook agree/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/12 instances matched/i)).toBeInTheDocument();
  });

  it('renders discrepancy rows for a calendar with findings', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org',
        calendarId: null,
        error: null,
        counts: { appExpected: 14, outlookFound: 13, matched: 12 },
        missingFromOutlook: [{
          mongoId: 'a1', eventTitle: 'Extra Rehearsal', date: '2026-08-20',
          eventType: 'addition', reason: 'no Outlook event for added date',
        }],
        untethered: [{ mongoId: 'm1', eventTitle: 'Orphan Series', eventType: 'seriesMaster' }],
        shouldNotBeInOutlook: [{
          graphId: 'g9', subject: 'Cancelled Standup', date: '2026-09-02',
          reason: 'excluded date still present',
        }],
        untracked: [{ graphId: 'stray', subject: 'Booked in Outlook', date: '2026-08-01' }],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText('Extra Rehearsal')).toBeInTheDocument();
    });
    expect(screen.getByText(/no Outlook event for added date/i)).toBeInTheDocument();
    expect(screen.getByText('Orphan Series')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Standup')).toBeInTheDocument();
    expect(screen.queryByText(/app and outlook agree/i)).not.toBeInTheDocument();
  });

  it('renders an error card for a calendar whose Graph call failed', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'broken@emanuelnyc.org',
        calendarId: null,
        error: 'Graph is down',
        counts: { appExpected: 4, outlookFound: 0, matched: 0 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run check/i }));

    await waitFor(() => {
      expect(screen.getByText(/graph is down/i)).toBeInTheDocument();
    });
    expect(screen.getByText('broken@emanuelnyc.org')).toBeInTheDocument();
  });
});

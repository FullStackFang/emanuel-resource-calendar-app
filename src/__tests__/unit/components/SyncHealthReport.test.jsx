import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

// The calendar picker is populated from the same admin-managed allowlist the
// calendar view uses (calendar-config.json -> allowedDisplayCalendars), served
// by /calendar-display-config. Today it holds only TempleEvents.
const ALLOWED = {
  allowedDisplayCalendars: ['TempleEvents@emanuelnyc.org'],
  defaultCalendar: 'TempleEvents@emanuelnyc.org',
};

const respondWith = (body, { allowed = ALLOWED } = {}) => {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (String(url).includes('/calendar-display-config')) {
      return Promise.resolve({ ok: true, json: async () => allowed });
    }
    return Promise.resolve({ ok: true, json: async () => body });
  });
};

const reportCalls = () =>
  (global.fetch.mock?.calls || []).filter(([u]) => String(u).includes('/reports/sync-health'));

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
    // The allowlist fetch is expected on mount; the report itself is not.
    expect(reportCalls()).toHaveLength(0);
  });

  it('populates the calendar picker from the allowed-calendars config', async () => {
    respondWith({ window: {}, calendars: [] });
    renderPage();

    const select = await screen.findByLabelText(/calendar/i);
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /TempleEvents@emanuelnyc\.org/i })
        .selected).toBe(true);
    });
    // Only the allow-listed mailbox is offered, so the sandbox cannot be run.
    expect(within(select).getAllByRole('option')).toHaveLength(1);
    expect(within(select).queryByRole('option', { name: /sandbox/i })).toBeNull();
  });

  it('sends the selected calendar as calendarOwner', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'TempleEvents@emanuelnyc.org', calendarId: null, error: null,
        counts: { appExpected: 1, outlookFound: 1, matched: 1 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => expect(reportCalls()).toHaveLength(1));
    expect(reportCalls()[0][0]).toContain(
      `calendarOwner=${encodeURIComponent('TempleEvents@emanuelnyc.org')}`
    );
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

    // Run Check stays disabled until the calendar allowlist resolves and a
    // mailbox is selected, so wait on the button itself.
    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/app and outlook agree/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/nothing needs attention/i)).toBeInTheDocument();
    // The reconciliation sentence replaces the three bare counts.
    expect(screen.getByText(/they agree on/i)).toBeInTheDocument();
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

    // Run Check stays disabled until the calendar allowlist resolves and a
    // mailbox is selected, so wait on the button itself.
    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText('Extra Rehearsal')).toBeInTheDocument();
    });
    // Sections are named for what breaks, not for the API field name.
    expect(screen.getByText(/never linked to outlook/i)).toBeInTheDocument();
    expect(screen.getByText(/removed here, still on outlook/i)).toBeInTheDocument();
    expect(screen.queryByText(/untethered/i)).not.toBeInTheDocument();

    expect(screen.getByText('Orphan Series')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Standup')).toBeInTheDocument();
    expect(screen.getByText(/3 events need attention/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing needs attention/i)).not.toBeInTheDocument();

    // Informational findings stay collapsed so they cannot bury the real ones.
    expect(screen.queryByText('Booked in Outlook')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show 1 event/i })).toBeInTheDocument();
  });

  // The headline fix: a broken series is ONE row with N dates, not N rows.
  it('collapses a multi-date series into one row and reveals dates on click', async () => {
    const dates = ['2026-07-01', '2026-07-02', '2026-07-08', '2026-07-09'];
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org', calendarId: null, error: null,
        counts: { appExpected: 10, outlookFound: 6, matched: 6 },
        missingFromOutlook: dates.map((date) => ({
          mongoId: 'm1', eventTitle: 'NS Pick Up', eventType: 'seriesMaster',
          date, reason: 'no Outlook occurrence on this date',
        })),
        untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => expect(screen.getByText('NS Pick Up')).toBeInTheDocument());

    // One row, not four, and the dates are hidden until asked for.
    expect(screen.getAllByText('NS Pick Up')).toHaveLength(1);
    expect(screen.getByText('4 dates')).toBeInTheDocument();
    expect(screen.queryByText('2026-07-01')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('NS Pick Up'));
    for (const d of dates) {
      expect(screen.getByText(d)).toBeInTheDocument();
    }
  });

  // REGRESSION: with staleTime 0 the result was stale the moment it arrived, so
  // every tab-visibility event (the app refreshes its token on visibility) fired
  // another ~11s refetch. The results pane gates on isFetching, so the spinner
  // re-armed before the data could render — an infinite spinner.
  it('does not refetch when the tab regains focus', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'templeevents@emanuelnyc.org',
        calendarId: null,
        error: null,
        counts: { appExpected: 5, outlookFound: 5, matched: 5 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    renderPage();

    // Run Check stays disabled until the calendar allowlist resolves and a
    // mailbox is selected, so wait on the button itself.
    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/app and outlook agree/i)).toBeInTheDocument();
    });
    expect(reportCalls()).toHaveLength(1);

    // Simulate the tab being hidden and shown again — TanStack's focus manager
    // listens on visibilitychange.
    fireEvent(window, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));

    // Results must survive; no second request may be issued.
    await waitFor(() => {
      expect(screen.getByText(/app and outlook agree/i)).toBeInTheDocument();
    });
    expect(reportCalls()).toHaveLength(1);
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

    // Run Check stays disabled until the calendar allowlist resolves and a
    // mailbox is selected, so wait on the button itself.
    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/graph is down/i)).toBeInTheDocument();
    });
    expect(screen.getByText('broken@emanuelnyc.org')).toBeInTheDocument();
  });
});

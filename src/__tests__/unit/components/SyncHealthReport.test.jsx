import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SyncHealthReport from '../../../components/SyncHealthReport';

const toasts = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => toasts,
}));

// Reconcile is admin-only, narrower than the report itself. Tests flip this.
let mockIsAdmin = true;
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: mockIsAdmin }),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SyncHealthReport apiToken="test-token" />
      </QueryClientProvider>
    ),
  };
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
    mockIsAdmin = true;
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

    // One row, not four. The When column leads with the first date and says
    // how many more follow — a bare "4 dates" told you the size of the problem
    // but not when it happens, which is the thing you act on.
    expect(screen.getAllByText('NS Pick Up')).toHaveLength(1);
    expect(screen.getByText('2026-07-01 +3')).toBeInTheDocument();
    // The remaining dates still stay behind the disclosure.
    expect(screen.queryByText('2026-07-02')).not.toBeInTheDocument();

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

  // Frontend and backend deploy separately in this project, so a UI that sends
  // calendarOwner can be talking to an API that ignores it. The displayed
  // report must honour the picker regardless of what the API returns.
  it('shows only the selected calendar even if the API returns extra ones', async () => {
    const calendarFor = (owner) => ({
      calendarOwner: owner, calendarId: null, error: null,
      counts: { appExpected: 5, outlookFound: 5, matched: 5 },
      missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
    });

    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [
        calendarFor('templeevents@emanuelnyc.org'),
        calendarFor('templeeventssandbox@emanuelnyc.org'),
      ],
    });
    renderPage();

    const runBtn = screen.getByRole('button', { name: /run check/i });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText('templeevents@emanuelnyc.org')).toBeInTheDocument();
    });
    expect(screen.queryByText('templeeventssandbox@emanuelnyc.org')).not.toBeInTheDocument();
  });

  // Every Run Check mints a new query key on purpose (that is what forces a
  // refetch on an unchanged date range). Left alone, the cache accumulated one
  // full report per click — and a report holds a calendarView page per mailbox,
  // the largest payload this app keeps in memory.
  it('evicts stale report cache entries as runs accumulate', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'TempleEvents@emanuelnyc.org', calendarId: null, error: null,
        counts: { appExpected: 5, outlookFound: 5, matched: 5 },
        missingFromOutlook: [], untethered: [], shouldNotBeInOutlook: [], untracked: [],
      }],
    });
    const { queryClient } = renderPage();

    const runBtn = screen.getByRole('button', { name: /run check/i });
    for (let run = 1; run <= 3; run += 1) {
      await waitFor(() => expect(runBtn).toBeEnabled());
      fireEvent.click(runBtn);
      await waitFor(() => expect(reportCalls()).toHaveLength(run));
    }

    const cached = queryClient.getQueryCache().findAll({ queryKey: ['syncHealth', 'report'] });
    // The current run plus the one it replaced — never a third.
    expect(cached.length).toBeLessThanOrEqual(2);
    // The allowlist query is a different key and must survive.
    expect(queryClient.getQueryCache().findAll({ queryKey: ['syncHealth', 'calendars'] }))
      .toHaveLength(1);
  });

  // ── reconcile: the Fix panel ────────────────────────────────────────────

  describe('Fix panel', () => {
    const FINDINGS = {
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        calendarOwner: 'TempleEvents@emanuelnyc.org', calendarId: null, error: null,
        counts: { appExpected: 3, outlookFound: 3, matched: 2 },
        missingFromOutlook: [],
        // Untethered findings now carry a date, so a single instance stops
        // rendering as "whole series".
        untethered: [{
          mongoId: 'm1', eventTitle: 'Orphan Event',
          eventType: 'singleInstance', date: '2026-08-14',
          location: 'Lowenstein', startTime: '09:00', endTime: '12:00',
        }],
        shouldNotBeInOutlook: [{
          graphId: 'zombie-1', subject: 'Cancelled Concert', date: '2026-09-02',
          reason: 'deleted in app but still in Outlook',
        }],
        untracked: [],
      }],
    };

    const DELETE_PLAN = {
      findingType: 'shouldNotBeInOutlook',
      action: 'deleteOutlook',
      irreversible: true,
      recommendation: 'deleteOutlook',
      requiresAllowDuplicate: false,
      candidates: [],
      ops: [{
        op: 'graphDelete', graphId: 'zombie-1', irreversible: true,
        direction: 'Removes it from Outlook',
        description: 'Permanently delete the Outlook entry "Cancelled Concert" on 2026-09-02.',
      }],
      warnings: ['This Outlook entry has 2 attendee(s). Deleting it sends them a cancellation.'],
      expectedState: { findingType: 'shouldNotBeInOutlook', expiresAt: '2099-01-01T00:00:00.000Z' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };

    // Opening the panel fires a plan call with NO action — "what is this event,
    // and what does Outlook show that day". Every wiring must answer it, so it
    // lives here rather than being repeated in each test.
    const CONTEXT = {
      context: true,
      availableActions: ['linkExisting', 'archive', 'publish'],
      observed: {
        doc: {
          mongoId: 'm1', eventTitle: 'Orphan Event', date: '2026-08-14',
          startTime: '19:00', endTime: '21:00', status: 'published',
          eventType: 'singleInstance', locationDisplayNames: ['Streicker Center'],
          requestedByName: 'Charlotte Duber', createdAt: '2019-04-02T12:00:00.000Z',
        },
        // startTime arrives already converted to the calendar's timezone —
        // the server does it, so the page never prints a UTC instant beside
        // the app's local times.
        dayEvents: [
          { graphId: 'x1', subject: 'Someone Else Meeting', startTime: '14:00', endTime: '15:00' },
        ],
        dayEventsTotal: 1,
        candidates: [],
      },
    };

    /**
     * Route the report, the allowlist, and the two reconcile endpoints.
     * `reconcile` receives the parsed request body and returns {status, body}.
     * Context calls (no action) are answered automatically so tests only
     * describe the behaviour they are actually about.
     */
    const wireApi = (reconcile) => {
      global.fetch = vi.fn().mockImplementation((url, init) => {
        const href = String(url);
        if (href.includes('/calendar-display-config')) {
          return Promise.resolve({ ok: true, json: async () => ALLOWED });
        }
        if (href.includes('/reconcile/')) {
          const body = JSON.parse(init.body);
          const phase = href.includes('/apply') ? 'apply' : 'plan';
          const res = (phase === 'plan' && !body.action)
            ? { status: 200, body: CONTEXT }
            : reconcile(phase, body);
          return Promise.resolve({ ok: res.status < 400, status: res.status, json: async () => res.body });
        }
        return Promise.resolve({ ok: true, json: async () => FINDINGS });
      });
    };

    const runReport = async () => {
      const runBtn = screen.getByRole('button', { name: /run check/i });
      await waitFor(() => expect(runBtn).toBeEnabled());
      fireEvent.click(runBtn);
      await waitFor(() => expect(screen.getByText('Cancelled Concert')).toBeInTheDocument());
      return runBtn;
    };

    const reconcileCalls = (phase) =>
      (global.fetch.mock?.calls || [])
        .filter(([u]) => String(u).includes(`/reconcile/${phase}`))
        .map(([, init]) => JSON.parse(init.body));

    // A row you must open to identify is a row you cannot scan, and there are
    // 46 of them. Date, time and room are columns now, not a click away.
    it('shows date, time and room as columns without opening anything', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      const row = screen.getByText('Orphan Event').closest('button');
      expect(within(row).getByText('2026-08-14')).toBeInTheDocument();
      expect(within(row).getByText('09:00–12:00')).toBeInTheDocument();
      expect(within(row).getByText('Lowenstein')).toBeInTheDocument();
      // Nothing was expanded to see them.
      expect(row).toHaveAttribute('aria-expanded', 'false');
    });

    // If Outlook already has the event, "publish" would duplicate it. That fact
    // must not be hidden behind choosing an action first.
    it('surfaces a matching Outlook event as soon as the panel opens', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      const inner = global.fetch;
      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (String(url).includes('/reconcile/plan') && !JSON.parse(init.body).action) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...CONTEXT,
              observed: {
                ...CONTEXT.observed,
                candidates: [{ graphId: 'legacy-1', subject: 'Orphan Event', date: '2026-08-14' }],
              },
            }),
          });
        }
        return inner(url, init);
      });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);

      await waitFor(() => {
        expect(screen.getByText(/an outlook event that matches already exists/i)).toBeInTheDocument();
      });
      // ...without the admin having had to pick an action to find out.
      expect(reconcileCalls('plan').every(c => !c.action)).toBe(true);
    });

    // Archive / link / publish are not interchangeable — a years-old '[Hold]'
    // placeholder wants archiving, a real booking next month wants publishing.
    // The panel used to offer all three knowing only a title.
    it('states what the event is before offering a choice', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);

      await waitFor(() => expect(screen.getByText(/2026-08-14 19:00–21:00/)).toBeInTheDocument());
      expect(screen.getByText('Streicker Center')).toBeInTheDocument();
      expect(screen.getByText('Charlotte Duber')).toBeInTheDocument();
      // The age of the record is what separates legacy cruft from a live booking.
      expect(screen.getByText('2019-04-02')).toBeInTheDocument();
    });

    // "Publish because a report said Outlook lacks it" is a leap of faith;
    // "publish because I can see that day and mine is not on it" is a decision.
    it('shows what Outlook actually has that day', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);

      await waitFor(() => expect(screen.getByText(/Outlook on 2026-08-14/)).toBeInTheDocument());
      expect(screen.getByText('Someone Else Meeting')).toBeInTheDocument();
      expect(screen.getByText('14:00')).toBeInTheDocument();
    });

    it('says so plainly when Outlook has nothing that day', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      // Override just the context answer for this test.
      const inner = global.fetch;
      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (String(url).includes('/reconcile/plan') && !JSON.parse(init.body).action) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ...CONTEXT, observed: { ...CONTEXT.observed, dayEvents: [], dayEventsTotal: 0 } }),
          });
        }
        return inner(url, init);
      });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);

      await waitFor(() => expect(screen.getByText(/nothing at all/i)).toBeInTheDocument());
    });

    // Reading the event must never be able to change it.
    it('does not apply anything just by opening the panel', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);
      await waitFor(() => expect(screen.getByText(/Outlook on 2026-08-14/)).toBeInTheDocument());

      expect(reconcileCalls('apply')).toHaveLength(0);
      expect(reconcileCalls('plan')[0].action).toBeNull();
    });

    // ── batch link ────────────────────────────────────────────────────────

    describe('batch link', () => {
      const BATCH_ROWS = [
        {
          mongoId: 'm1', eventTitle: 'Exact Match', date: '2027-01-23',
          startTime: '17:00', location: 'Streicker', tier: 'confident',
          reason: 'Name, date and start time all agree (2027-01-23 17:00).',
          candidate: { graphId: 'g-exact', subject: 'Exact Match', startTime: '17:00' },
          expectedState: { doc: { version: 1 } }, selectedByDefault: true,
        },
        {
          mongoId: 'm2', eventTitle: 'Different Time', date: '2027-01-23',
          startTime: '17:00', location: 'Wise Hall', tier: 'ambiguous',
          reason: 'Times differ — this record says 17:00, Outlook says 19:30.',
          candidate: { graphId: 'g-late', subject: 'Different Time', startTime: '19:30' },
          expectedState: { doc: { version: 1 } }, selectedByDefault: false,
        },
        {
          mongoId: 'm3', eventTitle: 'No Twin', date: '2027-01-23',
          startTime: '', location: '', tier: 'none',
          reason: 'Outlook has nothing with this name on this date.',
          candidate: null, expectedState: null, selectedByDefault: false,
        },
      ];

      // Two untethered rows so the batch affordance renders (it needs >1).
      const BATCH_FINDINGS = {
        ...FINDINGS,
        calendars: [{
          ...FINDINGS.calendars[0],
          untethered: [
            { mongoId: 'm1', eventTitle: 'Exact Match', eventType: 'singleInstance', date: '2027-01-23' },
            { mongoId: 'm2', eventTitle: 'Different Time', eventType: 'singleInstance', date: '2027-01-23' },
            { mongoId: 'm3', eventTitle: 'No Twin', eventType: 'singleInstance', date: '2027-01-23' },
          ],
        }],
      };

      const wireBatch = (onApply) => {
        global.fetch = vi.fn().mockImplementation((url, init) => {
          const href = String(url);
          if (href.includes('/calendar-display-config')) {
            return Promise.resolve({ ok: true, json: async () => ALLOWED });
          }
          if (href.includes('/batch/plan')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ rows: BATCH_ROWS, summary: { total: 3, confident: 1, ambiguous: 1, none: 1 } }),
            });
          }
          if (href.includes('/batch/apply')) {
            const body = JSON.parse(init.body);
            onApply?.(body);
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true, results: [], summary: { total: body.selections.length, done: body.selections.length, skipped: 0, failed: 0 },
              }),
            });
          }
          return Promise.resolve({ ok: true, json: async () => BATCH_FINDINGS });
        });
      };

      const openTable = async () => {
        const runBtn = screen.getByRole('button', { name: /run check/i });
        await waitFor(() => expect(runBtn).toBeEnabled());
        fireEvent.click(runBtn);
        await waitFor(() => expect(screen.getByText('Exact Match')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /find outlook matches for all/i }));
        await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
      };

      // The whole safety argument: only rows where name, date AND time agree
      // are pre-selected. Everything else needs a human to say yes.
      it('pre-selects confident rows only', async () => {
        wireBatch();
        renderPage();
        await openTable();

        const boxes = screen.getAllByRole('checkbox');
        // Two rows have a candidate; the no-match row offers no checkbox.
        expect(boxes).toHaveLength(2);
        expect(boxes[0]).toBeChecked();      // confident
        expect(boxes[1]).not.toBeChecked();  // times differ
        expect(screen.getByText(/1 of 2 with a match selected/i)).toBeInTheDocument();
      });

      it('shows the server reason each row was or was not auto-selected', async () => {
        wireBatch();
        renderPage();
        await openTable();

        expect(screen.getByText(/times differ — this record says 17:00/i)).toBeInTheDocument();
        expect(screen.getByText(/outlook has nothing with this name/i)).toBeInTheDocument();
      });

      it('sends only the checked rows, each with its own fingerprint', async () => {
        let sent = null;
        wireBatch((body) => { sent = body; });
        renderPage();
        await openTable();

        // Accept the ambiguous one deliberately.
        fireEvent.click(screen.getAllByRole('checkbox')[1]);
        await waitFor(() => expect(screen.getByText(/2 of 2 with a match selected/i)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /link 2 selected/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /confirm — link 2/i })).toBeInTheDocument());
        // Nothing sent on the first click.
        expect(sent).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /confirm — link 2/i }));
        await waitFor(() => expect(sent).not.toBeNull());

        expect(sent.selections).toEqual([
          { mongoId: 'm1', graphId: 'g-exact', expectedState: { doc: { version: 1 } } },
          { mongoId: 'm2', graphId: 'g-late', expectedState: { doc: { version: 1 } } },
        ]);
        // The unmatched row can never be submitted.
        expect(sent.selections.some(s => s.mongoId === 'm3')).toBe(false);
      });

      it('deselecting everything disables the apply button', async () => {
        wireBatch();
        renderPage();
        await openTable();

        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /link 0 selected/i })).toBeDisabled();
        });
      });

      it('re-runs the report after linking', async () => {
        wireBatch();
        renderPage();
        await openTable();
        expect(reportCalls()).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: /link 1 selected/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /confirm — link 1/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /confirm — link 1/i }));

        await waitFor(() => expect(reportCalls()).toHaveLength(2));
        expect(toasts.showSuccess).toHaveBeenCalled();
      });

      it('offers no batch affordance to a non-admin', async () => {
        mockIsAdmin = false;
        wireBatch();
        renderPage();
        const runBtn = screen.getByRole('button', { name: /run check/i });
        await waitFor(() => expect(runBtn).toBeEnabled());
        fireEvent.click(runBtn);
        await waitFor(() => expect(screen.getByText('Exact Match')).toBeInTheDocument());

        expect(screen.queryByRole('button', { name: /find outlook matches/i })).toBeNull();
      });
    });

    it('shows no Fix affordance to a non-admin', async () => {
      mockIsAdmin = false;
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      expect(screen.queryByRole('button', { name: /fix/i })).toBeNull();
    });

    // Informational findings have no shipped actions, so they get no button
    // even for an admin.
    it('offers Fix only on categories with actions', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      // untethered + shouldNotBeInOutlook == 2 rows, both actionable.
      expect(screen.getAllByRole('button', { name: /^fix/i })).toHaveLength(2);
    });

    // The panel must not paraphrase the plan: the server re-observes reality,
    // so its words are the only ones guaranteed to match what will happen.
    it('renders the server plan verbatim', async () => {
      wireApi(() => ({ status: 200, body: DELETE_PLAN }));
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[1]);
      fireEvent.click(screen.getByRole('button', { name: /delete from outlook/i }));

      await waitFor(() => {
        expect(screen.getByText(DELETE_PLAN.ops[0].description)).toBeInTheDocument();
      });
      expect(screen.getByText(DELETE_PLAN.warnings[0])).toBeInTheDocument();
      expect(screen.getByText(DELETE_PLAN.ops[0].direction)).toBeInTheDocument();
      // Planning alone must never apply anything.
      expect(reconcileCalls('apply')).toHaveLength(0);
    });

    it('requires a second click before sending an irreversible apply', async () => {
      wireApi((phase) => phase === 'plan'
        ? { status: 200, body: DELETE_PLAN }
        : { status: 200, body: { success: true, results: [] } });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[1]);
      fireEvent.click(screen.getByRole('button', { name: /delete from outlook/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());

      // First click only arms the confirmation.
      fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cannot be undone/i })).toBeInTheDocument();
      });
      expect(reconcileCalls('apply')).toHaveLength(0);

      // Second click sends it, WITH the server-enforced confirmation flag.
      fireEvent.click(screen.getByRole('button', { name: /cannot be undone/i }));
      await waitFor(() => expect(reconcileCalls('apply')).toHaveLength(1));
      expect(reconcileCalls('apply')[0]).toMatchObject({
        findingType: 'shouldNotBeInOutlook',
        action: 'deleteOutlook',
        confirmIrreversible: true,
        target: { graphId: 'zombie-1', date: '2026-09-02' },
        expectedState: DELETE_PLAN.expectedState,
      });
    });

    it('re-runs the report after a successful apply', async () => {
      wireApi((phase) => phase === 'plan'
        ? { status: 200, body: DELETE_PLAN }
        : { status: 200, body: { success: true, results: [] } });
      renderPage();
      await runReport();
      expect(reportCalls()).toHaveLength(1);

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[1]);
      fireEvent.click(screen.getByRole('button', { name: /delete from outlook/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /cannot be undone/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /cannot be undone/i }));

      await waitFor(() => expect(reportCalls()).toHaveLength(2));
      expect(toasts.showSuccess).toHaveBeenCalled();
    });

    // A stale finding means the report on screen is describing the past. Say so
    // and refresh, rather than leaving a dead panel open.
    it('explains and refreshes when the server reports a stale finding', async () => {
      wireApi((phase) => phase === 'plan'
        ? { status: 200, body: DELETE_PLAN }
        : { status: 409, body: { error: 'STALE_FINDING', message: 'moved', drifts: [] } });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[1]);
      fireEvent.click(screen.getByRole('button', { name: /delete from outlook/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /cannot be undone/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /cannot be undone/i }));

      await waitFor(() => expect(toasts.showWarning).toHaveBeenCalled());
      expect(toasts.showWarning.mock.calls[0][0]).toMatch(/changed since the report ran/i);
      await waitFor(() => expect(reportCalls()).toHaveLength(2));
    });

    // A reversible plan confirms too, but without the irreversible wording or
    // the server-enforced flag.
    it('confirms a reversible action without claiming it is permanent', async () => {
      const archivePlan = {
        ...DELETE_PLAN,
        findingType: 'untethered', action: 'archive', irreversible: false, warnings: [],
        ops: [{
          op: 'mongoArchive', irreversible: false,
          direction: "Changes only this app's record",
          description: 'Archive "Orphan Event" in the app.',
        }],
      };
      wireApi((phase) => phase === 'plan'
        ? { status: 200, body: archivePlan }
        : { status: 200, body: { success: true, results: [] } });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);
      fireEvent.click(screen.getByRole('button', { name: /archive in app/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^confirm\?$/i })).toBeInTheDocument());
      expect(screen.queryByText(/cannot be undone/i)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /^confirm\?$/i }));
      await waitFor(() => expect(reconcileCalls('apply')).toHaveLength(1));
      expect(reconcileCalls('apply')[0].confirmIrreversible).toBe(false);
      expect(reconcileCalls('apply')[0].target).toEqual({ mongoId: 'm1' });
    });

    it('offers the candidate pick-list the server returned with its refusal', async () => {
      const candidates = [{ graphId: 'legacy-1', subject: '[Hold] Orphan Event', date: '2026-08-14' }];
      wireApi((phase, body) => {
        if (phase === 'plan' && !body.linkTargetGraphId) {
          return { status: 409, body: { error: 'NO_LINK_TARGET', message: 'Choose one', candidates } };
        }
        return { status: 200, body: { ...DELETE_PLAN, action: 'linkExisting', irreversible: false } };
      });
      renderPage();
      await runReport();

      fireEvent.click(screen.getAllByRole('button', { name: /^fix/i })[0]);
      fireEvent.click(screen.getByRole('button', { name: /link to existing/i }));

      await waitFor(() => {
        expect(screen.getByText(/an outlook event that matches already exists/i)).toBeInTheDocument();
      });
      const choice = screen.getByRole('radio');
      fireEvent.click(choice);

      // Choosing a candidate re-plans, this time WITH the chosen id.
      await waitFor(() => {
        expect(reconcileCalls('plan').some(c => c.linkTargetGraphId === 'legacy-1')).toBe(true);
      });
    });
  });

  it('renders an error card for a calendar whose Graph call failed', async () => {
    respondWith({
      window: { start: '2026-08-01', end: '2026-09-30' },
      calendars: [{
        // The SELECTED calendar is the one that failed, which is the case a
        // user actually hits now that the report is scoped to one mailbox.
        calendarOwner: 'TempleEvents@emanuelnyc.org',
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
    // Scope to the heading: the picker option carries the same text.
    expect(screen.getByRole('heading', { name: 'TempleEvents@emanuelnyc.org' }))
      .toBeInTheDocument();
  });
});

// src/components/SyncHealthReport.jsx
//
// "Sync Health" screen (admins + approvers). Runs an on-demand diff between
// what the app believes is published and what Outlook actually shows.
//
// Loading contract: this view follows the EventSearch pattern, NOT the
// auto-firing list pattern. Its `enabled` is a deliberate user action (the Run
// Check button), so the idle state is a legitimate "choose a range" prompt
// rather than a spinner. deriveListLoadingState keeps the spinner up through
// the `pending && idle` tick after the click so we never flash an empty result.

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { deriveListLoadingState } from '../utils/listLoadingState';
import {
  groupFindingsByEvent,
  reconcile,
  countEventsNeedingAttention,
  APP_FINDING,
  OUTLOOK_FINDING,
} from '../utils/syncHealthGrouping';
import { useNotification } from '../context/NotificationContext';
import LoadingSpinner from './shared/LoadingSpinner';
import DatePickerInput from './DatePickerInput';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './SyncHealthReport.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const defaultWindow = () => {
  const now = new Date();
  return {
    startDate: toDateStr(new Date(now.getTime() - 30 * MS_PER_DAY)),
    endDate: toDateStr(new Date(now.getTime() + 180 * MS_PER_DAY)),
  };
};

// ── Problem vocabulary ─────────────────────────────────────────────────────
// Each section is named for what BREAKS and states the consequence, because
// "untethered: 46" is a field name and tells an admin nothing about whether to
// act. Order is the triage order: the sections a person should read first are
// declared first, and `untracked` is informational so it renders collapsed.
const SECTIONS = [
  {
    key: 'untethered',
    severity: 'critical',
    title: 'Never linked to Outlook',
    why: 'Published in the app, but no Outlook event was ever created, so nobody looking at the Outlook calendar can see them. Usually a publish that failed part way through.',
    accessors: APP_FINDING,
  },
  {
    key: 'missingFromOutlook',
    severity: 'critical',
    title: 'Missing from Outlook',
    why: 'The app holds an Outlook link, but nothing is on the Outlook calendar for these dates. The event was most likely deleted or recreated in Outlook, which also means edits made here will not reach it.',
    accessors: APP_FINDING,
  },
  {
    key: 'shouldNotBeInOutlook',
    severity: 'warning',
    title: 'Removed here, still on Outlook',
    why: 'Cancelled or excluded in the app but the Outlook entry survived, so people may still show up and the room still reads as booked.',
    accessors: OUTLOOK_FINDING,
  },
  {
    key: 'untracked',
    severity: 'info',
    title: 'On Outlook only',
    why: 'Created directly in Outlook and not managed here. Normally expected. Worth a glance only if something you booked in this app shows up in the list.',
    accessors: OUTLOOK_FINDING,
  },
];

// Long lists stay bounded. The old page rendered every row, so one calendar ran
// to ~178 rows with no way to skim it.
const ROWS_BEFORE_TRUNCATION = 8;
const DATES_BEFORE_TRUNCATION = 12;

const calendarLabel = (calendar) =>
  calendar.calendarId ? `${calendar.calendarOwner} (${calendar.calendarId})` : calendar.calendarOwner;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One event's row. Dates are revealed on demand: the count is what you scan,
 * the dates are what you act on.
 */
function EventRow({ group }) {
  const [open, setOpen] = useState(false);
  const hasDates = group.dates.length > 0;
  const shown = open ? group.dates : group.dates.slice(0, DATES_BEFORE_TRUNCATION);

  return (
    <li className="sync-health-row">
      <button
        type="button"
        className="sync-health-row-main"
        onClick={() => hasDates && setOpen((v) => !v)}
        aria-expanded={hasDates ? open : undefined}
        disabled={!hasDates}
      >
        <span className="sync-health-row-title">{group.title}</span>
        {group.kind && <span className="sync-health-row-kind">{group.kind}</span>}
        <span className="sync-health-row-count">
          {hasDates ? plural(group.dates.length, 'date', 'dates') : 'whole series'}
        </span>
      </button>

      {open && hasDates && (
        <ul className="sync-health-dates">
          {shown.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </li>
  );
}

/**
 * One problem category for one calendar.
 */
function FindingGroup({ section, rows }) {
  const groups = useMemo(
    () => groupFindingsByEvent(rows, section.accessors),
    [rows, section.accessors]
  );
  const [expanded, setExpanded] = useState(false);
  // Informational findings start closed: on live data they were 115 of the 178
  // rows and buried everything that actually needed doing.
  const [open, setOpen] = useState(section.severity !== 'info');

  if (groups.length === 0) return null;

  const instanceCount = rows.length;
  const visible = expanded ? groups : groups.slice(0, ROWS_BEFORE_TRUNCATION);

  return (
    <section className={`sync-health-group sync-health-group--${section.severity}`}>
      <div className="sync-health-group-head">
        <span className="sync-health-tally">{groups.length}</span>
        <div>
          <h4 className="sync-health-group-title">{section.title}</h4>
          <p className="sync-health-group-why">{section.why}</p>
        </div>
      </div>

      {section.severity === 'info' && !open ? (
        <button type="button" className="sync-health-disclose" onClick={() => setOpen(true)}>
          Show {plural(groups.length, 'event', 'events')} ({instanceCount} instances)
        </button>
      ) : (
        <>
          <ul className="sync-health-rows">
            {visible.map((g) => <EventRow key={g.key} group={g} />)}
          </ul>
          {groups.length > visible.length && (
            <button type="button" className="sync-health-disclose" onClick={() => setExpanded(true)}>
              Show all {groups.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The reconciliation: agreement in the middle, the two disagreements as wings.
 * This replaces three bare numbers that only meant something in relation to
 * each other.
 */
function Reconciliation({ counts }) {
  const { appOnly, matched, outlookOnly, total } = reconcile(counts);
  if (total === 0) return null;

  return (
    <div className="sync-health-recon">
      <div className="sync-health-recon-bar">
        {appOnly > 0 && (
          <div className="sync-health-seg sync-health-seg--app" style={{ flex: appOnly }}>
            {appOnly}
          </div>
        )}
        {matched > 0 && (
          <div className="sync-health-seg sync-health-seg--match" style={{ flex: matched }}>
            {matched.toLocaleString()} in sync
          </div>
        )}
        {outlookOnly > 0 && (
          <div className="sync-health-seg sync-health-seg--out" style={{ flex: outlookOnly }}>
            {outlookOnly}
          </div>
        )}
      </div>
      <div className="sync-health-recon-legend">
        <span>only in the app</span>
        <span className="mid">both agree</span>
        <span className="right">only in Outlook</span>
      </div>
      <p className="sync-health-recon-sentence">
        The app expects <b>{(counts.appExpected || 0).toLocaleString()}</b> instances and Outlook
        shows <b>{(counts.outlookFound || 0).toLocaleString()}</b>. They agree on{' '}
        <b>{matched.toLocaleString()}</b>.{' '}
        {appOnly > 0 && (
          <>The app believes <b>{appOnly.toLocaleString()}</b> more are published than Outlook has. </>
        )}
        {outlookOnly > 0 && (
          <><b>{outlookOnly.toLocaleString()}</b> sit on the Outlook calendar that this app does not manage.</>
        )}
      </p>
    </div>
  );
}

function CalendarReport({ calendar }) {
  const attention = countEventsNeedingAttention(calendar);

  if (calendar.error) {
    return (
      <section className="sync-health-calendar sync-health-calendar--errored">
        <div className="sync-health-calendar-head">
          <h3 className="sync-health-calendar-title">{calendarLabel(calendar)}</h3>
        </div>
        <p className="sync-health-error">Could not check this calendar: {calendar.error}</p>
      </section>
    );
  }

  return (
    <section className="sync-health-calendar">
      <div className="sync-health-calendar-head">
        <h3 className="sync-health-calendar-title">{calendarLabel(calendar)}</h3>
        <span className={`sync-health-verdict ${attention > 0 ? 'bad' : 'ok'}`}>
          {attention > 0
            ? `${plural(attention, 'event needs', 'events need')} attention`
            : 'App and Outlook agree'}
        </span>
      </div>

      <Reconciliation counts={calendar.counts || {}} />

      {SECTIONS.map((section) => (
        <FindingGroup key={section.key} section={section} rows={calendar[section.key] || []} />
      ))}

      {attention === 0 && (
        <p className="sync-health-allclear">
          <span className="tick">&#10003;</span>
          Nothing needs attention. Every event the app tracks is on the Outlook calendar where it
          should be.
        </p>
      )}
    </section>
  );
}

export default function SyncHealthReport({ apiToken }) {
  const { showError } = useNotification();
  const [range, setRange] = useState(defaultWindow);
  // Bumped by every Run Check click so an unchanged date range still refetches.
  const [runVersion, setRunVersion] = useState(0);
  const [appliedRange, setAppliedRange] = useState(null);
  const [calendarOwner, setCalendarOwner] = useState('');

  // The reportable calendars are the admin-managed allowlist from
  // calendar-config.json (allowedDisplayCalendars), the same list that governs
  // the main calendar view. Today it contains only TempleEvents, so that is the
  // only mailbox offered here; adding one in Calendar Config surfaces it here
  // too, with no change to this component.
  const { data: allowedCalendars = [] } = useQuery({
    queryKey: keys.syncHealth.calendars(),
    enabled: !!apiToken,
    queryFn: async () => {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/calendar-display-config`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) throw new Error('Could not load the calendar list');
      const body = await response.json();
      return body.allowedDisplayCalendars || [];
    },
  });

  // Settle on a selection as soon as the list arrives. Selecting here rather
  // than defaulting in render keeps the submitted value and the visible value
  // the same thing.
  useEffect(() => {
    if (!calendarOwner && allowedCalendars.length > 0) {
      setCalendarOwner(allowedCalendars[0]);
    }
  }, [allowedCalendars, calendarOwner]);

  const queryKey = useMemo(
    () => keys.syncHealth.report({ version: runVersion }),
    [runVersion]
  );

  const enabled = runVersion > 0 && !!apiToken && !!appliedRange;

  const { data, isPending, isFetching, error } = useQuery({
    queryKey,
    enabled,
    // This report is expensive (a calendarView page per mailbox; ~10s in
    // production) and is EXPLICITLY user-triggered, so it must never re-run
    // itself in the background. Two settings enforce that:
    //
    //  - refetchOnWindowFocus: false — the app refreshes its API token on tab
    //    visibility (useTokenRefresh), so focus events are frequent. Left on,
    //    each one queued another full run; because the results pane gates on
    //    isFetching, the spinner re-armed before results could render and never
    //    cleared.
    //  - staleTime inherited from the global default (5 min) rather than 0. A
    //    zero staleTime marks the result stale the instant it lands, which is
    //    what made every focus event eligible to refetch in the first place.
    //
    // Freshness on demand comes from runVersion instead: every Run Check click
    // mints a new query key with no cached entry, so a click always refetches.
    refetchOnWindowFocus: false,
    // Same reasoning for the other global auto-refetch trigger: a network blip
    // must not silently queue another 10s run behind the user's back.
    refetchOnReconnect: false,
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: appliedRange.startDate,
        endDate: appliedRange.endDate,
      });
      if (appliedRange.calendarOwner) {
        params.set('calendarOwner', appliedRange.calendarOwner);
      }
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/reports/sync-health?${params}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Sync health check failed (${response.status})`);
      }
      return response.json();
    },
  });

  const { isFirstLoad: isRunning } = deriveListLoadingState(
    { isPending, isFetching },
    { enabled }
  );

  // Honour the picker on the client too, not only via the query parameter.
  // The frontend and backend of this app deploy separately, so a UI that sends
  // calendarOwner can be talking to an API old enough to ignore it; without
  // this, the user picks one mailbox and the page shows every mailbox. The
  // server-side filter is still the one that matters for cost, since it is what
  // avoids the extra calendarView fetch.
  const visibleCalendars = useMemo(() => {
    const all = data?.calendars || [];
    const selected = appliedRange?.calendarOwner;
    if (!selected) return all;
    const wanted = selected.toLowerCase();
    const scoped = all.filter(c => String(c.calendarOwner || '').toLowerCase() === wanted);
    // If the requested mailbox simply has nothing in the window, the API
    // returns no entry for it. Falling back to `all` there would resurrect the
    // other calendars, so an empty result stays empty.
    return scoped;
  }, [data, appliedRange]);

  useEffect(() => {
    if (error) {
      logger.error('Sync health check failed:', error);
      showError(error.message || 'Sync health check failed');
    }
  }, [error, showError]);

  const handleRunCheck = () => {
    setAppliedRange({ ...range, calendarOwner });
    setRunVersion(v => v + 1);
  };

  return (
    <div className="sync-health">
      <header className="sync-health-header">
        <h2>Sync Health</h2>
        <p className="sync-health-subtitle">
          Compares what this app believes is published against what Outlook actually shows.
          Read-only — nothing is changed by running a check.
        </p>
      </header>

      {/* DatePickerInput renders a bare <input type="date"> — it has NO label
          prop, and its onChange is a raw DOM handler, so read e.target.value. */}
      <div className="sync-health-controls">
        <div className="sync-health-field">
          <label htmlFor="sync-health-calendar">Calendar</label>
          <select
            id="sync-health-calendar"
            className="sync-health-select"
            value={calendarOwner}
            onChange={(e) => setCalendarOwner(e.target.value)}
            disabled={allowedCalendars.length === 0}
          >
            {allowedCalendars.length === 0 && <option value="">Loading...</option>}
            {allowedCalendars.map((owner) => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
        </div>
        <div className="sync-health-field">
          <label htmlFor="sync-health-start">From</label>
          <DatePickerInput
            id="sync-health-start"
            value={range.startDate}
            onChange={(e) => setRange(r => ({ ...r, startDate: e.target.value }))}
          />
        </div>
        <div className="sync-health-field">
          <label htmlFor="sync-health-end">To</label>
          <DatePickerInput
            id="sync-health-end"
            value={range.endDate}
            onChange={(e) => setRange(r => ({ ...r, endDate: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="sync-health-run-btn"
          onClick={handleRunCheck}
          disabled={isRunning || isFetching || !calendarOwner}
        >
          {isRunning || isFetching ? 'Checking...' : 'Run Check'}
        </button>
      </div>

      <div className="sync-health-results">
        {isRunning || isFetching ? (
          <LoadingSpinner variant="card" text="Comparing app and Outlook..." />
        ) : !data ? (
          <p className="sync-health-idle">
            Choose a date range and click Run Check to compare the app against Outlook.
          </p>
        ) : visibleCalendars.length === 0 ? (
          <p className="sync-health-idle">
            This calendar has no events in the selected window.
          </p>
        ) : (
          visibleCalendars.map((calendar) => (
            <CalendarReport
              key={`${calendar.calendarOwner}|${calendar.calendarId || ''}`}
              calendar={calendar}
            />
          ))
        )}
      </div>
    </div>
  );
}

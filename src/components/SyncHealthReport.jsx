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

const calendarLabel = (calendar) =>
  calendar.calendarId ? `${calendar.calendarOwner} (${calendar.calendarId})` : calendar.calendarOwner;

function FindingSection({ title, rows, renderRow }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="sync-health-section sync-health-section--critical">
      <h4 className="sync-health-section-title">
        {title} <span className="sync-health-count">{rows.length}</span>
      </h4>
      <ul className="sync-health-rows">
        {rows.map((row, i) => <li key={i} className="sync-health-row">{renderRow(row)}</li>)}
      </ul>
    </section>
  );
}

function CalendarCard({ calendar }) {
  const [untrackedOpen, setUntrackedOpen] = useState(false);

  if (calendar.error) {
    return (
      <article className="sync-health-card sync-health-card--errored">
        <header className="sync-health-card-header">
          <h3 className="sync-health-card-title">{calendarLabel(calendar)}</h3>
        </header>
        <p className="sync-health-error">Could not check this calendar: {calendar.error}</p>
      </article>
    );
  }

  const { counts, missingFromOutlook, untethered, shouldNotBeInOutlook, untracked } = calendar;
  const isClean =
    missingFromOutlook.length === 0 &&
    untethered.length === 0 &&
    shouldNotBeInOutlook.length === 0;

  return (
    <article className="sync-health-card">
      <header className="sync-health-card-header">
        <h3 className="sync-health-card-title">{calendarLabel(calendar)}</h3>
        <dl className="sync-health-counts">
          <div><dt>App expects</dt><dd>{counts.appExpected}</dd></div>
          <div><dt>In Outlook</dt><dd>{counts.outlookFound}</dd></div>
          <div><dt>Matched</dt><dd>{counts.matched}</dd></div>
        </dl>
      </header>

      {isClean && (
        <p className="sync-health-banner sync-health-banner--ok">
          App and Outlook agree: {counts.matched} instances matched
        </p>
      )}

      <FindingSection
        title="Missing from Outlook"
        rows={missingFromOutlook}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.eventTitle}</span>
            <span className="sync-health-row-date">{row.date}</span>
            <span className="sync-health-row-reason">{row.reason}</span>
          </>
        )}
      />

      <FindingSection
        title="No Outlook link stored"
        rows={untethered}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.eventTitle}</span>
            <span className="sync-health-row-reason">{row.eventType} has no stored Graph ID</span>
          </>
        )}
      />

      <FindingSection
        title="Should not be in Outlook"
        rows={shouldNotBeInOutlook}
        renderRow={(row) => (
          <>
            <span className="sync-health-row-title">{row.subject}</span>
            <span className="sync-health-row-date">{row.date}</span>
            <span className="sync-health-row-reason">{row.reason}</span>
          </>
        )}
      />

      {untracked.length > 0 && (
        <section className="sync-health-section sync-health-section--info">
          <button
            type="button"
            className="sync-health-disclosure"
            onClick={() => setUntrackedOpen(open => !open)}
            aria-expanded={untrackedOpen}
          >
            In Outlook only <span className="sync-health-count">{untracked.length}</span>
          </button>
          {untrackedOpen && (
            <ul className="sync-health-rows">
              {untracked.map((row) => (
                <li key={row.graphId} className="sync-health-row">
                  <span className="sync-health-row-title">{row.subject}</span>
                  <span className="sync-health-row-date">{row.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

export default function SyncHealthReport({ apiToken }) {
  const { showError } = useNotification();
  const [range, setRange] = useState(defaultWindow);
  // Bumped by every Run Check click so an unchanged date range still refetches.
  const [runVersion, setRunVersion] = useState(0);
  const [appliedRange, setAppliedRange] = useState(null);

  const queryKey = useMemo(
    () => keys.syncHealth.report({ version: runVersion }),
    [runVersion]
  );

  const enabled = runVersion > 0 && !!apiToken && !!appliedRange;

  const { data, isPending, isFetching, error } = useQuery({
    queryKey,
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: appliedRange.startDate,
        endDate: appliedRange.endDate,
      });
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

  useEffect(() => {
    if (error) {
      logger.error('Sync health check failed:', error);
      showError(error.message || 'Sync health check failed');
    }
  }, [error, showError]);

  const handleRunCheck = () => {
    setAppliedRange({ ...range });
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
          disabled={isRunning || isFetching}
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
        ) : data.calendars.length === 0 ? (
          <p className="sync-health-idle">No managed calendars have events in this window.</p>
        ) : (
          data.calendars.map((calendar) => (
            <CalendarCard
              key={`${calendar.calendarOwner}|${calendar.calendarId || ''}`}
              calendar={calendar}
            />
          ))
        )}
      </div>
    </div>
  );
}

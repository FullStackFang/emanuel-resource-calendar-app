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
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { usePermissions } from '../hooks/usePermissions';
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
//
// `actions` lists what reconcile can do for the category. Only the labels and
// the action ids live here — every description of what an action WILL do comes
// from the server's plan response, so the page can never promise something the
// server would not actually perform.
const SECTIONS = [
  {
    key: 'untethered',
    severity: 'critical',
    title: 'Never linked to Outlook',
    why: 'Published in the app, but no Outlook event was ever created, so nobody looking at the Outlook calendar can see them. Usually a publish that failed part way through.',
    accessors: APP_FINDING,
    findingType: 'untethered',
    actions: [
      { id: 'archive', label: 'Archive in app', tone: 'neutral' },
      { id: 'linkExisting', label: 'Link to existing Outlook event', tone: 'neutral' },
      { id: 'publish', label: 'Publish to Outlook now', tone: 'constructive' },
    ],
    // Bulk is offered for LINK only — it writes Mongo, creates nothing, and is
    // reversible. Bulk publish would mint duplicate Outlook events and bulk
    // delete cannot be undone, so neither is offered at any tier.
    batchLink: true,
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
    findingType: 'shouldNotBeInOutlook',
    actions: [
      { id: 'deleteOutlook', label: 'Delete from Outlook', tone: 'destructive' },
    ],
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

// Grouping is by EVENT, so every instance row in a group shares the event's
// location and time — the first one speaks for all of them.
const firstRow = (group) => (group.rows && group.rows[0]) || {};

const timeRangeOf = (group) => {
  const { startTime, endTime } = firstRow(group);
  if (!startTime) return '';
  return endTime ? `${startTime}–${endTime}` : startTime;
};

/**
 * What the event actually is, so the choice between archiving, linking and
 * publishing can be made on evidence.
 *
 * The three actions are not interchangeable — a years-old '[Hold]' placeholder
 * wants archiving, a real booking next month wants publishing — and a title
 * alone does not tell them apart. Everything here comes from the server's fresh
 * observation, not from the rendered report, which may be minutes stale.
 */
function EventFacts({ observed }) {
  const doc = observed?.doc;
  if (!doc) return null;

  const when = doc.date
    ? `${doc.date}${doc.startTime ? ` ${doc.startTime}` : ''}${doc.endTime ? `–${doc.endTime}` : ''}`
    : 'no date recorded';
  const rooms = Array.isArray(doc.locationDisplayNames)
    ? doc.locationDisplayNames.join('; ')
    : doc.locationDisplayNames;
  const requester = doc.requestedByName || doc.requestedByEmail || doc.createdByEmail;

  return (
    <dl className="sync-health-facts">
      <div><dt>When</dt><dd>{when}</dd></div>
      {rooms && <div><dt>Where</dt><dd>{rooms}</dd></div>}
      {requester && <div><dt>Requested by</dt><dd>{requester}</dd></div>}
      <div><dt>Status</dt><dd>{doc.status}{doc.eventType ? ` · ${doc.eventType}` : ''}</dd></div>
      {doc.createdAt && (
        <div><dt>Created</dt><dd>{String(doc.createdAt).slice(0, 10)}</dd></div>
      )}
    </dl>
  );
}

/**
 * What Outlook shows on the event's date.
 *
 * This is the admin's own evidence, not the report's claim. "Publish this
 * because a report said Outlook lacks it" is a leap of faith; "publish this
 * because I can see these six entries on that day and mine is not among them"
 * is a decision.
 */
function OutlookThatDay({ observed }) {
  const events = observed?.dayEvents || [];
  const date = observed?.doc?.date;
  if (!date) return null;

  return (
    <div className="sync-health-day">
      <p className="sync-health-day-head">
        Outlook on {date}:{' '}
        {events.length === 0
          ? 'nothing at all.'
          : `${plural(observed.dayEventsTotal, 'entry', 'entries')}${
            observed.dayEventsTotal > events.length ? ` (showing ${events.length})` : ''}.`}
      </p>
      {events.length > 0 && (
        <ul className="sync-health-day-list">
          {events.map((e) => (
            // Times arrive already converted to the calendar's timezone. Graph
            // reports UTC, and printing that raw put a 17:00 booking on screen
            // as 22:00 directly beneath the app's '17:00' — the same event
            // looking like two.
            <li key={e.graphId}>
              <span className="sync-health-day-time">{e.startTime || '--:--'}</span>
              {e.subject}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The reconcile "Fix…" panel for one finding.
 *
 * Deliberately renders NOTHING of its own about what an action will do. The
 * server's plan is the single source of truth for that: it re-observes reality,
 * and its op descriptions and warnings are printed verbatim. A client-side
 * paraphrase would eventually describe something the server no longer does.
 *
 * Flow: open -> POST /plan with NO action (context: what is this event, and
 * what does Outlook show that day) -> pick an action -> POST /plan again (what
 * will happen) -> confirm -> POST /apply with the plan's expectedState. The
 * server refuses the apply if anything moved in between.
 */
function FixPanel({ section, group, calendarOwner, apiToken, onDone }) {
  const { showSuccess, showError, showWarning } = useNotification();

  // Outlook-side findings are grouped by subject, but a delete acts on ONE
  // Outlook entry. Default to the first instance and let the admin pick.
  // Memoized because the `[]` branch would otherwise be a new array every
  // render, retriggering the `target` memo below on every keystroke.
  const instances = useMemo(
    () => (section.accessors === OUTLOOK_FINDING ? group.rows : []),
    [section.accessors, group.rows]
  );
  const [instanceIdx, setInstanceIdx] = useState(0);

  const [action, setAction] = useState(null);
  const [plan, setPlan] = useState(null);
  const [observed, setObserved] = useState(null);
  const [loadingFacts, setLoadingFacts] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [linkTargetGraphId, setLinkTargetGraphId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(null);

  const target = useMemo(() => {
    if (section.accessors === OUTLOOK_FINDING) {
      const row = instances[instanceIdx] || {};
      return { graphId: row.graphId, date: row.date };
    }
    return { mongoId: group.key };
  }, [section.accessors, instances, instanceIdx, group.key]);

  const call = async (path, body) => {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/sync-health/reconcile/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({
        calendarOwner,
        findingType: section.findingType,
        action: body.action,
        target,
        ...body,
      }),
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  };

  const resetPlan = () => {
    setPlan(null);
    setConfirming(false);
    setProblem(null);
  };

  // Fetch the facts as soon as the panel opens, BEFORE any action is chosen.
  // An action list with no context is a guess, not a decision.
  useEffect(() => {
    let cancelled = false;
    setLoadingFacts(true);
    call('plan', { action: null })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setObserved(res.body.observed);
          // If Outlook already has a same-name event that day, that is the
          // single most decision-relevant fact there is — the answer is almost
          // certainly "link", not "publish". Surface it immediately rather
          // than waiting for the admin to guess an action first.
          setCandidates(res.body.observed?.candidates || []);
        } else {
          setProblem(res.body.message || res.body.error || 'Could not read this event.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Reconcile context failed:', err);
        setProblem(err.message || 'Could not read this event.');
      })
      .finally(() => { if (!cancelled) setLoadingFacts(false); });
    return () => { cancelled = true; };
    // Re-reads when the admin switches which dated instance they are fixing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mongoId, target.graphId]);

  const requestPlan = async (nextAction, chosenLinkId = linkTargetGraphId) => {
    setAction(nextAction);
    resetPlan();
    setBusy(true);
    try {
      const res = await call('plan', { action: nextAction, linkTargetGraphId: chosenLinkId || null });
      if (res.ok) {
        setPlan(res.body);
        setCandidates(res.body.candidates || []);
        return;
      }
      // "You haven't said which Outlook event to link to" is answered by the
      // candidate list the server returned with the refusal.
      setCandidates(res.body.candidates || []);
      setProblem(res.body.message || res.body.error || 'Could not plan this fix.');
    } catch (err) {
      logger.error('Reconcile plan failed:', err);
      setProblem(err.message || 'Could not plan this fix.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    // In-button confirmation, per the app-wide standard — no browser dialogs.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const res = await call('apply', {
        action,
        linkTargetGraphId: linkTargetGraphId || null,
        expectedState: plan.expectedState,
        // Only sent on the SECOND click, which is what makes the confirmation
        // meaningful rather than decorative — the server refuses without it.
        confirmIrreversible: plan.irreversible === true,
      });

      if (res.ok) {
        showSuccess('Fix applied. Re-running the check.');
        onDone();
        return;
      }
      if (res.body.error === 'STALE_FINDING') {
        showWarning('This finding changed since the report ran — refreshing.');
        onDone();
        return;
      }
      setConfirming(false);
      setProblem(res.body.message || res.body.error || 'Could not apply this fix.');
      showError(res.body.message || res.body.error || 'Could not apply this fix.');
    } catch (err) {
      logger.error('Reconcile apply failed:', err);
      setConfirming(false);
      showError(err.message || 'Could not apply this fix.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sync-health-fix">
      {instances.length > 1 && (
        <label className="sync-health-fix-instance">
          Which date
          <select
            value={instanceIdx}
            onChange={(e) => { setInstanceIdx(Number(e.target.value)); resetPlan(); }}
          >
            {instances.map((row, i) => (
              <option key={row.graphId || i} value={i}>{row.date || 'undated'}</option>
            ))}
          </select>
        </label>
      )}

      {loadingFacts ? (
        <p className="sync-health-facts-loading">Reading this event and checking Outlook…</p>
      ) : (
        <>
          <EventFacts observed={observed} />
          <OutlookThatDay observed={observed} />
        </>
      )}

      <div className="sync-health-fix-actions">
        {section.actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`sync-health-fix-btn ${action === a.id ? 'selected' : ''}`}
            onClick={() => requestPlan(a.id)}
            disabled={busy}
          >
            {a.label}
          </button>
        ))}
      </div>

      {candidates.length > 0 && (
        <div className="sync-health-fix-candidates">
          <p>An Outlook event that matches already exists — link to it instead?</p>
          {candidates.map((c) => (
            <label key={c.graphId}>
              <input
                type="radio"
                name={`candidate-${group.key}`}
                value={c.graphId}
                checked={linkTargetGraphId === c.graphId}
                onChange={() => {
                  setLinkTargetGraphId(c.graphId);
                  requestPlan('linkExisting', c.graphId);
                }}
              />
              {c.subject}{c.date ? ` — ${c.date}` : ''}
            </label>
          ))}
        </div>
      )}

      {problem && <p className="sync-health-fix-problem">{problem}</p>}

      {plan && (
        <div className="sync-health-fix-plan">
          <ol className="sync-health-fix-ops">
            {plan.ops.map((op, i) => (
              <li key={i}>
                <span className="sync-health-fix-op-desc">{op.description}</span>
                <span className="sync-health-fix-op-dir">{op.direction}</span>
              </li>
            ))}
          </ol>
          {plan.warnings.map((w, i) => (
            <p key={i} className="sync-health-fix-warning">{w}</p>
          ))}
          <button
            type="button"
            className={`sync-health-fix-apply ${confirming ? 'confirm' : ''} ${plan.irreversible ? 'destructive' : ''}`}
            onClick={apply}
            disabled={busy}
          >
            {busy
              ? 'Applying...'
              : confirming
                ? (plan.irreversible ? 'Confirm — cannot be undone' : 'Confirm?')
                : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One event's row. Dates are revealed on demand: the count is what you scan,
 * the dates are what you act on.
 */
function EventRow({ group, section, calendarOwner, apiToken, canFix, onFixed }) {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const hasDates = group.dates.length > 0;
  const shown = open ? group.dates : group.dates.slice(0, DATES_BEFORE_TRUNCATION);
  const fixable = canFix && section.actions?.length > 0;

  return (
    <li className="sync-health-row">
      <div className="sync-health-row-head">
        <button
          type="button"
          className="sync-health-row-main"
          onClick={() => hasDates && setOpen((v) => !v)}
          aria-expanded={hasDates ? open : undefined}
          disabled={!hasDates}
        >
          <span className="sync-health-row-title">{group.title}</span>
          {/* When / Where as columns, not behind a click. A row you have to
              open to identify is a row you cannot scan, and identifying these
              is the whole job. First row speaks for the group: grouping is by
              event, so every row in it shares a location and time. */}
          <span className="sync-health-row-when">
            {hasDates
              ? `${group.dates[0]}${group.dates.length > 1 ? ` +${group.dates.length - 1}` : ''}`
              : group.kind === 'seriesMaster' ? 'whole series' : 'no date'}
          </span>
          <span className="sync-health-row-time">{timeRangeOf(group)}</span>
          <span className="sync-health-row-where">{firstRow(group).location || ''}</span>
          {group.kind && <span className="sync-health-row-kind">{group.kind}</span>}
        </button>
        {fixable && (
          <button
            type="button"
            className="sync-health-fix-toggle"
            onClick={() => setFixing((v) => !v)}
            aria-expanded={fixing}
          >
            {fixing ? 'Close' : 'Fix…'}
          </button>
        )}
      </div>

      {open && hasDates && (
        <ul className="sync-health-dates">
          {shown.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}

      {fixable && fixing && (
        <FixPanel
          section={section}
          group={group}
          calendarOwner={calendarOwner}
          apiToken={apiToken}
          onDone={() => { setFixing(false); onFixed(); }}
        />
      )}
    </li>
  );
}

/**
 * Review-and-apply table for linking many untethered records at once.
 *
 * The server classifies every row; this only renders the verdict and collects
 * a selection. Confident rows (name, date AND start time all agree, with
 * exactly one candidate) arrive pre-checked; everything else is listed with the
 * reason it was held back, unchecked, for a human to accept deliberately.
 *
 * Nothing here can create or delete an Outlook event — the batch endpoint only
 * performs link, and each selected row still goes through the same fingerprint
 * handshake a single fix does.
 */
function BatchLinkPanel({ groups, calendarOwner, apiToken, onDone }) {
  const { showSuccess, showError } = useNotification();
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(null);

  const post = async (path, body) => {
    const response = await fetch(
      `${APP_CONFIG.API_BASE_URL}/admin/sync-health/reconcile/batch/${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ calendarOwner, ...body }),
      }
    );
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  };

  const runPlan = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await post('plan', { mongoIds: groups.map((g) => g.key) });
      if (!res.ok) {
        setProblem(res.body.message || res.body.error || 'Could not check for matches.');
        return;
      }
      setRows(res.body.rows);
      setSelected(new Set(res.body.rows.filter((r) => r.selectedByDefault).map((r) => r.mongoId)));
    } catch (err) {
      logger.error('Batch link plan failed:', err);
      setProblem(err.message || 'Could not check for matches.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (mongoId) => {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mongoId)) next.delete(mongoId); else next.add(mongoId);
      return next;
    });
  };

  const apply = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try {
      const selections = rows
        .filter((r) => selected.has(r.mongoId) && r.candidate)
        .map((r) => ({
          mongoId: r.mongoId, graphId: r.candidate.graphId, expectedState: r.expectedState,
        }));
      const res = await post('apply', { selections });
      if (!res.ok) {
        setConfirming(false);
        showError(res.body.message || res.body.error || 'Could not link these events.');
        return;
      }
      const { done, skipped, failed } = res.body.summary;
      showSuccess(
        `Linked ${done}.${skipped ? ` ${skipped} changed since the check and were skipped.` : ''}` +
        `${failed ? ` ${failed} failed.` : ''}`
      );
      onDone();
    } catch (err) {
      logger.error('Batch link apply failed:', err);
      setConfirming(false);
      showError(err.message || 'Could not link these events.');
    } finally {
      setBusy(false);
    }
  };

  if (!rows) {
    return (
      <div className="sync-health-batch">
        <button type="button" className="sync-health-batch-start" onClick={runPlan} disabled={busy}>
          {busy ? 'Checking Outlook…' : `Find Outlook matches for all ${groups.length}`}
        </button>
        {problem && <p className="sync-health-fix-problem">{problem}</p>}
      </div>
    );
  }

  const selectable = rows.filter((r) => r.candidate);
  const chosen = selectable.filter((r) => selected.has(r.mongoId));

  return (
    <div className="sync-health-batch">
      <table className="sync-health-batch-table">
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Link</span></th>
            <th scope="col">Event</th>
            <th scope="col">When</th>
            <th scope="col">Outlook match</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.mongoId} className={`tier-${row.tier}`}>
              <td>
                {row.candidate ? (
                  <input
                    type="checkbox"
                    checked={selected.has(row.mongoId)}
                    onChange={() => toggle(row.mongoId)}
                    aria-label={`Link ${row.eventTitle}`}
                  />
                ) : <span aria-hidden="true">—</span>}
              </td>
              <td>
                {row.eventTitle}
                {row.location && <span className="sync-health-batch-sub">{row.location}</span>}
              </td>
              <td className="tabular">
                {row.date}
                {row.startTime && <span className="sync-health-batch-sub">{row.startTime}</span>}
              </td>
              <td>
                {row.candidate ? (
                  <>
                    {row.candidate.subject}
                    {row.candidate.startTime && (
                      <span className="sync-health-batch-sub">{row.candidate.startTime}</span>
                    )}
                  </>
                ) : <span className="sync-health-batch-sub">no match</span>}
              </td>
              <td className="sync-health-batch-why">{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sync-health-batch-foot">
        <span>
          {chosen.length} of {selectable.length} with a match selected.
        </span>
        <button
          type="button"
          className={`sync-health-fix-apply ${confirming ? 'confirm' : ''}`}
          onClick={apply}
          disabled={busy || chosen.length === 0}
        >
          {busy ? 'Linking…' : confirming ? `Confirm — link ${chosen.length}?` : `Link ${chosen.length} selected`}
        </button>
      </div>
    </div>
  );
}

/**
 * One problem category for one calendar.
 */
function FindingGroup({ section, rows, calendarOwner, apiToken, canFix, onFixed }) {
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

      {canFix && section.batchLink && groups.length > 1 && (
        <BatchLinkPanel
          groups={groups}
          calendarOwner={calendarOwner}
          apiToken={apiToken}
          onDone={onFixed}
        />
      )}

      {section.severity === 'info' && !open ? (
        <button type="button" className="sync-health-disclose" onClick={() => setOpen(true)}>
          Show {plural(groups.length, 'event', 'events')} ({instanceCount} instances)
        </button>
      ) : (
        <>
          <ul className="sync-health-rows">
            {visible.map((g) => (
              <EventRow
                key={g.key}
                group={g}
                section={section}
                calendarOwner={calendarOwner}
                apiToken={apiToken}
                canFix={canFix}
                onFixed={onFixed}
              />
            ))}
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
function Reconciliation({ calendar }) {
  const counts = calendar.counts || {};
  const { appOnly, matched, outlookOnly, total } = reconcile(calendar);
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

function CalendarReport({ calendar, apiToken, canFix, onFixed }) {
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

      {calendar.degraded && (
        <p className="sync-health-degraded">
          Some events in this mailbox have no readable date, so their findings below may be
          wrong. Affected event {plural(calendar.degraded.mongoIds.length, 'record', 'records')}:{' '}
          {calendar.degraded.mongoIds.join(', ')}
        </p>
      )}

      <Reconciliation calendar={calendar} />

      {SECTIONS.map((section) => (
        <FindingGroup
          key={section.key}
          section={section}
          rows={calendar[section.key] || []}
          calendarOwner={calendar.calendarOwner}
          apiToken={apiToken}
          canFix={canFix}
          onFixed={onFixed}
        />
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
  const { isAdmin } = usePermissions();
  const queryClient = useQueryClient();
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
    const nextVersion = runVersion + 1;
    // Every run mints a NEW query key (that is what forces a refetch on an
    // unchanged date range). Without eviction the cache accumulates one full
    // report per click for the session — and a report is a per-mailbox
    // calendarView page, the largest payload this app holds. Drop everything
    // except the run being replaced, so the count is capped at two: the
    // outgoing result stays mounted until the new one lands.
    queryClient.removeQueries({
      queryKey: keys.syncHealth.report(),
      predicate: (query) => {
        const version = query.queryKey[2]?.version;
        return version !== nextVersion && version !== runVersion;
      },
    });

    setAppliedRange({ ...range, calendarOwner });
    setRunVersion(nextVersion);
  };

  return (
    <div className="sync-health loading-veil-host">
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
          <LoadingSpinner variant="overlay" className="visible initial" text="Comparing app and Outlook..." />
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
              apiToken={apiToken}
              // Reconcile writes to Outlook and one action cannot be undone, so
              // it is admin-only — narrower than the report itself, which
              // approvers can read.
              canFix={isAdmin}
              onFixed={handleRunCheck}
            />
          ))
        )}
      </div>
    </div>
  );
}

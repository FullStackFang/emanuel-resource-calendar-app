// src/components/ConflictReport.jsx
//
// "Room Conflicts" screen (admins + approvers). Scans a forward window and
// lists every genuine room double-booking among published events.
//
// WHY THIS EXISTS: every other conflict check in the system is one-vs-many —
// "given this candidate reservation, what does it hit?" — and runs at write
// time. Nothing answered "across the whole calendar, what is double-booked
// right now?". Graph delta sync writes Outlook-originated events straight into
// the collection without any conflict check, forced publishes deliberately
// write into a known conflict, and an approved event can be edited into a
// collision. In all three cases the double-booking sits in the database
// invisibly until two groups show up at the same room.
//
// LOADING CONTRACT: this is an auto-firing list view, so it follows the
// MyReservations / EventManagement pattern, NOT the SyncHealthReport
// run-on-click one. `loading` binds to isFirstLoad (isPending), never to
// TanStack's isLoading, which is false during the `pending && idle` tick.
//
// THE EMPTY STATE IS THE DANGEROUS ONE. On a defect list it does not read
// "nothing here yet", it reads "no conflicts were found". Rendering it before
// the scan resolves, or while the scan is degraded, tells an approver the
// calendar is clean when nobody has actually checked.

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { deriveListLoadingState } from '../utils/listLoadingState';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useEventReviewExperience } from '../hooks/useEventReviewExperience';
import EventReviewExperience from './shared/EventReviewExperience';
import EmptyStateRefreshButton from './shared/EmptyStateRefreshButton';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './ConflictReport.css';

// Presets only. The server rejects anything else rather than clamping, so a
// silently-clamped window can never make the report misstate its own coverage.
const WINDOW_OPTIONS = [
  { value: 30, label: 'Next 30 days' },
  { value: 90, label: 'Next 90 days' },
  { value: 180, label: 'Next 6 months' },
  { value: 365, label: 'Next year' },
];

const DEFAULT_DAYS = 90;

/** '2026-09-01T11:00:00' -> '11:00 AM'. Stored strings are local, no Z. */
function formatTime(value) {
  if (!value) return '';
  const time = String(value).split('T')[1];
  if (!time) return '';
  const [hRaw, m] = time.split(':');
  const h = Number(hRaw);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/**
 * A time range that stays honest across a day boundary. Two bare clock times
 * hide the rollover — a booking running to midnight the next day renders as
 * "12:00 AM – 12:00 AM" and reads as zero-length, which is precisely how a
 * whole-day span looked like it could not possibly be conflicting.
 */
function formatRange(start, end) {
  const startDay = String(start || '').split('T')[0];
  const endDay = String(end || '').split('T')[0];
  if (startDay && endDay && startDay !== endDay) {
    return `${formatTime(start)} – ${formatTime(end)} (${endDay})`;
  }
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function formatDateHeading(dateKey) {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * What kind of document this side actually is. Load-bearing rather than
 * decorative: the identifying fields are the only thing that differs when a
 * duplicate, a series occurrence, and an override all land on one row.
 */
function describeType(side) {
  // A Hold is a room block with no event scheduled inside it. Naming it matters
  // because its times come from its reservation bounds rather than from event
  // times, so a reader comparing it against the calendar will not find a
  // matching entry.
  const kind = side.isHold ? 'room hold' : null;
  if (side.eventType === 'exception') return kind ? `${kind} · series override` : 'series override';
  if (side.eventType === 'addition') return kind ? `${kind} · added date` : 'added date';
  if (side.isOccurrence) {
    const base = `series occurrence${side.occurrenceDate ? ` · ${side.occurrenceDate}` : ''}`;
    return kind ? `${kind} · ${base}` : base;
  }
  return kind || 'single event';
}

/**
 * One side of a conflict. Renders its own times beneath the contested interval
 * and opens through the shared review experience.
 */
function ConflictSide({ side, onOpen }) {
  return (
    <div className="conflict-side" data-testid="conflict-side">
      <div className="conflict-side-main">
        <span className="conflict-side-title">{side.title}</span>
        {side.isOccurrence && (
          <span className="conflict-side-badge occurrence" title={`Occurrence of a recurring series${side.occurrenceDate ? ` on ${side.occurrenceDate}` : ''}`}>
            Occurrence of a series
          </span>
        )}
        <span className={`conflict-side-status status-${side.status}`}>{side.status}</span>
      </div>
      <div className="conflict-side-meta">
        {/* formatRange, not two bare times: a span that crosses midnight
            renders as "12:00 AM – 12:00 AM" when the date is dropped, which
            reads as a zero-length event rather than a full day. */}
        <span className="conflict-side-times">{formatRange(side.startDateTime, side.endDateTime)}</span>
        {/* A blank requester would read as missing data. Outlook-synced events
            genuinely have none, and they are expected to be a large share of
            these rows, so say so. */}
        <span className="conflict-side-requester">
          {side.requesterName || 'Synced from Outlook'}
        </span>
        {/* Identity, because everything above can be IDENTICAL on both sides —
            a duplicated document, a series occurrence next to its own override,
            and two children on one date all render the same title, time and
            requester. Without the id and the type there is no way to tell which
            of those you are looking at. */}
        <span className="conflict-side-identity" data-testid="conflict-side-identity">
          <code title={side.id}>{String(side.id).slice(-6)}</code>
          <span className="conflict-side-type">{describeType(side)}</span>
        </span>
      </div>
      <button
        type="button"
        className="conflict-side-open"
        onClick={() => onOpen(side)}
        aria-label={`Open ${side.title}`}
      >
        Open
      </button>
    </div>
  );
}

export default function ConflictReport() {
  const authFetch = useAuthenticatedFetch();
  const { apiToken } = useAuth();
  const queryClient = useQueryClient();
  const { showError } = useNotification();

  const [days, setDays] = useState(DEFAULT_DAYS);
  // null = "not chosen yet". Distinct from '' ("All calendars"), which is a
  // deliberate user choice. The scan does not run while this is null, so the
  // first result the user sees is already correctly scoped — rather than a
  // full-collection scan that then re-runs under them.
  const [calendarOwner, setCalendarOwner] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // The reportable mailboxes are the admin-managed allowlist from
  // calendar-config.json, the same list that governs the main calendar view and
  // the Sync Health picker. Shares Sync Health's query key deliberately: it is
  // the same request against the same endpoint, so one cache entry serves both.
  const calendarsQuery = useQuery({
    queryKey: keys.syncHealth.calendars(),
    enabled: !!apiToken,
    queryFn: async () => {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/calendar-display-config`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Could not load the calendar list');
      const body = await response.json();
      return body.allowedDisplayCalendars || [];
    },
  });
  // Memoized because `data || []` mints a new array every render, which would
  // make the selection effect below re-run on every render.
  const allowedCalendars = useMemo(() => calendarsQuery.data || [], [calendarsQuery.data]);

  // Settle on a selection as soon as the list arrives — scanning one real
  // calendar rather than every mailbox that exists. Selecting here rather than
  // defaulting in render keeps the submitted value and the visible value the
  // same thing, the same way SyncHealthReport does it.
  //
  // The `!calendarsQuery.isPending` arm matters: with no configured calendars
  // the selection would never settle and the view would spin forever. Falling
  // back to "all" lets the scan run and lets the server explain the empty
  // allowlist instead.
  useEffect(() => {
    if (calendarOwner !== null) return;
    if (allowedCalendars.length > 0) {
      setCalendarOwner(allowedCalendars[0]);
    } else if (!calendarsQuery.isPending) {
      setCalendarOwner('');
    }
  }, [allowedCalendars, calendarOwner, calendarsQuery.isPending]);

  const queryKey = useMemo(
    () => keys.conflictReport.report({ days, calendarOwner: calendarOwner || null }),
    [days, calendarOwner]
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (calendarOwner) params.set('calendarOwner', calendarOwner);
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/reports/conflicts?${params.toString()}`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Conflict scan failed (${response.status})`);
      }
      return response.json();
    },
    // Gated on the token like every other auto-firing list view: a cold scan
    // fired before MSAL resolves is a guaranteed 401-then-refresh round trip.
    //
    // ALSO gated on the calendar selection having settled. Firing first and
    // re-firing when the list arrives makes the user watch a full-collection
    // scan get thrown away and replaced.
    enabled: !!apiToken && calendarOwner !== null,
  });

  // `enabled` is deliberately NOT passed to the helper. Per the list-view
  // convention it is only forwarded by views that intentionally skip the fetch
  // on some tab or filter. A token gate is "disabled but imminent": leaving the
  // helper's default keeps isPending true through the wait, so the spinner
  // holds instead of flashing "no room conflicts found" at a user whose scan
  // has not started.
  const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(query);

  const data = query.data || null;
  const conflicts = data?.conflicts || [];
  const groups = data?.groups || [];
  const degraded = data?.degraded || [];
  const truncated = !!data?.truncated;

  // Drill-in. One instance at report level, fed by a selected id — the same
  // single-instance pattern every other caller uses. Per the
  // EventReviewExperience contract, the report passes raw props and derives no
  // permission gates of its own.
  const experience = useEventReviewExperience({
    authFetch,
    onRefresh: () => {
      // A resolved conflict must disappear when the modal closes.
      queryClient.invalidateQueries({ queryKey: keys.conflictReport.all() });
    },
    onError: (error) => showError(error, { context: 'ConflictReport.reviewModal' }),
  });

  const handleOpenSide = useCallback((side) => {
    if (!side?.id) return;
    // navigateToEvent already carries the /room-reservations/:id -> /events/:id
    // 404 fallback. That is MANDATORY here, not defensive: Outlook-synced sides
    // have no roomReservationData and are absent from the reservations
    // endpoint entirely.
    //
    // `open: true` is REQUIRED from this surface. navigateToEvent's other
    // callers are already inside an open modal, so by default it stages the
    // event without touching isOpen — from the report that means the button
    // does nothing visible at all.
    Promise.resolve(experience.navigateToEvent(side.id, { open: true })).catch((err) => {
      logger.error('ConflictReport: failed to open side', err);
    });
  }, [experience]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [query]);

  // Render the empty state ONLY when the query is settled, the result is
  // empty, and nothing is refetching underneath.
  const showEmptyState = !isFirstLoad && !isSilentRefreshing && !query.error && conflicts.length === 0;

  return (
    <div className="conflict-report loading-veil-host">
      <header className="conflict-report-header">
        <div className="conflict-report-heading">
          <h1>Room Conflicts</h1>
          <p className="conflict-report-subtitle">
            Published events double-booked into the same room. Overlaps your category
            rules permit are not listed.
          </p>
        </div>

        <div className="conflict-report-controls">
          <label className="conflict-report-control">
            <span>Window</span>
            <select
              data-testid="conflict-report-window"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="conflict-report-control">
            <span>Calendar</span>
            {/* "All calendars" is a real option, not a missing filter: the scan
                only ever compares events within one mailbox, so scanning all of
                them finds each calendar's own conflicts without inventing
                cross-mailbox ones. */}
            <select
              data-testid="conflict-report-calendar"
              value={calendarOwner ?? ''}
              disabled={calendarOwner === null}
              onChange={(e) => setCalendarOwner(e.target.value)}
            >
              <option value="">All calendars</option>
              {allowedCalendars.map((owner) => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="conflict-report-rerun"
            data-testid="conflict-report-rerun"
            onClick={handleManualRefresh}
            disabled={isFirstLoad || isManualRefreshing}
          >
            {isManualRefreshing ? 'Scanning…' : 'Re-run scan'}
          </button>
        </div>

        {data?.generatedAt && (
          <div className="conflict-report-generated-at" data-testid="conflict-report-generated-at">
            Scanned {new Date(data.generatedAt).toLocaleString()}
            {data.window?.days ? ` · next ${data.window.days} days` : ''}
            {typeof data.occurrenceCount === 'number' ? ` · ${data.occurrenceCount} bookings examined` : ''}
          </div>
        )}
      </header>

      {/* Incompleteness is stated ABOVE the results, because the results below
          are the incomplete thing being qualified. */}
      {degraded.length > 0 && (
        <div className="conflict-report-banner warning" data-testid="conflict-report-degraded" role="status">
          <strong>These results may be incomplete.</strong>{' '}
          Part of the scan did not finish, so conflicts involving that data are not listed:{' '}
          {degraded.map((d) => `${d.stage} (${d.message})`).join('; ')}
        </div>
      )}

      {truncated && (
        <div className="conflict-report-banner warning" data-testid="conflict-report-truncated" role="status">
          <strong>Not all bookings were scanned.</strong>{' '}
          This window contains more occurrences than one scan examines. Narrow the
          window or the calendar to cover the rest.
        </div>
      )}

      {query.error && (
        <div className="conflict-report-error" data-testid="conflict-report-error" role="alert">
          <p>
            <strong>The scan could not run.</strong>{' '}
            {query.error.message || 'Something went wrong.'}
          </p>
          <p className="conflict-report-error-note">
            This is not a report that the calendar is clean — nothing was checked.
          </p>
          <button type="button" onClick={handleManualRefresh} disabled={isManualRefreshing}>
            {isManualRefreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* The one loading veil every tab uses; the root is its host. */}
      {isFirstLoad && (
        <LoadingSpinner variant="overlay" className="visible initial" text="Scanning the calendar..." />
      )}

      {!isFirstLoad && !query.error && conflicts.length > 0 && (
        <div className={`conflict-report-results${isSilentRefreshing ? ' refreshing' : ''}`}>
          <div className="conflict-report-count">
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} found
          </div>

          {groups.map((dateGroup) => (
            <section
              key={dateGroup.date}
              className="conflict-date-group"
              data-testid="conflict-date-group"
            >
              <h2 className="conflict-date-heading">
                {formatDateHeading(dateGroup.date)}
                <span className="conflict-date-key">{dateGroup.date}</span>
              </h2>

              {dateGroup.rooms.map((roomGroup) => (
                <div
                  key={`${dateGroup.date}-${roomGroup.roomId}`}
                  className="conflict-room-group"
                  data-testid="conflict-room-group"
                >
                  <h3 className="conflict-room-heading">
                    {roomGroup.roomName}
                    {/* Both sides always share this — the scan only compares
                        within one mailbox — so it belongs on the room, not
                        repeated on each side. */}
                    {roomGroup.conflicts[0]?.calendarOwner && (
                      <span className="conflict-room-calendar">
                        {roomGroup.conflicts[0].calendarOwner}
                      </span>
                    )}
                  </h3>

                  {roomGroup.conflicts.map((c) => (
                    <article key={c.key} className="conflict-row" data-testid="conflict-row">
                      {/* The headline is the CONTESTED interval, not either
                          event's span. With setup and teardown buffers in play
                          two events collide while their visible times do not
                          overlap; a row showing only the visible times is one
                          an approver argues with. */}
                      <div className="conflict-contested" data-testid="contested-interval">
                        <span className="conflict-contested-label">Room contested</span>
                        <span className="conflict-contested-times">
                          {formatRange(c.overlapStart, c.overlapEnd)}
                        </span>
                      </div>

                      <div className="conflict-sides">
                        {c.sides.map((s) => (
                          <ConflictSide key={s.key} side={s} onOpen={handleOpenSide} />
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {showEmptyState && (
        <div className="conflict-report-empty" data-testid="conflict-report-empty">
          <div className="conflict-report-empty-icon" aria-hidden="true">✓</div>
          <h2>No room conflicts found</h2>
          <p>
            Nothing in the scanned window is double-booked
            {degraded.length > 0 ? ' among the data that could be read' : ''}.
          </p>
          <EmptyStateRefreshButton
            onClick={handleManualRefresh}
            isRefreshing={isManualRefreshing}
            label="Re-run scan"
          />
        </div>
      )}

      {/* Mounted at report level and left mounted beneath the overlay, so the
          list's scroll position survives without special handling. */}
      <EventReviewExperience
        experience={experience}
        title={experience.editableData?.eventTitle || 'Event'}
        defaultCalendar={experience.editableData?.calendarOwner || undefined}
      />
    </div>
  );
}

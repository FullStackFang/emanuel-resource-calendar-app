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

import React, { useState, useMemo, useCallback } from 'react';
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
        <span className="conflict-side-times">
          {formatTime(side.startDateTime)} – {formatTime(side.endDateTime)}
        </span>
        {/* A blank requester would read as missing data. Outlook-synced events
            genuinely have none, and they are expected to be a large share of
            these rows, so say so. */}
        <span className="conflict-side-requester">
          {side.requesterName || 'Synced from Outlook'}
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
  const [calendarOwner, setCalendarOwner] = useState('');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

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
    enabled: !!apiToken,
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
    Promise.resolve(experience.navigateToEvent(side.id)).catch((err) => {
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
    <div className="conflict-report">
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
            <input
              data-testid="conflict-report-calendar"
              type="text"
              placeholder="All calendars"
              value={calendarOwner}
              onChange={(e) => setCalendarOwner(e.target.value)}
            />
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

      {isFirstLoad && <LoadingSpinner />}

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
                  <h3 className="conflict-room-heading">{roomGroup.roomName}</h3>

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
                          {formatTime(c.overlapStart)} – {formatTime(c.overlapEnd)}
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

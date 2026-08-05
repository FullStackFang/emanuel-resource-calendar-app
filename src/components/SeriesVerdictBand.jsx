import { useState, useEffect } from 'react';
import { formatTimeFromDateTimeString } from '../utils/appTimeUtils';
import './SeriesVerdictBand.css';

/**
 * SeriesVerdictBand
 *
 * The selected occurrence day's verdict, rendered directly beneath the
 * SeriesOccurrenceBand's chip row inside the assistant's series region
 * (scheduling-assistant-series-mode) — selecting a chip shows its
 * consequence adjacent to it. Three states, bound to the selected day
 * rather than opened per row:
 * - conflicted: every blocking event's detail (title, status, time, rooms,
 *   requester or synced-from-Outlook badge) with a per-blocker open link
 *   (always a new tab; the focus re-check refreshes this form on return)
 *   and a skip action;
 * - clear: a quiet all-clear line, no actions;
 * - skipped: a pending-removal note with a restore action, warning when the
 *   session's last-known blockers say the room is still booked.
 *
 * Skip (warning color) and Restore (success color) use the app's two-step
 * in-button confirmation. Arming clears on selection change or data refresh
 * — never by timeout (app button standard).
 */
function formatDayLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export default function SeriesVerdictBand({
  selectedDate,
  occurrence = null,
  conflict = null,
  lastKnownBlockers = {},
  skipRefused = false,
  readOnly = false,
  onSkipOccurrence = null,
  onRestoreOccurrence = null,
}) {
  // 'skip' | 'restore' | null — the armed two-step confirmation
  const [armed, setArmed] = useState(null);

  // Disarm structurally on selection or state change: a confirmation armed
  // for one date must never execute against another.
  useEffect(() => {
    setArmed(null);
  }, [selectedDate, occurrence?.state]);

  if (!occurrence) return null;

  const handleSkipClick = () => {
    if (armed !== 'skip') {
      setArmed('skip');
      return;
    }
    setArmed(null);
    onSkipOccurrence?.(occurrence.date);
  };

  const handleRestoreClick = () => {
    if (armed !== 'restore') {
      setArmed('restore');
      return;
    }
    setArmed(null);
    onRestoreOccurrence?.(occurrence.date);
  };

  if (occurrence.state === 'skipped') {
    const knownBlockers = lastKnownBlockers[occurrence.date] || [];
    return (
      <div className="series-verdict-band v-skipped" data-testid="series-verdict-band">
        <span className="svb-skip-note">
          Skipped &mdash; this date leaves the series when you save.
          {knownBlockers.length > 0 && (
            <span className="svb-skip-warn">
              {' '}The room is still booked here; restoring re-flags the conflict.
            </span>
          )}
        </span>
        {!readOnly && onRestoreOccurrence && (
          <span className="svb-actions">
            <button
              type="button"
              className={`svb-btn restore${armed === 'restore' ? ' confirm' : ''}`}
              data-testid="svb-restore"
              onClick={handleRestoreClick}
            >
              {armed === 'restore' ? 'Confirm restore?' : 'Restore this date'}
            </button>
          </span>
        )}
      </div>
    );
  }

  if (occurrence.state !== 'conflicted' || !conflict) {
    return (
      <div className="series-verdict-band v-clear" data-testid="series-verdict-band">
        <span className="svb-check" aria-hidden="true">&#10003;</span>
        No conflicts on this day.
      </div>
    );
  }

  return (
    <div className="series-verdict-band v-conflict" data-testid="series-verdict-band">
      {/* Day anchor: the band renders under the chip row, where several chips
          can be conflicted — the detail must say which day it resolves. */}
      <span className="svb-day" data-testid="svb-day">{formatDayLabel(occurrence.date)}</span>
      <div className="svb-blockers">
        {conflict.hardConflicts.map((c, i) => {
          const rooms = Array.isArray(c.roomNames) ? c.roomNames : (c.roomNames ? [c.roomNames] : []);
          return (
            <div key={`${c.id}-${i}`} className="svb-blocker">
              <span className="svb-blocker-info">
                <span className="svb-blocker-title">{c.eventTitle}</span>
                {c.status && <span className="svb-blocker-status">{c.status}</span>}
                <span className="svb-blocker-time">
                  {formatTimeFromDateTimeString(c.startDateTime)} &ndash; {formatTimeFromDateTimeString(c.endDateTime)}
                </span>
                {rooms.length > 0 && <span className="svb-blocker-rooms">{rooms.join(', ')}</span>}
                {c.requestedBy ? (
                  <span className="svb-blocker-requester">Requested by {c.requestedBy}</span>
                ) : (
                  <span className="svb-outlook-badge">Synced from Outlook</span>
                )}
              </span>
              {/* Always a new tab: the form under review stays open, and the
                  focus re-check refreshes its conflicts when the user returns.
                  The ?eventId= deep link is matched by Mongo _id in Calendar's
                  deep-link effect. */}
              <a
                href={`/?eventId=${c.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="svb-btn open"
                data-testid={`svb-open-${c.id}`}
              >
                Open blocking event
              </a>
            </div>
          );
        })}
      </div>
      {!readOnly && onSkipOccurrence && (
        skipRefused ? (
          <p className="svb-skip-refused">
            This is the only remaining occurrence, so it can&apos;t be skipped.
            Use the recurrence editor to shorten or cancel the series instead.
          </p>
        ) : (
          <span className="svb-actions">
            <button
              type="button"
              className={`svb-btn skip${armed === 'skip' ? ' confirm' : ''}`}
              data-testid="svb-skip"
              onClick={handleSkipClick}
            >
              {armed === 'skip' ? 'Confirm skip?' : 'Skip this date'}
            </button>
          </span>
        )
      )}
    </div>
  );
}

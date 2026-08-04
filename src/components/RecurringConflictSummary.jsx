import { useState, useEffect, useRef, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import { formatTimeFromDateTimeString } from '../utils/appTimeUtils';
import { isAbortError } from '../utils/errorUtils';
import './RecurringConflictSummary.css';

// Strip density thresholds (design D9): above DENSE the squares shrink one
// step; above COMPACT the strip is replaced by a summary line — past that
// density the strip stops being glanceable and starts being wallpaper.
const STRIP_DENSE_THRESHOLD = 60;
const STRIP_COMPACT_THRESHOLD = 150;

/**
 * RecurringConflictSummary
 *
 * Per-occurrence conflict resolution surface for recurring events. Since
 * recurring-publish-conflict-blocking, a conflicted occurrence blocks
 * publishing (409), so the panel renders a verdict — an occurrence strip
 * (one square per occurrence) plus a single inline resolution drawer with
 * each blocking event's detail and the two ways out: open the blocker, or
 * skip the date.
 *
 * Props:
 * - recurrence: { pattern, range, exclusions, additions }
 * - roomIds: string[] of room ObjectIds
 * - startDateTime: ISO string for first occurrence start
 * - endDateTime: ISO string for first occurrence end
 * - setupTimeMinutes: number
 * - teardownTimeMinutes: number
 * - excludeEventId: string | null (self-exclusion)
 * - readOnly: boolean (true = single fetch on mount; false = debounced fetch on change)
 * - apiToken: string | null
 * - isAllowedConcurrent: boolean
 * - categories: string[]
 * - calendarOwner: string | null (scopes conflicts to one mailbox calendar)
 * - onOpenBlockingEvent: fn(conflictRecord, { occurrenceDate, outstandingConflictCount }) | null
 * - onSkipOccurrence: fn(occurrenceDate) | null — null when the form's fields
 *   are disabled (a read-only viewer cannot change the recurrence)
 * - pendingSkippedDates: string[] — exclusions added this session but not yet
 *   saved; rendered as skipped-but-pending, never as done
 */
export default function RecurringConflictSummary({
  recurrence,
  roomIds,
  startDateTime,
  endDateTime,
  setupTimeMinutes = 0,
  teardownTimeMinutes = 0,
  reservationStartMinutes = 0,
  reservationEndMinutes = 0,
  excludeEventId = null,
  readOnly = false,
  apiToken = null,
  isAllowedConcurrent = false,
  categories = [],
  calendarOwner = null,
  inline = false,
  onOpenBlockingEvent = null,
  onSkipOccurrence = null,
  pendingSkippedDates = [],
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // The single open resolution drawer (design D2): occurrenceDate | null.
  // A drawer only renders inside a still-conflicted row, so a refetch that
  // clears the active date closes it structurally.
  const [activeDate, setActiveDate] = useState(null);
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const fetchConflicts = useCallback(async () => {
    if (!recurrence?.pattern || !recurrence?.range || !roomIds?.length || !startDateTime || !endDateTime) {
      setData(null);
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/recurring-conflicts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          startDateTime,
          endDateTime,
          recurrence,
          roomIds,
          setupTimeMinutes,
          teardownTimeMinutes,
          reservationStartMinutes,
          reservationEndMinutes,
          excludeEventId,
          isAllowedConcurrent,
          categories,
          calendarOwner,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Server error (${response.status})`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [recurrence, roomIds, startDateTime, endDateTime, setupTimeMinutes, teardownTimeMinutes, reservationStartMinutes, reservationEndMinutes, excludeEventId, apiToken, isAllowedConcurrent, categories, calendarOwner]);

  // Keep the latest fetchConflicts reachable without keying the effect on its
  // identity — parents pass fresh array/object references every render, which
  // would refetch forever in readOnly mode and perpetually reset the form-mode
  // debounce. The effect below is keyed on the serialized request instead.
  const fetchConflictsRef = useRef(fetchConflicts);
  useEffect(() => {
    fetchConflictsRef.current = fetchConflicts;
  }, [fetchConflicts]);

  const requestSignature = JSON.stringify({
    recurrence,
    roomIds,
    startDateTime,
    endDateTime,
    setupTimeMinutes,
    teardownTimeMinutes,
    reservationStartMinutes,
    reservationEndMinutes,
    excludeEventId,
    isAllowedConcurrent,
    categories,
    calendarOwner,
    hasToken: !!apiToken,
  });

  useEffect(() => {
    if (readOnly) {
      // Single fetch per distinct request in read-only mode (Conflicts tab)
      fetchConflictsRef.current();
      return;
    }

    // Debounced fetch for form mode
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchConflictsRef.current();
    }, 1200);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [requestSignature, readOnly]);

  const inlineClass = inline ? ' inline' : '';

  // Don't render anything until we have data or are loading
  if (!loading && !data && !error) return null;

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className={`recurring-conflict-summary loading${inlineClass}`}>
        <div className="rcs-skeleton-bar" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`recurring-conflict-summary error${inlineClass}`}>
        <span className="rcs-icon">&#9888;</span>
        <span>{error}</span>
        <button className="rcs-retry-btn" onClick={fetchConflicts}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const blocked = data.conflictingOccurrences > 0;
  const conflictedDates = new Set((data.conflicts || []).map(c => c.occurrenceDate));
  const skippedDates = new Set(pendingSkippedDates || []);

  // Strip entries: every occurrence the server expanded, plus any date skipped
  // this session (a skipped date leaves the recurrence expansion, so it
  // disappears from allOccurrences — it must still render, as skipped).
  const stripEntries = buildStripEntries(data.allOccurrences, skippedDates, conflictedDates);
  const stripDense = stripEntries.length > STRIP_DENSE_THRESHOLD;
  const stripCompact = stripEntries.length > STRIP_COMPACT_THRESHOLD;

  const toggleDrawer = (date) => {
    setActiveDate(prev => (prev === date ? null : date));
  };

  // The last remaining occurrence cannot be skipped — an empty series is the
  // recurrence editor's job to create deliberately, not a side effect here.
  const skipRefused = data.totalOccurrences <= 1;

  return (
    <div className={`recurring-conflict-summary ${blocked ? 'blocked' : 'clean'}${inlineClass}`}>
      {/* Verdict header — reads as a publish gate, not an advisory */}
      <div className="rcs-header" role="status">
        <span className={`rcs-icon ${blocked ? 'rcs-icon-blocked' : 'rcs-icon-clean'}`} aria-hidden="true">
          {blocked ? '⛔' : '✓'}
        </span>
        <span className="rcs-text">
          {blocked ? (
            <>
              <span className="rcs-verdict-counts">
                <strong>{data.conflictingOccurrences}</strong> of {data.totalOccurrences} occurrences have room conflicts.
              </span>
              <span className="rcs-verdict-sub">
                Publishing is blocked until each conflict is resolved or its date is skipped.
              </span>
            </>
          ) : (
            <>All {data.totalOccurrences} occurrences are clear of room conflicts.</>
          )}
        </span>
        {loading && <span className="rcs-refreshing">Refreshing...</span>}
      </div>

      {/* Occurrence strip — which weeks are affected, at a glance */}
      {stripCompact ? (
        <p className="rcs-compact-summary" data-testid="rcs-compact-summary">
          {stripEntries.length} occurrences &mdash; too many to chart individually.
          The conflicted dates are listed below.
        </p>
      ) : stripEntries.length > 0 && (
        <div className={`rcs-strip${stripDense ? ' dense' : ''}`} role="list" aria-label="Occurrences">
          {stripEntries.map((entry) => {
            const label = `${formatOccurrenceDate(entry.date)} — ${entry.state === 'skipped' ? 'skipped (not saved yet)' : entry.state}`;
            return entry.state === 'conflicted' ? (
              <button
                key={entry.date}
                type="button"
                role="listitem"
                className={`rcs-strip-square conflicted${activeDate === entry.date ? ' active' : ''}`}
                data-testid={`rcs-square-${entry.date}`}
                data-date={entry.date}
                data-state="conflicted"
                title={label}
                aria-label={label}
                onClick={() => toggleDrawer(entry.date)}
              />
            ) : (
              <span
                key={entry.date}
                role="listitem"
                className={`rcs-strip-square ${entry.state}`}
                data-testid={`rcs-square-${entry.date}`}
                data-date={entry.date}
                data-state={entry.state}
                title={label}
                aria-label={label}
              />
            );
          })}
        </div>
      )}

      {skippedDates.size > 0 && (
        <p className="rcs-skip-pending-note">
          Skipped dates are not saved yet &mdash; save the form to make them permanent.
        </p>
      )}

      {/* Conflict list: one row per conflicted occurrence, each opening the
          single resolution drawer (accordion — opening one closes another) */}
      {blocked && (
        <div className="rcs-conflict-list">
          {data.conflicts.map((occ) => (
            <div key={occ.occurrenceDate} className="rcs-conflict-row-wrap">
              <button
                type="button"
                className={`rcs-conflict-row${activeDate === occ.occurrenceDate ? ' active' : ''}`}
                data-testid={`rcs-conflict-row-${occ.occurrenceDate}`}
                aria-expanded={activeDate === occ.occurrenceDate}
                onClick={() => toggleDrawer(occ.occurrenceDate)}
              >
                <span className="rcs-row-date">{formatOccurrenceDate(occ.occurrenceDate)}</span>
                <span className="rcs-row-time">
                  {formatTime(occ.occurrenceStart)} &ndash; {formatTime(occ.occurrenceEnd)}
                </span>
                <span className="rcs-row-count">
                  {occ.hardConflicts.length} blocking event{occ.hardConflicts.length === 1 ? '' : 's'}
                </span>
              </button>

              {activeDate === occ.occurrenceDate && (
                <div className="rcs-drawer" data-testid={`rcs-drawer-${occ.occurrenceDate}`}>
                  {occ.hardConflicts.map((c, i) => {
                    const rooms = Array.isArray(c.roomNames) ? c.roomNames : (c.roomNames ? [c.roomNames] : []);
                    return (
                      <div key={`${c.id}-${i}`} className="rcs-drawer-event">
                        <div className="rcs-drawer-event-info">
                          <span className="rcs-drawer-title">{c.eventTitle}</span>
                          {c.status && <span className={`rcs-drawer-status status-${c.status}`}>{c.status}</span>}
                          <span className="rcs-drawer-time">
                            {formatTime(c.startDateTime)} &ndash; {formatTime(c.endDateTime)}
                          </span>
                          {rooms.length > 0 && (
                            <span className="rcs-drawer-rooms">{rooms.join(', ')}</span>
                          )}
                          {c.requestedBy ? (
                            <span className="rcs-drawer-requester">Requested by {c.requestedBy}</span>
                          ) : (
                            <span className="rcs-drawer-outlook-badge">Synced from Outlook</span>
                          )}
                        </div>
                        {onOpenBlockingEvent && (
                          <button
                            type="button"
                            className="rcs-drawer-open-btn"
                            data-testid={`rcs-open-${c.id}`}
                            onClick={() => onOpenBlockingEvent(c, {
                              occurrenceDate: occ.occurrenceDate,
                              outstandingConflictCount: data.conflictingOccurrences,
                            })}
                          >
                            Open blocking event
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {onSkipOccurrence && (
                    skipRefused ? (
                      <p className="rcs-skip-refused">
                        This is the only remaining occurrence, so it can&apos;t be skipped.
                        Use the recurrence editor to shorten or cancel the series instead.
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="rcs-skip-btn"
                        data-testid={`rcs-skip-${occ.occurrenceDate}`}
                        onClick={() => onSkipOccurrence(occ.occurrenceDate)}
                      >
                        Skip this date instead
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Merge the server's expanded occurrences with session-skipped dates into one
// ordered strip. A skipped date wins over any other state: even before the
// refetch removes it from allOccurrences, it must already read as skipped.
function buildStripEntries(allOccurrences, skippedDates, conflictedDates) {
  const seen = new Set();
  const entries = [];
  for (const occ of allOccurrences || []) {
    seen.add(occ.occurrenceDate);
    entries.push({
      date: occ.occurrenceDate,
      state: skippedDates.has(occ.occurrenceDate)
        ? 'skipped'
        : conflictedDates.has(occ.occurrenceDate) ? 'conflicted' : 'clear',
    });
  }
  for (const date of skippedDates) {
    if (!seen.has(date)) entries.push({ date, state: 'skipped' });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

function formatOccurrenceDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// formatTime is now imported as formatTimeFromDateTimeString from appTimeUtils
const formatTime = formatTimeFromDateTimeString;

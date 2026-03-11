import { useState, useEffect, useRef, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import './RecurringConflictSummary.css';

/**
 * RecurringConflictSummary
 *
 * Displays per-occurrence conflict info for recurring events.
 * Non-blocking / purely informational — does not disable any buttons.
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
 */
export default function RecurringConflictSummary({
  recurrence,
  roomIds,
  startDateTime,
  endDateTime,
  setupTimeMinutes = 0,
  teardownTimeMinutes = 0,
  excludeEventId = null,
  readOnly = false,
  apiToken = null,
  isAllowedConcurrent = false,
  categories = [],
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
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
          excludeEventId,
          isAllowedConcurrent,
          categories,
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
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [recurrence, roomIds, startDateTime, endDateTime, setupTimeMinutes, teardownTimeMinutes, excludeEventId, apiToken, isAllowedConcurrent, categories]);

  useEffect(() => {
    if (readOnly) {
      // Single fetch on mount for read-only mode (Conflicts tab)
      fetchConflicts();
      return;
    }

    // Debounced fetch for form mode
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchConflicts();
    }, 500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchConflicts, readOnly]);

  // Don't render anything until we have data or are loading
  if (!loading && !data && !error) return null;

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="recurring-conflict-summary loading">
        <div className="rcs-skeleton-bar" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="recurring-conflict-summary error">
        <span className="rcs-icon">&#9888;</span>
        <span>{error}</span>
        <button className="rcs-retry-btn" onClick={fetchConflicts}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  // No conflicts — green checkmark
  if (data.conflictingOccurrences === 0) {
    return (
      <div className="recurring-conflict-summary clean">
        <div className="rcs-header" onClick={() => setExpanded(!expanded)}>
          <span className="rcs-icon rcs-icon-clean">&#10003;</span>
          <span className="rcs-text">
            All {data.totalOccurrences} occurrences are clear of room conflicts.
          </span>
          <button
            className="rcs-expand-btn"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse occurrence details' : 'Expand occurrence details'}
          >
            {expanded ? '\u25B2' : '\u25BC'}
          </button>
          {loading && <span className="rcs-refreshing">Refreshing...</span>}
        </div>
        {expanded && data.allOccurrences && (
          <div className="rcs-detail-list">
            {data.allOccurrences.map((occ) => (
              <div key={occ.occurrenceDate} className="rcs-occurrence-row rcs-occurrence-clean">
                <div className="rcs-occurrence-date">
                  {formatOccurrenceDate(occ.occurrenceDate)}
                </div>
                <div className="rcs-occurrence-time">
                  {formatTime(occ.startDateTime)} &ndash; {formatTime(occ.endDateTime)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Conflicts found — warning
  return (
    <div className="recurring-conflict-summary warning">
      <div className="rcs-header" onClick={() => setExpanded(!expanded)}>
        <span className="rcs-icon rcs-icon-warning">&#9888;</span>
        <span className="rcs-text">
          <strong>{data.conflictingOccurrences}</strong> of {data.totalOccurrences} occurrences have room conflicts.
        </span>
        <button
          className="rcs-expand-btn"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse conflict details' : 'Expand conflict details'}
        >
          {expanded ? '\u25B2' : '\u25BC'}
        </button>
        {loading && <span className="rcs-refreshing">Refreshing...</span>}
      </div>

      {expanded && (
        <div className="rcs-detail-list">
          {data.conflicts.map((occ) => (
            <div key={occ.occurrenceDate} className="rcs-occurrence-row">
              <div className="rcs-occurrence-date">
                {formatOccurrenceDate(occ.occurrenceDate)}
              </div>
              <div className="rcs-occurrence-time">
                {formatTime(occ.occurrenceStart)} &ndash; {formatTime(occ.occurrenceEnd)}
              </div>
              <div className="rcs-occurrence-conflicts">
                {occ.hardConflicts.map((c, i) => (
                  <div key={`${c.id}-${i}`} className="rcs-conflict-item">
                    <span className="rcs-conflict-title">{c.eventTitle}</span>
                    <span className="rcs-conflict-time">
                      {formatTime(c.startDateTime)} &ndash; {formatTime(c.endDateTime)}
                    </span>
                    {c.roomNames?.length > 0 && (
                      <span className="rcs-conflict-rooms">{c.roomNames.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatOccurrenceDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(dtStr) {
  if (!dtStr || !dtStr.includes('T')) return '';
  const timePart = dtStr.split('T')[1].replace(/Z$/, '');
  const [h, m] = timePart.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${ampm}`;
}

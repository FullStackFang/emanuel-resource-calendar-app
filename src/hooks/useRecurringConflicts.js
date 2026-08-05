import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import APP_CONFIG from '../config/config';
import { isAbortError } from '../utils/errorUtils';

/**
 * useRecurringConflicts
 *
 * Owns the POST /rooms/recurring-conflicts fetch for a recurring series —
 * extracted from the retired RecurringConflictSummary component so the
 * SchedulingAssistant's series band can consume the same data
 * (scheduling-assistant-series-mode).
 *
 * Fetch behavior (unchanged from the component):
 * - The effect is keyed on a serialized request signature, NOT callback
 *   identity — parents pass fresh array/object references every render, which
 *   would refetch forever in readOnly mode and perpetually reset the
 *   form-mode debounce.
 * - readOnly: one fetch per distinct request. Edit mode: 1200ms debounce.
 * - In-flight requests are aborted when superseded.
 *
 * Occurrence model (new):
 * - `occurrences` merges the server's expanded occurrences with the
 *   recurrence's exclusion dates (which the server never expands), in date
 *   order. A skipped date wins over any server state — even before the
 *   refetch removes it from allOccurrences it must already read as skipped.
 * - `pending` marks exclusions added this session but not yet saved
 *   (pendingSkippedDates ⊆ recurrence.exclusions).
 * - `lastKnownBlockers` is session memory: the hardConflicts last seen for
 *   each date, so a skipped date's verdict can warn that restoring will
 *   re-flag the conflict. Advisory only — the refetch after restore is the
 *   authority.
 *
 * Inputs: { recurrence, roomIds, startDateTime, endDateTime,
 *   setupTimeMinutes, teardownTimeMinutes, reservationStartMinutes,
 *   reservationEndMinutes, excludeEventId, readOnly, apiToken,
 *   isAllowedConcurrent, categories, calendarOwner, pendingSkippedDates }
 */
export function useRecurringConflicts({
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
  pendingSkippedDates = [],
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastKnownBlockers, setLastKnownBlockers] = useState({});
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const fetchConflicts = useCallback(async () => {
    if (!recurrence?.pattern || !recurrence?.range || !roomIds?.length || !startDateTime || !endDateTime) {
      setData(null);
      return;
    }

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
      // Session memory before data: remember every date's blockers so a
      // subsequently skipped date can still name what blocked it.
      setLastKnownBlockers(prev => {
        const next = { ...prev };
        for (const occ of result.conflicts || []) {
          next[occ.occurrenceDate] = occ.hardConflicts || [];
        }
        return next;
      });
      setData(result);
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [recurrence, roomIds, startDateTime, endDateTime, setupTimeMinutes, teardownTimeMinutes, reservationStartMinutes, reservationEndMinutes, excludeEventId, apiToken, isAllowedConcurrent, categories, calendarOwner]);

  // Latest fetch reachable without keying the effect on callback identity.
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
      fetchConflictsRef.current();
      return;
    }

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

  const retry = useCallback(() => {
    fetchConflictsRef.current();
  }, []);

  const exclusionKey = JSON.stringify(recurrence?.exclusions || []);
  const pendingKey = JSON.stringify(pendingSkippedDates || []);

  const occurrences = useMemo(() => {
    if (!data) return [];
    const exclusions = JSON.parse(exclusionKey);
    const pending = new Set(JSON.parse(pendingKey));
    const skipped = new Set(exclusions);
    for (const d of pending) skipped.add(d);
    const conflicted = new Set((data.conflicts || []).map(c => c.occurrenceDate));

    const seen = new Set();
    const entries = [];
    for (const occ of data.allOccurrences || []) {
      seen.add(occ.occurrenceDate);
      const state = skipped.has(occ.occurrenceDate)
        ? 'skipped'
        : conflicted.has(occ.occurrenceDate) ? 'conflicted' : 'clear';
      entries.push({
        date: occ.occurrenceDate,
        state,
        pending: state === 'skipped' && pending.has(occ.occurrenceDate),
      });
    }
    for (const date of skipped) {
      if (!seen.has(date)) {
        entries.push({ date, state: 'skipped', pending: pending.has(date) });
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }, [data, exclusionKey, pendingKey]);

  const conflictedDates = useMemo(
    () => occurrences.filter(o => o.state === 'conflicted').map(o => o.date),
    [occurrences]
  );

  return {
    data,
    occurrences,
    conflictedDates,
    conflicts: data?.conflicts || [],
    totalOccurrences: data?.totalOccurrences ?? 0,
    conflictingOccurrences: data?.conflictingOccurrences ?? 0,
    // The last remaining occurrence cannot be skipped — an empty series is
    // the recurrence editor's job to create deliberately.
    skipRefused: (data?.totalOccurrences ?? 0) <= 1,
    loading,
    error,
    retry,
    lastKnownBlockers,
  };
}

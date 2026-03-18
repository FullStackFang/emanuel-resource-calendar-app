// src/components/RecurrenceTabContent.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import APP_CONFIG from '../config/config';
import { RecurringIcon } from './shared/CalendarIcons';
import RecurrencePatternModal from './RecurrencePatternModal';
import {
  calculateAllSeriesDates,
  calculateRecurrenceDates,
  formatRecurrenceSummary,
  isDateInPattern
} from '../utils/recurrenceUtils';
import './RecurrenceTabContent.css';

/**
 * Format a YYYY-MM-DD date string to a readable format
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Convert YYYY-MM-DD to Date-friendly string for DatePicker
 */
function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * RecurrenceTabContent — Dedicated tab content for managing recurring event patterns.
 *
 * Empty state: Shows CTA to create recurrence.
 * Management view: Two-column layout with pattern summary + mini-calendar (left)
 * and scrollable occurrence list with inline conflict display (right).
 */
export default function RecurrenceTabContent({
  recurrencePattern,
  onRecurrencePatternChange,
  showRecurrenceModal,
  onShowRecurrenceModal,
  reservation,
  formData,
  apiToken,
  editScope,
  readOnly = false,
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [filter, setFilter] = useState('all'); // 'all' | 'added' | 'excluded' | 'conflicts'
  const [conflictData, setConflictData] = useState(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const confirmTimerRef = useRef(null);
  const abortControllerRef = useRef(null);

  const hasPattern = Boolean(recurrencePattern?.pattern && recurrencePattern?.range);

  // Determine if user can edit recurrence
  const canEdit = !readOnly && editScope !== 'thisEvent';

  // Get event start date for initializing modal
  const eventStartDate = formData?.startDate || reservation?.calendarData?.startDate || reservation?.startDate || '';

  // Build the full list of pattern dates (not including additions)
  const patternDatesOnly = useMemo(() => {
    if (!hasPattern) return [];
    // Calculate all pattern dates (without additions/exclusions applied) for classification
    const patternOnly = { ...recurrencePattern, additions: [], exclusions: [] };
    return calculateAllSeriesDates(patternOnly);
  }, [recurrencePattern, hasPattern]);

  const patternDateSet = useMemo(() => new Set(patternDatesOnly), [patternDatesOnly]);

  // Build occurrence list: merge pattern dates, additions, exclusions
  const occurrences = useMemo(() => {
    if (!hasPattern) return [];

    const additions = recurrencePattern.additions || [];
    const exclusions = recurrencePattern.exclusions || [];
    const exclusionSet = new Set(exclusions);
    const additionSet = new Set(additions);

    const items = [];

    // Pattern dates (including ones that are excluded)
    for (const dateStr of patternDatesOnly) {
      if (exclusionSet.has(dateStr)) {
        items.push({ date: dateStr, type: 'excluded' });
      } else {
        items.push({ date: dateStr, type: 'pattern' });
      }
    }

    // Also add excluded dates that were pattern dates but not in the patternDatesOnly set
    // (because calculateAllSeriesDates with no exclusions wouldn't include them if they're excluded)
    // Actually patternDatesOnly has no exclusions applied, so all pattern dates are there.
    // We need to add exclusions that are pattern dates but might have been excluded before expansion
    for (const dateStr of exclusions) {
      if (!patternDateSet.has(dateStr)) {
        // Excluded date that isn't a pattern date — might be stale, skip
      } else if (!items.find(i => i.date === dateStr)) {
        items.push({ date: dateStr, type: 'excluded' });
      }
    }

    // Ad-hoc additions
    for (const dateStr of additions) {
      if (!exclusionSet.has(dateStr) && !patternDateSet.has(dateStr)) {
        items.push({ date: dateStr, type: 'added' });
      }
    }

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }, [recurrencePattern, hasPattern, patternDatesOnly, patternDateSet]);

  // Current month pattern dates for the mini-calendar
  const monthPatternDates = useMemo(() => {
    if (!hasPattern) return [];
    return calculateRecurrenceDates(
      recurrencePattern.pattern,
      recurrencePattern.range,
      viewMonth
    );
  }, [recurrencePattern, hasPattern, viewMonth]);

  // Fetch conflict data
  const fetchConflicts = useCallback(async () => {
    if (!hasPattern || !apiToken) return;

    const startDateTime = formData?.startDate && formData?.startTime
      ? `${formData.startDate}T${formData.startTime}:00`
      : reservation?.calendarData?.startDateTime || reservation?.startDateTime;
    const endDateTime = formData?.endDate && formData?.endTime
      ? `${formData.endDate}T${formData.endTime}:00`
      : reservation?.calendarData?.endDateTime || reservation?.endDateTime;
    const roomIds = (formData?.requestedRooms || reservation?.calendarData?.locations || reservation?.locations || [])
      .map(id => id?.toString?.() || id);

    if (!startDateTime || !endDateTime || !roomIds.length) {
      setConflictData(null);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setConflictLoading(true);
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/recurring-conflicts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          startDateTime,
          endDateTime,
          recurrence: recurrencePattern,
          roomIds,
          setupTimeMinutes: formData?.setupTimeMinutes || reservation?.calendarData?.setupTimeMinutes || 0,
          teardownTimeMinutes: formData?.teardownTimeMinutes || reservation?.calendarData?.teardownTimeMinutes || 0,
          excludeEventId: reservation?._id?.toString?.() || reservation?.id || null,
          isAllowedConcurrent: formData?.isAllowedConcurrent || reservation?.isAllowedConcurrent || false,
          categories: formData?.categories || reservation?.calendarData?.categories || [],
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        setConflictData(await response.json());
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setConflictData(null);
      }
    } finally {
      setConflictLoading(false);
    }
  }, [hasPattern, recurrencePattern, formData, reservation, apiToken]);

  useEffect(() => {
    if (hasPattern) fetchConflicts();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [hasPattern, fetchConflicts]);

  // Build conflict lookup by date
  const conflictsByDate = useMemo(() => {
    if (!conflictData?.conflicts) return {};
    const map = {};
    for (const c of conflictData.conflicts) {
      map[c.occurrenceDate] = c;
    }
    return map;
  }, [conflictData]);

  // Calendar click handler for add/exclude toggling
  const handleCalendarDateClick = useCallback((date) => {
    if (!canEdit || !hasPattern) return;
    const dateStr = toDateStr(date);

    const isPatternDate = monthPatternDates.includes(dateStr) || patternDateSet.has(dateStr);
    const exclusions = recurrencePattern.exclusions || [];
    const additions = recurrencePattern.additions || [];
    const isExcluded = exclusions.includes(dateStr);
    const isAdded = additions.includes(dateStr);

    let newPattern;
    if (isExcluded) {
      newPattern = { ...recurrencePattern, exclusions: exclusions.filter(d => d !== dateStr) };
    } else if (isPatternDate) {
      newPattern = { ...recurrencePattern, exclusions: [...exclusions, dateStr] };
    } else if (isAdded) {
      newPattern = { ...recurrencePattern, additions: additions.filter(d => d !== dateStr) };
    } else {
      newPattern = { ...recurrencePattern, additions: [...additions, dateStr] };
    }
    onRecurrencePatternChange(newPattern);
  }, [canEdit, hasPattern, recurrencePattern, monthPatternDates, patternDateSet, onRecurrencePatternChange]);

  // Remove ad-hoc addition
  const handleRemoveAddition = useCallback((dateStr) => {
    if (!canEdit) return;
    const additions = (recurrencePattern.additions || []).filter(d => d !== dateStr);
    onRecurrencePatternChange({ ...recurrencePattern, additions });
  }, [canEdit, recurrencePattern, onRecurrencePatternChange]);

  // Restore excluded date
  const handleRestoreExclusion = useCallback((dateStr) => {
    if (!canEdit) return;
    const exclusions = (recurrencePattern.exclusions || []).filter(d => d !== dateStr);
    onRecurrencePatternChange({ ...recurrencePattern, exclusions });
  }, [canEdit, recurrencePattern, onRecurrencePatternChange]);

  // Remove recurrence with two-click confirmation
  const handleRemoveRecurrence = useCallback(() => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      confirmTimerRef.current = setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    clearTimeout(confirmTimerRef.current);
    setConfirmRemove(false);
    onRecurrencePatternChange(null);
  }, [confirmRemove, onRecurrencePatternChange]);

  useEffect(() => {
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, []);

  // Toggle expanded row
  const toggleRow = useCallback((dateStr) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }, []);

  // Filter occurrences
  const filteredOccurrences = useMemo(() => {
    if (filter === 'all') return occurrences;
    if (filter === 'added') return occurrences.filter(o => o.type === 'added');
    if (filter === 'excluded') return occurrences.filter(o => o.type === 'excluded');
    if (filter === 'conflicts') return occurrences.filter(o => conflictsByDate[o.date]);
    return occurrences;
  }, [occurrences, filter, conflictsByDate]);

  // Pattern save handler from modal
  const handlePatternSave = useCallback((pattern) => {
    onRecurrencePatternChange(pattern);
    onShowRecurrenceModal(false);
  }, [onRecurrencePatternChange, onShowRecurrenceModal]);

  // Get time display from form data or reservation
  const timeDisplay = useMemo(() => {
    const start = formData?.startTime || reservation?.calendarData?.startTime || '';
    const end = formData?.endTime || reservation?.calendarData?.endTime || '';
    if (!start || !end) return '';
    // Simple formatting HH:MM → h:mm AM/PM
    const fmt = (t) => {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
    };
    return `${fmt(start)} - ${fmt(end)}`;
  }, [formData, reservation]);

  // Get room names for display
  const roomDisplay = useMemo(() => {
    const locationNames = formData?.locationDisplayNames || reservation?.locationDisplayNames;
    if (locationNames) {
      return Array.isArray(locationNames) ? locationNames.join(', ') : locationNames;
    }
    return '';
  }, [formData, reservation]);

  // Summary text
  const summaryText = useMemo(() => {
    if (!hasPattern) return '';
    return formatRecurrenceSummary(recurrencePattern.pattern, recurrencePattern.range);
  }, [recurrencePattern, hasPattern]);

  // Counts
  const additionCount = recurrencePattern?.additions?.length || 0;
  const exclusionCount = recurrencePattern?.exclusions?.length || 0;
  const conflictCount = conflictData?.conflictingOccurrences || 0;

  // ─── EMPTY STATE ────────────────────────────────────────────
  if (!hasPattern) {
    return (
      <div className="recurrence-tab-empty">
        <RecurringIcon size={36} className="recurrence-tab-empty-icon" />
        <h3 className="recurrence-tab-empty-title">No Recurring Schedule</h3>
        <p className="recurrence-tab-empty-desc">
          This is a one-time event. Set up a recurring schedule to repeat it automatically on selected days.
        </p>
        {canEdit && (
          <button
            type="button"
            className="recurrence-tab-create-btn"
            onClick={() => onShowRecurrenceModal(true)}
          >
            Create Recurrence
          </button>
        )}

        <RecurrencePatternModal
          isOpen={showRecurrenceModal}
          onClose={() => onShowRecurrenceModal(false)}
          onSave={handlePatternSave}
          initialPattern={null}
          eventStartDate={eventStartDate}
          existingSeriesDates={[]}
        />
      </div>
    );
  }

  // ─── MANAGEMENT VIEW ────────────────────────────────────────
  return (
    <div className="recurrence-tab-management">
      {/* Left Column — Pattern + Calendar */}
      <div className="recurrence-tab-left">
        <div className="recurrence-tab-pattern-card">
          <div className="recurrence-tab-pattern-header">
            <RecurringIcon size={16} />
            <span className="recurrence-tab-pattern-title">Pattern</span>
          </div>
          <p className="recurrence-tab-pattern-summary">{summaryText}</p>
          <div className="recurrence-tab-pattern-stats">
            <span>{occurrences.filter(o => o.type !== 'excluded').length} occurrences</span>
            {additionCount > 0 && <span className="stat-added">+{additionCount} added</span>}
            {exclusionCount > 0 && <span className="stat-excluded">{exclusionCount} excluded</span>}
            {conflictCount > 0 && <span className="stat-conflicts">{conflictCount} conflicts</span>}
          </div>
          {canEdit && (
            <button
              type="button"
              className="recurrence-tab-edit-btn"
              onClick={() => onShowRecurrenceModal(true)}
            >
              Edit Pattern
            </button>
          )}
        </div>

        {/* Interactive Mini-Calendar */}
        <div className="recurrence-tab-calendar">
          <DatePicker
            inline
            selected={null}
            onChange={handleCalendarDateClick}
            onMonthChange={setViewMonth}
            dayClassName={(date) => {
              const dateStr = toDateStr(date);
              if ((recurrencePattern.exclusions || []).includes(dateStr)) return 'adhoc-exclusion';
              if ((recurrencePattern.additions || []).includes(dateStr)) return 'adhoc-addition';
              if (monthPatternDates.includes(dateStr) || patternDateSet.has(dateStr)) return 'recurrence-pattern';
              return '';
            }}
          />
          <div className="calendar-legend">
            <div className="legend-item">
              <div className="legend-color recurrence-pattern-color" />
              <span>Pattern</span>
            </div>
            <div className="legend-item">
              <div className="legend-color adhoc-addition-color" />
              <span>Added</span>
            </div>
            <div className="legend-item">
              <div className="legend-color adhoc-exclusion-color" />
              <span>Excluded</span>
            </div>
          </div>
        </div>

        {/* Remove Recurrence */}
        {canEdit && (
          <button
            type="button"
            className={`recurrence-tab-remove-btn ${confirmRemove ? 'confirm' : ''}`}
            onClick={handleRemoveRecurrence}
          >
            {confirmRemove ? 'Confirm?' : 'Remove Recurrence'}
          </button>
        )}
      </div>

      {/* Right Column — Occurrence List */}
      <div className="recurrence-tab-right">
        <div className="recurrence-tab-list-header">
          <h3 className="recurrence-tab-list-title">
            Occurrences ({filteredOccurrences.length})
          </h3>
          <div className="recurrence-tab-filters">
            {['all', 'added', 'excluded', 'conflicts'].map(f => (
              <button
                key={f}
                type="button"
                className={`recurrence-tab-filter ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'added' ? 'Added' : f === 'excluded' ? 'Excluded' : 'Conflicts'}
                {f === 'conflicts' && conflictCount > 0 && (
                  <span className="filter-count">{conflictCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="recurrence-tab-list">
          {filteredOccurrences.length === 0 && (
            <div className="recurrence-tab-list-empty">
              No {filter === 'all' ? '' : filter} occurrences found.
            </div>
          )}
          {filteredOccurrences.map((occ) => {
            const conflict = conflictsByDate[occ.date];
            const isExpanded = expandedRows.has(occ.date);

            return (
              <div
                key={occ.date}
                className={`recurrence-occ-row recurrence-occ-row--${occ.type} ${conflict ? 'recurrence-occ-row--conflict' : ''}`}
              >
                <div
                  className="recurrence-occ-main"
                  onClick={conflict ? () => toggleRow(occ.date) : undefined}
                  style={conflict ? { cursor: 'pointer' } : undefined}
                >
                  {/* Type indicator */}
                  <span className={`recurrence-occ-indicator recurrence-occ-indicator--${occ.type}`}>
                    {occ.type === 'added' && '+'}
                    {occ.type === 'excluded' && '\u2715'}
                    {occ.type === 'pattern' && '\u2713'}
                  </span>

                  {/* Date */}
                  <span className={`recurrence-occ-date ${occ.type === 'excluded' ? 'recurrence-occ-date--excluded' : ''}`}>
                    {formatDate(occ.date)}
                  </span>

                  {/* Time + Room (not for excluded) */}
                  {occ.type !== 'excluded' && timeDisplay && (
                    <span className="recurrence-occ-time">{timeDisplay}</span>
                  )}
                  {occ.type !== 'excluded' && roomDisplay && (
                    <span className="recurrence-occ-room">{roomDisplay}</span>
                  )}

                  {/* Conflict icon */}
                  {conflict && occ.type !== 'excluded' && (
                    <span className="recurrence-occ-conflict-icon" title="Scheduling conflict">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </span>
                  )}

                  {/* Actions */}
                  {canEdit && occ.type === 'added' && (
                    <button
                      type="button"
                      className="recurrence-occ-action recurrence-occ-action--remove"
                      onClick={(e) => { e.stopPropagation(); handleRemoveAddition(occ.date); }}
                      title="Remove addition"
                    >
                      Remove
                    </button>
                  )}
                  {canEdit && occ.type === 'excluded' && (
                    <button
                      type="button"
                      className="recurrence-occ-action recurrence-occ-action--restore"
                      onClick={(e) => { e.stopPropagation(); handleRestoreExclusion(occ.date); }}
                      title="Restore date"
                    >
                      Restore
                    </button>
                  )}
                </div>

                {/* Expanded conflict details */}
                {isExpanded && conflict && (
                  <div className="recurrence-occ-conflict-details">
                    {(conflict.hardConflicts || []).map((hc, i) => (
                      <div key={i} className="recurrence-occ-conflict-item">
                        <span className="conflict-item-title">{hc.eventTitle || 'Untitled event'}</span>
                        <span className="conflict-item-time">
                          {hc.startDateTime && hc.endDateTime
                            ? `${new Date(hc.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${new Date(hc.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                            : ''}
                        </span>
                        {hc.roomNames && (
                          <span className="conflict-item-room">
                            {Array.isArray(hc.roomNames) ? hc.roomNames.join(', ') : hc.roomNames}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {conflictLoading && (
          <div className="recurrence-tab-conflict-loading">
            Checking conflicts...
          </div>
        )}
      </div>

      {/* Recurrence Pattern Modal */}
      <RecurrencePatternModal
        isOpen={showRecurrenceModal}
        onClose={() => onShowRecurrenceModal(false)}
        onSave={handlePatternSave}
        initialPattern={recurrencePattern}
        eventStartDate={eventStartDate}
        existingSeriesDates={[]}
      />
    </div>
  );
}

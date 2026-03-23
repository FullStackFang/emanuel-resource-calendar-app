// src/components/RecurrenceTabContent.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import APP_CONFIG from '../config/config';
import DatePickerInput from './DatePickerInput';
import { RecurringIcon } from './shared/CalendarIcons';
import { logger } from '../utils/logger';
import {
  calculateAllSeriesDates,
  calculateRecurrenceDates,
  formatRecurrenceSummary,
} from '../utils/recurrenceUtils';
import { useRooms } from '../context/LocationContext';
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
 * Convert Date to YYYY-MM-DD string using local date getters
 */
function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const DAYS_OPTIONS = [
  { value: 'sunday', label: 'S' },
  { value: 'monday', label: 'M' },
  { value: 'tuesday', label: 'T' },
  { value: 'wednesday', label: 'W' },
  { value: 'thursday', label: 'T' },
  { value: 'friday', label: 'F' },
  { value: 'saturday', label: 'S' },
];

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * RecurrenceTabContent — Dedicated tab for managing recurring event patterns.
 *
 * Inline editor (left column): frequency, interval, day-of-week buttons, end date, calendar preview.
 * Occurrence list (right column): scrollable list with conflict display, toggleable to occurrence detail editor.
 */
export default function RecurrenceTabContent({
  recurrencePattern,
  onRecurrencePatternChange,
  occurrenceOverrides: liftedOverrides,
  onOccurrenceOverridesChange,
  reservation,
  formData,
  apiToken,
  editScope,
  readOnly = false,
  onHasUncommittedRecurrence = null,
  createRecurrenceRef = null,
}) {
  // ── Pattern editor state ──────────────────────────────────────
  const [frequency, setFrequency] = useState('weekly');
  const [interval, setIntervalVal] = useState(1);
  const [daysOfWeek, setDaysOfWeek] = useState(['monday']);
  const [patternStartDate, setPatternStartDate] = useState('');
  const [endType, setEndType] = useState('endDate');
  const [endDate, setEndDate] = useState('');
  const [occurrenceCount, setOccurrenceCount] = useState(10);

  // ── View state ────────────────────────────────────────────────
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [selectedOccurrence, setSelectedOccurrence] = useState(null); // YYYY-MM-DD or null
  const [occurrenceEdits, setOccurrenceEdits] = useState({}); // { field: value } for current detail

  // ── Calendar popover state (Customize / Exclude on pattern dates) ──
  const [calendarPopover, setCalendarPopover] = useState(null); // { dateStr, left, top } or null
  const popoverRef = useRef(null);
  const calendarContainerRef = useRef(null);
  const lastClickCell = useRef(null);

  // ── Inline picker state ─────────────────────────────────────
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [showSecondaryTimes, setShowSecondaryTimes] = useState(false);

  // ── Room data from context ──────────────────────────────────
  const { rooms, getLocationName } = useRooms();
  const reservableRooms = useMemo(() =>
    rooms.filter(r => r.isReservable === true),
    [rooms]
  );

  // ── Lazy category fetch ──────────────────────────────────────
  const fetchCategoriesOnce = useCallback(async () => {
    if (categoriesLoaded) return;
    try {
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/categories`, {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableCategories(data);
      }
    } catch (err) {
      logger.error('Failed to fetch categories', err);
    }
    setCategoriesLoaded(true);
  }, [categoriesLoaded, apiToken]);

  // ── Conflict state ────────────────────────────────────────────
  const [conflictData, setConflictData] = useState(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const confirmTimerRef = useRef(null);
  const editorTouchedRef = useRef(false);
  const hasUncommittedEditsRef = useRef(false);
  const abortControllerRef = useRef(null);

  const hasPattern = Boolean(recurrencePattern?.pattern && recurrencePattern?.range);
  const canEdit = !readOnly && editScope !== 'thisEvent';

  // Get event start date for defaults
  const eventStartDate = formData?.startDate || reservation?.calendarData?.startDate || reservation?.startDate || '';

  // ── Initialize editor state from recurrencePattern ────────────
  useEffect(() => {
    editorTouchedRef.current = false;
    hasUncommittedEditsRef.current = false;
    onHasUncommittedRecurrence?.(false);
    if (recurrencePattern) {
      const { pattern, range } = recurrencePattern;
      if (pattern) {
        setFrequency(pattern.type || 'weekly');
        setIntervalVal(pattern.interval || 1);
        if (pattern.daysOfWeek?.length > 0) setDaysOfWeek(pattern.daysOfWeek);
      }
      if (range) {
        setPatternStartDate(range.startDate || eventStartDate || toDateStr(new Date()));
        setEndType(range.type || 'endDate');
        if (range.endDate) setEndDate(range.endDate);
        if (range.numberOfOccurrences) setOccurrenceCount(range.numberOfOccurrences);
      }
    } else {
      // Defaults for creation mode
      setFrequency('weekly');
      setIntervalVal(1);
      setEndType('endDate');
      setOccurrenceCount(10);

      const defaultStart = eventStartDate || toDateStr(new Date());
      setPatternStartDate(defaultStart);
      setViewMonth(new Date(defaultStart + 'T00:00:00'));

      // Auto-select day of week from start date
      const startObj = new Date(defaultStart + 'T00:00:00');
      setDaysOfWeek([DAY_NAMES[startObj.getDay()]]);

      // Default end date: 3 months out
      const defaultEnd = new Date(defaultStart + 'T00:00:00');
      defaultEnd.setMonth(defaultEnd.getMonth() + 3);
      setEndDate(toDateStr(defaultEnd));
    }
  }, [recurrencePattern, eventStartDate]); // eslint-disable-line react-hooks/exhaustive-deps -- onHasUncommittedRecurrence is stable (setState from parent)

  // ── Build pattern object from editor state ────────────────────
  const buildPatternObject = useCallback(() => {
    if (!patternStartDate) return null;

    // Adjust start date for weekly recurrence to match selected day
    let adjustedStartDate = patternStartDate;
    if (frequency === 'weekly' && daysOfWeek.length > 0) {
      const startObj = new Date(patternStartDate + 'T00:00:00');
      const startDayOfWeek = DAY_NAMES[startObj.getDay()];
      if (!daysOfWeek.includes(startDayOfWeek)) {
        const selectedIndices = daysOfWeek.map(d => DAY_NAMES.indexOf(d)).sort((a, b) => a - b);
        const currentIdx = startObj.getDay();
        let nextIdx = selectedIndices.find(idx => idx > currentIdx);
        if (nextIdx === undefined) nextIdx = selectedIndices[0] + 7;
        const adjusted = new Date(startObj);
        adjusted.setDate(adjusted.getDate() + (nextIdx - currentIdx));
        adjustedStartDate = toDateStr(adjusted);
      }
    }

    const pattern = {
      type: frequency,
      interval: parseInt(interval),
      daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
      firstDayOfWeek: 'sunday',
    };

    const range = {
      type: endType,
      startDate: adjustedStartDate,
      endDate: endType === 'endDate' ? endDate : undefined,
      numberOfOccurrences: endType === 'numbered' ? parseInt(occurrenceCount) : undefined,
    };

    return { pattern, range };
  }, [frequency, interval, daysOfWeek, patternStartDate, endType, endDate, occurrenceCount]);

  // ── Propagate editor changes to parent ────────────────────────
  const applyPatternChanges = useCallback(() => {
    const built = buildPatternObject();
    if (!built) return;

    // Calculate all pattern dates for cleanup
    let allPatternDates = [];
    const rangeStart = new Date(built.range.startDate + 'T00:00:00');
    let rangeEnd;
    if (built.range.type === 'endDate' && built.range.endDate) {
      rangeEnd = new Date(built.range.endDate + 'T00:00:00');
    } else {
      rangeEnd = new Date(rangeStart);
      rangeEnd.setFullYear(rangeEnd.getFullYear() + 2);
    }
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cursor <= rangeEnd) {
      const monthDates = calculateRecurrenceDates(built.pattern, built.range, cursor);
      monthDates.forEach(d => { if (!allPatternDates.includes(d)) allPatternDates.push(d); });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Clean additions/exclusions
    const existingAdditions = recurrencePattern?.additions || [];
    const existingExclusions = recurrencePattern?.exclusions || [];
    const cleanedAdditions = existingAdditions.filter(d => !allPatternDates.includes(d));
    const cleanedExclusions = existingExclusions.filter(d => allPatternDates.includes(d));

    onRecurrencePatternChange({
      ...built,
      additions: cleanedAdditions,
      exclusions: cleanedExclusions,
    });
  }, [buildPatternObject, recurrencePattern, onRecurrencePatternChange]);

  // Auto-apply when editor fields change (if pattern exists OR user has interacted with editor)
  const prevEditorKey = useRef('');
  useEffect(() => {
    if (!hasPattern && !editorTouchedRef.current) return;
    const key = JSON.stringify({ frequency, interval, daysOfWeek, patternStartDate, endType, endDate, occurrenceCount });
    if (key !== prevEditorKey.current) {
      prevEditorKey.current = key;
      applyPatternChanges();
    }
  }, [hasPattern, frequency, interval, daysOfWeek, patternStartDate, endType, endDate, occurrenceCount, applyPatternChanges]);

  // ── Create recurrence (for empty state) ───────────────────────
  const handleCreate = useCallback(() => {
    editorTouchedRef.current = true;
    hasUncommittedEditsRef.current = false;
    onHasUncommittedRecurrence?.(false);
    applyPatternChanges();
  }, [applyPatternChanges, onHasUncommittedRecurrence]);

  // Expose handleCreate to parent via ref (for programmatic "Create & Save")
  useEffect(() => {
    if (createRecurrenceRef) {
      createRecurrenceRef.current = handleCreate;
    }
  }, [createRecurrenceRef, handleCreate]);

  // ── Day toggle handler ────────────────────────────────────────
  const handleDayToggle = useCallback((day) => {
    if (!hasPattern) {
      hasUncommittedEditsRef.current = true;
      onHasUncommittedRecurrence?.(true);
    }
    setDaysOfWeek(prev => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter(d => d !== day);
      }
      return [...prev, day].sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
    });
  }, [hasPattern, onHasUncommittedRecurrence]);

  // ── Build occurrence list ─────────────────────────────────────
  const patternDatesOnly = useMemo(() => {
    if (!hasPattern) return [];
    const patternOnly = { ...recurrencePattern, additions: [], exclusions: [] };
    return calculateAllSeriesDates(patternOnly);
  }, [recurrencePattern, hasPattern]);

  const patternDateSet = useMemo(() => new Set(patternDatesOnly), [patternDatesOnly]);

  const occurrences = useMemo(() => {
    if (!hasPattern) return [];
    const additions = recurrencePattern.additions || [];
    const exclusions = recurrencePattern.exclusions || [];
    const exclusionSet = new Set(exclusions);
    const items = [];

    for (const dateStr of patternDatesOnly) {
      items.push({ date: dateStr, type: exclusionSet.has(dateStr) ? 'excluded' : 'pattern' });
    }

    for (const dateStr of exclusions) {
      if (!patternDateSet.has(dateStr) || items.find(i => i.date === dateStr)) continue;
      items.push({ date: dateStr, type: 'excluded' });
    }

    for (const dateStr of additions) {
      if (!exclusionSet.has(dateStr) && !patternDateSet.has(dateStr)) {
        items.push({ date: dateStr, type: 'added' });
      }
    }

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }, [recurrencePattern, hasPattern, patternDatesOnly, patternDateSet]);

  // Current month pattern dates for calendar
  const monthPatternDates = useMemo(() => {
    if (!hasPattern) {
      // Preview from editor state
      if (!patternStartDate) return [];
      return calculateRecurrenceDates(
        { type: frequency, interval, daysOfWeek },
        { startDate: patternStartDate, endDate: endType === 'endDate' ? endDate : null, type: endType },
        viewMonth
      );
    }
    return calculateRecurrenceDates(recurrencePattern.pattern, recurrencePattern.range, viewMonth);
  }, [recurrencePattern, hasPattern, viewMonth, frequency, interval, daysOfWeek, patternStartDate, endType, endDate]);

  // ── Conflict fetching ─────────────────────────────────────────
  const fetchConflicts = useCallback(async () => {
    if (!hasPattern || !apiToken) return;

    const effectiveStartTime = formData?.startTime || formData?.reservationStartTime;
    const effectiveEndTime = formData?.endTime || formData?.reservationEndTime;
    const startDateTime = formData?.startDate && effectiveStartTime
      ? `${formData.startDate}T${effectiveStartTime}:00`
      : reservation?.calendarData?.startDateTime || reservation?.startDateTime;
    const endDateTime = formData?.endDate && effectiveEndTime
      ? `${formData.endDate}T${effectiveEndTime}:00`
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
          reservationStartMinutes: formData?.reservationStartMinutes || reservation?.calendarData?.reservationStartMinutes || 0,
          reservationEndMinutes: formData?.reservationEndMinutes || reservation?.calendarData?.reservationEndMinutes || 0,
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
      if (err.name !== 'AbortError') setConflictData(null);
    } finally {
      setConflictLoading(false);
    }
  }, [hasPattern, recurrencePattern, formData, reservation, apiToken]);

  useEffect(() => {
    if (hasPattern) fetchConflicts();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [hasPattern, fetchConflicts]);

  const conflictsByDate = useMemo(() => {
    if (!conflictData?.conflicts) return {};
    const map = {};
    for (const c of conflictData.conflicts) map[c.occurrenceDate] = c;
    return map;
  }, [conflictData]);

  // ── Calendar popover dismiss (click-outside + Escape) ─────────
  useEffect(() => {
    if (!calendarPopover) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setCalendarPopover(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setCalendarPopover(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [calendarPopover]);

  // ── Calendar date click (add/exclude toggle) ──────────────────
  const handleCalendarDateClick = useCallback((date) => {
    if (!canEdit) return;
    const dateStr = toDateStr(date);

    // Auto-create pattern if none exists
    if (!hasPattern) {
      const built = buildPatternObject();
      if (!built) return;
      editorTouchedRef.current = true;
      hasUncommittedEditsRef.current = false;
      onHasUncommittedRecurrence?.(false);
      // If the clicked date is already a pattern date, just create the pattern
      // Otherwise, add it as an ad-hoc addition
      const patternDates = calculateAllSeriesDates({ ...built, additions: [], exclusions: [] });
      if (patternDates.includes(dateStr)) {
        onRecurrencePatternChange({ ...built, additions: [], exclusions: [] });
      } else {
        onRecurrencePatternChange({ ...built, additions: [dateStr], exclusions: [] });
      }
      return;
    }

    const isPatternDate = monthPatternDates.includes(dateStr) || patternDateSet.has(dateStr);
    const exclusions = recurrencePattern.exclusions || [];
    const additions = recurrencePattern.additions || [];
    const isExcluded = exclusions.includes(dateStr);
    const isAdded = additions.includes(dateStr);

    let newPattern;
    if (isExcluded) {
      newPattern = { ...recurrencePattern, exclusions: exclusions.filter(d => d !== dateStr) };
    } else if (isPatternDate) {
      // Show popover anchored below the clicked cell, positioned relative to calendar container
      const cell = lastClickCell.current;
      const container = calendarContainerRef.current;
      if (cell && container) {
        const cellRect = cell.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        setCalendarPopover({
          dateStr,
          left: cellRect.left - containerRect.left + cellRect.width / 2,
          top: cellRect.bottom - containerRect.top,
        });
      }
      return;
    } else if (isAdded) {
      newPattern = { ...recurrencePattern, additions: additions.filter(d => d !== dateStr) };
    } else {
      newPattern = { ...recurrencePattern, additions: [...additions, dateStr] };
    }
    onRecurrencePatternChange(newPattern);
  }, [canEdit, hasPattern, buildPatternObject, recurrencePattern, monthPatternDates, patternDateSet, onRecurrencePatternChange, onHasUncommittedRecurrence]);

  // ── Occurrence list actions ───────────────────────────────────
  const handleRemoveAddition = useCallback((dateStr) => {
    if (!canEdit) return;
    const additions = (recurrencePattern.additions || []).filter(d => d !== dateStr);
    onRecurrencePatternChange({ ...recurrencePattern, additions });
  }, [canEdit, recurrencePattern, onRecurrencePatternChange]);

  const handleRestoreExclusion = useCallback((dateStr) => {
    if (!canEdit) return;
    const exclusions = (recurrencePattern.exclusions || []).filter(d => d !== dateStr);
    onRecurrencePatternChange({ ...recurrencePattern, exclusions });
  }, [canEdit, recurrencePattern, onRecurrencePatternChange]);

  // ── Remove recurrence (two-click) ────────────────────────────
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

  // ── Toggle conflict row expand ────────────────────────────────
  const toggleRow = useCallback((dateStr) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }, []);

  // ── Occurrence overrides ──────────────────────────────────────
  const overrides = liftedOverrides || reservation?.occurrenceOverrides || [];
  const overridesByDate = useMemo(() => {
    const map = {};
    for (const o of overrides) map[o.occurrenceDate] = o;
    return map;
  }, [overrides]);

  const handleRemoveOverride = useCallback((dateStr) => {
    if (!canEdit || !onOccurrenceOverridesChange) return;
    onOccurrenceOverridesChange(overrides.filter(o => o.occurrenceDate !== dateStr));
  }, [canEdit, overrides, onOccurrenceOverridesChange]);

  // ── Filter to exceptions only (added, excluded, conflicts, overrides) ──
  const filteredOccurrences = useMemo(() => {
    return occurrences.filter(o =>
      o.type === 'added' ||
      o.type === 'excluded' ||
      conflictsByDate[o.date] ||
      overridesByDate[o.date]
    );
  }, [occurrences, conflictsByDate, overridesByDate]);

  // ── Time display / Room display ───────────────────────────────
  const timeDisplay = useMemo(() => {
    const start = formData?.startTime || reservation?.calendarData?.startTime || '';
    const end = formData?.endTime || reservation?.calendarData?.endTime || '';
    if (!start || !end) return '';
    const fmt = (t) => {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
    };
    return `${fmt(start)} - ${fmt(end)}`;
  }, [formData, reservation]);

  const roomDisplay = useMemo(() => {
    const roomIds = formData?.requestedRooms
      || reservation?.calendarData?.locations
      || reservation?.locations
      || [];
    if (roomIds.length > 0) return roomIds.map(id => getLocationName(id)).join(', ');
    return '';
  }, [formData?.requestedRooms, reservation, getLocationName]);

  // Summary text for display
  const summaryText = useMemo(() => {
    if (!hasPattern) {
      // Preview from editor state
      if (!patternStartDate) return '';
      return formatRecurrenceSummary(
        { type: frequency, interval, daysOfWeek },
        { type: endType, startDate: patternStartDate, endDate, numberOfOccurrences: occurrenceCount }
      );
    }
    return formatRecurrenceSummary(recurrencePattern.pattern, recurrencePattern.range);
  }, [recurrencePattern, hasPattern, frequency, interval, daysOfWeek, patternStartDate, endType, endDate, occurrenceCount]);

  // Counts
  const additionCount = recurrencePattern?.additions?.length || 0;
  const exclusionCount = recurrencePattern?.exclusions?.length || 0;
  const conflictCount = conflictData?.conflictingOccurrences || 0;

  // ── Occurrence detail helpers ─────────────────────────────────
  const getEffectiveValue = useCallback((dateStr, field) => {
    // Check local edits first
    if (occurrenceEdits[field] !== undefined) return occurrenceEdits[field];
    // Then existing override
    const override = overridesByDate[dateStr];
    if (override && override[field] !== undefined) return override[field];
    // Fall back to master
    const masterSources = {
      eventTitle: formData?.eventTitle || reservation?.eventTitle || reservation?.calendarData?.eventTitle || '',
      eventDescription: formData?.eventDescription || reservation?.eventDescription || reservation?.calendarData?.eventDescription || '',
      startTime: formData?.startTime || reservation?.calendarData?.startTime || '',
      endTime: formData?.endTime || reservation?.calendarData?.endTime || '',
      setupTime: formData?.setupTime || reservation?.calendarData?.setupTime || '',
      teardownTime: formData?.teardownTime || reservation?.calendarData?.teardownTime || '',
      reservationStartTime: formData?.reservationStartTime || reservation?.calendarData?.reservationStartTime || '',
      reservationEndTime: formData?.reservationEndTime || reservation?.calendarData?.reservationEndTime || '',
      doorOpenTime: formData?.doorOpenTime || reservation?.calendarData?.doorOpenTime || '',
      doorCloseTime: formData?.doorCloseTime || reservation?.calendarData?.doorCloseTime || '',
      categories: formData?.categories || reservation?.calendarData?.categories || [],
      locations: formData?.requestedRooms || reservation?.calendarData?.locations || reservation?.locations || [],
      locationDisplayNames: (() => {
        const ids = formData?.requestedRooms || reservation?.calendarData?.locations || reservation?.locations || [];
        return ids.map(id => getLocationName(id)).join(', ');
      })(),
    };
    return masterSources[field] ?? '';
  }, [occurrenceEdits, overridesByDate, formData, reservation, getLocationName]);

  const handleOccurrenceFieldChange = useCallback((field, value) => {
    setOccurrenceEdits(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleOpenOccurrenceDetail = useCallback((dateStr) => {
    setSelectedOccurrence(dateStr);
    // Pre-populate edits from existing override
    const override = overridesByDate[dateStr];
    if (override) {
      const edits = {};
      for (const field of ['eventTitle', 'eventDescription', 'startTime', 'endTime', 'setupTime', 'teardownTime', 'reservationStartTime', 'reservationEndTime', 'doorOpenTime', 'doorCloseTime', 'categories', 'locations', 'locationDisplayNames']) {
        if (override[field] !== undefined) edits[field] = override[field];
      }
      setOccurrenceEdits(edits);
    } else {
      setOccurrenceEdits({});
    }
  }, [overridesByDate]);

  const handleBackToList = useCallback(() => {
    // Commit any pending edits to the overrides array
    if (selectedOccurrence && Object.keys(occurrenceEdits).length > 0 && onOccurrenceOverridesChange) {
      const dateKey = selectedOccurrence;
      const existingOverride = overridesByDate[dateKey];
      const newOverride = {
        ...(existingOverride || {}),
        occurrenceDate: dateKey,
        ...occurrenceEdits,
      };

      // Build updated overrides: replace or append
      const updatedOverrides = existingOverride
        ? overrides.map(o => o.occurrenceDate === dateKey ? newOverride : o)
        : [...overrides, newOverride];

      onOccurrenceOverridesChange(updatedOverrides);
    }

    setSelectedOccurrence(null);
    setOccurrenceEdits({});
    setShowRoomPicker(false);
    setShowCategoryPicker(false);
    setShowSecondaryTimes(false);
  }, [selectedOccurrence, occurrenceEdits, overrides, overridesByDate, onOccurrenceOverridesChange]);

  // ── Calendar popover actions ─────────────────────────────────
  const handlePopoverCustomize = useCallback(() => {
    if (!calendarPopover || !onOccurrenceOverridesChange) return;
    const dateStr = calendarPopover.dateStr;
    setCalendarPopover(null);
    // Add an empty override so this date appears in the occurrence list for editing
    if (!overridesByDate[dateStr]) {
      onOccurrenceOverridesChange([...overrides, { occurrenceDate: dateStr }]);
    }
  }, [calendarPopover, overrides, overridesByDate, onOccurrenceOverridesChange]);

  const handlePopoverExclude = useCallback(() => {
    if (!calendarPopover) return;
    const dateStr = calendarPopover.dateStr;
    setCalendarPopover(null);
    const exclusions = recurrencePattern.exclusions || [];
    onRecurrencePatternChange({ ...recurrencePattern, exclusions: [...exclusions, dateStr] });
  }, [calendarPopover, recurrencePattern, onRecurrencePatternChange]);

  // ─────────────────────────────────────────────────────────────
  // RENDER: Left Column — Pattern Editor (always shown)
  // ─────────────────────────────────────────────────────────────

  const renderPatternEditor = () => (
    <div className="recurrence-tab-left">
      {/* Calendar Preview */}
      <div
        className="recurrence-tab-calendar"
        ref={calendarContainerRef}
        onMouseDown={(e) => {
          const cell = e.target.closest('.react-datepicker__day');
          if (cell) lastClickCell.current = cell;
        }}
      >
        <DatePicker
          inline
          selected={null}
          onChange={canEdit ? handleCalendarDateClick : undefined}
          onMonthChange={(date) => { setViewMonth(date); setCalendarPopover(null); }}
          dayClassName={(date) => {
            const dateStr = toDateStr(date);
            if (hasPattern) {
              if ((recurrencePattern.exclusions || []).includes(dateStr)) return 'adhoc-exclusion';
              if ((recurrencePattern.additions || []).includes(dateStr)) return 'adhoc-addition';
            }
            if (monthPatternDates.includes(dateStr) || patternDateSet.has(dateStr)) return 'recurrence-pattern';
            return '';
          }}
        />
        {calendarPopover && (
          <div
            ref={popoverRef}
            className="recurrence-calendar-popover"
            style={{
              position: 'absolute',
              left: calendarPopover.left,
              top: calendarPopover.top,
            }}
          >
            <button type="button" className="popover-option popover-option--customize" onClick={handlePopoverCustomize}>
              &#9998; Customize
            </button>
            <button type="button" className="popover-option popover-option--exclude" onClick={handlePopoverExclude}>
              &#10005; Exclude
            </button>
          </div>
        )}
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

      {/* Pattern Controls */}
      <div className="recurrence-tab-editor">
        {/* Start Date */}
        <div className="recurrence-editor-row">
          <label>Start</label>
          <DatePickerInput
            value={patternStartDate}
            onChange={(e) => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setPatternStartDate(e.target.value); }}
            className="recurrence-editor-date-input"
            disabled={!canEdit}
          />
        </div>

        {/* Frequency + Interval */}
        <div className="recurrence-editor-row">
          <span className="repeat-icon">&#8635;</span>
          <label>Every</label>
          <input
            type="number"
            min="1"
            max="999"
            value={interval}
            onChange={(e) => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setIntervalVal(Math.max(1, parseInt(e.target.value) || 1)); }}
            className="recurrence-editor-interval"
            disabled={!canEdit}
          />
          <select
            value={frequency}
            onChange={(e) => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setFrequency(e.target.value); }}
            className="recurrence-editor-frequency"
            disabled={!canEdit}
          >
            <option value="daily">day{interval > 1 ? 's' : ''}</option>
            <option value="weekly">week{interval > 1 ? 's' : ''}</option>
            <option value="monthly">month{interval > 1 ? 's' : ''}</option>
            <option value="yearly">year{interval > 1 ? 's' : ''}</option>
          </select>
        </div>

        {/* Day-of-Week Buttons */}
        {frequency === 'weekly' && (
          <div className="recurrence-editor-days">
            {DAYS_OPTIONS.map(day => (
              <button
                key={day.value}
                type="button"
                className={`recurrence-day-circle ${daysOfWeek.includes(day.value) ? 'selected' : ''}`}
                onClick={() => canEdit && handleDayToggle(day.value)}
                disabled={!canEdit}
              >
                {day.label}
              </button>
            ))}
          </div>
        )}

        {/* Summary */}
        {summaryText && (
          <div className="recurrence-editor-summary">{summaryText}</div>
        )}

        {/* End Date */}
        {endType === 'endDate' && (
          <div className="recurrence-editor-row">
            <label>End</label>
            <DatePickerInput
              value={endDate}
              onChange={(e) => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setEndDate(e.target.value); }}
              className="recurrence-editor-date-input"
              min={patternStartDate}
              disabled={!canEdit}
            />
            {canEdit && (
              <button type="button" className="recurrence-link-btn" onClick={() => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setEndType('noEnd'); }}>
                Remove
              </button>
            )}
          </div>
        )}
        {endType === 'noEnd' && canEdit && (
          <button type="button" className="recurrence-link-btn" onClick={() => { if (!hasPattern) { hasUncommittedEditsRef.current = true; onHasUncommittedRecurrence?.(true); } setEndType('endDate'); }}>
            Add end date
          </button>
        )}

        {/* Stats (when pattern exists) */}
        {hasPattern && (
          <div className="recurrence-editor-stats">
            <span>{occurrences.filter(o => o.type !== 'excluded').length} occurrences</span>
            {additionCount > 0 && <span className="stat-added">+{additionCount} added</span>}
            {exclusionCount > 0 && <span className="stat-excluded">{exclusionCount} excluded</span>}
            {conflictCount > 0 && <span className="stat-conflicts">{conflictCount} conflicts</span>}
          </div>
        )}

        {/* Create / Remove */}
        {!hasPattern && canEdit && (
          <button type="button" className="recurrence-tab-create-btn" onClick={handleCreate}>
            Create Recurrence
          </button>
        )}
        {hasPattern && canEdit && (
          <button
            type="button"
            className={`recurrence-tab-remove-btn ${confirmRemove ? 'confirm' : ''}`}
            onClick={handleRemoveRecurrence}
          >
            {confirmRemove ? 'Confirm?' : 'Remove Recurrence'}
          </button>
        )}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: Right Column — Occurrence List or Detail Editor
  // ─────────────────────────────────────────────────────────────

  const renderOccurrenceDetail = () => {
    if (!selectedOccurrence) return null;
    const occ = occurrences.find(o => o.date === selectedOccurrence);
    const isExcluded = occ?.type === 'excluded';

    if (isExcluded) {
      return (
        <div className="recurrence-tab-right recurrence-tab-right--detail">
          <div className="recurrence-detail-header">
            <button type="button" className="recurrence-back-btn" onClick={handleBackToList}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12L6 8l4-4" />
              </svg>
            </button>
            <div className="recurrence-detail-header-text">
              <span className="recurrence-detail-date">{formatDate(selectedOccurrence)}</span>
            </div>
          </div>
          <div className="recurrence-detail-excluded">
            <div className="recurrence-detail-excluded-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M5 19L19 5" />
              </svg>
            </div>
            <span>This date is excluded from the series</span>
            {canEdit && (
              <button
                type="button"
                className="recurrence-occ-action recurrence-occ-action--restore"
                onClick={() => { handleRestoreExclusion(selectedOccurrence); handleBackToList(); }}
              >
                Restore
              </button>
            )}
          </div>
        </div>
      );
    }

    const hasOverride = Boolean(overridesByDate[selectedOccurrence]);

    return (
      <div className="recurrence-tab-right recurrence-tab-right--detail">
        <div className="recurrence-detail-header">
          <button type="button" className="recurrence-back-btn" onClick={handleBackToList}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </button>
          <div className="recurrence-detail-header-text">
            <span className="recurrence-detail-date">{formatDate(selectedOccurrence)}</span>
            {hasOverride && <span className="recurrence-customized-badge">Customized</span>}
          </div>
        </div>

        <div className="recurrence-detail-fields">
          {/* Title */}
          <div className="recurrence-detail-field">
            <label>Title</label>
            <input
              type="text"
              value={getEffectiveValue(selectedOccurrence, 'eventTitle')}
              onChange={(e) => handleOccurrenceFieldChange('eventTitle', e.target.value)}
              disabled={!canEdit}
              className="recurrence-detail-input"
            />
          </div>

          {/* Description */}
          <div className="recurrence-detail-field">
            <label>Description</label>
            <textarea
              value={getEffectiveValue(selectedOccurrence, 'eventDescription')}
              onChange={(e) => handleOccurrenceFieldChange('eventDescription', e.target.value)}
              disabled={!canEdit}
              className="recurrence-detail-input recurrence-detail-textarea"
              rows={1}
              placeholder="Event description"
            />
          </div>

          {/* Start / End (inline labels, group break) */}
          <div className="recurrence-detail-row recurrence-detail-group-break">
            <div className="recurrence-detail-field recurrence-detail-field--inline">
              <label>Start</label>
              <input
                type="time"
                value={getEffectiveValue(selectedOccurrence, 'startTime')}
                onChange={(e) => handleOccurrenceFieldChange('startTime', e.target.value)}
                disabled={!canEdit}
                className="recurrence-detail-input"
              />
            </div>
            <div className="recurrence-detail-field recurrence-detail-field--inline">
              <label>End</label>
              <input
                type="time"
                value={getEffectiveValue(selectedOccurrence, 'endTime')}
                onChange={(e) => handleOccurrenceFieldChange('endTime', e.target.value)}
                disabled={!canEdit}
                className="recurrence-detail-input"
              />
            </div>
          </div>

          {/* Secondary times disclosure */}
          {(() => {
            const hasSecondaryTimes = Boolean(
              getEffectiveValue(selectedOccurrence, 'setupTime') ||
              getEffectiveValue(selectedOccurrence, 'teardownTime') ||
              getEffectiveValue(selectedOccurrence, 'reservationStartTime') ||
              getEffectiveValue(selectedOccurrence, 'reservationEndTime') ||
              getEffectiveValue(selectedOccurrence, 'doorOpenTime') ||
              getEffectiveValue(selectedOccurrence, 'doorCloseTime')
            );
            const isOpen = showSecondaryTimes || hasSecondaryTimes;

            // Read-only with no values: render nothing
            if (!canEdit && !hasSecondaryTimes) return null;

            return (
              <>
                <div
                  className="recurrence-detail-disclosure"
                  onClick={() => setShowSecondaryTimes(prev => !prev)}
                >
                  <svg
                    className={`recurrence-detail-disclosure-chevron ${isOpen ? 'expanded' : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  <span className="recurrence-detail-disclosure-label">Additional Times</span>
                  <span className="recurrence-detail-disclosure-line" />
                </div>

                <div className={`recurrence-detail-collapsible ${isOpen ? 'expanded' : ''}`}>
                  <div className="recurrence-detail-collapsible-inner">
                    <div className="recurrence-detail-row">
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Reservation Start</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'reservationStartTime')}
                          onChange={(e) => handleOccurrenceFieldChange('reservationStartTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Reservation End</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'reservationEndTime')}
                          onChange={(e) => handleOccurrenceFieldChange('reservationEndTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                    </div>
                    <div className="recurrence-detail-row">
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Setup</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'setupTime')}
                          onChange={(e) => handleOccurrenceFieldChange('setupTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Teardown</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'teardownTime')}
                          onChange={(e) => handleOccurrenceFieldChange('teardownTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                    </div>
                    <div className="recurrence-detail-row">
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Door Open</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'doorOpenTime')}
                          onChange={(e) => handleOccurrenceFieldChange('doorOpenTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                      <div className="recurrence-detail-field recurrence-detail-field--inline">
                        <label>Door Close</label>
                        <input
                          type="time"
                          value={getEffectiveValue(selectedOccurrence, 'doorCloseTime')}
                          onChange={(e) => handleOccurrenceFieldChange('doorCloseTime', e.target.value)}
                          disabled={!canEdit}
                          className="recurrence-detail-input"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Divider */}
          <hr className="recurrence-detail-divider" />

          {/* Categories (group break) */}
          <div className="recurrence-detail-field">
            <label>Categories</label>
            <div className="recurrence-detail-chips">
              {(getEffectiveValue(selectedOccurrence, 'categories') || []).map((cat, i) => (
                <span key={i} className="recurrence-detail-chip">
                  {cat}
                  {canEdit && (
                    <button
                      type="button"
                      className="recurrence-chip-remove"
                      onClick={() => {
                        const current = getEffectiveValue(selectedOccurrence, 'categories') || [];
                        handleOccurrenceFieldChange('categories', current.filter((_, idx) => idx !== i));
                      }}
                    >
                      &times;
                    </button>
                  )}
                </span>
              ))}
              {canEdit && (
                <button
                  type="button"
                  className="recurrence-chip-add"
                  onClick={() => {
                    setShowCategoryPicker(prev => !prev);
                    setShowRoomPicker(false);
                    fetchCategoriesOnce();
                  }}
                >
                  + Add
                </button>
              )}
            </div>
            <div className={`recurrence-inline-picker-wrap ${showCategoryPicker ? 'open' : ''}`}>
              <div className="recurrence-category-picker">
                {availableCategories
                  .filter(cat => {
                    const current = getEffectiveValue(selectedOccurrence, 'categories') || [];
                    return !current.includes(cat.name);
                  })
                  .map(cat => (
                    <button
                      key={cat._id || cat.name}
                      type="button"
                      className="recurrence-category-picker-item"
                      onClick={() => {
                        const current = getEffectiveValue(selectedOccurrence, 'categories') || [];
                        handleOccurrenceFieldChange('categories', [...current, cat.name]);
                        setShowCategoryPicker(false);
                      }}
                    >
                      <span
                        className="recurrence-category-dot"
                        style={{ backgroundColor: cat.color || 'var(--text-tertiary)' }}
                      />
                      {cat.name}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Locations */}
          <div className="recurrence-detail-field">
            <label>Locations</label>
            <div className="recurrence-detail-chips">
              {(() => {
                const locIds = getEffectiveValue(selectedOccurrence, 'locations') || [];
                return locIds.map((locId, i) => (
                  <span key={i} className="recurrence-detail-chip">
                    {getLocationName(locId)}
                    {canEdit && (
                      <button
                        type="button"
                        className="recurrence-chip-remove"
                        onClick={() => {
                          const currentIds = getEffectiveValue(selectedOccurrence, 'locations') || [];
                          handleOccurrenceFieldChange('locations', currentIds.filter((_, idx) => idx !== i));
                          const updatedIds = currentIds.filter((_, idx) => idx !== i);
                          handleOccurrenceFieldChange('locationDisplayNames',
                            updatedIds.map(id => getLocationName(id)).join(', ')
                          );
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                ));
              })()}
              {canEdit && (
                <button
                  type="button"
                  className="recurrence-chip-add"
                  onClick={() => {
                    setShowRoomPicker(prev => !prev);
                    setShowCategoryPicker(false);
                  }}
                >
                  + Add
                </button>
              )}
            </div>
            <div className={`recurrence-inline-picker-wrap ${showRoomPicker ? 'open' : ''}`}>
              <div className="recurrence-category-picker">
                {reservableRooms
                  .filter(room => {
                    const currentIds = (getEffectiveValue(selectedOccurrence, 'locations') || []).map(id => id?.toString?.() || id);
                    return !currentIds.includes(room._id?.toString?.() || room._id);
                  })
                  .map(room => (
                    <button
                      key={room._id}
                      type="button"
                      className="recurrence-category-picker-item"
                      onClick={() => {
                        const currentIds = getEffectiveValue(selectedOccurrence, 'locations') || [];
                        const updatedIds = [...currentIds, room._id];
                        handleOccurrenceFieldChange('locations', updatedIds);
                        handleOccurrenceFieldChange('locationDisplayNames',
                          updatedIds.map(id => getLocationName(id)).join(', ')
                        );
                        setShowRoomPicker(false);
                      }}
                    >
                      <span className="recurrence-category-dot" style={{ backgroundColor: 'var(--color-primary-400)' }} />
                      {room.name}
                      {room.capacity && <span className="recurrence-room-capacity">({room.capacity})</span>}
                    </button>
                  ))}
                {reservableRooms.filter(room => {
                  const currentIds = (getEffectiveValue(selectedOccurrence, 'locations') || []).map(id => id?.toString?.() || id);
                  return !currentIds.includes(room._id?.toString?.() || room._id);
                }).length === 0 && (
                  <div className="recurrence-room-picker-empty">No more rooms available</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Conflict info for this date */}
        {conflictsByDate[selectedOccurrence] && (
          <div className="recurrence-detail-conflicts">
            <span className="recurrence-detail-conflicts-title">Scheduling Conflicts</span>
            {(conflictsByDate[selectedOccurrence].hardConflicts || []).map((hc, i) => (
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
  };

  const renderOccurrenceList = () => (
    <div className="recurrence-tab-right">
      <div className="recurrence-tab-list-header">
        <span className="recurrence-tab-list-title">
          Exceptions ({filteredOccurrences.length})
        </span>
        <span className="recurrence-tab-list-subtitle">
          {occurrences.filter(o => o.type === 'pattern').length} occurrences total
        </span>
      </div>

      <div className="recurrence-tab-list">
        {filteredOccurrences.length === 0 && (
          <div className="recurrence-tab-list-empty">
            No exceptions or conflicts.
          </div>
        )}
        {filteredOccurrences.map((occ) => {
          const conflict = conflictsByDate[occ.date];
          const isExpanded = expandedRows.has(occ.date);
          const hasOverride = Boolean(overridesByDate[occ.date]);

          return (
            <div
              key={occ.date}
              className={`recurrence-occ-row recurrence-occ-row--${occ.type} ${hasOverride ? 'recurrence-occ-row--customized' : ''} ${conflict ? 'recurrence-occ-row--conflict' : ''}`}
            >
              <div
                className="recurrence-occ-main"
                onClick={() => handleOpenOccurrenceDetail(occ.date)}
                style={{ cursor: 'pointer' }}
              >
                <span className={`recurrence-occ-indicator recurrence-occ-indicator--${occ.type}`}>
                  {occ.type === 'added' && '+'}
                  {occ.type === 'excluded' && '\u2715'}
                  {occ.type === 'pattern' && '\u2713'}
                </span>

                {occ.type !== 'excluded' && (
                  <span className="recurrence-occ-edit-hint" title="Edit this occurrence">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </span>
                )}

                <span className={`recurrence-occ-date ${occ.type === 'excluded' ? 'recurrence-occ-date--excluded' : ''}`}>
                  {formatDate(occ.date)}
                </span>

                {occ.type !== 'excluded' && timeDisplay && (
                  <span className="recurrence-occ-time">{timeDisplay}</span>
                )}
                {occ.type !== 'excluded' && roomDisplay && (
                  <span className="recurrence-occ-room">{roomDisplay}</span>
                )}

                {/* Customized indicator */}
                {hasOverride && occ.type !== 'excluded' && (
                  <span className="recurrence-occ-customized" title="This occurrence has been customized">
                    &#9889;
                  </span>
                )}

                {conflict && occ.type !== 'excluded' && (
                  <span
                    className="recurrence-occ-conflict-icon"
                    title="Scheduling conflict"
                    onClick={(e) => { e.stopPropagation(); toggleRow(occ.date); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </span>
                )}

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
                {canEdit && hasOverride && occ.type === 'pattern' && (
                  <button
                    type="button"
                    className="recurrence-occ-action recurrence-occ-action--remove"
                    onClick={(e) => { e.stopPropagation(); handleRemoveOverride(occ.date); }}
                    title="Remove customization"
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
        <div className="recurrence-tab-conflict-loading">Checking conflicts...</div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="recurrence-tab-management">
      {renderPatternEditor()}
      {hasPattern
        ? (selectedOccurrence ? renderOccurrenceDetail() : renderOccurrenceList())
        : (
          <div className="recurrence-tab-right recurrence-tab-right--empty">
            <div className="recurrence-tab-empty-hint">
              <RecurringIcon size={28} className="recurrence-tab-empty-icon" />
              <p>Configure a recurrence pattern on the left to get started. Changes save automatically when you click <strong>Save Draft</strong>.</p>
            </div>
          </div>
        )
      }
    </div>
  );
}

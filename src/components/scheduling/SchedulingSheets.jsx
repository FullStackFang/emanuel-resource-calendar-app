// src/components/scheduling/SchedulingSheets.jsx
//
// The Scheduling Sheets workbook — the feature's landing surface. One master
// workbook view: a Scheduling Sheet picker top-left ('2026 High Holy Days ▾'),
// DAY tabs (dates, not occasion names — ceremonies/events live at the COLUMN
// level, exactly like the team's Excel heading row), and the grid as the hero.
//
// This is a scheduling ARTIFACT builder: nothing here writes to Outlook,
// templeEvents__Events, or any approval workflow. Event links are prefill
// sugar with a drift flag (see SchedulingSheetGrid).
//
// Loading contract: the workbook list is an auto-firing query, so `loading`
// binds to deriveListLoadingState().isFirstLoad, never TanStack's isLoading.

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  useSchedulingSheetList,
  useSchedulingSheet,
  useSheetUserLookup,
  useSchedulingSheetMutations,
} from '../../hooks/useSchedulingSheets';
import { useLocationsQuery } from '../../hooks/useLocationsQuery';
import { deriveListLoadingState } from '../../utils/listLoadingState';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import LoadingSpinner from '../shared/LoadingSpinner';
import EmptyStateRefreshButton from '../shared/EmptyStateRefreshButton';
import { PrinterIcon, MailIcon, CopyIcon } from '../shared/CalendarIcons';
import SchedulingSheetGrid from './SchedulingSheetGrid';
import { toLocationNameArray } from './sheetEventUtils';
import SeedDatePicker from './SeedDatePicker';
import EmailSchedulesPanel from './EmailSchedulesPanel';
import { transformEventToFlatStructure } from '../../utils/eventTransformers';
import APP_CONFIG from '../../config/config';
import { logger } from '../../utils/logger';
import './SchedulingSheets.css';

function getCalendarOwner() {
  const config = APP_CONFIG.CALENDAR_CONFIG;
  return config.DEFAULT_MODE === 'production' ? config.PRODUCTION_CALENDAR : config.SANDBOX_CALENDAR;
}

function formatTabDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function yearOf(sheet) {
  const first = (sheet.days || [])[0];
  return first ? first.date.slice(0, 4) : '—';
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Tab window rule (design D8): today + upcoming, just-passed days linger 7 days. */
function splitDayTabs(days) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const tabbed = days.filter((d) => d.date >= cutoff);
  const earlier = days.filter((d) => d.date < cutoff);
  return { tabbed, earlier };
}

export default function SchedulingSheets() {
  const { apiToken } = useAuth();
  const { showSuccess, showError, showWarning } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedSheetId, setSelectedSheetId] = useState(() => searchParams.get('sheet') || null);
  const [selectedDate, setSelectedDate] = useState(() => searchParams.get('date') || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmMenuAction, setConfirmMenuAction] = useState(null); // 'delete-day' | 'delete-sheet'
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [newSheet, setNewSheet] = useState({ name: '', dates: [], copyFrom: '' });
  const [newDayOpen, setNewDayOpen] = useState(false);
  const [newDay, setNewDay] = useState({ date: '', title: '', copyFrom: '' });
  const [emailOpen, setEmailOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);
  const autoOpenedRef = React.useRef(false);
  const workbookRef = React.useRef(null);
  const sheetMenuRef = React.useRef(null);

  // Both top-bar popovers were open-until-clicked-again: nothing dismissed them
  // when attention moved elsewhere, so the picker hung over the grid and the
  // '...' menu could linger with a destructive 'Confirm?' still armed. Same
  // mousedown-containment idiom the rest of the app uses (Navigation.jsx,
  // MultiSelect.jsx) — mousedown, not click, so a drag that starts outside
  // dismisses too, and touchstart for the tablet the sheets get printed from.
  useEffect(() => {
    if (!pickerOpen && !menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (pickerOpen && workbookRef.current && !workbookRef.current.contains(event.target)) {
        setPickerOpen(false);
      }
      if (menuOpen && sheetMenuRef.current && !sheetMenuRef.current.contains(event.target)) {
        setMenuOpen(false);
        setConfirmMenuAction(null);
      }
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setPickerOpen(false);
      setMenuOpen(false);
      setConfirmMenuAction(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen, menuOpen]);

  const listQuery = useSchedulingSheetList();
  const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(listQuery);
  const sheets = useMemo(() => listQuery.data || [], [listQuery.data]);

  // Settle on a workbook: deep link wins, else the first sheet.
  useEffect(() => {
    if (!selectedSheetId && sheets.length) setSelectedSheetId(String(sheets[0]._id));
  }, [sheets, selectedSheetId]);

  const detailQuery = useSchedulingSheet(selectedSheetId);
  const sheet = detailQuery.data || null;
  const days = useMemo(() => (sheet && sheet.days) || [], [sheet]);

  // Settle on a day: deep link, else today or the next upcoming day, else last.
  useEffect(() => {
    if (!days.length) return;
    if (selectedDate && days.some((d) => d.date === selectedDate)) return;
    const upcoming = days.find((d) => d.date >= todayStr());
    setSelectedDate((upcoming || days[days.length - 1]).date);
  }, [days, selectedDate]);

  // Reflect the selection in the URL so the view is deep-linkable.
  useEffect(() => {
    if (!selectedSheetId) return;
    const next = new URLSearchParams(searchParams);
    next.set('sheet', selectedSheetId);
    if (selectedDate) next.set('date', selectedDate);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [selectedSheetId, selectedDate, searchParams, setSearchParams]);

  const activeDay = days.find((d) => d.date === selectedDate) || null;
  const { tabbed, earlier } = splitDayTabs(days);

  const mutations = useSchedulingSheetMutations(selectedSheetId);
  const userLookupQuery = useSheetUserLookup(true);
  const locationsQuery = useLocationsQuery(apiToken);

  // Published events around the active day (±1 for setup-day rows) — feeds the
  // column link picker and the drift comparison. Nothing here writes back.
  const eventsQuery = useQuery({
    queryKey: ['schedulingSheets', 'linkableEvents', selectedDate],
    enabled: !!apiToken && !!selectedDate,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const start = new Date(`${selectedDate}T00:00:00`);
      start.setDate(start.getDate() - 1);
      const end = new Date(`${selectedDate}T00:00:00`);
      end.setDate(end.getDate() + 2);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/load`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarOwners: [getCalendarOwner()],
          calendarIds: [],
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          forceRefresh: false,
        }),
      });
      if (!response.ok) throw new Error('Failed to load events');
      const data = await response.json();
      return (data.events || [])
        .map((e) => transformEventToFlatStructure(e))
        .filter((e) => e.status === 'published')
        .map((e) => ({
          id: String(e.id || e._id),
          title: e.eventTitle,
          date: e.startDate || null,
          startDateTime: e.startDateTime || null,
          endDateTime: e.endDateTime || null,
          // HH:MM fields feed the '@event' starter-row prefill (Call Time ←
          // setup, Doors Open, Begins, Ends) and the picker's when-line.
          startTime: e.startTime || null,
          endTime: e.endTime || null,
          setupTime: e.setupTime || null,
          doorOpenTime: e.doorOpenTime || null,
          // locationDisplayNames is a comma-separated STRING on legacy events
          // (same shape 4e60397 handles server-side) — normalize to an array
          // here so the snapshot and the prefill always see one.
          locationNames: toLocationNameArray(e.locationDisplayNames),
        }));
    },
  });
  const publishedEvents = useMemo(() => eventsQuery.data || [], [eventsQuery.data]);
  const liveEventsById = useMemo(() => new Map(publishedEvents.map((e) => [e.id, e])), [publishedEvents]);

  const onMutationError = (error, fallback) => {
    if (error && error.code === 'VERSION_CONFLICT') {
      showError('Someone else changed this sheet — it has been reloaded. Please retry your change.');
      detailQuery.refetch();
      return;
    }
    showError(error.message || fallback);
  };

  // cellWrites: optional follow-up cell writes (the '@event' starter-row
  // prefill). Sequenced AFTER the structure write succeeds so a 409 on the
  // column itself never strands prefill cells for a column that was never
  // created (cell writes are ungated by design D2 and would land regardless).
  // callbacks: optional { onSuccess, onError } for the CALLER's own UI state
  // (e.g. the add-column form staying open with a saving indicator instead of
  // closing into a blank gap) — independent of the toast/refetch handling below.
  const structureChange = (updates, cellWrites, callbacks) => {
    if (!activeDay) return;
    const dayId = activeDay._id;
    mutations.updateStructure.mutate(
      { dayId, expectedVersion: activeDay._version, ...updates },
      {
        onError: (e) => {
          onMutationError(e, 'Could not save the change');
          if (callbacks && callbacks.onError) callbacks.onError(e);
        },
        onSuccess: () => {
          for (const write of cellWrites || []) {
            mutations.updateCell.mutate(
              { dayId, rowId: write.rowId, colId: write.colId, cell: write.cell },
              { onError: (e) => onMutationError(e, 'Could not prefill a cell from the event') }
            );
          }
          if (callbacks && callbacks.onSuccess) callbacks.onSuccess();
        },
      }
    );
  };

  const cellSave = (rowId, colId, cell) => {
    if (!activeDay) return;
    mutations.updateCell.mutate(
      { dayId: activeDay._id, rowId, colId, cell },
      { onError: (e) => onMutationError(e, 'Could not save the cell') }
    );
  };

  const createSheet = () => {
    // Calendar clicks arrive in click order, not date order — and copyFromSheetId
    // maps the source workbook's days onto the seeds IN ORDER, so sort first.
    const dates = newSheet.dates.map((d) => d.trim()).filter(Boolean).sort();
    mutations.createSheet.mutate(
      {
        name: newSheet.name,
        seedDates: dates,
        ...(newSheet.copyFrom ? { copyFromSheetId: newSheet.copyFrom } : {}),
      },
      {
        onSuccess: (created) => {
          showSuccess(`Scheduling sheet '${created.name}' created`);
          setNewSheetOpen(false);
          setNewSheet({ name: '', dates: [], copyFrom: '' });
          setSelectedSheetId(String(created._id));
          setSelectedDate(dates[0] || null);
        },
        onError: (e) => onMutationError(e, 'Could not create the scheduling sheet'),
      }
    );
  };

  // Duplicate needs no endpoint of its own: POST /api/scheduling-sheets already
  // copies a source workbook's day structures onto sorted seedDates in order.
  // So it opens the ordinary creation panel prefilled rather than firing a
  // silent one-click copy — a duplicate is nearly always 'same structure, next
  // year', and the dates have to stay editable for that to be worth anything.
  const duplicateSheet = (source) => {
    setPickerOpen(false);
    setNewSheet({
      name: `${source.name} (Copy)`,
      dates: (source.days || []).map((d) => d.date).filter(Boolean).sort(),
      copyFrom: String(source._id),
    });
    setNewSheetOpen(true);
  };

  const createDay = () => {
    mutations.createDay.mutate(
      {
        date: newDay.date,
        title: newDay.title || undefined,
        ...(newDay.copyFrom ? { copyFromDayId: newDay.copyFrom } : {}),
      },
      {
        onSuccess: (created) => {
          showSuccess(`Day added to ${sheet ? sheet.name : 'the sheet'}`);
          setNewDayOpen(false);
          setNewDay({ date: '', title: '', copyFrom: '' });
          setSelectedDate(created.date);
        },
        onError: (e) => onMutationError(e, 'Could not add the day'),
      }
    );
  };

  // Weekday-drift soft warning for copy-a-day (design D8): a Friday-shaped
  // roster pasted onto a Sunday deserves a heads-up, never a block.
  const copySourceDay = days.find((d) => String(d._id) === newDay.copyFrom);
  const weekdayDrift =
    copySourceDay && newDay.date &&
    new Date(`${copySourceDay.date}T00:00:00`).getDay() !== new Date(`${newDay.date}T00:00:00`).getDay();

  const menuAction = (action) => {
    if (confirmMenuAction !== action) { setConfirmMenuAction(action); return; }
    setConfirmMenuAction(null);
    setMenuOpen(false);
    if (action === 'delete-day' && activeDay) {
      mutations.deleteDay.mutate(activeDay._id, {
        onSuccess: () => { showSuccess('Day deleted'); setSelectedDate(null); },
        onError: (e) => onMutationError(e, 'Could not delete the day'),
      });
    }
    if (action === 'delete-sheet' && sheet) {
      mutations.deleteSheet.mutate(String(sheet._id), {
        onSuccess: () => { showSuccess('Scheduling sheet deleted'); setSelectedSheetId(null); setSelectedDate(null); },
        onError: (e) => onMutationError(e, 'Could not delete the scheduling sheet'),
      });
    }
  };

  const commitTitle = () => {
    if (editingTitle === null || !activeDay) { setEditingTitle(null); return; }
    structureChange({ title: editingTitle.trim() || null });
    setEditingTitle(null);
  };

  // Meta whisper: counts + freshest send.
  const meta = useMemo(() => {
    if (!activeDay) return null;
    let people = (activeDay.taggedEmails || []).length;
    let assignments = 0;
    for (const key of Object.keys(activeDay.cells || {})) {
      assignments += (activeDay.cells[key].segments || []).filter((s) => s.type === 'person').length;
    }
    const lastSent = (activeDay.emailStatus || []).reduce((acc, s) => (s.sentAt && (!acc || s.sentAt > acc) ? s.sentAt : acc), null);
    return { people, assignments, lastSent };
  }, [activeDay]);

  // Export the WHOLE workbook (every day), landscape, one day per page. The
  // generator is lazy-imported: jsPDF is large and nothing else on this page
  // needs it, so it must stay out of the initial bundle (same pattern AIChat
  // uses for calendarPdfGenerator). Everything it needs is already in the
  // detail query's cache — no extra request.
  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    if (!sheet || exportingPdf) return;
    setExportingPdf(true);
    try {
      const { generateSchedulingSheetPdf } = await import('../../utils/schedulingSheetPdf');
      const { blobUrl, fileName, dayCount, omittedDays } = generateSchedulingSheetPdf({ sheet, liveEventsById });
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoked late: Safari reads the blob after the click returns.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      showSuccess(omittedDays > 0
        ? `Exported the first ${dayCount} days. ${omittedDays} more were left out - print those from their own day tabs.`
        : `Exported ${dayCount} day${dayCount === 1 ? '' : 's'} to PDF.`);
    } catch (error) {
      logger.error('Scheduling sheet PDF export failed', error);
      showError('Could not generate the PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  // Every schedule email carries the workbook printout — the SAME artifact the
  // Download PDF button produces, rendered here by the same generator and
  // uploaded with the send. jsPDF and its embedded DM Sans faces live in the
  // frontend bundle only, so rendering server-side would mean a second,
  // drifting copy of a 900-line layout.
  //
  // Attachment failure NEVER fails the send: the email body is self-contained
  // (that is the ASSIGNMENT_SCHEDULE template's whole design), so a missing
  // PDF is worth a warning, not withholding 34 people's schedules.
  const buildSchedulePdfAttachment = async () => {
    const { generateSchedulingSheetPdf } = await import('../../utils/schedulingSheetPdf');
    const { blob, blobUrl, fileName } = generateSchedulingSheetPdf({ sheet, liveEventsById });
    URL.revokeObjectURL(blobUrl); // we want the bytes, not a download
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Chunked: String.fromCharCode(...bytes) overflows the call stack on a
    // PDF this size (the embedded font alone is ~200KB).
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return { fileName, contentBase64: btoa(binary) };
  };

  const sendSchedules = async (body) => {
    let attachment = null;
    try {
      attachment = await buildSchedulePdfAttachment();
    } catch (error) {
      logger.error('Could not build the schedule PDF attachment; sending without it', error);
    }
    try {
      const outcome = await mutations.sendSchedules.mutateAsync({ ...body, ...(attachment ? { attachment } : {}) });
      if (outcome && outcome.attachmentWarning) showWarning(outcome.attachmentWarning);
      else if (attachment && outcome && !outcome.attached) showWarning('The schedule PDF was not attached.');
      return outcome;
    } catch (e) {
      logger.error('Schedule send failed:', e);
      throw e;
    }
  };

  const sheetsByYear = useMemo(() => {
    const groups = {};
    for (const s of sheets) (groups[yearOf(s)] = groups[yearOf(s)] || []).push(s);
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sheets]);

  // The workbook list and the open sheet are INDEPENDENT queries: a deep link
  // (?sheet=&date=) resolves the detail without the list ever having succeeded.
  // So an empty or failed list must not print 'no scheduling sheets yet' over a
  // sheet the user is populating — and must not trip the auto-open effect below
  // into throwing the creation panel at them mid-edit.
  // Picking a sheet swaps the detail query's key, so `sheet` goes null while the
  // new one loads. `detailQuery.isPending` is also true when the query is merely
  // disabled (no sheet chosen), hence the selectedSheetId qualifier.
  const sheetLoading = !!selectedSheetId && !!detailQuery.isPending;
  const sheetLoadError = !!selectedSheetId && !sheetLoading && !sheet && !!detailQuery.isError;
  const viewingSheet = !!sheet || sheetLoading || sheetLoadError;
  const listSettled = !isFirstLoad && !isSilentRefreshing;
  const showListError = listSettled && !!listQuery.isError && !viewingSheet;
  const showWorkbookEmpty = listSettled && !listQuery.isError && !viewingSheet && sheets.length === 0;

  // First run: an empty workbook auto-opens the creation panel once (design
  // D8 #7) — closing it reveals the empty state with its manual button.
  useEffect(() => {
    if (showWorkbookEmpty && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setNewSheetOpen(true);
    }
  }, [showWorkbookEmpty]);

  // ONE loading element for the whole page, positioned and sized exactly like
  // Calendar.jsx's: default 64px wheel, absolutely centred in a container that
  // fills <main>. Two separate gates (an early-return card for the first load,
  // a veil for sheet swaps) put the wheel at two different heights.
  //   initial  – nothing behind it yet, lighter backdrop (Calendar's own case)
  //   visible  – veiling the chrome while a different sheet loads
  const overlayClass = isFirstLoad ? 'visible initial' : sheetLoading ? 'visible' : 'hidden';
  const overlayText = isFirstLoad ? 'Loading scheduling sheets...' : 'Loading sheet...';

  return (
    <div className="ss-page" data-testid="scheduling-sheets-page">
      <div className="ss-topbar">
        <div className="ss-workbook" ref={workbookRef}>
          <button
            type="button"
            className="ss-workbook-trigger"
            data-testid="workbook-picker"
            aria-haspopup="true"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {sheet ? sheet.name : 'Scheduling Sheets'} <span aria-hidden="true">&#9662;</span>
          </button>
          {pickerOpen && (
            <div className="ss-workbook-menu" data-testid="workbook-menu">
              {/* A failed list would otherwise read as 'this is every sheet' —
                  the same lie the empty state used to tell, one level in. */}
              {listQuery.isError && (
                <div className="ss-workbook-error" data-testid="workbook-menu-error">
                  Could not load the sheet list.{' '}
                  <button type="button" onClick={() => listQuery.refetch()}>Retry</button>
                </div>
              )}
              {sheetsByYear.map(([year, group]) => (
                <div key={year} className="ss-workbook-group">
                  <div className="ss-workbook-year">{year}</div>
                  {group.map((s) => (
                    // A row, not one button: Duplicate is a second action on the
                    // same line, and a button inside a button is invalid markup.
                    <div key={String(s._id)} className="ss-workbook-row">
                      <button
                        type="button"
                        className={`ss-workbook-item ${String(s._id) === selectedSheetId ? 'active' : ''}`}
                        onClick={() => { setSelectedSheetId(String(s._id)); setSelectedDate(null); setPickerOpen(false); }}
                      >
                        <span className="ss-workbook-name">{s.name}</span>
                        <span className="ss-workbook-sub">
                          {(s.days || []).length} day{(s.days || []).length === 1 ? '' : 's'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ss-workbook-dup"
                        data-testid={`duplicate-sheet-${String(s._id)}`}
                        aria-label={`Duplicate ${s.name}`}
                        title="Duplicate this scheduling sheet"
                        onClick={() => duplicateSheet(s)}
                      >
                        <CopyIcon size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              <button
                type="button"
                className="ss-workbook-new"
                data-testid="new-sheet-button"
                onClick={() => { setNewSheetOpen(true); setPickerOpen(false); }}
              >
                + New Scheduling Sheet&hellip;
              </button>
            </div>
          )}
        </div>

        <div className="ss-tabs" role="tablist" data-testid="day-tabs">
          {tabbed.map((d) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === selectedDate}
              className={`ss-tab ${d.date === selectedDate ? 'active' : ''}`}
              data-testid={`day-tab-${d.date}`}
              onClick={() => setSelectedDate(d.date)}
            >
              {formatTabDate(d.date)}
            </button>
          ))}
          {earlier.length > 0 && (
            <select
              className="ss-tab-earlier"
              data-testid="earlier-days"
              value=""
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            >
              <option value="">Earlier ({earlier.length})</option>
              {earlier.map((d) => (
                <option key={d.date} value={d.date}>{formatTabDate(d.date)}{d.title ? ` — ${d.title}` : ''}</option>
              ))}
            </select>
          )}
          {sheet && (
            <button type="button" className="ss-tab ss-tab-add" data-testid="add-day-tab" onClick={() => setNewDayOpen(true)}>
              +
            </button>
          )}
        </div>
      </div>

      {/* Always mounted and class-toggled so it fades in and out instead of
          popping — an unmounted overlay skips the transition. No `size`: the
          wheel is ROSE_DEFAULT_SIZE, the same 64px Calendar renders. */}
      <LoadingSpinner variant="overlay" text={overlayText} className={overlayClass} />

      {sheetLoadError && (
        <div className="ss-empty" data-testid="sheet-load-error">
          <p>Could not load this scheduling sheet.</p>
          <EmptyStateRefreshButton onClick={() => detailQuery.refetch()} isRefreshing={detailQuery.isFetching} />
        </div>
      )}

      {showListError && (
        <div className="ss-empty" data-testid="workbook-list-error">
          <p>Could not load your scheduling sheets. Any existing sheets are still there — this is a read failure, not an empty workbook.</p>
          <EmptyStateRefreshButton onClick={() => listQuery.refetch()} isRefreshing={listQuery.isFetching} />
        </div>
      )}

      {showWorkbookEmpty && !newSheetOpen && (
        <div className="ss-empty" data-testid="workbook-empty">
          <p>No scheduling sheets yet. Create the first one — e.g. &lsquo;2026 High Holy Days&rsquo;.</p>
          <button type="button" className="ss-primary-btn" onClick={() => setNewSheetOpen(true)}>
            + New Scheduling Sheet
          </button>
          <EmptyStateRefreshButton onClick={() => listQuery.refetch()} isRefreshing={listQuery.isFetching} />
        </div>
      )}

      {sheet && activeDay && (
        <div className="ss-sheet-card" data-testid="sheet-card">
          <div className="ss-sheet-header">
            {editingTitle !== null ? (
              <input
                className="ss-title-input"
                data-testid="day-title-input"
                value={editingTitle}
                autoFocus
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
              />
            ) : (
              <h2
                className="ss-title"
                data-testid="day-title"
                title="Click to rename this day sheet"
                onClick={() => setEditingTitle(activeDay.title || '')}
              >
                {activeDay.title || formatFullDate(activeDay.date)}
                {activeDay.title && <span className="ss-title-date"> &middot; {formatFullDate(activeDay.date)}</span>}
              </h2>
            )}

            {meta && (
              <span className="ss-meta" data-testid="sheet-meta">
                {meta.assignments} assignment{meta.assignments === 1 ? '' : 's'} &middot; {meta.people} {meta.people === 1 ? 'person' : 'people'}
                {' '}&middot; {meta.lastSent ? `✉ ${new Date(meta.lastSent).toLocaleDateString()}` : 'not yet emailed'}
              </span>
            )}

            <div className="ss-actions">
              <button type="button" className="ss-primary-btn" data-testid="email-schedules-button" onClick={() => setEmailOpen(true)}>
                <MailIcon size={14} /> Email Schedules
              </button>
              {/* Icon-only, so the accessible name has to be explicit — the
                  emoji this replaced was carrying it (badly). */}
              <button
                type="button"
                className="ss-ghost-btn ss-icon-btn"
                data-testid="export-pdf-button"
                aria-label={exportingPdf ? 'Preparing PDF' : 'Export scheduling sheet as PDF'}
                aria-busy={exportingPdf}
                title="Download this scheduling sheet as a landscape PDF (every day, one per page)"
                disabled={exportingPdf || !days.length}
                onClick={handleExportPdf}
              >
                <PrinterIcon size={14} />
              </button>
              <div className="ss-menu-wrap" ref={sheetMenuRef}>
                <button type="button" className="ss-ghost-btn" data-testid="sheet-menu-button" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => { setMenuOpen((v) => !v); setConfirmMenuAction(null); }}>
                  &#8943;
                </button>
                {menuOpen && (
                  <div className="ss-menu" data-testid="sheet-menu">
                    <button
                      type="button"
                      className={confirmMenuAction === 'delete-day' ? 'ss-menu-danger confirm' : 'ss-menu-danger'}
                      data-testid="delete-day-button"
                      onClick={() => menuAction('delete-day')}
                    >
                      {confirmMenuAction === 'delete-day' ? 'Confirm?' : 'Delete day'}
                    </button>
                    <button
                      type="button"
                      className={confirmMenuAction === 'delete-sheet' ? 'ss-menu-danger confirm' : 'ss-menu-danger'}
                      data-testid="delete-sheet-button"
                      onClick={() => menuAction('delete-sheet')}
                    >
                      {confirmMenuAction === 'delete-sheet' ? 'Confirm?' : 'Delete scheduling sheet'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <SchedulingSheetGrid
            day={activeDay}
            canEdit
            people={userLookupQuery.data || []}
            onRefreshPeople={userLookupQuery.refetch}
            locations={locationsQuery.data || []}
            publishedEvents={publishedEvents}
            liveEventsById={liveEventsById}
            onCellSave={cellSave}
            onStructure={structureChange}
          />
        </div>
      )}

      {sheet && !activeDay && (
        <div className="ss-empty" data-testid="sheet-no-days">
          <p>This scheduling sheet has no days yet.</p>
          <button type="button" className="ss-primary-btn" onClick={() => setNewDayOpen(true)}>+ Add a day</button>
        </div>
      )}

      {newSheetOpen && (
        <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewSheetOpen(false); }}>
          <div className="ss-panel ss-panel-wide" role="dialog" aria-label="New scheduling sheet" data-testid="new-sheet-panel">
            <h3>New Scheduling Sheet</h3>
            <label>
              Name
              <input
                data-testid="new-sheet-name"
                value={newSheet.name}
                autoFocus
                placeholder="2026 High Holy Days"
                onChange={(e) => setNewSheet((s) => ({ ...s, name: e.target.value }))}
              />
            </label>
            <div className="ss-panel-dates" data-testid="new-sheet-dates">
              <span>Seed with dates (optional — each becomes a day tab; days can be disjoint)</span>
              <SeedDatePicker
                selectedDates={newSheet.dates}
                onChange={(dates) => setNewSheet((s) => ({ ...s, dates }))}
                disabled={mutations.createSheet.isPending}
              />
            </div>
            <label>
              Start from a copy of
              <select
                data-testid="new-sheet-copyfrom"
                value={newSheet.copyFrom}
                onChange={(e) => setNewSheet((s) => ({ ...s, copyFrom: e.target.value }))}
              >
                <option value="">Blank sheet</option>
                {sheets.map((s) => (
                  <option key={String(s._id)} value={String(s._id)}>{s.name}</option>
                ))}
              </select>
            </label>
            {newSheet.copyFrom && (
              <p className="ss-panel-hint">Copies columns, roles, and people onto the seeded dates in order; email history does not carry over.</p>
            )}
            <div className="ss-editor-actions">
              <button type="button" className="ss-ghost-btn" onClick={() => setNewSheetOpen(false)}>Cancel</button>
              <button
                type="button"
                className="ss-primary-btn"
                data-testid="create-sheet-button"
                disabled={!newSheet.name.trim() || mutations.createSheet.isPending}
                onClick={createSheet}
              >
                {mutations.createSheet.isPending ? 'Creating…' : 'Create sheet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {newDayOpen && sheet && (
        <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewDayOpen(false); }}>
          <div className="ss-panel" role="dialog" aria-label="New day" data-testid="new-day-panel">
            <h3>New day in {sheet.name}</h3>
            <label>
              Date
              <input
                type="date"
                data-testid="new-day-date"
                value={newDay.date}
                autoFocus
                onChange={(e) => setNewDay((s) => ({ ...s, date: e.target.value }))}
              />
            </label>
            <label>
              Sheet title (optional — the ceremony name; the tab shows the date)
              <input
                data-testid="new-day-title"
                value={newDay.title}
                placeholder="2026 Temple Emanu-El Erev Rosh Hashanah"
                onChange={(e) => setNewDay((s) => ({ ...s, title: e.target.value }))}
              />
            </label>
            <label>
              Start from a copy of
              <select
                data-testid="new-day-copyfrom"
                value={newDay.copyFrom}
                onChange={(e) => setNewDay((s) => ({ ...s, copyFrom: e.target.value }))}
              >
                <option value="">Blank day (starter rows only)</option>
                {days.map((d) => (
                  <option key={String(d._id)} value={String(d._id)}>{formatTabDate(d.date)}{d.title ? ` — ${d.title}` : ''}</option>
                ))}
              </select>
            </label>
            {weekdayDrift && (
              <p className="ss-panel-warn" data-testid="weekday-drift-warning">
                Heads up: the source day is a {new Date(`${copySourceDay.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' })} and
                the new date is a {new Date(`${newDay.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' })} — times carry over as-is.
              </p>
            )}
            <div className="ss-editor-actions">
              <button type="button" className="ss-ghost-btn" onClick={() => setNewDayOpen(false)}>Cancel</button>
              <button
                type="button"
                className="ss-primary-btn"
                data-testid="create-day-button"
                disabled={!newDay.date || mutations.createDay.isPending}
                onClick={createDay}
              >
                {mutations.createDay.isPending ? 'Adding…' : 'Add day'}
              </button>
            </div>
          </div>
        </div>
      )}

      {emailOpen && sheet && activeDay && (
        <EmailSchedulesPanel
          sheet={sheet}
          activeDay={activeDay}
          onClose={() => setEmailOpen(false)}
          onSend={sendSchedules}
        />
      )}
    </div>
  );
}

// src/components/RschedImport.jsx
//
// Admin-only CSV import wizard for Resource Scheduler events.
// 5-step workflow: upload → review/edit → validate → commit → publish.
// Sessions persist in templeEvents__RschedImportStaging — admins can leave
// and come back later. See backend/services/rschedImportService.js for the
// upsert algorithm and conflict semantics.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { useNotification } from '../context/NotificationContext';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import APP_CONFIG from '../config/config';
import './RschedImport.css';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'staged', label: 'Staged' },
  { key: 'conflict', label: 'Conflicts' },
  { key: 'unmatched_location', label: 'Unmatched' },
  { key: 'human_edit_conflict', label: 'Human Edits' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'applied', label: 'Applied' },
  { key: 'failed', label: 'Failed' },
];

const STATUS_BADGE = {
  staged: { className: 'rsi-badge-staged', label: 'Staged' },
  conflict: { className: 'rsi-badge-conflict', label: 'Conflict' },
  unmatched_location: { className: 'rsi-badge-warn', label: 'Unmatched' },
  human_edit_conflict: { className: 'rsi-badge-warn', label: 'Human Edit' },
  skipped: { className: 'rsi-badge-muted', label: 'Skipped' },
  applied: { className: 'rsi-badge-ok', label: 'Applied' },
  failed: { className: 'rsi-badge-err', label: 'Failed' },
};

const PAGE_SIZE = 50;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RschedImport() {
  const { isAdmin } = usePermissions();
  const { showSuccess, showError } = useNotification();
  const authFetch = useAuthenticatedFetch();

  const [view, setView] = useState('list'); // 'list' | 'session'
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPage, setRowPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [uploading, setUploading] = useState(false);

  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // Two-step confirm state — IDs of which row/action is in confirm state.
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmSkipRowId, setConfirmSkipRowId] = useState(null);
  const [confirmForceRowId, setConfirmForceRowId] = useState(null);

  const [removedCandidates, setRemovedCandidates] = useState([]);
  const [selectedRemovals, setSelectedRemovals] = useState(new Set());

  const searchTimerRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions`);
      if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      showError(err);
    }
  }, [authFetch, showError]);

  const fetchSession = useCallback(
    async (sessionId) => {
      try {
        const res = await authFetch(
          `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${sessionId}`,
        );
        if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
        setActiveSession(await res.json());
      } catch (err) {
        showError(err);
      }
    },
    [authFetch, showError],
  );

  const fetchRows = useCallback(
    async (sessionId, page, status, searchVal) => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        if (status) params.append('status', status);
        if (searchVal) params.append('search', searchVal);
        const res = await authFetch(
          `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${sessionId}/rows?${params}`,
        );
        if (!res.ok) throw new Error(`Failed to load rows (${res.status})`);
        const data = await res.json();
        setRows(data.rows || []);
        setRowTotal(data.total || 0);
      } catch (err) {
        showError(err);
      }
    },
    [authFetch, showError],
  );

  // Initial sessions load.
  useEffect(() => {
    if (isAdmin) fetchSessions();
  }, [isAdmin, fetchSessions]);

  // Load rows when entering a session view, changing tab/page, or after edits.
  useEffect(() => {
    if (view === 'session' && activeSessionId) {
      fetchRows(activeSessionId, rowPage, statusFilter, search);
    }
  }, [view, activeSessionId, rowPage, statusFilter, search, fetchRows]);

  const openSession = useCallback(
    async (sessionId) => {
      setActiveSessionId(sessionId);
      setView('session');
      setRowPage(1);
      setStatusFilter('');
      setSearch('');
      setRemovedCandidates([]);
      setSelectedRemovals(new Set());
      await fetchSession(sessionId);
    },
    [fetchSession],
  );

  const backToList = useCallback(() => {
    setView('list');
    setActiveSessionId(null);
    setActiveSession(null);
    setRows([]);
    fetchSessions();
  }, [fetchSessions]);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    setRowPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      // Re-trigger via state already handled by useEffect.
    }, 400);
  };

  const handleStatusTab = (key) => {
    setStatusFilter(key);
    setRowPage(1);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const mode = fd.get('sourceMode') || 'upload';
    setUploading(true);
    try {
      let res;
      if (mode === 'library') {
        const filename = fd.get('libraryFilename');
        if (!filename) throw new Error('Please choose a library file');
        res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/upload-from-library`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename,
            calendarOwner: fd.get('calendarOwner'),
            calendarId: fd.get('calendarId') || undefined,
            dateRangeStart: fd.get('dateRangeStart'),
            dateRangeEnd: fd.get('dateRangeEnd'),
          }),
        });
      } else {
        if (!fd.get('csvFile') || !fd.get('csvFile').name) {
          throw new Error('Please select a CSV file');
        }
        res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/upload`, {
          method: 'POST',
          body: fd,
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const sample = Array.isArray(data.parseErrors) && data.parseErrors.length > 0
          ? ` First issue: ${data.parseErrors[0].reason || JSON.stringify(data.parseErrors[0])}`
          : '';
        throw new Error((data.error || `Upload failed (${res.status})`) + sample);
      }
      showSuccess(`Staged ${data.rowCount} rows. Session ${data.sessionId}.`);
      await openSession(data.sessionId);
    } catch (err) {
      showError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleValidate = async () => {
    if (!activeSessionId) return;
    setValidating(true);
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/validate`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Validate failed (${res.status})`);
      setRemovedCandidates(data.removedCandidates || []);
      setSelectedRemovals(new Set());
      showSuccess(
        `Validation done. ${data.conflictCount} new conflict(s), ` +
          `${data.resetCount} cleared. ${(data.removedCandidates || []).length} candidate removals.`,
      );
      await fetchSession(activeSessionId);
      await fetchRows(activeSessionId, rowPage, statusFilter, search);
    } catch (err) {
      showError(err);
    } finally {
      setValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!activeSessionId) return;
    if (!confirmCommit) {
      setConfirmCommit(true);
      return;
    }
    setCommitting(true);
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/commit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            forceConflicts: false,
            deleteRsIds: [...selectedRemovals],
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Commit failed (${res.status})`);
      showSuccess(
        `Committed: ${data.applied} applied, ${data.noOp} no-op, ${data.skipped} skipped, ` +
          `${data.humanEditConflicts} human-edit conflicts, ${data.failed} failed, ${data.removed} removed.`,
      );
      setConfirmCommit(false);
      setRemovedCandidates([]);
      setSelectedRemovals(new Set());
      await fetchSession(activeSessionId);
      await fetchRows(activeSessionId, rowPage, statusFilter, search);
    } catch (err) {
      showError(err);
    } finally {
      setCommitting(false);
    }
  };

  const handlePublish = async () => {
    if (!activeSessionId) return;
    if (!confirmPublish) {
      setConfirmPublish(true);
      return;
    }
    setPublishing(true);
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/publish`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Publish failed (${res.status})`);
      showSuccess(
        `Published: ${data.published} new, ${data.updated} updated, ${data.skipped} skipped, ` +
          `${data.failed} failed.`,
      );
      setConfirmPublish(false);
    } catch (err) {
      showError(err);
    } finally {
      setPublishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!activeSessionId) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setDiscarding(true);
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Discard failed (${res.status})`);
      showSuccess(`Discarded session (${data.deleted} rows removed).`);
      setConfirmDiscard(false);
      backToList();
    } catch (err) {
      showError(err);
    } finally {
      setDiscarding(false);
    }
  };

  const handleSkipRow = async (row) => {
    if (confirmSkipRowId !== row._id) {
      setConfirmSkipRowId(row._id);
      return;
    }
    try {
      const skip = row.status !== 'skipped';
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/rows/${row._id}/skip`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Skip failed (${res.status})`);
      }
      setConfirmSkipRowId(null);
      await fetchRows(activeSessionId, rowPage, statusFilter, search);
    } catch (err) {
      showError(err);
    }
  };

  const handleForceApply = async (row) => {
    if (confirmForceRowId !== row._id) {
      setConfirmForceRowId(row._id);
      return;
    }
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/rows/${row._id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceApply: !row.forceApply }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Force-apply toggle failed (${res.status})`);
      }
      setConfirmForceRowId(null);
      await fetchRows(activeSessionId, rowPage, statusFilter, search);
    } catch (err) {
      showError(err);
    }
  };

  // Click anywhere outside to reset confirm states.
  useEffect(() => {
    const reset = () => {
      setConfirmCommit(false);
      setConfirmPublish(false);
      setConfirmDiscard(false);
      setConfirmSkipRowId(null);
      setConfirmForceRowId(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!isAdmin) {
    return (
      <div className="rsi-page">
        <div className="rsi-card">
          <h1>Access Denied</h1>
          <p>Admin role is required to use the rsched importer.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rsi-page">
      <header className="rsi-header">
        <h1>Resource Scheduler Import</h1>
        {view === 'session' && (
          <button type="button" className="rsi-btn-secondary" onClick={backToList}>
            ← Back to sessions
          </button>
        )}
      </header>

      {view === 'list' && (
        <>
          <StageCsvCard
            uploading={uploading}
            onSubmit={handleUpload}
            authFetch={authFetch}
            showError={showError}
          />
          <SessionsList sessions={sessions} onOpen={openSession} />
        </>
      )}

      {view === 'session' && activeSession && (
        <SessionView
          session={activeSession}
          rows={rows}
          rowTotal={rowTotal}
          rowPage={rowPage}
          setRowPage={setRowPage}
          statusFilter={statusFilter}
          setStatusFilter={handleStatusTab}
          search={search}
          onSearchChange={handleSearchChange}
          validating={validating}
          committing={committing}
          publishing={publishing}
          discarding={discarding}
          confirmCommit={confirmCommit}
          confirmPublish={confirmPublish}
          confirmDiscard={confirmDiscard}
          confirmSkipRowId={confirmSkipRowId}
          confirmForceRowId={confirmForceRowId}
          removedCandidates={removedCandidates}
          selectedRemovals={selectedRemovals}
          setSelectedRemovals={setSelectedRemovals}
          onValidate={handleValidate}
          onCommit={handleCommit}
          onPublish={handlePublish}
          onDiscard={handleDiscard}
          onSkipRow={handleSkipRow}
          onForceRow={handleForceApply}
        />
      )}

    </div>
  );
}

function SessionsList({ sessions, onOpen }) {
  return (
    <section className="rsi-card">
      <h2>Past import sessions</h2>
      {sessions.length === 0 ? (
        <p className="rsi-muted">No sessions yet. Stage a CSV above to begin.</p>
      ) : (
        <table className="rsi-table">
          <thead>
            <tr>
              <th>Uploaded</th>
              <th>Calendar</th>
              <th>File</th>
              <th>Range</th>
              <th>Rows</th>
              <th>Breakdown</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.sessionId}>
                <td>{new Date(s.uploadedAt).toLocaleString()}</td>
                <td>{s.calendarOwner}</td>
                <td>{s.csvFilename || '—'}</td>
                <td>
                  {s.dateRangeStart} → {s.dateRangeEnd}
                </td>
                <td>{s.rowCount}</td>
                <td>
                  <BreakdownChips breakdown={s.statusBreakdown} />
                </td>
                <td>
                  <button
                    type="button"
                    className="rsi-btn-secondary"
                    onClick={() => onOpen(s.sessionId)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BreakdownChips({ breakdown = {} }) {
  const keys = Object.keys(breakdown);
  if (keys.length === 0) return <span className="rsi-muted">—</span>;
  return (
    <div className="rsi-breakdown">
      {keys.map((k) => {
        const cfg = STATUS_BADGE[k] || { className: 'rsi-badge-muted', label: k };
        return (
          <span key={k} className={`rsi-badge ${cfg.className}`}>
            {cfg.label}: {breakdown[k]}
          </span>
        );
      })}
    </div>
  );
}

function SessionView(props) {
  const {
    session,
    rows,
    rowTotal,
    rowPage,
    setRowPage,
    statusFilter,
    setStatusFilter,
    search,
    onSearchChange,
    validating,
    committing,
    publishing,
    discarding,
    confirmCommit,
    confirmPublish,
    confirmDiscard,
    confirmSkipRowId,
    confirmForceRowId,
    removedCandidates,
    selectedRemovals,
    setSelectedRemovals,
    onValidate,
    onCommit,
    onPublish,
    onDiscard,
    onSkipRow,
    onForceRow,
  } = props;

  const totalPages = Math.max(1, Math.ceil(rowTotal / PAGE_SIZE));
  const breakdown = session.statusBreakdown || {};
  const hasApplied = (breakdown.applied || 0) > 0;

  return (
    <>
      <section className="rsi-card">
        <div className="rsi-session-summary">
          <div>
            <strong>Calendar:</strong> {session.calendarOwner}
          </div>
          <div>
            <strong>File:</strong> {session.csvFilename || '—'}
          </div>
          <div>
            <strong>Range:</strong> {session.dateRangeStart} → {session.dateRangeEnd}
          </div>
          <div>
            <strong>Rows:</strong> {session.rowCount}
          </div>
        </div>
        <BreakdownChips breakdown={breakdown} />

        <div className="rsi-actions">
          <button
            type="button"
            className="rsi-btn-secondary"
            onClick={onValidate}
            disabled={validating}
          >
            {validating ? 'Validating…' : 'Validate'}
          </button>
          <button
            type="button"
            className={`rsi-btn-primary ${confirmCommit ? 'rsi-confirm' : ''}`}
            onClick={onCommit}
            disabled={committing}
          >
            {committing ? 'Committing…' : confirmCommit ? 'Confirm commit' : 'Commit to MongoDB'}
          </button>
          <button
            type="button"
            className={`rsi-btn-primary ${confirmPublish ? 'rsi-confirm' : ''}`}
            onClick={onPublish}
            disabled={publishing || !hasApplied}
            title={hasApplied ? '' : 'Commit at least one row before publishing.'}
          >
            {publishing ? 'Publishing…' : confirmPublish ? 'Confirm publish' : 'Publish to Outlook'}
          </button>
          <button
            type="button"
            className={`rsi-btn-danger ${confirmDiscard ? 'rsi-confirm' : ''}`}
            onClick={onDiscard}
            disabled={discarding}
          >
            {discarding ? 'Discarding…' : confirmDiscard ? 'Confirm discard' : 'Discard session'}
          </button>
        </div>
      </section>

      {removedCandidates.length > 0 && (
        <section className="rsi-card rsi-removal-panel">
          <h3>Possibly-removed events ({removedCandidates.length})</h3>
          <p className="rsi-muted">
            These rsched events exist in MongoDB but were not found in this CSV import. Select any
            you want to delete at commit time. Nothing is auto-deleted.
          </p>
          <table className="rsi-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Title</th>
                <th>Start</th>
                <th>rsId</th>
              </tr>
            </thead>
            <tbody>
              {removedCandidates.map((r) => {
                const checked = selectedRemovals.has(r.rsId);
                return (
                  <tr key={r.rsId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedRemovals);
                          if (e.target.checked) next.add(r.rsId);
                          else next.delete(r.rsId);
                          setSelectedRemovals(next);
                        }}
                      />
                    </td>
                    <td>{r.eventTitle || '(untitled)'}</td>
                    <td>{r.startDateTime}</td>
                    <td>{r.rsId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="rsi-card">
        <div className="rsi-row-flex">
          <input
            type="search"
            placeholder="Search title, description, location, rsKey…"
            value={search}
            onChange={onSearchChange}
            className="rsi-search"
          />
        </div>
        <div className="rsi-tabs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={`rsi-tab ${statusFilter === t.key ? 'active' : ''}`}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label} {breakdown[t.key] != null ? <span>({breakdown[t.key]})</span> : null}
            </button>
          ))}
        </div>
        <table className="rsi-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Start</th>
              <th>End</th>
              <th>Locations</th>
              <th>rsKey</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cfg = STATUS_BADGE[r.status] || { className: 'rsi-badge-muted', label: r.status };
              const isSkipConfirm = confirmSkipRowId === r._id;
              const isForceConfirm = confirmForceRowId === r._id;
              return (
                <tr key={r._id}>
                  <td>
                    <span className={`rsi-badge ${cfg.className}`}>{cfg.label}</span>
                  </td>
                  <td>{r.eventTitle}</td>
                  <td>{r.startDateTime}</td>
                  <td>{r.endDateTime}</td>
                  <td>{r.locationDisplayNames || '—'}</td>
                  <td>{r.rsKey}</td>
                  <td className="rsi-reason">{r.conflictReason || (r.applyError ? r.applyError : '')}</td>
                  <td>
                    <button
                      type="button"
                      className={`rsi-btn-link ${isSkipConfirm ? 'rsi-confirm' : ''}`}
                      onClick={() => onSkipRow(r)}
                    >
                      {r.status === 'skipped'
                        ? isSkipConfirm
                          ? 'Confirm unskip'
                          : 'Unskip'
                        : isSkipConfirm
                          ? 'Confirm skip'
                          : 'Skip'}
                    </button>
                    {r.status === 'conflict' && (
                      <button
                        type="button"
                        className={`rsi-btn-link ${isForceConfirm ? 'rsi-confirm' : ''}`}
                        onClick={() => onForceRow(r)}
                        style={{ marginLeft: 8 }}
                      >
                        {r.forceApply
                          ? isForceConfirm
                            ? 'Confirm clear force'
                            : 'Clear force'
                          : isForceConfirm
                            ? 'Confirm force'
                            : 'Force'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="rsi-pagination">
          <button
            type="button"
            className="rsi-btn-secondary"
            disabled={rowPage <= 1}
            onClick={() => setRowPage(rowPage - 1)}
          >
            Prev
          </button>
          <span>
            Page {rowPage} / {totalPages} ({rowTotal} rows)
          </span>
          <button
            type="button"
            className="rsi-btn-secondary"
            disabled={rowPage >= totalPages}
            onClick={() => setRowPage(rowPage + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}

function StageCsvCard({ uploading, onSubmit, authFetch, showError }) {
  const [calendarOwner, setCalendarOwner] = useState(APP_CONFIG.CALENDAR_CONFIG.SANDBOX_CALENDAR);
  const [calendarId, setCalendarId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDaysIso(todayIso(), 90));
  const [sourceMode, setSourceMode] = useState('library');
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [libraryFilename, setLibraryFilename] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingLibrary(true);
      try {
        const res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/library`);
        if (!res.ok) throw new Error(`Failed to list library (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        const files = data.files || [];
        setLibraryFiles(files);
        if (files.length > 0) setLibraryFilename((prev) => prev || files[0].filename);
        if (files.length === 0) setSourceMode('upload');
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) setLoadingLibrary(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <section className="rsi-card">
      <h2>Stage a CSV</h2>
      <p className="rsi-muted" style={{ marginTop: 0 }}>
        Pick a saved Rsched export from the library or upload a new one, set the
        calendar and date range, then preview what will be added, updated, or
        removed before committing.
      </p>
      <form className="rsi-stage-form" onSubmit={onSubmit}>
        <input type="hidden" name="sourceMode" value={sourceMode} />

        <div className="rsi-row-flex" style={{ gap: '1rem', marginBottom: '0.5rem' }}>
          <label style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="radio"
              checked={sourceMode === 'library'}
              onChange={() => setSourceMode('library')}
              disabled={libraryFiles.length === 0}
            />
            From library{libraryFiles.length === 0 && !loadingLibrary ? ' (empty)' : ''}
          </label>
          <label style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="radio"
              checked={sourceMode === 'upload'}
              onChange={() => setSourceMode('upload')}
            />
            Upload new
          </label>
        </div>

        {sourceMode === 'library' ? (
          <label>
            Library file
            <select
              name="libraryFilename"
              value={libraryFilename}
              onChange={(e) => setLibraryFilename(e.target.value)}
              disabled={loadingLibrary}
              required
            >
              {loadingLibrary && <option value="">Loading…</option>}
              {!loadingLibrary && libraryFiles.length === 0 && (
                <option value="">No Rsched_*.csv files in backend/csv-imports/</option>
              )}
              {libraryFiles.map((f) => (
                <option key={f.filename} value={f.filename}>
                  {f.filename} — {formatBytes(f.sizeBytes)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            CSV file
            <input
              type="file"
              name="csvFile"
              accept=".csv,text/csv"
              required={sourceMode === 'upload'}
            />
          </label>
        )}

        <label>
          Calendar owner
          <select
            name="calendarOwner"
            value={calendarOwner}
            onChange={(e) => setCalendarOwner(e.target.value)}
            required
          >
            <option value={APP_CONFIG.CALENDAR_CONFIG.SANDBOX_CALENDAR}>
              {APP_CONFIG.CALENDAR_CONFIG.SANDBOX_CALENDAR} (sandbox)
            </option>
            <option value={APP_CONFIG.CALENDAR_CONFIG.PRODUCTION_CALENDAR}>
              {APP_CONFIG.CALENDAR_CONFIG.PRODUCTION_CALENDAR} (production)
            </option>
          </select>
        </label>

        <div className="rsi-row-flex">
          <label style={{ flex: 1 }}>
            Date range start
            <input
              type="date"
              name="dateRangeStart"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            Date range end
            <input
              type="date"
              name="dateRangeEnd"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </label>
        </div>

        <button
          type="button"
          className="rsi-btn-link"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ alignSelf: 'flex-start', padding: 0 }}
        >
          {showAdvanced ? '▾' : '▸'} Advanced
        </button>
        {showAdvanced && (
          <label>
            Calendar ID
            <input
              type="text"
              name="calendarId"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              placeholder="Leave blank to use the configured default"
            />
            <span className="rsi-muted" style={{ fontSize: '0.85em' }}>
              Optional Outlook calendar GUID inside the chosen mailbox. Most
              imports leave this blank — the system auto-resolves to the
              calendar configured for the selected owner.
            </span>
          </label>
        )}

        <div className="rsi-row-flex" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="rsi-btn-primary" disabled={uploading}>
            {uploading ? 'Staging…' : sourceMode === 'library' ? 'Stage from library' : 'Upload & stage'}
          </button>
        </div>
      </form>
    </section>
  );
}

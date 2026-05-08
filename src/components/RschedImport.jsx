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

  const [activeSession, setActiveSession] = useState(null);
  const activeSessionId = activeSession?.sessionId || null;
  const [rows, setRows] = useState([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPage, setRowPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [uploading, setUploading] = useState(false);

  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Two-step confirm state — IDs of which row/action is in confirm state.
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmSkipRowId, setConfirmSkipRowId] = useState(null);
  const [confirmForceRowId, setConfirmForceRowId] = useState(null);

  const [selectedRemovals, setSelectedRemovals] = useState(new Set());

  const searchTimerRef = useRef(null);

  const loadActive = useCallback(async () => {
    try {
      const res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/active`);
      if (!res.ok) throw new Error(`Failed to load active staging (${res.status})`);
      const data = await res.json();
      setActiveSession(data.active || null);
      setSelectedRemovals(new Set());
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

  // Auto-resume the user's in-flight staging on mount.
  useEffect(() => {
    if (isAdmin) loadActive();
  }, [isAdmin, loadActive]);

  // Load rows when staging changes or table filters change.
  useEffect(() => {
    if (activeSessionId) {
      fetchRows(activeSessionId, rowPage, statusFilter, search);
    } else {
      setRows([]);
      setRowTotal(0);
    }
  }, [activeSessionId, rowPage, statusFilter, search, fetchRows]);

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
        const isAllTime = fd.get('allTime') === 'true';
        res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/rsched-import/upload-from-library`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename,
            calendarOwner: fd.get('calendarOwner'),
            calendarId: fd.get('calendarId') || undefined,
            allTime: isAllTime,
            dateRangeStart: isAllTime ? null : fd.get('dateRangeStart'),
            dateRangeEnd: isAllTime ? null : fd.get('dateRangeEnd'),
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
      showSuccess(`Staged ${data.rowCount} rows.`);
      setRowPage(1);
      setStatusFilter('');
      setSearch('');
      setSelectedRemovals(new Set());
      await loadActive();
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

  const handleDownloadDriftReport = async (format) => {
    if (!activeSessionId) return;
    try {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/rsched-import/sessions/${activeSessionId}/drift-report?format=${format}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rsched-drift-${activeSessionId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess(`Drift report downloaded as ${format.toUpperCase()}`);
    } catch (err) {
      showError(err);
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

  // Esc resets two-step confirm states.
  useEffect(() => {
    const reset = () => {
      setConfirmCommit(false);
      setConfirmPublish(false);
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
      </header>

      <StageCsvCard
        uploading={uploading}
        onSubmit={handleUpload}
        authFetch={authFetch}
        showError={showError}
      />

      {activeSession ? (
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
          confirmCommit={confirmCommit}
          confirmPublish={confirmPublish}
          confirmSkipRowId={confirmSkipRowId}
          confirmForceRowId={confirmForceRowId}
          selectedRemovals={selectedRemovals}
          setSelectedRemovals={setSelectedRemovals}
          onValidate={handleValidate}
          onCommit={handleCommit}
          onPublish={handlePublish}
          onSkipRow={handleSkipRow}
          onForceRow={handleForceApply}
          onDownloadDriftReport={handleDownloadDriftReport}
        />
      ) : (
        <section className="rsi-card">
          <p className="rsi-muted" style={{ margin: 0 }}>
            Nothing staged yet — pick a CSV above to see a preview of what
            would change.
          </p>
        </section>
      )}
    </div>
  );
}

function PreviewSummary({ session, preview }) {
  if (!preview) return null;
  const e = preview.existingInRange || {};
  const p = preview.plannedActions || {};
  return (
    <section className="rsi-card rsi-preview">
      <div className="rsi-preview-meta">
        <div><strong>Calendar:</strong> {session.calendarOwner}</div>
        <div><strong>CSV:</strong> {session.csvFilename || '—'}</div>
        <div>
          <strong>Date range:</strong>{' '}
          {preview.dateRange?.allTime ? (
            <span>All time <span className="rsi-muted">(no date filter)</span></span>
          ) : (
            <>
              {preview.dateRange?.start} → {preview.dateRange?.end}{' '}
              <span className="rsi-muted">({preview.dateRange?.days} days)</span>
            </>
          )}
        </div>
      </div>

      <div className="rsi-preview-grid">
        <div className="rsi-preview-block">
          <h3>Currently in calendar</h3>
          <ul>
            <li><span className="rsi-num">{e.total ?? 0}</span> total events in range</li>
            <li><span className="rsi-num">{e.fromRsched ?? 0}</span> from rsched</li>
            <li>
              <span className="rsi-num">{e.manual ?? 0}</span> manually created
              <span className="rsi-muted"> (won't be touched)</span>
            </li>
          </ul>
        </div>

        <div className="rsi-preview-block">
          <h3>After commit, this CSV will</h3>
          <ul>
            <li><span className="rsi-num rsi-num-good">{p.willCreate ?? 0}</span> create new event(s)</li>
            {p.willUpdate != null && p.willUpdate > 0 ? (
              <li>
                <span className="rsi-num rsi-num-warn">{p.willUpdate}</span> update existing event(s)
                <span className="rsi-muted"> — field-level diffs visible below</span>
              </li>
            ) : null}
            {p.willStayUnchanged != null && p.willStayUnchanged > 0 ? (
              <li>
                <span className="rsi-num rsi-num-muted">{p.willStayUnchanged}</span> match existing — no changes
              </li>
            ) : null}
            {p.willConflictHumanEdit != null && p.willConflictHumanEdit > 0 ? (
              <li>
                <span className="rsi-num rsi-num-warn">{p.willConflictHumanEdit}</span> human-edited event(s)
                <span className="rsi-muted"> — review before committing</span>
              </li>
            ) : null}
            {/* Pre-validate, willUpdate/willStayUnchanged are zero. Show legacy total in that case. */}
            {(p.willUpdate ?? 0) === 0 && (p.willStayUnchanged ?? 0) === 0 && (p.willConflictHumanEdit ?? 0) === 0 ? (
              <li>
                <span className="rsi-num">{p.willMatchExisting ?? 0}</span> match existing event(s)
                <span className="rsi-muted"> (run validate for field-level drift)</span>
              </li>
            ) : null}
            <li>
              <span className="rsi-num rsi-num-warn">{p.willRemove ?? 0}</span> remove rsched event(s)
              <span className="rsi-muted"> — opt-in per row below</span>
            </li>
            <li><span className="rsi-num rsi-num-muted">{p.willSkipConflict ?? 0}</span> skip — conflicts</li>
            <li><span className="rsi-num rsi-num-muted">{p.willSkipUnmatched ?? 0}</span> skip — unmatched location</li>
          </ul>
        </div>
      </div>
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
  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());
  const toggleRowExpanded = (rowId) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

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
    confirmCommit,
    confirmPublish,
    confirmSkipRowId,
    confirmForceRowId,
    selectedRemovals,
    setSelectedRemovals,
    onValidate,
    onCommit,
    onPublish,
    onSkipRow,
    onForceRow,
    onDownloadDriftReport,
  } = props;

  const totalPages = Math.max(1, Math.ceil(rowTotal / PAGE_SIZE));
  const preview = session.preview || null;
  const breakdown = session.statusBreakdown || {};
  const hasApplied = (breakdown.applied || 0) > 0;
  const removedCandidates = preview?.removalCandidates || [];

  return (
    <>
      <PreviewSummary session={session} preview={preview} />

      <section className="rsi-card">
        <div className="rsi-actions">
          <button
            type="button"
            className="rsi-btn-secondary"
            onClick={onValidate}
            disabled={validating}
          >
            {validating ? 'Validating…' : 'Re-validate preview'}
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
          {onDownloadDriftReport ? (
            <span className="rsi-download-group">
              <button
                type="button"
                className="rsi-btn-secondary"
                onClick={() => onDownloadDriftReport('json')}
                title="Download drift report as JSON for offline review"
              >
                Download report (JSON)
              </button>
              <button
                type="button"
                className="rsi-btn-secondary"
                onClick={() => onDownloadDriftReport('csv')}
                title="Download drift report as long-format CSV"
              >
                Download report (CSV)
              </button>
            </span>
          ) : null}
        </div>
        <p className="rsi-muted" style={{ margin: '8px 0 0 0', fontSize: '0.85em' }}>
          Tip: stage a different CSV or date range above at any time — your
          current preview will be replaced.
        </p>
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
              <th aria-label="expand"></th>
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
              const hasDiffs = Array.isArray(r.materialDiffs) && r.materialDiffs.length > 0;
              const isExpanded = expandedRowIds.has(r._id);
              const driftBadge =
                r.driftType === 'update'
                  ? { className: 'rsi-badge-warn', label: 'Drift' }
                  : r.driftType === 'human_edit_conflict'
                    ? { className: 'rsi-badge-warn', label: 'Human-edited' }
                    : null;
              return (
                <React.Fragment key={r._id}>
                  <tr>
                    <td>
                      {hasDiffs ? (
                        <button
                          type="button"
                          className="rsi-btn-link rsi-expand-btn"
                          onClick={() => toggleRowExpanded(r._id)}
                          aria-expanded={isExpanded}
                          title={isExpanded ? 'Collapse diff' : 'Show field diffs'}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <span className={`rsi-badge ${cfg.className}`}>{cfg.label}</span>
                      {driftBadge ? (
                        <span
                          className={`rsi-badge ${driftBadge.className}`}
                          style={{ marginLeft: 6 }}
                        >
                          {driftBadge.label}
                        </span>
                      ) : null}
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
                  {isExpanded && hasDiffs ? (
                    <tr className="rsi-diff-row">
                      <td></td>
                      <td colSpan={8}>
                        <div className="rsi-diff-block">
                          <div className="rsi-diff-header">
                            Field-level changes vs MongoDB
                            {r.materialDiffs.some((d) => d.truncated) ? (
                              <span className="rsi-muted"> (some values truncated — download the report for full text)</span>
                            ) : null}
                          </div>
                          <table className="rsi-diff-table">
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Previous (Mongo)</th>
                                <th>CSV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.materialDiffs.map((d, i) => (
                                <tr key={`${r._id}-${i}`}>
                                  <td className="rsi-diff-field">{d.field}</td>
                                  <td className="rsi-diff-prev">{d.previous}</td>
                                  <td className="rsi-diff-csv">{d.csv}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
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
  const [allTime, setAllTime] = useState(false);
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

  const submitLabel = uploading
    ? 'Staging…'
    : sourceMode === 'library'
      ? 'Stage from library'
      : 'Upload & stage';

  return (
    <section className="rsi-card rsi-stage-card">
      <header className="rsi-stage-header">
        <h2>Stage a CSV</h2>
        <p>
          Pick a saved Rsched export or upload a new one. Set the calendar and
          date range, then preview what will change before committing.
        </p>
      </header>

      <form className="rsi-stage-form" onSubmit={onSubmit}>
        <input type="hidden" name="sourceMode" value={sourceMode} />

        <div className="rsi-field">
          <span className="rsi-field-label">Source</span>
          <div className="rsi-segmented" role="tablist" aria-label="CSV source">
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === 'library'}
              className={`rsi-segmented-btn ${sourceMode === 'library' ? 'active' : ''}`}
              onClick={() => setSourceMode('library')}
              disabled={libraryFiles.length === 0}
            >
              From library
              {libraryFiles.length > 0 && (
                <span className="rsi-segmented-count">{libraryFiles.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === 'upload'}
              className={`rsi-segmented-btn ${sourceMode === 'upload' ? 'active' : ''}`}
              onClick={() => setSourceMode('upload')}
            >
              Upload new
            </button>
          </div>
        </div>

        {sourceMode === 'library' ? (
          <div className="rsi-field">
            <label className="rsi-field-label" htmlFor="rsi-library">Library file</label>
            <div className="rsi-select-wrap">
              <select
                id="rsi-library"
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
              <span className="rsi-select-chevron" aria-hidden="true">▾</span>
            </div>
          </div>
        ) : (
          <div className="rsi-field">
            <label className="rsi-field-label" htmlFor="rsi-file">CSV file</label>
            <input
              id="rsi-file"
              type="file"
              name="csvFile"
              accept=".csv,text/csv"
              required={sourceMode === 'upload'}
              className="rsi-file-input"
            />
          </div>
        )}

        <div className="rsi-field">
          <label className="rsi-field-label" htmlFor="rsi-calendar-owner">Calendar owner</label>
          <div className="rsi-select-wrap">
            <select
              id="rsi-calendar-owner"
              name="calendarOwner"
              value={calendarOwner}
              onChange={(e) => setCalendarOwner(e.target.value)}
              required
            >
              <option value={APP_CONFIG.CALENDAR_CONFIG.SANDBOX_CALENDAR}>
                Sandbox · {APP_CONFIG.CALENDAR_CONFIG.SANDBOX_CALENDAR}
              </option>
              <option value={APP_CONFIG.CALENDAR_CONFIG.PRODUCTION_CALENDAR}>
                Production · {APP_CONFIG.CALENDAR_CONFIG.PRODUCTION_CALENDAR}
              </option>
            </select>
            <span className="rsi-select-chevron" aria-hidden="true">▾</span>
          </div>
        </div>

        <input type="hidden" name="allTime" value={allTime ? 'true' : 'false'} />

        <div className="rsi-field rsi-alltime-field">
          <label className="rsi-checkbox-label">
            <input
              type="checkbox"
              checked={allTime}
              onChange={(e) => setAllTime(e.target.checked)}
            />
            <span>Reconcile all events (no date filter)</span>
          </label>
          {allTime && (
            <p className="rsi-field-hint">
              Skips the date range and runs against the entire calendar history.
              Slower on large datasets but matches every rsched event in MongoDB.
            </p>
          )}
        </div>

        <div className="rsi-field-row">
          <div className="rsi-field">
            <label className="rsi-field-label" htmlFor="rsi-from">Start date</label>
            <input
              id="rsi-from"
              type="date"
              name="dateRangeStart"
              value={allTime ? '' : from}
              onChange={(e) => setFrom(e.target.value)}
              required={!allTime}
              disabled={allTime}
            />
          </div>
          <div className="rsi-field">
            <label className="rsi-field-label" htmlFor="rsi-to">End date</label>
            <input
              id="rsi-to"
              type="date"
              name="dateRangeEnd"
              value={allTime ? '' : to}
              onChange={(e) => setTo(e.target.value)}
              required={!allTime}
              disabled={allTime}
            />
          </div>
        </div>

        <div className="rsi-advanced">
          <button
            type="button"
            className="rsi-expander"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <span className={`rsi-expander-icon ${showAdvanced ? 'open' : ''}`} aria-hidden="true">▸</span>
            Advanced
          </button>
          {showAdvanced && (
            <div className="rsi-field rsi-advanced-field">
              <label className="rsi-field-label" htmlFor="rsi-calendar-id">Calendar ID</label>
              <input
                id="rsi-calendar-id"
                type="text"
                name="calendarId"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder="Leave blank to auto-resolve"
              />
              <p className="rsi-field-hint">
                Optional Outlook calendar GUID inside the chosen mailbox. Most
                imports leave this blank — the system auto-resolves to the
                calendar configured for the selected owner.
              </p>
            </div>
          )}
        </div>

        <footer className="rsi-stage-footer">
          <button type="submit" className="rsi-btn-primary rsi-btn-lg" disabled={uploading}>
            {submitLabel}
          </button>
        </footer>
      </form>
    </section>
  );
}

// src/components/MyAssignments.jsx
//
// The derived per-user view of Scheduling Sheets: any authenticated user's
// upcoming assignments, grouped by day (each group names its workbook).
// Read-only by design — assignments are person chips on a sheet only managers
// can edit; this surface answers 'where am I supposed to be, and when'.
//
// Loading contract: auto-firing list view → `loading` binds to
// deriveListLoadingState().isFirstLoad; the empty state renders only when the
// query has genuinely resolved empty (never during first load or a silent
// refresh), and it carries the standard refresh affordance.

import React, { useMemo, useState } from 'react';
import { useMyAssignments } from '../hooks/useSchedulingSheets';
import { deriveListLoadingState } from '../utils/listLoadingState';
import LoadingSpinner from './shared/LoadingSpinner';
import EmptyStateRefreshButton from './shared/EmptyStateRefreshButton';
import './MyAssignments.css';

function formatDayHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function MyAssignments() {
  const query = useMyAssignments();
  const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(query);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const assignments = useMemo(() => query.data || [], [query.data]);

  const groups = useMemo(() => {
    const byDay = new Map();
    for (const a of assignments) {
      const key = `${a.date}|${String(a.sheetId)}`;
      if (!byDay.has(key)) byDay.set(key, { date: a.date, dayTitle: a.dayTitle, sheetName: a.sheetName, items: [] });
      byDay.get(key).items.push(a);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [assignments]);

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    try { await query.refetch(); } finally { setIsManualRefreshing(false); }
  };

  if (isFirstLoad) {
    return (
      <div className="ma-page" data-testid="my-assignments-loading">
        <LoadingSpinner />
      </div>
    );
  }

  const showEmpty = !isFirstLoad && assignments.length === 0 && !isSilentRefreshing;

  return (
    <div className="ma-page" data-testid="my-assignments-page">
      <h1 className="ma-heading">My Assignments</h1>

      {query.isError && (
        <div className="ma-error" data-testid="my-assignments-error">
          Could not load your assignments. <button type="button" onClick={handleManualRefresh}>Retry</button>
        </div>
      )}

      {showEmpty && !query.isError && (
        <div className="ma-empty" data-testid="my-assignments-empty">
          <p>No upcoming assignments.</p>
          <p className="ma-empty-sub">When the events office schedules you for a service or holiday, it will appear here.</p>
          <EmptyStateRefreshButton onClick={handleManualRefresh} isRefreshing={isManualRefreshing} />
        </div>
      )}

      {groups.map((group) => (
        <section key={`${group.date}-${group.sheetName}`} className="ma-day" data-testid={`assignment-day-${group.date}`}>
          <header className="ma-day-header">
            <h2>{formatDayHeading(group.date)}</h2>
            <span className="ma-day-sub">
              {group.dayTitle ? `${group.dayTitle} · ` : ''}{group.sheetName || ''}
            </span>
          </header>
          <ul className="ma-list">
            {group.items.map((a, i) => (
              <li key={i} className="ma-item" data-testid="assignment-item">
                <div className="ma-item-main">
                  <span className="ma-item-role">{a.rowLabel || 'Assignment'}</span>
                  {a.columnName && <span className="ma-item-post">{a.columnName}</span>}
                </div>
                <div className="ma-item-meta">
                  {a.callTime && <span className="ma-item-call" data-testid="assignment-calltime">Call {a.callTime}</span>}
                  {(a.begins || a.ends) && <span>{[a.begins, a.ends].filter(Boolean).join(' – ')}</span>}
                  {a.location && <span>&#128205; {a.location}</span>}
                </div>
                {a.note && <p className="ma-item-note">{a.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

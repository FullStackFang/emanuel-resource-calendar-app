// src/components/MyAssignments.jsx
//
// The derived per-user view of Scheduling Sheets: any authenticated user's
// upcoming assignments, grouped by day (each group names its workbook).
// Read-only by design — assignments are person chips on a sheet only managers
// can edit; this surface answers 'where am I supposed to be, and when'.
//
// LAYOUT: the soonest day is a full-width featured card; the remaining days
// flow in a responsive grid. The previous layout gave each assignment its own
// full-width row in a 760px column, so height grew with the season while the
// width went unused — a seven-post High Holy Days ran ~800px down the page.
// Making the DAY the panel converts that growth from vertical to horizontal.
//
// Call time leads every card because it is the only value on this page anyone
// acts on. It is rendered verbatim, never parsed: sheet call times are free
// text and read things like 'HD 4:30pm / Reg 4:45pm'.
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

function daySubtitle(group) {
  return [group.dayTitle, group.sheetName].filter(Boolean).join(' · ');
}

/** The window an assignment runs for, when the sheet recorded one. */
function timeRange(a) {
  return [a.begins, a.ends].filter(Boolean).join(' – ');
}

/** One assignment inside a normal (non-featured) day card. */
function AssignmentRow({ assignment: a }) {
  const range = timeRange(a);
  return (
    <div className="ma-slot" data-testid="assignment-item">
      <div className="ma-slot-call" data-testid="assignment-calltime">
        {a.callTime ? `Call ${a.callTime}` : (range || '—')}
      </div>
      <div className="ma-slot-body">
        {/* One line, not four: post and role side by side with the secondary
            detail pushed right, so a wide card spends its width. */}
        <div className="ma-slot-head">
          <span className="ma-slot-post">{a.columnName || 'Assignment'}</span>
          <span className="ma-slot-role">{a.rowLabel}</span>
          <span className="ma-slot-extras">
            {a.callTime && range && <span className="ma-slot-extra">{range}</span>}
            {a.location && <span className="ma-slot-extra">📍 {a.location}</span>}
          </span>
        </div>
        {a.note && <p className="ma-slot-note">{a.note}</p>}
      </div>
    </div>
  );
}

/**
 * The soonest day, given its own full-width row.
 *
 * It features the DAY rather than the single next assignment: a day routinely
 * holds more than one post, and featuring one while leaving its sibling in a
 * normal card would split one morning across two visual weights. Extra posts
 * on the featured day list compactly beneath a divider in the same card.
 */
function FeaturedDay({ group }) {
  const [first, ...rest] = group.items;
  const range = timeRange(first);
  const subtitle = daySubtitle(group);

  return (
    <section className="ma-card ma-card-feature" data-testid={`assignment-day-${group.date}`}>
      <header className="ma-card-head">
        <h2>{formatDayHeading(group.date)}</h2>
        <span className="ma-next-tag">Next</span>
        {subtitle && <span className="ma-card-sub">{subtitle}</span>}
        <span className="ma-card-count">
          {group.items.length} post{group.items.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="ma-feature-main" data-testid="assignment-item">
        {first.callTime && (
          <div className="ma-feature-when" data-testid="assignment-calltime">
            <span className="ma-feature-label">Call</span>{' '}
            {/* Call times are free text and often read 'HD 4:30pm / Reg 4:45pm'.
                The string is never shortened (see MAL-4) — a long one steps
                down a type size instead, so '1:30 PM' keeps the full emphasis
                while a two-part time stays readable rather than shouting. */}
            <span className={`ma-feature-time${first.callTime.length > 14 ? ' ma-feature-time-long' : ''}`}>
              {first.callTime}
            </span>
          </div>
        )}
        <div className="ma-feature-what">
          <div className="ma-feature-post">{first.columnName || 'Assignment'}</div>
          <div className="ma-feature-role">{first.rowLabel}</div>
        </div>
        {/* margin-left:auto pushes this to the card's trailing edge — the
            featured card spans the page, and without it the right two thirds
            are empty. */}
        <div className="ma-feature-meta">
          {range && (
            <span><span className="ma-feature-meta-label">Runs</span>{range}</span>
          )}
          {first.location && (
            <span><span className="ma-feature-meta-label">Where</span>{first.location}</span>
          )}
          {first.note && (
            <span><span className="ma-feature-meta-label">Note</span>{first.note}</span>
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="ma-feature-rest">
          {rest.map((a, i) => <AssignmentRow key={i} assignment={a} />)}
        </div>
      )}
    </section>
  );
}

/** A later day. */
function DayCard({ group }) {
  const subtitle = daySubtitle(group);
  return (
    <section className="ma-card" data-testid={`assignment-day-${group.date}`}>
      <header className="ma-card-head">
        <h2>{formatDayHeading(group.date)}</h2>
        {subtitle && <span className="ma-card-sub">{subtitle}</span>}
        <span className="ma-card-count">
          {group.items.length} post{group.items.length === 1 ? '' : 's'}
        </span>
      </header>
      {group.items.map((a, i) => <AssignmentRow key={i} assignment={a} />)}
    </section>
  );
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
      <div className="loading-veil-host" data-testid="my-assignments-loading">
        <LoadingSpinner variant="overlay" className="visible initial" text="Loading your assignments..." />
      </div>
    );
  }

  const showEmpty = !isFirstLoad && assignments.length === 0 && !isSilentRefreshing;
  const [featured, ...later] = groups;

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

      {featured && <FeaturedDay group={featured} />}

      {later.length > 0 && (
        <div className="ma-grid">
          {later.map((group) => <DayCard key={`${group.date}-${group.sheetName}`} group={group} />)}
        </div>
      )}
    </div>
  );
}

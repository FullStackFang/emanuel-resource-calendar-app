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
// PAST: the server is asked for the last PAST_WINDOW_DAYS as well, and days
// before the device's local today are folded away under one toggle, newest
// first when opened. The featured card is always the soonest UPCOMING day. A
// day dated today is upcoming until midnight — the evening-service usher must
// still see it at 8 PM.
//
// TAP TO HIGHLIGHT: a DAY card is a toggle button that does nothing but draw
// a border around itself. It lets a reader mark their place without the page
// pretending it can open or change anything. Single selection; tap again to
// clear. The unit is the day, not the row — per-row highlights carved a card
// into competing boxes and read as a list of buttons. Deliberately not a link
// to the event: most posts are not event-linked, and the endpoint carries no
// event id (SE-25).
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

/** How far back the Past section reaches. A season, not a history dump. */
export const PAST_WINDOW_DAYS = 90;

/** The device's local date as YYYY-MM-DD — the same calendar sheet days use. */
function localDateKey(d = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

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

/**
 * The props that make a day card a highlight toggle. A real <button> would
 * swallow the block layout the card depends on, so this is the ARIA toggle
 * pattern on the section: role, tabindex, aria-pressed, and Enter/Space.
 */
function toggleProps(dayKey, selectedKey, onToggle) {
  const selected = selectedKey === dayKey;
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selected,
    onClick: () => onToggle(dayKey),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(dayKey);
      }
    },
    className: selected ? ' ma-selected' : '',
  };
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
function FeaturedDay({ group, selectedKey, onToggle }) {
  const [first, ...rest] = group.items;
  const range = timeRange(first);
  const subtitle = daySubtitle(group);
  const { className, ...toggle } = toggleProps(group.key, selectedKey, onToggle);

  return (
    <section className={`ma-card ma-card-feature${className}`} data-testid={`assignment-day-${group.date}`} {...toggle}>
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

/** A later day — or, with `past`, one that has gone by. */
function DayCard({ group, past = false, selectedKey, onToggle }) {
  const subtitle = daySubtitle(group);
  const { className, ...toggle } = toggleProps(group.key, selectedKey, onToggle);
  return (
    <section
      className={`ma-card${past ? ' ma-card-past' : ''}${className}`}
      data-testid={`assignment-day-${group.date}`}
      {...toggle}
    >
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
  const query = useMyAssignments({ pastDays: PAST_WINDOW_DAYS });
  const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(query);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);

  const assignments = useMemo(() => query.data || [], [query.data]);

  const { upcoming, past } = useMemo(() => {
    const byDay = new Map();
    for (const a of assignments) {
      const key = `${a.date}|${String(a.sheetId)}`;
      if (!byDay.has(key)) byDay.set(key, { key, date: a.date, dayTitle: a.dayTitle, sheetName: a.sheetName, items: [] });
      byDay.get(key).items.push(a);
    }
    const today = localDateKey();
    const groups = [...byDay.values()];
    return {
      upcoming: groups.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
      // Newest first: a past list is read backwards from today.
      past: groups.filter((g) => g.date < today).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [assignments]);

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    try { await query.refetch(); } finally { setIsManualRefreshing(false); }
  };

  const toggleSelected = (dayKey) => setSelectedKey((cur) => (cur === dayKey ? null : dayKey));

  if (isFirstLoad) {
    return (
      <div className="loading-veil-host" data-testid="my-assignments-loading">
        <LoadingSpinner variant="overlay" className="visible initial" text="Loading your assignments..." />
      </div>
    );
  }

  // Empty means no UPCOMING assignments; past ones may still sit below.
  const showEmpty = !isFirstLoad && upcoming.length === 0 && !isSilentRefreshing;
  const [featured, ...later] = upcoming;

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

      {featured && <FeaturedDay group={featured} selectedKey={selectedKey} onToggle={toggleSelected} />}

      {later.length > 0 && (
        <div className="ma-grid">
          {later.map((group) => (
            <DayCard key={group.key} group={group} selectedKey={selectedKey} onToggle={toggleSelected} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <section className="ma-past" data-testid="my-assignments-past">
          <button
            type="button"
            className="ma-past-toggle"
            aria-expanded={pastOpen}
            onClick={() => setPastOpen((open) => !open)}
          >
            <span className={`ma-past-chevron${pastOpen ? ' open' : ''}`} aria-hidden="true">▸</span>
            Past assignments
            <span className="ma-past-count">
              {past.length} day{past.length === 1 ? '' : 's'} · last {PAST_WINDOW_DAYS} days
            </span>
          </button>
          {pastOpen && (
            <div className="ma-grid">
              {past.map((group) => (
                <DayCard key={group.key} group={group} past selectedKey={selectedKey} onToggle={toggleSelected} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

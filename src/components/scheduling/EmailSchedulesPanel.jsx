// src/components/scheduling/EmailSchedulesPanel.jsx
//
// The send surface for per-person schedule emails. Recipients are the distinct
// tagged people in scope, each with an honest per-person status (sent / stale /
// not yet emailed). Placeholder chips have no address, so they are listed as
// skipped and never block the send — the people who DO have a schedule still
// get it. Two-step in-button confirmation per the app-wide standard; results
// render per recipient so one bad address is visible without hiding six good
// sends.
//
// SCOPE IS A DAY LIST, not a mode. This replaced two radio buttons ("this day"
// / "all days in this sheet"), which could not express the actual request — a
// Friday-and-Sunday send, with Saturday left out. Days are now a checkbox each
// in a persistent left rail, and the roster to the right is DERIVED from that
// selection, so the two can never disagree about who is being emailed.
//
// The rail sits beside the roster rather than above it deliberately: the panel
// is already 1120px wide, its roster grid already scrolls, and a real send
// covers 30+ people — spending horizontal space costs nothing here while extra
// vertical length pushes the footer off screen.
//
// Layout otherwise follows the app's modal convention (fixed header /
// scrolling body / fixed footer, as CategorySelectorModal).

import React, { useMemo, useState } from 'react';

function collectRecipients(days) {
  const byEmail = new Map();
  const placeholders = new Set();
  for (const day of days) {
    for (const key of Object.keys(day.cells || {})) {
      for (const seg of (day.cells[key].segments || [])) {
        if (seg.type !== 'person') continue;
        if (seg.placeholder) { placeholders.add(seg.name); continue; }
        if (!seg.email) { continue; }
        if (!byEmail.has(seg.email)) byEmail.set(seg.email, { email: seg.email, name: seg.name, count: 0 });
        byEmail.get(seg.email).count += 1;
      }
    }
  }
  return { recipients: [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name)), placeholders: [...placeholders] };
}

function statusFor(email, days) {
  let sentAt = null;
  let stale = false;
  for (const day of days) {
    const entry = (day.emailStatus || []).find((s) => s.email === email);
    if (entry && entry.sentAt) {
      if (!sentAt || entry.sentAt > sentAt) sentAt = entry.sentAt;
      if (entry.stale) stale = true;
    } else if ((day.taggedEmails || []).includes(email)) {
      // Tagged on a day with no send yet — the person is not fully covered.
      stale = stale || !!sentAt;
    }
  }
  if (!sentAt) return { label: 'not yet emailed', kind: 'none' };
  // Short enough to sit beside the assignment count on one line in a roster
  // card — a wrapping pill inflates the whole grid row it sits in.
  if (stale) return { label: 'changed since sent', kind: 'stale' };
  return { label: 'sent', kind: 'sent' };
}

/** 'Fri Sep 11' — short enough for a 266px rail row without wrapping. */
function shortDayLabel(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

/** Person-chip assignments on one day, for the rail's per-day count. */
function assignmentCount(day) {
  let n = 0;
  for (const key of Object.keys(day.cells || {})) {
    for (const seg of (day.cells[key].segments || [])) {
      if (seg.type === 'person') n += 1;
    }
  }
  return n;
}

export default function EmailSchedulesPanel({ sheet, activeDay, onSend, onClose }) {
  // Chronological once, here, so the rail, the dayIds sent, and the version
  // snapshot all present the same order the email body will.
  const allDays = useMemo(
    () => [...(sheet.days || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
    [sheet.days]
  );

  // Defaults to the day being viewed — the same scope the old panel opened on,
  // so the common single-day send is still one click.
  const [selectedDayIds, setSelectedDayIds] = useState(() => [String(activeDay._id)]);
  // Both attachments default ON and are independent decisions. An attachment
  // nobody remembers to tick is worth nothing; and a sender who hits a mail
  // client that mishandles one needs a lever that is not a deploy.
  const [includePdf, setIncludePdf] = useState(true);
  const [includeCalendar, setIncludeCalendar] = useState(true);
  const [checked, setChecked] = useState(null); // null = all eligible
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const scopeDays = useMemo(
    () => allDays.filter((d) => selectedDayIds.includes(String(d._id))),
    [allDays, selectedDayIds]
  );
  const { recipients, placeholders } = useMemo(() => collectRecipients(scopeDays), [scopeDays]);

  // Every control cancels a pending confirmation: the armed button described a
  // send that no longer matches what is on screen.
  const disarm = () => setConfirming(false);

  const applyDays = (nextIds) => {
    const wanted = new Set(nextIds.map(String));
    setSelectedDayIds(allDays.filter((d) => wanted.has(String(d._id))).map((d) => String(d._id)));
    // A different day selection means a different roster, so a recipient
    // exclusion made against the OLD roster no longer refers to the same set.
    // Reset to all eligible rather than carry a stale deselection invisibly.
    setChecked(null);
    disarm();
  };

  const toggleDay = (id) => {
    const key = String(id);
    applyDays(selectedDayIds.includes(key) ? selectedDayIds.filter((x) => x !== key) : [...selectedDayIds, key]);
  };

  const isChecked = (email) => (checked ? checked.has(email) : true);
  const toggle = (email) => {
    setChecked((prev) => {
      const next = new Set(prev || recipients.map((r) => r.email));
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
    disarm();
  };

  const selectedEmails = recipients.map((r) => r.email).filter(isChecked);
  const totalAssignments = recipients.reduce((sum, r) => sum + r.count, 0);
  const canSend = selectedDayIds.length > 0 && selectedEmails.length > 0;

  const send = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSending(true);
    setError(null);
    try {
      const body = {
        dayIds: selectedDayIds,
        // One entry per selected day. The server refuses a partial map, because
        // a missing entry is a new-client bug rather than an old client, and it
        // 409s on any drift before a single message goes out.
        expectedDayVersions: Object.fromEntries(scopeDays.map((d) => [String(d._id), d._version])),
        ...(checked ? { recipients: selectedEmails } : {}),
        includePdf,
        includeCalendar,
      };
      const outcome = await onSend(body);
      setResults(outcome);
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  const scopeSummary = scopeDays.length === 1
    ? (scopeDays[0].title || shortDayLabel(scopeDays[0].date))
    : `${scopeDays.length} days`;

  return (
    <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ss-email-panel" role="dialog" aria-label="Email schedules" data-testid="email-schedules-panel">
        <header className="ss-email-header">
          <div className="ss-email-heading">
            <h3>Email Schedules</h3>
            <p className="ss-email-subtitle">
              {sheet.name}
              {!results && (
                <>
                  {' '}&middot; {scopeDays.length ? scopeSummary : 'no days selected'}
                  {' '}&middot; {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
                  {' '}&middot; {totalAssignments} assignment{totalAssignments === 1 ? '' : 's'}
                </>
              )}
            </p>
          </div>
          <button type="button" className="ss-email-close" onClick={onClose} aria-label="Close">&times;</button>
        </header>

        {!results && (
          <>
            <div className="ss-email-split">
              <aside className="ss-day-rail">
                <div className="ss-rail-head">
                  <span className="ss-rail-title">Days</span>
                  <span className="ss-rail-quick">
                    <button
                      type="button"
                      className="ss-email-linkbtn"
                      data-testid="days-this"
                      onClick={() => applyDays([String(activeDay._id)])}
                    >
                      This day
                    </button>
                    <button
                      type="button"
                      className="ss-email-linkbtn"
                      data-testid="days-all"
                      onClick={() => applyDays(allDays.map((d) => String(d._id)))}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="ss-email-linkbtn"
                      data-testid="days-none"
                      onClick={() => applyDays([])}
                    >
                      None
                    </button>
                  </span>
                </div>

                <ul className="ss-day-list">
                  {allDays.map((day) => {
                    const id = String(day._id);
                    const on = selectedDayIds.includes(id);
                    return (
                      <li key={id}>
                        <label className={`ss-day-row ${on ? 'ss-day-on' : ''} ${id === String(activeDay._id) ? 'ss-day-active' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            data-testid={`day-option-${id}`}
                            onChange={() => toggleDay(id)}
                          />
                          <span className="ss-day-txt">
                            <span className="ss-day-when">{shortDayLabel(day.date)}</span>
                            {day.title && <span className="ss-day-what">{day.title}</span>}
                          </span>
                          <span className="ss-day-badge">{assignmentCount(day)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                <div className="ss-rail-foot">
                  {selectedDayIds.length
                    ? `${selectedDayIds.length} of ${allDays.length} day${allDays.length === 1 ? '' : 's'} selected`
                    : 'Select at least one day.'}
                </div>
              </aside>

              <div className="ss-email-main">
                <div className="ss-email-toolbar">
                  <span data-testid="selection-count">
                    <strong>{selectedEmails.length}</strong> of {recipients.length} selected
                  </span>
                  <span className="ss-email-toolbar-actions">
                    <button
                      type="button"
                      className="ss-email-linkbtn"
                      onClick={() => { setChecked(null); disarm(); }}
                      disabled={selectedEmails.length === recipients.length}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="ss-email-linkbtn"
                      onClick={() => { setChecked(new Set()); disarm(); }}
                      disabled={selectedEmails.length === 0}
                    >
                      Clear
                    </button>
                  </span>
                </div>

                <ul className="ss-email-recipients">
                  {recipients.map((r) => {
                    const status = statusFor(r.email, scopeDays);
                    const on = isChecked(r.email);
                    return (
                      <li key={r.email} className={on ? '' : 'ss-recipient-off'} data-testid={`recipient-${r.email}`}>
                        <label>
                          <input
                            type="checkbox"
                            checked={on}
                            data-testid={`recipient-toggle-${r.email}`}
                            onChange={() => toggle(r.email)}
                          />
                          <span className="ss-recipient-text">
                            <span className="ss-recipient-name">{r.name}</span>
                            <span className="ss-recipient-sub" title={r.email}>{r.email}</span>
                            <span className="ss-recipient-meta">
                              <span className="ss-recipient-count">{r.count} assignment{r.count === 1 ? '' : 's'}</span>
                              <span className={`ss-recipient-status ss-status-${status.kind}`} data-testid={`status-${r.email}`}>
                                {status.label}
                              </span>
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {placeholders.map((name) => (
                    <li key={name} className="ss-recipient-placeholder" data-testid={`placeholder-${name}`}>
                      <span className="ss-recipient-text">
                        <span className="ss-recipient-name">{name}</span>
                        <span className="ss-recipient-sub">no email &middot; unassigned placeholder</span>
                      </span>
                    </li>
                  ))}
                </ul>

                {!selectedDayIds.length && (
                  <div className="ss-email-error" data-testid="no-days-note">
                    No days selected. Choose at least one day to see who would be emailed.
                  </div>
                )}

                {placeholders.length > 0 && (
                  <div className="ss-email-note" data-testid="placeholder-note">
                    <strong>{placeholders.length}</strong> unassigned placeholder{placeholders.length === 1 ? '' : 's'} on the
                    selected day{selectedDayIds.length === 1 ? '' : 's'} ha{placeholders.length === 1 ? 's' : 've'} no email
                    address and will be skipped:
                    {' '}{placeholders.join(', ')}.
                  </div>
                )}

                {includePdf && selectedDayIds.length > 0 && (
                  <div className="ss-email-note ss-email-note-info" data-testid="pdf-scope-note">
                    The PDF carries the <strong>full shared grid</strong> for the selected
                    day{selectedDayIds.length === 1 ? '' : 's'}; each email body and calendar file carries only
                    <strong> that person&rsquo;s own</strong> assignments in the same scope.
                  </div>
                )}

                {error && <div className="ss-email-error" data-testid="send-error">{error}</div>}
              </div>
            </div>

            <footer className="ss-email-footer">
              <span className="ss-email-footnote">
                <label className="ss-email-attach-toggle">
                  <input
                    type="checkbox"
                    data-testid="include-pdf"
                    checked={includePdf}
                    onChange={(e) => { setIncludePdf(e.target.checked); disarm(); }}
                  />
                  Attach the schedule PDF for the selected days
                </label>
                <label className="ss-email-attach-toggle">
                  <input
                    type="checkbox"
                    data-testid="include-calendar"
                    checked={includeCalendar}
                    onChange={(e) => { setIncludeCalendar(e.target.checked); disarm(); }}
                  />
                  Attach a calendar file (.ics) of each person&rsquo;s own shifts
                </label>
                Each person gets one email covering all their cells in the selected days.
              </span>
              <div className="ss-editor-actions">
                <button type="button" className="ss-ghost-btn" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  className={`ss-primary-btn ${confirming ? 'ss-confirm' : ''}`}
                  data-testid="send-schedules-button"
                  disabled={sending || !canSend}
                  onClick={send}
                >
                  {sending ? 'Sending…' : confirming ? 'Confirm send?' : `Email ${selectedEmails.length} ${selectedEmails.length === 1 ? 'person' : 'people'}`}
                </button>
              </div>
            </footer>
          </>
        )}

        {results && (
          <>
            <div className="ss-email-body ss-email-results" data-testid="send-results">
              <p className="ss-email-results-summary">
                <strong>{results.sent}</strong> sent
                {results.failed > 0 && <> &middot; <strong className="ss-failed">{results.failed} failed</strong></>}
                {results.skipped > 0 && <> &middot; {results.skipped} not sent (delivery is off)</>}
                {results.skippedPlaceholders && results.skippedPlaceholders.length > 0 && (
                  <> &middot; {results.skippedPlaceholders.length} placeholder{results.skippedPlaceholders.length === 1 ? '' : 's'} skipped</>
                )}
              </p>
              {results.sent > 0 && (
                <p className="ss-email-results-attachment" data-testid="attachment-note">
                  {results.attached
                    ? 'The full schedule PDF was attached to every email.'
                    : 'Sent without the schedule PDF attachment.'}
                  {results.calendarAttached && ' Each person also got a calendar file of their own shifts.'}
                </p>
              )}
              <ul>
                {(results.results || []).map((r) => (
                  <li
                    key={r.email}
                    className={r.success ? 'ss-result-ok' : (r.skipped ? 'ss-result-skipped' : 'ss-result-fail')}
                    data-testid={`result-${r.email}`}
                  >
                    <span className="ss-result-email" title={r.email}>{r.email}</span>
                    <span className="ss-result-outcome">
                      {r.success ? 'Sent ✓' : (r.skipped ? 'Not sent — delivery off' : `Failed — ${r.error}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="ss-email-footer">
              <span className="ss-email-footnote" />
              <div className="ss-editor-actions">
                <button type="button" className="ss-primary-btn" onClick={onClose}>Done</button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// src/components/scheduling/EmailSchedulesPanel.jsx
//
// The send surface for per-person schedule emails. Day- or workbook-scoped;
// recipients are the distinct tagged people in scope, each with an honest
// per-person status (sent / stale / not yet emailed). Placeholder chips have
// no address, so they are listed as skipped and never block the send — the
// people who DO have a schedule still get it. Two-step in-button confirmation
// per the app-wide standard; results render per recipient so one bad address
// is visible without hiding six good sends.
//
// Layout follows the app's modal convention (fixed header / scrolling body /
// fixed footer, as CategorySelectorModal): a real send covers 30+ people, so
// the roster is a responsive CARD GRID, not one full-width row per address —
// the whole selection has to be scannable without scrolling past the footer.

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

export default function EmailSchedulesPanel({ sheet, activeDay, onSend, onClose }) {
  const [scope, setScope] = useState('day'); // 'day' | 'sheet'
  const [checked, setChecked] = useState(null); // null = all
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const scopeDays = useMemo(
    () => (scope === 'day' ? [activeDay] : sheet.days || []),
    [scope, activeDay, sheet.days]
  );
  const { recipients, placeholders } = useMemo(() => collectRecipients(scopeDays), [scopeDays]);

  const isChecked = (email) => (checked ? checked.has(email) : true);
  const toggle = (email) => {
    setChecked((prev) => {
      const next = new Set(prev || recipients.map((r) => r.email));
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const selectedEmails = recipients.map((r) => r.email).filter(isChecked);
  const totalAssignments = recipients.reduce((sum, r) => sum + r.count, 0);
  const scopeLabel = scope === 'day' ? (activeDay.title || activeDay.date) : sheet.name;

  const send = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSending(true);
    setError(null);
    try {
      const body = {
        ...(scope === 'day' ? { dayId: activeDay._id } : { wholeSheet: true }),
        ...(checked ? { recipients: selectedEmails } : {}),
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

  return (
    <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ss-email-panel" role="dialog" aria-label="Email schedules" data-testid="email-schedules-panel">
        <header className="ss-email-header">
          <div className="ss-email-heading">
            <h3>Email Schedules</h3>
            <p className="ss-email-subtitle">
              {scopeLabel}
              {!results && (
                <>
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
            <div className="ss-email-body">
              <div className="ss-email-scope" role="radiogroup" aria-label="Send scope">
                <label className={`ss-scope-opt ${scope === 'day' ? 'ss-scope-on' : ''}`}>
                  <input type="radio" name="ss-scope" checked={scope === 'day'} onChange={() => { setScope('day'); setChecked(null); }} />
                  <span className="ss-scope-text">
                    <span className="ss-scope-title">This day only</span>
                    <span className="ss-scope-sub">{activeDay.title || activeDay.date}</span>
                  </span>
                </label>
                <label className={`ss-scope-opt ${scope === 'sheet' ? 'ss-scope-on' : ''}`}>
                  <input type="radio" name="ss-scope" checked={scope === 'sheet'} onChange={() => { setScope('sheet'); setChecked(null); }} />
                  <span className="ss-scope-text">
                    <span className="ss-scope-title">All days in this sheet</span>
                    <span className="ss-scope-sub">One email per person covering everything</span>
                  </span>
                </label>
              </div>

              <div className="ss-email-toolbar">
                <span data-testid="selection-count">
                  <strong>{selectedEmails.length}</strong> of {recipients.length} selected
                </span>
                <span className="ss-email-toolbar-actions">
                  <button
                    type="button"
                    className="ss-email-linkbtn"
                    onClick={() => setChecked(null)}
                    disabled={selectedEmails.length === recipients.length}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="ss-email-linkbtn"
                    onClick={() => setChecked(new Set())}
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
                        <input type="checkbox" checked={on} onChange={() => toggle(r.email)} />
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

              {placeholders.length > 0 && (
                <div className="ss-email-note" data-testid="placeholder-note">
                  <strong>{placeholders.length}</strong> unassigned placeholder{placeholders.length === 1 ? '' : 's'} on this
                  {scope === 'day' ? ' day' : ' sheet'} ha{placeholders.length === 1 ? 's' : 've'} no email address and will be skipped:
                  {' '}{placeholders.join(', ')}.
                </div>
              )}

              {error && <div className="ss-email-error" data-testid="send-error">{error}</div>}
            </div>

            <footer className="ss-email-footer">
              <span className="ss-email-footnote">Each person gets one email covering all their cells in scope.</span>
              <div className="ss-editor-actions">
                <button type="button" className="ss-ghost-btn" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  className={`ss-primary-btn ${confirming ? 'ss-confirm' : ''}`}
                  data-testid="send-schedules-button"
                  disabled={sending || selectedEmails.length === 0}
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
                {results.skippedPlaceholders && results.skippedPlaceholders.length > 0 && (
                  <> &middot; {results.skippedPlaceholders.length} placeholder{results.skippedPlaceholders.length === 1 ? '' : 's'} skipped</>
                )}
              </p>
              <ul>
                {(results.results || []).map((r) => (
                  <li key={r.email} className={r.success ? 'ss-result-ok' : 'ss-result-fail'} data-testid={`result-${r.email}`}>
                    <span className="ss-result-email" title={r.email}>{r.email}</span>
                    <span className="ss-result-outcome">{r.success ? 'Sent ✓' : `Failed — ${r.error}`}</span>
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

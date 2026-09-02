// src/components/scheduling/EmailSchedulesPanel.jsx
//
// The send surface for per-person schedule emails. Day- or workbook-scoped;
// recipients are the distinct tagged people in scope, each with an honest
// per-person status (sent / stale / not yet emailed). Placeholder chips
// HARD-BLOCK the send (a roster being emailed with unassigned posts is
// exactly what the block catches); only an admin can override, and the
// override plainly says placeholders are skipped, not silently dropped.
// Two-step in-button confirmation per the app-wide standard; results render
// per recipient so one bad address is visible without hiding six good sends.

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
  if (stale) return { label: 'emailed, but changed since', kind: 'stale' };
  return { label: 'sent', kind: 'sent' };
}

export default function EmailSchedulesPanel({ sheet, activeDay, isAdmin, onSend, onClose }) {
  const [scope, setScope] = useState('day'); // 'day' | 'sheet'
  const [checked, setChecked] = useState(null); // null = all
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [allowPlaceholders, setAllowPlaceholders] = useState(false);

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
  const blocked = placeholders.length > 0 && !(isAdmin && allowPlaceholders);

  const send = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSending(true);
    setError(null);
    try {
      const body = {
        ...(scope === 'day' ? { dayId: activeDay._id } : { wholeSheet: true }),
        ...(checked ? { recipients: selectedEmails } : {}),
        ...(isAdmin && allowPlaceholders ? { allowPlaceholders: true } : {}),
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
        <h3>
          Email Schedules &middot; {scope === 'day' ? (activeDay.title || activeDay.date) : sheet.name}
        </h3>

        {!results && (
          <>
            <div className="ss-email-scope">
              <label>
                <input type="radio" name="ss-scope" checked={scope === 'day'} onChange={() => { setScope('day'); setChecked(null); }} />
                This day only
              </label>
              <label>
                <input type="radio" name="ss-scope" checked={scope === 'sheet'} onChange={() => { setScope('sheet'); setChecked(null); }} />
                All days in this sheet (one email per person covering everything)
              </label>
            </div>

            <ul className="ss-email-recipients">
              {recipients.map((r) => {
                const status = statusFor(r.email, scopeDays);
                return (
                  <li key={r.email} data-testid={`recipient-${r.email}`}>
                    <label>
                      <input type="checkbox" checked={isChecked(r.email)} onChange={() => toggle(r.email)} />
                      <span className="ss-recipient-name">{r.name}</span>
                      <span className="ss-recipient-sub">{r.email} &middot; {r.count} assignment{r.count === 1 ? '' : 's'}</span>
                    </label>
                    <span className={`ss-recipient-status ss-status-${status.kind}`} data-testid={`status-${r.email}`}>
                      {status.label}
                    </span>
                  </li>
                );
              })}
              {placeholders.map((name) => (
                <li key={name} className="ss-recipient-placeholder" data-testid={`placeholder-${name}`}>
                  <span className="ss-recipient-name">{name}</span>
                  <span className="ss-recipient-sub">no email &middot; unassigned placeholder</span>
                </li>
              ))}
            </ul>

            {placeholders.length > 0 && (
              <div className="ss-email-block" data-testid="placeholder-block">
                <strong>{placeholders.length}</strong> unassigned placeholder{placeholders.length === 1 ? '' : 's'} remain{placeholders.length === 1 ? 's' : ''} on this
                {scope === 'day' ? ' day' : ' sheet'}. Sending is blocked until every post has a real person.
                {isAdmin && (
                  <label className="ss-email-override">
                    <input
                      type="checkbox"
                      checked={allowPlaceholders}
                      onChange={(e) => setAllowPlaceholders(e.target.checked)}
                      data-testid="allow-placeholders"
                    />
                    Send anyway (admin) &mdash; placeholders are skipped
                  </label>
                )}
              </div>
            )}

            {error && <div className="ss-email-error" data-testid="send-error">{error}</div>}

            <div className="ss-editor-actions">
              <button type="button" className="ss-ghost-btn" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className={`ss-primary-btn ${confirming ? 'ss-confirm' : ''}`}
                data-testid="send-schedules-button"
                disabled={sending || blocked || selectedEmails.length === 0}
                onClick={send}
              >
                {sending ? 'Sending…' : confirming ? 'Confirm send?' : `Email ${selectedEmails.length} ${selectedEmails.length === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          </>
        )}

        {results && (
          <div className="ss-email-results" data-testid="send-results">
            <p>
              <strong>{results.sent}</strong> sent
              {results.failed > 0 && <> &middot; <strong className="ss-failed">{results.failed} failed</strong></>}
              {results.skippedPlaceholders && results.skippedPlaceholders.length > 0 && (
                <> &middot; {results.skippedPlaceholders.length} placeholder{results.skippedPlaceholders.length === 1 ? '' : 's'} skipped</>
              )}
            </p>
            <ul>
              {(results.results || []).map((r) => (
                <li key={r.email} className={r.success ? 'ss-result-ok' : 'ss-result-fail'} data-testid={`result-${r.email}`}>
                  <span>{r.email}</span>
                  <span>{r.success ? 'Sent ✓' : `Failed — ${r.error}`}</span>
                </li>
              ))}
            </ul>
            <div className="ss-editor-actions">
              <button type="button" className="ss-primary-btn" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

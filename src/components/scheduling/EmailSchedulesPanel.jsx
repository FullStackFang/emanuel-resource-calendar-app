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
import { buildAssignmentSubject } from './assignmentSubject';
import EmailTemplateEditor from '../shared/EmailTemplateEditor';
import { logger } from '../../utils/logger';

// What a failed row SAYS, keyed on the server's reason code. The raw Graph
// text is console material (see handleSend); a row that printed the payload
// was a wall of red JSON that also crushed the address to an ellipsis.
const FAILURE_TEXT = {
  throttled: 'Mail server was too busy',
  rejected: 'Address rejected by the mail server',
  unavailable: 'Mail server unreachable',
  unknown: 'Send failed',
};
// The same reasons as a summary fragment: 'mail server too busy (24)'.
const FAILURE_SUMMARY_TEXT = {
  throttled: 'mail server too busy',
  rejected: 'address rejected',
  unavailable: 'mail server unreachable',
  unknown: 'send failed',
};

const failureText = (r) => FAILURE_TEXT[r.reason] || FAILURE_TEXT.unknown;

/** 'mail server too busy (24), address rejected (1)' in a stable order. */
function summarizeFailures(rows) {
  const counts = new Map();
  for (const r of rows) {
    const key = FAILURE_SUMMARY_TEXT[r.reason] ? r.reason : 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.keys(FAILURE_SUMMARY_TEXT)
    .filter((k) => counts.has(k))
    .map((k) => `${FAILURE_SUMMARY_TEXT[k]} (${counts.get(k)})`)
    .join(', ');
}

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

export default function EmailSchedulesPanel({
  sheet,
  activeDay,
  onSend,
  onClose,
  // Message / preview (openspec/changes/schedule-email-template-editing).
  apiToken,
  canEditTemplate = false,
  onLoadTemplate,
  onTemplateSaved,
  onPreview,
  onTestSend,
}) {
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
  // null = follow the computed default. Same "null means follow" shape as
  // SchedulingAssistant's seriesViewDate: it lets the subject track the day
  // selection until somebody types, and stop tracking it the moment they do.
  const [customSubject, setCustomSubject] = useState(null);
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

  // The subject the sender would get if they never touched the field. Recomputed
  // as the day selection changes, so a subset send is never mistaken for any
  // other send from this workbook.
  const defaultSubject = useMemo(
    () => buildAssignmentSubject({
      // Resolved server-side, so a subject customized in Email Management is
      // honoured here rather than re-guessed.
      subjectTemplate: sheet.assignmentEmailSubject,
      sheetName: sheet.name,
      allDays,
      selectedDayIds,
    }),
    [sheet.assignmentEmailSubject, sheet.name, allDays, selectedDayIds]
  );
  const subject = customSubject === null ? defaultSubject : customSubject;

  const selectedEmails = recipients.map((r) => r.email).filter(isChecked);
  const failedRows = ((results && results.results) || []).filter((r) => !r.success && !r.skipped);

  // Back to the form with ONLY the people who failed selected, so recovering
  // from a partial send is one click rather than a hunt through the roster.
  const retryFailed = () => {
    setChecked(new Set(failedRows.map((r) => r.email)));
    setResults(null);
    setError(null);
    disarm();
  };
  const totalAssignments = recipients.reduce((sum, r) => sum + r.count, 0);

  // ── Message: the ONE shared 'assignment-schedule' template ────────────────
  // Read-only for every sender; editable in place for template editors. A save
  // writes the same override Email Management edits — never a per-send draft.
  const [messageOpen, setMessageOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  // Shown until the sheet refetch brings the saved body back from the server.
  const [savedBody, setSavedBody] = useState(null);
  const messageBody = savedBody ?? sheet.assignmentEmailBody ?? '';

  const startEditing = async () => {
    setLoadingTemplate(true);
    setError(null);
    try {
      setEditingTemplate(await onLoadTemplate());
    } catch (e) {
      setError(e.message || 'Could not load the email template');
    } finally {
      setLoadingTemplate(false);
    }
  };
  const stopEditing = () => {
    // The editor reports dirty on change, not on unmount.
    setEditingTemplate(null);
    setTemplateDirty(false);
  };
  const handleTemplateSaved = (template) => {
    // Stay in the editor, remounted clean on the saved version.
    setEditingTemplate(template);
    setTemplateDirty(false);
    setSavedBody(template.body);
    onTemplateSaved?.(template);
  };

  // ── Preview: the exact email one selected person would receive ───────────
  const [previewChoice, setPreviewChoice] = useState(null); // null = first selected
  const previewEmail = previewChoice && selectedEmails.includes(previewChoice) ? previewChoice : (selectedEmails[0] || '');
  const previewRequest = { dayIds: selectedDayIds, subject: subject.trim(), recipientEmail: previewEmail };
  // A preview or test-send result belongs to exactly one request (days, subject,
  // person, stored body). Anything else on screen would describe an email that
  // is no longer the one being sent, so it is keyed and hidden on mismatch.
  const previewKey = JSON.stringify([previewRequest, messageBody]);
  const [preview, setPreview] = useState(null); // { key, html, recipientName }
  const [previewing, setPreviewing] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testSendStatus, setTestSendStatus] = useState(null); // { key, kind, text }
  const canPreview = !!previewEmail && selectedDayIds.length > 0 && subject.trim().length > 0 && !templateDirty;

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const result = await onPreview(previewRequest);
      setPreview({ key: previewKey, html: result.html, recipientName: result.recipientName });
    } catch (e) {
      setError(e.message || 'Could not preview the email');
    } finally {
      setPreviewing(false);
    }
  };

  const runTestSend = async () => {
    setTestSending(true);
    setError(null);
    try {
      const outcome = await onTestSend({ ...previewRequest, includeCalendar, includePdf });
      setTestSendStatus(
        outcome && outcome.skipped
          ? { key: previewKey, kind: 'warn', text: 'Email delivery is turned off, so the preview was not sent.' }
          : { key: previewKey, kind: 'ok', text: `Preview sent to ${(outcome && outcome.to) || 'you'}.` }
      );
    } catch (e) {
      setTestSendStatus({ key: previewKey, kind: 'error', text: `Could not send the preview: ${e.message || 'send failed'}` });
    } finally {
      setTestSending(false);
    }
  };

  const shownPreview = preview && preview.key === previewKey ? preview : null;
  const shownTestStatus = testSendStatus && testSendStatus.key === previewKey ? testSendStatus : null;

  // Whitespace is not a subject, and an empty header is worse than not sending.
  // Unsaved template edits block too: sends use the STORED template, so the
  // text on screen would not be the text anybody receives.
  const canSend = selectedDayIds.length > 0 && selectedEmails.length > 0 && subject.trim().length > 0 && !templateDirty;

  const send = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSending(true);
    setError(null);
    try {
      const body = {
        dayIds: selectedDayIds,
        // Always explicit, so what the sender read on screen is what goes out.
        // The server falls back to its own default only for a client that sends
        // no subject at all.
        subject: subject.trim(),
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
      // One console entry per send, not one per row: the raw server text for
      // every failure, for the day somebody needs to send it to support.
      const failedRows = ((outcome && outcome.results) || []).filter((r) => !r.success && !r.skipped);
      if (failedRows.length) {
        logger.warn('Schedule emails that failed to send:', failedRows.map((r) => ({ email: r.email, reason: r.reason, error: r.error })));
      }
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
                <div className="ss-email-subject">
                  <label className="ss-subject-label" htmlFor="ss-email-subject-input">
                    Subject
                    {customSubject !== null && (
                      <button
                        type="button"
                        className="ss-email-linkbtn"
                        data-testid="subject-reset"
                        onClick={() => { setCustomSubject(null); disarm(); }}
                      >
                        Reset to default
                      </button>
                    )}
                  </label>
                  <input
                    id="ss-email-subject-input"
                    type="text"
                    className="ss-subject-input"
                    data-testid="email-subject-input"
                    value={subject}
                    maxLength={200}
                    onChange={(e) => { setCustomSubject(e.target.value); disarm(); }}
                    placeholder="Subject line for this send"
                  />
                  <span className="ss-subject-hint">
                    Everyone in this send gets this subject. It follows the days you pick until
                    you edit it.
                  </span>
                </div>

                <section className="ss-email-message">
                  <div className="ss-email-section-head">
                    <button
                      type="button"
                      className="ss-email-disclosure"
                      data-testid="message-toggle"
                      aria-expanded={messageOpen}
                      onClick={() => setMessageOpen((o) => !o)}
                    >
                      <span aria-hidden="true">{messageOpen ? '▾' : '▸'}</span> Message
                    </button>
                    {messageOpen && canEditTemplate && !editingTemplate && (
                      <button
                        type="button"
                        className="ss-email-linkbtn"
                        data-testid="message-edit"
                        onClick={startEditing}
                        disabled={loadingTemplate}
                      >
                        {loadingTemplate ? 'Loading…' : 'Edit message'}
                      </button>
                    )}
                    {messageOpen && editingTemplate && (
                      <button type="button" className="ss-email-linkbtn" data-testid="message-discard" onClick={stopEditing}>
                        {templateDirty ? 'Discard changes' : 'Close editor'}
                      </button>
                    )}
                  </div>
                  {messageOpen && (
                    <>
                      <p className="ss-subject-hint">
                        {editingTemplate
                          ? 'This message is shared: saving changes every future schedule email, and Email Management shows the same text. Each person’s own schedule fills in {{assignmentsTable}}.'
                          : 'The text every recipient gets around their own schedule.'}
                      </p>
                      {editingTemplate ? (
                        <EmailTemplateEditor
                          key={editingTemplate.updatedAt || 'default'}
                          apiToken={apiToken}
                          template={editingTemplate}
                          showSubject={false}
                          showHeader={false}
                          onDirtyChange={setTemplateDirty}
                          onSaved={handleTemplateSaved}
                        />
                      ) : (
                        <EmailTemplateEditor
                          readOnly
                          template={{ id: 'assignment-schedule', subject: '', body: messageBody }}
                        />
                      )}
                    </>
                  )}
                </section>

                <section className="ss-email-preview">
                  <div className="ss-email-preview-row">
                    <label className="ss-subject-label" htmlFor="ss-preview-recipient">Preview as</label>
                    <select
                      id="ss-preview-recipient"
                      className="ss-preview-select"
                      data-testid="preview-recipient"
                      value={previewEmail}
                      onChange={(e) => setPreviewChoice(e.target.value)}
                      disabled={!selectedEmails.length}
                    >
                      {recipients.filter((r) => isChecked(r.email)).map((r) => (
                        <option key={r.email} value={r.email}>{r.name} ({r.email})</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ss-ghost-btn"
                      data-testid="preview-button"
                      onClick={runPreview}
                      disabled={!canPreview || previewing}
                    >
                      {previewing ? 'Rendering…' : 'Preview'}
                    </button>
                    <button
                      type="button"
                      className="ss-ghost-btn"
                      data-testid="test-send-button"
                      onClick={runTestSend}
                      disabled={!canPreview || testSending}
                      title="Sends this person's email, with the chosen attachments, to your own address only"
                    >
                      {testSending ? 'Sending…' : 'Send preview to me'}
                    </button>
                  </div>
                  {shownTestStatus && (
                    <div
                      className={`ss-email-note ${shownTestStatus.kind === 'ok' ? 'ss-email-note-info' : ''}`}
                      data-testid="test-send-status"
                      role="status"
                    >
                      {shownTestStatus.text}
                    </div>
                  )}
                  {shownPreview && (
                    <iframe
                      className="ss-preview-frame"
                      title={`Preview of the email to ${shownPreview.recipientName || previewEmail}`}
                      sandbox=""
                      srcDoc={shownPreview.html}
                    />
                  )}
                </section>

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

                {templateDirty && (
                  <div className="ss-email-error" data-testid="template-dirty-note">
                    Save or discard your template changes first.
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
                {results.failed > 0 && (
                  <> &middot; <strong className="ss-failed">{results.failed} failed</strong>
                    {failedRows.length > 0 && (
                      <span className="ss-failure-summary" data-testid="failure-summary"> &mdash; {summarizeFailures(failedRows)}</span>
                    )}
                  </>
                )}
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
                      {r.success ? 'Sent ✓' : (r.skipped ? 'Not sent — delivery off' : `Failed — ${failureText(r)}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="ss-email-footer">
              <span className="ss-email-footnote" />
              <div className="ss-editor-actions">
                {failedRows.length > 0 && (
                  <button type="button" className="ss-ghost-btn" onClick={retryFailed} data-testid="retry-failed-button">
                    Try again for the {failedRows.length} who failed
                  </button>
                )}
                <button type="button" className="ss-primary-btn" onClick={onClose}>Done</button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

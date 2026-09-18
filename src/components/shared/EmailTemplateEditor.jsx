// src/components/shared/EmailTemplateEditor.jsx
//
// The ONE email template editor, shared by Email Management and the Email
// Schedules panel (openspec/changes/schedule-email-template-editing, D4) so
// the two can never drift in toolbar, variables, reset or save semantics.
//
// Saves send `expectedUpdatedAt` (D9): a 409 TEMPLATE_CHANGED keeps the
// user's unsaved text and offers to load the newer version instead of
// overwriting it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { useNotification } from '../../context/NotificationContext';
import APP_CONFIG from '../../config/config';
import { logger } from '../../utils/logger';
import './EmailTemplateEditor.css';

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['link'],
    ['clean']
  ]
};

const QUILL_FORMATS = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'color', 'background',
  'list', 'bullet',
  'align',
  'link'
];

/**
 * @param {object}   props
 * @param {string}   props.apiToken
 * @param {object}   props.template      { id, name?, description?, subject, body, variables?, isCustomized?, updatedAt?, updatedBy? }
 * @param {boolean}  [props.readOnly]    show the message only, no controls
 * @param {boolean}  [props.showSubject=true] false keeps the stored subject (the panel's subject is per-send)
 * @param {object}   [props.draft]       { subject, body } to resume from
 * @param {Function} [props.onDraftChange] (draft|null) on every edit; null when clean
 * @param {Function} [props.onDirtyChange] (bool)
 * @param {Function} [props.onSaved]     (template) after save, reset, or loading a newer version
 * @param {Function} [props.onBusyChange] (bool) while saving / previewing
 * @param {Function} [props.loadPreview] ({subject, body}) => Promise<html>; adds a Preview tab
 * @param {boolean}  [props.showHeader=true] name and description (last-updated always shows)
 */
export default function EmailTemplateEditor({
  apiToken,
  template,
  readOnly = false,
  showSubject = true,
  draft = null,
  onDraftChange,
  onDirtyChange,
  onSaved,
  onBusyChange,
  loadPreview,
  showHeader = true
}) {
  const { showSuccess, showError } = useNotification();
  const [subject, setSubject] = useState(draft?.subject ?? template.subject);
  const [body, setBody] = useState(draft?.body ?? template.body);
  // Only USER edits count toward dirty. ReactQuill may re-emit a normalized
  // body on mount (it strips inline styles); counting that would make the
  // panel's editor "dirty" — and block sending — just by opening it.
  const [touched, setTouched] = useState(!!draft);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'save' | 'reset' | null
  const [conflict, setConflict] = useState(null); // current version from a 409
  const [view, setView] = useState('template');
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const dirty = touched && (subject !== template.subject || body !== template.body);

  // Ref-held callbacks: parents pass inline arrows, and these must not re-run
  // the reporting effects on every parent render.
  const callbacks = useRef({ onDirtyChange, onDraftChange, onBusyChange });
  useEffect(() => { callbacks.current = { onDirtyChange, onDraftChange, onBusyChange }; });

  useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty]);
  useEffect(() => {
    if (!touched) return;
    callbacks.current.onDraftChange?.(dirty ? { subject, body } : null);
  }, [touched, dirty, subject, body]);
  useEffect(() => { callbacks.current.onBusyChange?.(saving || previewLoading); }, [saving, previewLoading]);

  const baseUrl = `${APP_CONFIG.API_BASE_URL}/admin/email/templates/${template.id}`;
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${apiToken}` }), [apiToken]);

  const edit = (setter) => (value) => {
    setter(value);
    setTouched(true);
    setPreviewHtml(null);
    setConfirmAction(null);
  };

  const readJson = async (response) => {
    try { return await response.json(); } catch { return {}; }
  };

  const handleSave = async () => {
    if (confirmAction !== 'save') { setConfirmAction('save'); return; }
    setConfirmAction(null);
    setSaving(true);
    try {
      const response = await fetch(baseUrl, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, expectedUpdatedAt: template.updatedAt ?? null })
      });
      const result = await readJson(response);
      if (response.status === 409 && result.code === 'TEMPLATE_CHANGED') {
        setConflict(result.current || {});
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Failed to save template');
      setConflict(null);
      showSuccess('Template saved');
      onSaved?.(result.template);
    } catch (err) {
      logger.error('Error saving template:', err);
      showError(err, { context: 'EmailTemplateEditor.save' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (confirmAction !== 'reset') { setConfirmAction('reset'); return; }
    setConfirmAction(null);
    setSaving(true);
    try {
      const response = await fetch(`${baseUrl}/reset`, { method: 'POST', headers: authHeaders });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || 'Failed to reset template');
      showSuccess('Template reset to default');
      onSaved?.(result.template);
    } catch (err) {
      logger.error('Error resetting template:', err);
      showError(err, { context: 'EmailTemplateEditor.reset' });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadTheirs = async () => {
    setSaving(true);
    try {
      const response = await fetch(baseUrl, { headers: authHeaders });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || 'Failed to load template');
      setConflict(null);
      onSaved?.(result.template);
    } catch (err) {
      logger.error('Error reloading template:', err);
      showError(err, { context: 'EmailTemplateEditor.reload' });
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (previewHtml) { setView('preview'); return; }
    setPreviewLoading(true);
    try {
      setPreviewHtml(await loadPreview({ subject, body }));
      setView('preview');
    } catch (err) {
      logger.error('Error previewing template:', err);
      showError(err, { context: 'EmailTemplateEditor.preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const meta = template.updatedAt && (
    <div className="settings-meta template-meta">
      Last updated: {new Date(template.updatedAt).toLocaleString()}
      {template.updatedBy && ` by ${template.updatedBy}`}
    </div>
  );

  if (readOnly) {
    return (
      <div className="email-template-editor read-only">
        {meta}
        <iframe
          className="ete-message-frame"
          title="Email message"
          sandbox=""
          srcDoc={template.body || ''}
        />
      </div>
    );
  }

  return (
    <div className="email-template-editor">
      <div className="template-editor-header">
        {showHeader && (
          <div className="template-editor-intro">
            {template.name && <h3>{template.name}</h3>}
            {template.description && <p className="template-description">{template.description}</p>}
          </div>
        )}
        <div className="template-header-actions">
          <button
            type="button"
            className={`reset-button${confirmAction === 'reset' ? ' confirm' : ''}`}
            onClick={handleReset}
            disabled={saving || !template.isCustomized}
          >
            {confirmAction === 'reset' ? 'Confirm?' : 'Reset to Default'}
          </button>
          <button
            type="button"
            className={`save-button${confirmAction === 'save' ? ' confirm' : ''}`}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving...' : confirmAction === 'save' ? 'Confirm?' : 'Save Template'}
          </button>
        </div>
      </div>

      {meta}

      {conflict && (
        <div className="ete-conflict" role="alert">
          <span>
            {conflict.updatedBy || 'Someone else'} saved a newer version of this template.
            Your changes are still here and have not been saved.
          </span>
          <button type="button" className="cancel-button" onClick={handleLoadTheirs} disabled={saving}>
            Load their version
          </button>
        </div>
      )}

      {loadPreview && (
        <div className="editor-view-tabs">
          <button
            type="button"
            className={`editor-view-tab ${view === 'template' ? 'active' : ''}`}
            onClick={() => setView('template')}
          >
            Template
          </button>
          <button
            type="button"
            className={`editor-view-tab ${view === 'preview' ? 'active' : ''}`}
            onClick={handlePreview}
            disabled={previewLoading}
          >
            {previewLoading ? 'Loading...' : 'Preview'}
          </button>
        </div>
      )}

      {view === 'template' && (
        <div className="template-editor">
          {showSubject && (
            <div className="form-group">
              <label htmlFor={`ete-subject-${template.id}`}>Subject Line</label>
              <input
                type="text"
                id={`ete-subject-${template.id}`}
                value={subject}
                onChange={(e) => edit(setSubject)(e.target.value)}
                placeholder="Email subject"
              />
            </div>
          )}

          <div className="form-group">
            <label>Body</label>
            <div className="quill-editor-container">
              <ReactQuill
                theme="snow"
                value={body}
                onChange={(value, _delta, source) => {
                  if (source && source !== 'user') { setBody(value); return; }
                  edit(setBody)(value);
                }}
                modules={QUILL_MODULES}
                formats={QUILL_FORMATS}
                placeholder="Compose your email template..."
              />
            </div>
            {template.variables?.length > 0 && (
              <details className="template-variables-hint">
                <summary>Available variables</summary>
                To include dynamic content, type variables like {'{{'}<em>eventTitle</em>{'}}'}.
                Available: {template.variables.map((v) => `{{${v}}}`).join(', ')}
              </details>
            )}
          </div>
        </div>
      )}

      {view === 'preview' && (
        <div className="template-preview-panel">
          {previewHtml ? (
            <iframe srcDoc={previewHtml} title="Email Preview" className="preview-iframe" sandbox="" />
          ) : (
            <div className="preview-loading"><p>Loading preview...</p></div>
          )}
        </div>
      )}
    </div>
  );
}

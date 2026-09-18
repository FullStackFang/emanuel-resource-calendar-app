// src/components/EmailTestAdmin.jsx
import React, { useState, useEffect, useCallback } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import EmailTemplateEditor from './shared/EmailTemplateEditor';
import { useNotification } from '../context/NotificationContext';
import { usePermissions } from '../hooks/usePermissions';
import APP_CONFIG from '../config/config';
import './Admin.css';
import { logger } from '../utils/logger';
import './EmailTestAdmin.css';

const templateWorkflow = (id) => {
  if (id === 'assignment-schedule') return 'Scheduling';
  if (id.includes('cancellation')) return 'Cancellations';
  if (id.includes('edit-request') || id === 'event-updated') return 'Edits';
  if (id === 'error-notification' || id === 'user-report-acknowledgment') return 'System';
  return 'Reservations';
};

export default function EmailTestAdmin({ apiToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const { showSuccess, showWarning } = useNotification();
  // Approvers reach this page for the Templates tab only; delivery settings
  // (and the endpoints behind them) stay admin-only.
  const { isAdmin } = usePermissions();

  // Tab state. Derived, not just initialized: a role change (e.g. an admin
  // starting role simulation) must not leave a non-admin on Settings.
  const [selectedTab, setSelectedTab] = useState(isAdmin ? 'settings' : 'templates');
  const activeTab = isAdmin ? selectedTab : 'templates';
  const setActiveTab = setSelectedTab;

  // Settings & Test tab state
  const [emailConfig, setEmailConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState(null);

  // Editable settings
  const [editEnabled, setEditEnabled] = useState(false);
  const [editRedirectTo, setEditRedirectTo] = useState('');
  const [editCcTo, setEditCcTo] = useState('');

  // Test email form state
  const [toEmail, setToEmail] = useState('');
  const [testSubject, setTestSubject] = useState('Test Email from Temple Emanuel Calendar');
  const [testBody, setTestBody] = useState('<h1>Test Email</h1><p>This is a test email from the Temple Emanuel Resource Calendar system.</p><p>If you received this email, the email service is working correctly.</p>');
  const [testResult, setTestResult] = useState(null);

  // Templates tab state
  const [templates, setTemplates] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [customizedOnly, setCustomizedOnly] = useState(false);
  const [templateDrafts, setTemplateDrafts] = useState({});
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const filteredTemplates = templates.filter(template =>
    `${template.name} ${template.description || ''}`.toLowerCase().includes(templateSearch.trim().toLowerCase()) &&
    (!workflow || templateWorkflow(template.id) === workflow) &&
    (!customizedOnly || template.isCustomized)
  );

  // Load email configuration on mount
  useEffect(() => {
    if (apiToken && isAdmin) {
      loadEmailConfig();
    }
  }, [apiToken, isAdmin]);

  // Load templates when templates tab is active
  useEffect(() => {
    if (apiToken && activeTab === 'templates' && templates.length === 0) {
      loadTemplates();
    }
  }, [apiToken, activeTab]);

  const loadEmailConfig = async () => {
    try {
      setConfigLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/email/config`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (response.ok) {
        const config = await response.json();
        setEmailConfig(config);
        setEditEnabled(config.enabled || false);
        setEditRedirectTo(config.redirectTo || '');
        setEditCcTo(config.ccTo || '');
      } else {
        setError('Failed to load email configuration');
      }
    } catch (err) {
      logger.error('Error loading email config:', err);
      setError('Failed to load email configuration');
    } finally {
      setConfigLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      setTemplatesLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/email/templates`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      } else {
        setError('Failed to load email templates');
      }
    } catch (err) {
      logger.error('Error loading templates:', err);
      setError('Failed to load email templates');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/email/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enabled: editEnabled,
          redirectTo: editRedirectTo.trim(),
          ccTo: editCcTo.trim()
        })
      });

      const result = await response.json();

      if (response.ok) {
        showSuccess('Settings saved');
        await loadEmailConfig();
      } else {
        setError(result.error || 'Failed to save settings');
      }
    } catch (err) {
      logger.error('Error saving settings:', err);
      setError(`Failed to save settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendTest = async (e) => {
    e.preventDefault();

    if (!toEmail) {
      setError('Please enter a recipient email address');
      return;
    }

    setLoading(true);
    setError(null);
    setTestResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/email/test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: toEmail,
          subject: testSubject,
          body: testBody
        })
      });

      const result = await response.json();

      if (response.ok) {
        setTestResult(result);
        if (result.skipped) {
          showWarning('Email was NOT sent (Email Disabled). Check server logs for details.');
        } else {
          showSuccess('Test email sent');
        }
      } else {
        setError(result.error || 'Failed to send test email');
        setTestResult(result);
      }
    } catch (err) {
      logger.error('Error sending test email:', err);
      setError(`Failed to send test email: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template) => {
    if (selectedTemplate?.id === template.id) return;
    setSelectedTemplate(template);
    setError(null);
  };

  // Drafts live here, not in the editor, so switching templates and back keeps
  // unsaved text. The editor reports every edit (null once clean).
  const handleDraftChange = useCallback((id, draft) => {
    setTemplateDrafts(drafts => {
      if (!draft && !drafts[id]) return drafts;
      const next = { ...drafts };
      if (draft) next[id] = draft; else delete next[id];
      return next;
    });
  }, []);

  const handleTemplateSaved = async (template) => {
    handleDraftChange(template.id, null);
    setSelectedTemplate(template);
    await loadTemplates();
  };

  // Email Management's preview renders the UNSAVED text against sample data.
  const loadSamplePreview = async ({ subject, body }) => {
    const response = await fetch(`${API_BASE_URL}/admin/email/templates/${selectedTemplate.id}/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ subject, body })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to preview template');
    return result.html;
  };

  const renderSettingsEditor = () => {
    if (configLoading) {
      return null;
    }

    const hasChanges = emailConfig && (
      editEnabled !== emailConfig.enabled ||
      (editRedirectTo || '') !== (emailConfig.redirectTo || '') ||
      (editCcTo || '') !== (emailConfig.ccTo || '')
    );

    return (
      <div className="email-settings-editor">
        <div className="settings-header">
          <h3>Email Settings</h3>
          <button
            className="save-button"
            onClick={handleSaveSettings}
            disabled={savingSettings || !hasChanges}
          >
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        <p className="settings-description">
          Configure email behavior. Changes are saved to the database and take effect immediately.
        </p>

        <div className="settings-form">
          <div className="setting-row">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={editEnabled}
                onChange={(e) => setEditEnabled(e.target.checked)}
              />
              <span className="setting-text">
                <strong>Enable Email Sending</strong>
                <small>When disabled, emails are logged but not sent</small>
              </span>
            </label>
          </div>

          <div className="setting-row">
            <label className="setting-label-block">
              <strong>Redirect All Emails To (Testing)</strong>
              <small>Leave empty to send to actual recipients</small>
            </label>
            <input
              type="email"
              value={editRedirectTo}
              onChange={(e) => setEditRedirectTo(e.target.value)}
              placeholder="your-email@example.com"
              className="redirect-input"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label-block">
              <strong>CC All Emails To</strong>
              <small>Add a CC recipient to every notification email (ignored when redirect is active)</small>
            </label>
            <input
              type="email"
              value={editCcTo}
              onChange={(e) => setEditCcTo(e.target.value)}
              placeholder="cc-recipient@example.com"
              className="redirect-input"
              disabled={!!editRedirectTo.trim()}
            />
          </div>

          {emailConfig?.dbSettings && (
            <div className="settings-meta">
              Last updated: {new Date(emailConfig.dbSettings.updatedAt).toLocaleString()}
              {emailConfig.dbSettings.updatedBy && ` by ${emailConfig.dbSettings.updatedBy}`}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderConfigStatus = () => {
    if (configLoading) {
      return <LoadingSpinner minHeight={150} />;
    }

    if (!emailConfig) {
      return <div className="error-message">Could not load email configuration</div>;
    }

    return (
      <div className="email-config-status">
        <h3>Current Status</h3>
        <table className="config-table">
          <tbody>
            <tr>
              <td>Email Sending</td>
              <td>
                <span className={`status-badge ${emailConfig.enabled ? 'enabled' : 'disabled'}`}>
                  {emailConfig.enabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </td>
            </tr>
            <tr>
              <td>Redirect Mode</td>
              <td>
                {emailConfig.redirectTo ? (
                  <span className="redirect-active">All emails → {emailConfig.redirectTo}</span>
                ) : (
                  <span className="redirect-inactive">Off (sending to actual recipients)</span>
                )}
              </td>
            </tr>
            <tr>
              <td>CC Recipient</td>
              <td>
                {emailConfig.ccTo ? (
                  <span className="redirect-active">CC → {emailConfig.ccTo}</span>
                ) : (
                  <span className="redirect-inactive">None</span>
                )}
              </td>
            </tr>
            <tr>
              <td>From Address</td>
              <td>
                <span className={`status-badge ${emailConfig.fromAddress ? 'configured' : 'missing'}`}>
                  {emailConfig.fromAddress || 'Not configured'}
                </span>
              </td>
            </tr>
            <tr>
              <td>Client Secret</td>
              <td>
                <span className={`status-badge ${emailConfig.hasClientSecret ? 'configured' : 'missing'}`}>
                  {emailConfig.hasClientSecret ? 'Configured' : 'MISSING'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {!emailConfig.hasClientSecret && (
          <div className="config-error">
            Missing <code>EMAIL_CLIENT_SECRET</code> in backend/.env
          </div>
        )}
      </div>
    );
  };

  const renderSettingsTab = () => (
    <div className="email-admin-grid">
      <div className="email-admin-column">
        {renderSettingsEditor()}
      </div>

      <div className="email-admin-column">
        {renderConfigStatus()}
      </div>

      <div className="email-admin-column">
        <div className="email-test-form-container">
          <h3>Send Test Email</h3>

          <form onSubmit={handleSendTest} className="email-test-form">
            <div className="form-group">
              <label htmlFor="toEmail">Recipient Email *</label>
              <input
                type="email"
                id="toEmail"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="test@example.com"
                required
              />
              {emailConfig?.redirectTo && (
                <small className="form-hint">
                  Will be redirected to: {emailConfig.redirectTo}
                </small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="testSubject">Subject</label>
              <input
                type="text"
                id="testSubject"
                value={testSubject}
                onChange={(e) => setTestSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>

            <div className="form-group">
              <label htmlFor="testBody">Body (HTML)</label>
              <textarea
                id="testBody"
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                rows={6}
                placeholder="<p>HTML email body...</p>"
              />
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="save-button"
                disabled={loading || !apiToken}
              >
                {loading ? 'Sending...' : 'Send Test Email'}
              </button>
              <button
                type="button"
                className="cancel-button"
                onClick={loadEmailConfig}
                disabled={configLoading}
              >
                Refresh
              </button>
            </div>
          </form>

          {testResult && (
            <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
              <h4>Test Result</h4>
              <pre>{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderTemplatesTab = () => (
    <div className="templates-container">
      <div className="templates-grid">
        {/* Template List */}
        <div className="template-list-container">
          <div className="template-list-controls">
            <h3>Templates</h3>
            <input type="search" aria-label="Search templates" placeholder="Search templates..." value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} />
            <label htmlFor="template-workflow">Workflow</label>
            <select id="template-workflow" value={workflow} onChange={e => setWorkflow(e.target.value)}>
              <option value="">All workflows</option>
              {['Reservations', 'Edits', 'Cancellations', 'Scheduling', 'System'].map(group => <option key={group}>{group}</option>)}
            </select>
            <label className="template-customized-filter"><input type="checkbox" checked={customizedOnly} onChange={e => setCustomizedOnly(e.target.checked)} />Customized only</label>
          </div>

          {templatesLoading ? (
            <LoadingSpinner minHeight={150} />
          ) : (
            <div className="template-list">
              {filteredTemplates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  aria-pressed={selectedTemplate?.id === template.id}
                  disabled={editorBusy}
                  className={`template-item ${selectedTemplate?.id === template.id ? 'selected' : ''} ${template.isCustomized ? 'customized' : ''}`}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <span className="template-item-header">
                    <span className="template-name">{template.name}</span>
                    {template.isCustomized && (
                      <span className="customized-badge">Customized</span>
                    )}
                  </span>
                </button>
              ))}
              {filteredTemplates.length === 0 && (
                <div className="template-list-empty">
                  <p>No matching templates.</p>
                  <button type="button" className="cancel-button" onClick={() => { setTemplateSearch(''); setWorkflow(''); setCustomizedOnly(false); }}>Clear filters</button>
                </div>
              )}
            </div>
          )}
          {!templatesLoading && <div className="template-list-count" role="status">{filteredTemplates.length} of {templates.length} templates</div>}
        </div>

        {/* Template Editor */}
        <div className="template-editor-container">
          {selectedTemplate ? (
            <EmailTemplateEditor
              // Remount per template AND per saved version, so a save or reset
              // starts the editor clean from the stored text.
              key={`${selectedTemplate.id}:${selectedTemplate.updatedAt || 'default'}`}
              apiToken={apiToken}
              template={selectedTemplate}
              draft={templateDrafts[selectedTemplate.id] || null}
              onDraftChange={(draft) => handleDraftChange(selectedTemplate.id, draft)}
              onSaved={handleTemplateSaved}
              onBusyChange={setEditorBusy}
              loadPreview={loadSamplePreview}
            />
          ) : (
            <div className="no-template-selected">
              <p>Select a template from the list to edit it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`admin-container email-test-admin${activeTab === 'templates' ? ' email-templates-active' : ''}`}>
      <h2>Email Management</h2>
      <p className="admin-description">
        Configure email settings, edit templates, and test the notification service.
      </p>

      {error && <div className="error-message">{error}</div>}

      {/* Tabs */}
      <div className="email-tabs">
        {isAdmin && (
          <button
            className={`email-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings & Test
          </button>
        )}
        <button
          className={`email-tab ${activeTab === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveTab('templates')}
        >
          Email Templates
        </button>
      </div>

      {/* Tab Content */}
      <div className="email-tab-content">
        {activeTab === 'settings' && renderSettingsTab()}
        {activeTab === 'templates' && renderTemplatesTab()}
      </div>
    </div>
  );
}

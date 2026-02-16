// src/components/EmailTestAdmin.jsx
import React, { useState, useEffect, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import './Admin.css';
import './EmailTestAdmin.css';

export default function EmailTestAdmin({ apiToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;

  // Tab state
  const [activeTab, setActiveTab] = useState('settings');

  // Settings & Test tab state
  const [emailConfig, setEmailConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

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
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editorView, setEditorView] = useState('template'); // 'template' or 'preview'

  // Quill editor configuration
  const quillModules = useMemo(() => ({
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'align': [] }],
      ['link'],
      ['clean']
    ]
  }), []);

  const quillFormats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'color', 'background',
    'list', 'bullet',
    'align',
    'link'
  ];

  // Load email configuration on mount
  useEffect(() => {
    if (apiToken) {
      loadEmailConfig();
    }
  }, [apiToken]);

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
      console.error('Error loading email config:', err);
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
      console.error('Error loading templates:', err);
      setError('Failed to load email templates');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    setSuccessMessage('');

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
        setSuccessMessage('Settings saved successfully!');
        await loadEmailConfig();
      } else {
        setError(result.error || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
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
    setSuccessMessage('');
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
          setSuccessMessage('Email was NOT sent (Email Disabled). Check server logs for details.');
        } else {
          setSuccessMessage('Test email sent successfully!');
        }
      } else {
        setError(result.error || 'Failed to send test email');
        setTestResult(result);
      }
    } catch (err) {
      console.error('Error sending test email:', err);
      setError(`Failed to send test email: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setEditSubject(template.subject);
    setEditBody(template.body);
    setPreviewHtml(null);
    setEditorView('template');
    setError(null);
    setSuccessMessage('');
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplate) return;

    setSavingTemplate(true);
    setError(null);
    setSuccessMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/admin/email/templates/${selectedTemplate.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: editSubject,
          body: editBody
        })
      });

      const result = await response.json();

      if (response.ok) {
        setSuccessMessage('Template saved successfully!');
        await loadTemplates();
        // Update selected template with new data
        if (result.template) {
          setSelectedTemplate(result.template);
        }
      } else {
        setError(result.error || 'Failed to save template');
      }
    } catch (err) {
      console.error('Error saving template:', err);
      setError(`Failed to save template: ${err.message}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResetTemplate = async () => {
    if (!selectedTemplate) return;

    if (!window.confirm('Are you sure you want to reset this template to its default? Any customizations will be lost.')) {
      return;
    }

    setSavingTemplate(true);
    setError(null);
    setSuccessMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/admin/email/templates/${selectedTemplate.id}/reset`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      const result = await response.json();

      if (response.ok) {
        setSuccessMessage('Template reset to default!');
        await loadTemplates();
        // Update editor with default values
        if (result.template) {
          setSelectedTemplate(result.template);
          setEditSubject(result.template.subject);
          setEditBody(result.template.body);
        }
      } else {
        setError(result.error || 'Failed to reset template');
      }
    } catch (err) {
      console.error('Error resetting template:', err);
      setError(`Failed to reset template: ${err.message}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handlePreviewTemplate = async () => {
    if (!selectedTemplate) return;

    setPreviewLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/email/templates/${selectedTemplate.id}/preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: editSubject,
          body: editBody
        })
      });

      const result = await response.json();

      if (response.ok) {
        setPreviewHtml(result.html);
        setEditorView('preview');
      } else {
        setError(result.error || 'Failed to preview template');
      }
    } catch (err) {
      console.error('Error previewing template:', err);
      setError(`Failed to preview template: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
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
          <h3>Email Templates</h3>
          <p className="settings-description">
            Click a template to edit its subject and body content.
          </p>

          {templatesLoading ? (
            <LoadingSpinner minHeight={150} />
          ) : (
            <div className="template-list">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`template-item ${selectedTemplate?.id === template.id ? 'selected' : ''} ${template.isCustomized ? 'customized' : ''}`}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <div className="template-item-header">
                    <span className="template-name">{template.name}</span>
                    {template.isCustomized && (
                      <span className="customized-badge">Customized</span>
                    )}
                  </div>
                  <div className="template-description">{template.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Template Editor */}
        <div className="template-editor-container">
          {selectedTemplate ? (
            <>
              <div className="template-editor-header">
                <h3>Edit: {selectedTemplate.name}</h3>
                <div className="template-header-actions">
                  <button
                    className="reset-button"
                    onClick={handleResetTemplate}
                    disabled={savingTemplate || !selectedTemplate.isCustomized}
                  >
                    Reset to Default
                  </button>
                  <button
                    className="save-button"
                    onClick={handleSaveTemplate}
                    disabled={savingTemplate || (editSubject === selectedTemplate.subject && editBody === selectedTemplate.body)}
                  >
                    {savingTemplate ? 'Saving...' : 'Save Template'}
                  </button>
                </div>
              </div>

              {selectedTemplate.updatedAt && (
                <div className="settings-meta template-meta">
                  Last updated: {new Date(selectedTemplate.updatedAt).toLocaleString()}
                  {selectedTemplate.updatedBy && ` by ${selectedTemplate.updatedBy}`}
                </div>
              )}

              {/* Editor View Tabs */}
              <div className="editor-view-tabs">
                <button
                  className={`editor-view-tab ${editorView === 'template' ? 'active' : ''}`}
                  onClick={() => setEditorView('template')}
                >
                  Template
                </button>
                <button
                  className={`editor-view-tab ${editorView === 'preview' ? 'active' : ''}`}
                  onClick={() => {
                    if (!previewHtml) {
                      handlePreviewTemplate();
                    } else {
                      setEditorView('preview');
                    }
                  }}
                  disabled={previewLoading}
                >
                  {previewLoading ? 'Loading...' : 'Preview'}
                </button>
              </div>

              {/* Template Editor View */}
              {editorView === 'template' && (
                <div className="template-editor">
                  <div className="form-group">
                    <label htmlFor="editSubject">Subject Line</label>
                    <input
                      type="text"
                      id="editSubject"
                      value={editSubject}
                      onChange={(e) => {
                        setEditSubject(e.target.value);
                        setPreviewHtml(null); // Invalidate preview on change
                      }}
                      placeholder="Email subject"
                    />
                    <small className="form-hint">
                      Available variables: {selectedTemplate.variables?.map(v => `{{${v}}}`).join(', ')}
                    </small>
                  </div>

                  <div className="form-group">
                    <label>Body</label>
                    <div className="quill-editor-container">
                      <ReactQuill
                        theme="snow"
                        value={editBody}
                        onChange={(value) => {
                          setEditBody(value);
                          setPreviewHtml(null); // Invalidate preview on change
                        }}
                        modules={quillModules}
                        formats={quillFormats}
                        placeholder="Compose your email template..."
                      />
                    </div>
                    <small className="form-hint template-variables-hint">
                      To include dynamic content, type variables like {'{{'}<em>eventTitle</em>{'}}'}.
                      Available: {selectedTemplate.variables?.map(v => `{{${v}}}`).join(', ')}
                    </small>
                  </div>
                </div>
              )}

              {/* Preview View */}
              {editorView === 'preview' && (
                <div className="template-preview-panel">
                  {previewHtml ? (
                    <iframe
                      srcDoc={previewHtml}
                      title="Email Preview"
                      className="preview-iframe"
                    />
                  ) : (
                    <div className="preview-loading">
                      <p>Loading preview...</p>
                    </div>
                  )}
                </div>
              )}
            </>
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
    <div className="admin-container email-test-admin">
      <h2>Email Management</h2>
      <p className="admin-description">
        Configure email settings, edit templates, and test the notification service.
      </p>

      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {/* Tabs */}
      <div className="email-tabs">
        <button
          className={`email-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings & Test
        </button>
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

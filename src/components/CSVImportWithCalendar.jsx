// Enhanced CSV Import Component with Calendar Selection and Sync
import React, { useState, useRef, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import LoadingSpinner from './shared/LoadingSpinner';
import './CSVImportWithMapping.css';

const IMPORT_STEPS = [
  { id: 'upload', title: 'Upload File', icon: '📁', description: 'Select your CSV file' },
  { id: 'calendar', title: 'Select Calendar', icon: '📅', description: 'Choose target calendar' },
  { id: 'mapping', title: 'Map Fields', icon: '🔗', description: 'Connect CSV columns to event fields' },
  { id: 'preview', title: 'Preview', icon: '👁️', description: 'Review before import' },
  { id: 'import', title: 'Import', icon: '⚡', description: 'Execute import and sync' }
];

const FIELD_MAPPINGS_PRESET = {
  'rsId': { label: 'Resource Scheduler ID', type: 'text', required: false },
  'subject': { label: 'Event Subject/Title', type: 'text', required: true },
  'startDateTime': { label: 'Start Date/Time', type: 'datetime', required: true },
  'endDateTime': { label: 'End Date/Time', type: 'datetime', required: true },
  'location': { label: 'Location', type: 'text', required: false },
  'description': { label: 'Description', type: 'text', required: false },
  'categories': { label: 'Categories', type: 'text', required: false },
  'isAllDay': { label: 'All Day Event', type: 'boolean', required: false },
  'attendeeEmails': { label: 'Attendee Emails', type: 'text', required: false },
  'isDeleted': { label: 'Deleted', type: 'boolean', required: false }
};

export default function CSVImportWithCalendar({ apiToken, graphToken }) {
  const { showError, showWarning } = useNotification();
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const fileInputRef = useRef(null);

  // Step management
  const [currentStep, setCurrentStep] = useState('upload');
  const [stepsCompleted, setStepsCompleted] = useState(new Set());

  // File data
  const [selectedFile, setSelectedFile] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvSampleData, setCsvSampleData] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);

  // Calendar selection
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [syncToCalendar, setSyncToCalendar] = useState(true);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  // Field mapping
  const [fieldMappings, setFieldMappings] = useState({});
  const [autoMapped, setAutoMapped] = useState(false);

  // Preview
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // Import
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState([]);
  const [importResult, setImportResult] = useState(null);

  // Auth headers
  const getAuthHeaders = () => {
    if (!apiToken) {
      throw new Error('API token not set');
    }
    return {
      'Authorization': `Bearer ${apiToken}`
    };
  };

  // Load available calendars
  useEffect(() => {
    if (apiToken) {
      loadAvailableCalendars();
    }
  }, [apiToken]);

  const loadAvailableCalendars = async () => {
    try {
      setLoadingCalendars(true);

      // Get calendars via backend (uses app-only auth)
      const userId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;
      const params = new URLSearchParams({ userId });
      const response = await fetch(`${API_BASE_URL}/graph/calendars?${params}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const calendars = (data.value || []).map(cal => ({
          id: cal.owner?.address || cal.id,
          name: cal.name,
          isDefaultCalendar: cal.isDefaultCalendar,
          canEdit: cal.canEdit,
          owner: cal.owner
        }));

        setAvailableCalendars(calendars);

        // Auto-select default calendar
        const defaultCal = calendars.find(c => c.isDefaultCalendar);
        if (defaultCal) {
          setSelectedCalendarId(defaultCal.id);
        }
      }
    } catch (error) {
      logger.error('Failed to load calendars:', error);
    } finally {
      setLoadingCalendars(false);
    }
  };

  // Reset wizard
  const resetWizard = () => {
    setCurrentStep('upload');
    setStepsCompleted(new Set());
    setSelectedFile(null);
    setCsvHeaders([]);
    setCsvSampleData([]);
    setFieldMappings({});
    setAutoMapped(false);
    setPreviewData(null);
    setImportResult(null);
    setImportProgress([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Step 1: File Upload and Analysis
  const handleFileSelect = async (file) => {
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv')) {
      showWarning('Please select a CSV file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showWarning('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    await analyzeCSVFile(file);
  };

  const analyzeCSVFile = async (file) => {
    try {
      setAnalyzing(true);

      const formData = new FormData();
      formData.append('csvFile', file);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import/analyze`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to analyze CSV file');
      }

      const analysis = await response.json();

      console.log('[CSVImportWithCalendar] Analysis result:', analysis);
      console.log('[CSVImportWithCalendar] Headers:', analysis.columns);
      console.log('[CSVImportWithCalendar] Sample data:', analysis.samples);

      setCsvHeaders(analysis.columns || []);
      setCsvSampleData(Object.values(analysis.samples || {}));

      // Auto-map fields based on header names
      autoMapFields(analysis.columns || []);

      // Mark step as completed
      setStepsCompleted(prev => new Set([...prev, 'upload']));
      setCurrentStep('calendar');

    } catch (error) {
      logger.error('CSV analysis failed:', error);
      showError(error, { context: 'CSVImportWithCalendar.analyzeFile', userMessage: 'Failed to analyze CSV file' });
    } finally {
      setAnalyzing(false);
    }
  };

  const autoMapFields = (headers) => {
    console.log('[CSVImportWithCalendar] Auto-mapping with headers:', headers);
    const mappings = {};

    // Exact mapping for Resource Scheduler CSV columns (based on actual file)
    const exactMappings = {
      'rsId': 'rsId',              // Maps to internalData.rsId
      'Subject': 'subject',         // Maps to graphData.subject
      'StartDateTime': 'startDateTime', // Maps to graphData.start
      'EndDateTime': 'endDateTime',     // Maps to graphData.end
      'Location': 'location',           // Maps to graphData.location
      'Description': 'description',     // Maps to graphData.body
      'Categories': 'categories',       // Maps to graphData.categories
      'AllDayEvent': 'isAllDay',       // Maps to graphData.isAllDay
      'Deleted': 'isDeleted',          // For filtering deleted events
      'AttendeeEmails': 'attendeeEmails' // For attendee information
    };

    // Clean headers to remove BOM characters
    const cleanedHeaders = headers.map(h => h.replace(/^\uFEFF/, '').replace(/^﻿/, '').trim());

    cleanedHeaders.forEach((header) => {
      if (exactMappings[header]) {
        mappings[header] = exactMappings[header];
      }
    });

    console.log('[CSVImportWithCalendar] Final mappings:', mappings);
    setFieldMappings(mappings);
    setAutoMapped(Object.keys(mappings).length > 0);
  };

  // Step 2: Calendar Selection
  const handleCalendarSelection = () => {
    if (!syncToCalendar || selectedCalendarId) {
      setStepsCompleted(prev => new Set([...prev, 'calendar']));
      setCurrentStep('mapping');
    } else {
      showWarning('Please select a target calendar or disable calendar sync');
    }
  };

  // Step 3: Field Mapping
  const handleMappingChange = (csvColumn, targetField) => {
    setFieldMappings(prev => ({
      ...prev,
      [csvColumn]: targetField
    }));
  };

  const handleMappingComplete = () => {
    // Validate required fields are mapped
    const requiredFields = Object.entries(FIELD_MAPPINGS_PRESET)
      .filter(([, config]) => config.required)
      .map(([field]) => field);

    const mappedFields = Object.values(fieldMappings);
    const missingRequired = requiredFields.filter(field => !mappedFields.includes(field));

    if (missingRequired.length > 0) {
      showWarning(`Please map required fields: ${missingRequired.join(', ')}`);
      return;
    }

    console.log('[CSVImportWithCalendar] Field mappings before validation:', fieldMappings);
    console.log('[CSVImportWithCalendar] Required fields:', requiredFields);
    console.log('[CSVImportWithCalendar] Mapped fields:', mappedFields);

    setStepsCompleted(prev => new Set([...prev, 'mapping']));
    setCurrentStep('preview');
    generatePreview();
  };

  // No conversion needed - frontend and backend use same format: {csvColumn: targetField}

  // Step 4: Preview
  const generatePreview = async () => {
    try {
      setPreviewing(true);

      const formData = new FormData();
      formData.append('csvFile', selectedFile);
      formData.append('fieldMappings', JSON.stringify(fieldMappings));

      console.log('[CSVImportWithCalendar] Sending preview request with mappings:', fieldMappings);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import/preview`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate preview: ${errorText}`);
      }

      const preview = await response.json();
      console.log('[CSVImportWithCalendar] Preview result:', preview);
      console.log('[CSVImportWithCalendar] Preview totalRows:', preview.totalRows);
      console.log('[CSVImportWithCalendar] Preview validRows:', preview.validRows);
      console.log('[CSVImportWithCalendar] Preview errorsFound:', preview.errorsFound);
      setPreviewData(preview);

      setStepsCompleted(prev => new Set([...prev, 'preview']));

    } catch (error) {
      logger.error('Preview generation failed:', error);
      showError(error, { context: 'CSVImportWithCalendar.generatePreview', userMessage: 'Failed to generate preview' });
    } finally {
      setPreviewing(false);
    }
  };

  // Step 5: Execute Import
  const executeImport = async () => {
    try {
      setImporting(true);
      setImportProgress([]);
      setCurrentStep('import');

      const formData = new FormData();
      formData.append('csvFile', selectedFile);
      formData.append('fieldMappings', JSON.stringify(fieldMappings));
      formData.append('targetCalendarId', selectedCalendarId);
      formData.append('syncToCalendar', syncToCalendar);
      formData.append('graphToken', graphToken);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import/with-calendar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error('Import failed');
      }

      // Read streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const progress = JSON.parse(line);
            setImportProgress(prev => [...prev, progress]);

            if (progress.type === 'complete') {
              setImportResult(progress.summary);
              setStepsCompleted(prev => new Set([...prev, 'import']));
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

    } catch (error) {
      logger.error('Import execution failed:', error);
      setImportProgress(prev => [...prev, {
        type: 'error',
        message: 'Import failed: ' + error.message
      }]);
    } finally {
      setImporting(false);
    }
  };

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="csv-import-steps">
      {IMPORT_STEPS.map((step, index) => (
        <div
          key={step.id}
          className={`csv-import-step ${currentStep === step.id ? 'active' : ''} ${stepsCompleted.has(step.id) ? 'completed' : ''}`}
          onClick={() => {
            if (stepsCompleted.has(step.id) || index === 0) {
              setCurrentStep(step.id);
            }
          }}
        >
          <div className="step-icon">{step.icon}</div>
          <div className="step-info">
            <div className="step-title">{step.title}</div>
            <div className="step-description">{step.description}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="csv-import-with-calendar">
      <div className="csv-import-header">
        <h2>📊 Import CSV with Calendar Sync</h2>
        <button onClick={resetWizard} className="reset-button">
          Start Over
        </button>
      </div>

      {renderStepIndicator()}

      <div className="csv-import-content">
        {/* Step 1: Upload */}
        {currentStep === 'upload' && (
          <div className="import-step-content">
            <h3>Upload CSV File</h3>
            <p>Select a CSV file from Resource Scheduler to import events.</p>

            <div
              className="file-upload-zone"
              onClick={() => fileInputRef.current?.click()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFileSelect(file);
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {selectedFile ? (
                <div>
                  <strong>{selectedFile.name}</strong>
                  <br />
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </div>
              ) : (
                <div>
                  <span className="upload-icon">📁</span>
                  <br />
                  Click or drag CSV file here
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelect(e.target.files[0])}
              style={{ display: 'none' }}
            />

            {analyzing && <LoadingSpinner minHeight={100} size={40} />}

            {csvHeaders.length > 0 && (
              <div className="analysis-results">
                <h4>File Analysis</h4>
                <p>Found {csvHeaders.length} columns and {csvSampleData.length} sample rows</p>
                <p>Columns: {csvHeaders.join(', ')}</p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Calendar Selection */}
        {currentStep === 'calendar' && (
          <div className="import-step-content">
            <h3>Select Target Calendar</h3>
            <p>Choose where to sync the imported events.</p>

            <div className="calendar-selection">
              <label>
                <input
                  type="checkbox"
                  checked={syncToCalendar}
                  onChange={(e) => setSyncToCalendar(e.target.checked)}
                />
                Sync events to Microsoft 365 calendar
              </label>

              {syncToCalendar && (
                <div className="calendar-dropdown">
                  {loadingCalendars ? (
                    <LoadingSpinner minHeight={100} size={40} />
                  ) : (
                    <select
                      value={selectedCalendarId}
                      onChange={(e) => setSelectedCalendarId(e.target.value)}
                      className="calendar-selector"
                    >
                      <option value="">-- Select Calendar --</option>
                      {availableCalendars.map(cal => (
                        <option key={cal.id} value={cal.id}>
                          {cal.name} {cal.isDefaultCalendar ? '(Default)' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedCalendarId && (
                    <p className="selected-calendar">
                      ✓ Selected: {availableCalendars.find(c => c.id === selectedCalendarId)?.name}
                    </p>
                  )}
                </div>
              )}

              {!syncToCalendar && (
                <p className="info-message">
                  Events will only be imported to the database, not synced to any calendar.
                </p>
              )}

              <button
                onClick={handleCalendarSelection}
                className="continue-button"
                disabled={syncToCalendar && !selectedCalendarId}
              >
                Continue to Field Mapping
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Field Mapping */}
        {currentStep === 'mapping' && (
          <div className="import-step-content">
            <h3>Map CSV Fields</h3>
            {console.log('[CSVImportWithCalendar] Rendering mapping step - csvHeaders:', csvHeaders, 'fieldMappings:', fieldMappings)}
            {autoMapped && (
              <p className="success-message">✓ Auto-mapped {Object.keys(fieldMappings).length} fields</p>
            )}

            <div className="field-mapping-grid">
              <div className="mapping-header">
                <span>CSV Column</span>
                <span>→</span>
                <span>Event Field</span>
              </div>

              {csvHeaders.map(header => (
                <div key={header} className="mapping-row">
                  <span className="csv-column">{header}</span>
                  <span>→</span>
                  <select
                    value={fieldMappings[header] || ''}
                    onChange={(e) => handleMappingChange(header, e.target.value)}
                    className="field-selector"
                  >
                    <option value="">-- Skip --</option>
                    {Object.entries(FIELD_MAPPINGS_PRESET).map(([field, config]) => (
                      <option key={field} value={field}>
                        {config.label} {config.required ? '*' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <button onClick={handleMappingComplete} className="continue-button">
              Continue to Preview
            </button>
          </div>
        )}

        {/* Step 4: Preview */}
        {currentStep === 'preview' && (
          <div className="import-step-content">
            <h3>Preview Import</h3>

            {previewing ? (
              <LoadingSpinner minHeight={100} size={40} />
            ) : previewData ? (
              <div className="preview-section">
                <div className="preview-summary">
                  <h4>Import Summary</h4>
                  <p>Total events to import: {previewData.statistics?.totalRows || 0}</p>
                  <p>Valid events: {previewData.statistics?.validRows || 0}</p>
                  <p>Events with errors: {previewData.statistics?.rowsWithErrors || 0}</p>
                  {syncToCalendar && (
                    <p>Target calendar: {availableCalendars.find(c => c.id === selectedCalendarId)?.name}</p>
                  )}
                </div>

                {previewData.sample && previewData.sample.length > 0 && (
                  <div className="sample-events">
                    <h4>Sample Events</h4>
                    <div className="event-list">
                      {previewData.sample.slice(0, 5).map((event, idx) => (
                        <div key={idx} className="preview-event">
                          <strong>{event.subject}</strong>
                          <br />
                          {event.start?.dateTime || event.startDateTime} - {event.end?.dateTime || event.endDateTime}
                          <br />
                          {event.location && `Location: ${event.location}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={executeImport} className="import-button" disabled={importing}>
                  {importing ? 'Importing...' : 'Execute Import'}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 5: Import Progress */}
        {currentStep === 'import' && (
          <div className="import-step-content">
            <h3>Import Progress</h3>

            <div className="import-progress-log">
              {importProgress.map((progress, idx) => (
                <div key={idx} className={`progress-item ${progress.type}`}>
                  {progress.type === 'progress' && (
                    <span>✓ {progress.message}</span>
                  )}
                  {progress.type === 'info' && (
                    <span>ℹ️ {progress.message}</span>
                  )}
                  {progress.type === 'warning' && (
                    <span>⚠️ {progress.message}</span>
                  )}
                  {progress.type === 'error' && (
                    <span>❌ {progress.message}</span>
                  )}
                  {progress.type === 'complete' && (
                    <div className="import-complete">
                      <h4>✅ Import Complete!</h4>
                      <div className="import-stats">
                        <p>Total processed: {progress.summary?.processed || 0}</p>
                        <p>Created: {progress.summary?.created || 0}</p>
                        <p>Updated: {progress.summary?.updated || 0}</p>
                        <p>Skipped: {progress.summary?.skipped || 0}</p>
                        {syncToCalendar && (
                          <>
                            <p>Synced to calendar: {progress.summary?.synced || 0}</p>
                            <p>Sync failed: {progress.summary?.syncFailed || 0}</p>
                          </>
                        )}
                        <p>Errors: {progress.summary?.errors || 0}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {importResult && (
              <button onClick={resetWizard} className="reset-button">
                Import Another File
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
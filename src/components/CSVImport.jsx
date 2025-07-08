// CSV Import Component for Unified Events Admin
import React, { useState, useRef } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './Admin.css';

export default function CSVImport({ apiToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const fileInputRef = useRef(null);
  
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [showDetailedResults, setShowDetailedResults] = useState(false);

  // Auth headers
  const getAuthHeaders = () => {
    if (!apiToken) {
      throw new Error('API token not set');
    }
    return {
      'Authorization': `Bearer ${apiToken}`
    };
  };

  // Load CSV import statistics
  const loadStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/csv-import/stats`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to load stats: ${response.status}`);
      }

      const data = await response.json();
      setStats(data);
    } catch (err) {
      logger.error('Error loading CSV stats:', err);
      setError(`Failed to load statistics: ${err.message}`);
    }
  };

  // Handle file selection
  const handleFileSelect = (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('File size must be less than 10MB');
      return;
    }

    uploadCSV(file);
  };

  // Upload and process CSV file
  const uploadCSV = async (file) => {
    try {
      setImporting(true);
      setError(null);
      setImportResult(null);

      const formData = new FormData();
      formData.append('csvFile', file);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Upload failed: ${response.status}`);
      }

      setImportResult(result);
      
      // Reload stats after successful import
      await loadStats();

      logger.log('CSV import completed:', result);

    } catch (err) {
      logger.error('Error uploading CSV:', err);
      setError(err.message);
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Clear all CSV imported events
  const clearImportedEvents = async () => {
    if (!confirm('Are you sure you want to delete all CSV imported events? This cannot be undone.')) {
      return;
    }

    try {
      setImporting(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import/clear`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Clear failed: ${response.status}`);
      }

      setImportResult({
        success: true,
        summary: {
          cleared: result.deletedCount
        }
      });

      // Reload stats
      await loadStats();

      logger.log('CSV events cleared:', result);

    } catch (err) {
      logger.error('Error clearing CSV events:', err);
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // File input change handler
  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  // Load stats on component mount
  React.useEffect(() => {
    if (apiToken) {
      loadStats();
    }
  }, [apiToken]);

  if (!apiToken) {
    return (
      <div className="csv-import">
        <div className="error-message">
          API token is required to access CSV import functionality.
        </div>
      </div>
    );
  }

  return (
    <div className="csv-import">
      <div className="csv-import-content">
        <div className="csv-import-header">
          <h2>📁 CSV Import</h2>
          <p>Import events from CSV files into the unified events system</p>
        </div>

      {/* Current Statistics */}
      {stats && (
        <div className="csv-stats-card">
          <h3>📊 Current CSV Import Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total Imported:</span>
              <span className="stat-value">{stats.totalEvents || 0}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Active Events:</span>
              <span className="stat-value">{stats.activeEvents || 0}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Deleted Events:</span>
              <span className="stat-value">{stats.deletedEvents || 0}</span>
            </div>
            {stats.newestImport && (
              <div className="stat-item">
                <span className="stat-label">Last Import:</span>
                <span className="stat-value">
                  {new Date(stats.newestImport).toLocaleString()}
                </span>
              </div>
            )}
          </div>
          {stats.totalEvents > 0 && (
            <div className="csv-actions">
              <button
                onClick={clearImportedEvents}
                className="action-btn danger"
                disabled={importing}
              >
                🗑️ Clear All Imported Events
              </button>
            </div>
          )}
        </div>
      )}

      {/* Upload Area */}
      <div 
        className={`csv-upload-area ${dragOver ? 'drag-over' : ''} ${importing ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !importing && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          disabled={importing}
        />
        
        <div className="upload-content">
          {importing ? (
            <>
              <div className="upload-spinner">⏳</div>
              <div className="upload-text">Processing CSV file...</div>
            </>
          ) : (
            <>
              <div className="upload-icon">📁</div>
              <div className="upload-text">
                <strong>Click to select or drag & drop a CSV file</strong>
                <br />
                <small>Supported format: .csv files up to 10MB</small>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expected CSV Format */}
      <div className="csv-format-info">
        <h3>📋 Expected CSV Format</h3>
        <p>Your CSV file should contain the following columns:</p>
        <div className="format-example">
          <strong>Required:</strong> Subject
          <br />
          <strong>Recommended:</strong> StartDate, EndDate, StartTime, EndTime, Location, Categories
          <br />
          <strong>Optional:</strong> StartDateTime, EndDateTime, AllDayEvent, Description, Deleted, rsId
        </div>
        <div className="format-notes">
          <h4>Notes:</h4>
          <ul>
            <li>Date formats: Excel serial numbers (e.g., 49966) or ISO strings (e.g., 2036-10-18T10:30:00)</li>
            <li>Time formats: Decimal fractions (e.g., 0.4375 = 10:30 AM) or included in DateTime</li>
            <li>Categories: Comma-separated values (e.g., "Staff Meeting, Important")</li>
            <li>Boolean fields: 0/1, true/false, yes/no</li>
          </ul>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {/* Import Results */}
      {importResult && (
        <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
          <h3>
            {importResult.success ? '✅ Import Completed' : '❌ Import Failed'}
          </h3>
          
          {importResult.summary && (
            <div className="result-summary">
              {importResult.summary.cleared !== undefined ? (
                <p><strong>Cleared:</strong> {importResult.summary.cleared} events</p>
              ) : (
                <>
                  <p><strong>Total Rows:</strong> {importResult.summary.totalRows}</p>
                  <p><strong>Successfully Transformed:</strong> {importResult.summary.successfulTransforms}</p>
                  <p><strong>Inserted:</strong> {importResult.summary.inserted}</p>
                  {importResult.summary.duplicates > 0 && (
                    <p><strong>Duplicates Skipped:</strong> {importResult.summary.duplicates}</p>
                  )}
                  {importResult.summary.transformErrors > 0 && (
                    <p className="error-text"><strong>Transform Errors:</strong> {importResult.summary.transformErrors}</p>
                  )}
                  {importResult.summary.insertErrors > 0 && (
                    <p className="error-text"><strong>Insert Errors:</strong> {importResult.summary.insertErrors}</p>
                  )}
                  {importResult.summary.registrationEventsCreated > 0 && (
                    <p><strong>Registration Events Created:</strong> {importResult.summary.registrationEventsCreated}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Toggle for detailed results */}
          {importResult.success && importResult.summary && importResult.summary.inserted > 0 && (
            <div className="detailed-results-toggle">
              <button
                onClick={() => setShowDetailedResults(!showDetailedResults)}
                className="toggle-btn"
                style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  backgroundColor: '#007acc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {showDetailedResults ? '🔽 Hide' : '▶️ Show'} Recent Imports
              </button>
              
              {showDetailedResults && (
                <div className="recent-imports" style={{ marginTop: '15px' }}>
                  <h4>📋 Recently Imported Events</h4>
                  <p style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                    Note: To see rsId values and full event details, check the <strong>Unified Events Admin</strong> tab.
                  </p>
                  <div className="import-sample" style={{
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    padding: '10px',
                    fontSize: '12px'
                  }}>
                    <div style={{ fontFamily: 'monospace' }}>
                      <div><strong>✅ Import Summary:</strong></div>
                      <div>• {importResult.summary.inserted} main events imported</div>
                      {importResult.summary.registrationEventsCreated > 0 && (
                        <div>• {importResult.summary.registrationEventsCreated} setup/teardown events created</div>
                      )}
                      {importResult.summary.duplicates > 0 && (
                        <div>• {importResult.summary.duplicates} duplicates skipped</div>
                      )}
                      <div style={{ marginTop: '8px' }}>
                        <strong>🔍 To view rsId values:</strong> Go to the "Unified Events Admin" tab and look for events with the rsId column populated.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Show first few errors */}
          {importResult.errors && importResult.errors.length > 0 && (
            <div className="result-errors">
              <h4>Transform Errors:</h4>
              {importResult.errors.map((error, index) => (
                <div key={index} className="error-detail">
                  <strong>Row {error.row}:</strong> {error.error}
                </div>
              ))}
            </div>
          )}

          {importResult.insertErrors && importResult.insertErrors.length > 0 && (
            <div className="result-errors">
              <h4>Insert Errors:</h4>
              {importResult.insertErrors.map((error, index) => (
                <div key={index} className="error-detail">
                  {error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
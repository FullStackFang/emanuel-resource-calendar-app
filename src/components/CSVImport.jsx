// CSV Import Component for Unified Events Admin
import React, { useState, useRef } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './Admin.css';

export default function CSVImport({ apiToken, availableCalendars = [] }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const fileInputRef = useRef(null);
  
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [showDetailedResults, setShowDetailedResults] = useState(false);
  const [targetCalendarId, setTargetCalendarId] = useState('');
  
  // Streaming import states
  const [streamingImport, setStreamingImport] = useState(false);
  const [streamProgress, setStreamProgress] = useState({
    processed: 0,
    total: 0,
    progress: 0,
    successful: 0,
    duplicates: 0,
    errors: 0,
    currentMessage: ''
  });
  const [streamMessages, setStreamMessages] = useState([]);
  
  // Streaming clear states
  const [streamingClear, setStreamingClear] = useState(false);
  const [clearProgress, setClearProgress] = useState({
    processed: 0,
    totalCount: 0,
    progress: 0,
    deleted: 0,
    currentMessage: '',
    collections: {},
    currentCollection: '',
    collectionProgress: {},
    collectionResults: {}
  });
  const [clearMessages, setClearMessages] = useState([]);

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

    // Always use streaming for better user experience
    uploadCSVWithStreaming(file);
  };


  // Upload and process CSV file with streaming
  const uploadCSVWithStreaming = async (file) => {
    // Validate calendar selection
    if (!targetCalendarId) {
      setError('Please select a target calendar before importing');
      return;
    }

    try {
      setStreamingImport(true);
      setImporting(true);
      setError(null);
      setImportResult(null);
      setStreamMessages([]);
      setStreamProgress({
        processed: 0,
        total: 0,
        progress: 0,
        successful: 0,
        duplicates: 0,
        errors: 0,
        currentMessage: 'Initializing...'
      });

      const formData = new FormData();
      formData.append('csvFile', file);
      if (targetCalendarId) {
        formData.append('targetCalendarId', targetCalendarId);
      }

      // Create EventSource for streaming
      const eventSource = new EventSource(`${API_BASE_URL}/admin/csv-import/stream`);
      
      // First, send the file to trigger the streaming import
      const response = await fetch(`${API_BASE_URL}/admin/csv-import/stream`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      // Read the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const eventData = JSON.parse(line.substring(6));
                  handleStreamEvent(eventData);
                } catch (e) {
                  console.warn('Failed to parse stream event:', line);
                }
              }
            }
          }
        } catch (err) {
          logger.error('Error reading stream:', err);
          setError(`Stream error: ${err.message}`);
        }
      };

      await processStream();

      // Reload stats after completion
      await loadStats();

      logger.log('Streaming CSV import completed');

    } catch (err) {
      logger.error('Error in streaming CSV upload:', err);
      setError(err.message);
    } finally {
      setStreamingImport(false);
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle streaming events
  const handleStreamEvent = (eventData) => {
    const timestamp = new Date().toLocaleTimeString();
    const message = `${timestamp}: ${eventData.message}`;
    
    setStreamMessages(prev => [...prev, { ...eventData, displayMessage: message }]);

    switch (eventData.type) {
      case 'start':
        setStreamProgress(prev => ({
          ...prev,
          currentMessage: eventData.message
        }));
        break;
        
      case 'headers':
        setStreamProgress(prev => ({
          ...prev,
          total: eventData.totalRows || 0,
          currentMessage: eventData.message
        }));
        break;
        
      case 'progress':
        setStreamProgress(prev => ({
          ...prev,
          processed: eventData.processed || 0,
          total: eventData.total || prev.total,
          progress: eventData.progress || 0,
          successful: eventData.successful || 0,
          duplicates: eventData.duplicates || 0,
          errors: eventData.errors || 0,
          currentMessage: eventData.message
        }));
        break;
        
      case 'chunk':
        setStreamProgress(prev => ({
          ...prev,
          currentMessage: eventData.message
        }));
        break;
        
      case 'complete':
        setStreamProgress(prev => ({
          ...prev,
          currentMessage: eventData.message
        }));
        setImportResult({
          success: true,
          summary: eventData.summary,
          errors: eventData.errors || []
        });
        break;
        
      case 'error':
        setError(eventData.message);
        setImportResult({
          success: false,
          error: eventData.error
        });
        break;
    }
  };

  // Clear all CSV imported events with streaming
  const clearImportedEvents = async () => {
    if (!confirm('Are you sure you want to delete all CSV imported events? This cannot be undone.')) {
      return;
    }

    try {
      setStreamingClear(true);
      setImporting(true);
      setError(null);
      setImportResult(null);
      setClearMessages([]);
      setClearProgress({
        processed: 0,
        totalCount: 0,
        progress: 0,
        deleted: 0,
        currentMessage: 'Initializing clear operation...',
        collections: {},
        currentCollection: '',
        collectionProgress: {},
        collectionResults: {}
      });

      // Use streaming clear endpoint
      const response = await fetch(`${API_BASE_URL}/admin/csv-import/clear-stream`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Clear failed: ${response.status}`);
      }

      // Read the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const eventData = JSON.parse(line.substring(6));
                  handleClearStreamEvent(eventData);
                } catch (e) {
                  console.warn('Failed to parse clear stream event:', line);
                }
              }
            }
          }
        } catch (err) {
          logger.error('Error reading clear stream:', err);
          setError(`Clear stream error: ${err.message}`);
        }
      };

      await processStream();

      // Reload stats after completion
      await loadStats();

      logger.log('Streaming CSV clear completed');

    } catch (err) {
      logger.error('Error in streaming CSV clear:', err);
      setError(err.message);
    } finally {
      setStreamingClear(false);
      setImporting(false);
    }
  };

  // Handle clear streaming events
  const handleClearStreamEvent = (eventData) => {
    const timestamp = new Date().toLocaleTimeString();
    const message = `${timestamp}: ${eventData.message}`;
    
    setClearMessages(prev => [...prev, { ...eventData, displayMessage: message }]);

    switch (eventData.type) {
      case 'start':
        setClearProgress(prev => ({
          ...prev,
          currentMessage: eventData.message,
          collections: {}
        }));
        break;
        
      case 'collection_start':
        setClearProgress(prev => ({
          ...prev,
          currentMessage: `Starting ${eventData.collection}...`,
          currentCollection: eventData.collection
        }));
        break;

      case 'collection_progress':
        setClearProgress(prev => ({
          ...prev,
          currentMessage: eventData.message,
          currentCollection: eventData.collection,
          collectionProgress: {
            ...prev.collectionProgress,
            [eventData.collection]: {
              processed: eventData.processed || 0,
              total: eventData.total || 0,
              deleted: eventData.deleted || 0
            }
          }
        }));
        break;

      case 'collection_complete':
        setClearProgress(prev => ({
          ...prev,
          currentMessage: `Completed ${eventData.collection}: ${eventData.deleted} deleted`,
          collectionResults: {
            ...prev.collectionResults,
            [eventData.collection]: eventData.deleted || 0
          }
        }));
        break;
        
      case 'count':
        setClearProgress(prev => ({
          ...prev,
          totalCount: eventData.totalCount || 0,
          currentMessage: eventData.message,
          collections: eventData.counts || {}
        }));
        break;
        
      case 'progress':
        setClearProgress(prev => ({
          ...prev,
          processed: eventData.processed || 0,
          totalCount: eventData.totalCount || prev.totalCount,
          progress: eventData.progress || 0,
          deleted: eventData.deleted || 0,
          currentMessage: eventData.message
        }));
        break;
        
      case 'complete':
        setClearProgress(prev => ({
          ...prev,
          currentMessage: eventData.message
        }));
        setImportResult({
          success: true,
          summary: {
            cleared: eventData.totalDeleted,
            details: eventData.summary || {}
          }
        });
        break;
        
      case 'error':
        setError(eventData.message);
        setImportResult({
          success: false,
          error: eventData.error
        });
        break;
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

        {/* Calendar Selector */}
        <div className="csv-import-section">
          <h3>Target Calendar</h3>
          <select 
            value={targetCalendarId} 
            onChange={(e) => setTargetCalendarId(e.target.value)}
            className="calendar-selector"
            style={{ width: '100%', padding: '8px', marginBottom: '20px' }}
          >
            <option value="">
              {availableCalendars.length === 0 ? 'Loading calendars...' : 'Select a calendar...'}
            </option>
            {availableCalendars.map(calendar => {
              let displayName = calendar.name || 'Unnamed Calendar';
              
              // Add owner email if available and different from calendar name
              if (calendar.owner?.emailAddress?.address && calendar.owner.emailAddress.address !== displayName) {
                displayName += ` (${calendar.owner.emailAddress.address})`;
              } else if (calendar.owner?.name && calendar.owner.name !== displayName) {
                displayName += ` (${calendar.owner.name})`;
              }
              
              // Add default indicator if available
              if (calendar.isDefaultCalendar) {
                displayName += ' ⭐';
              }
              
              return (
                <option key={calendar.id} value={calendar.id}>
                  {displayName}
                </option>
              );
            })}
          </select>
          {availableCalendars.length === 0 && (
            <p style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
              📡 Loading your available calendars...
            </p>
          )}
        </div>

      {/* Two Column Layout for Stats and Format Info */}
      <div className="csv-info-columns">
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
      </div>


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
              <div className="upload-text">Streaming CSV import...</div>
            </>
          ) : (
            <>
              <div className="upload-icon">📁</div>
              <div className="upload-text">
                <strong>Click to select or drag & drop a CSV file</strong>
                <br />
                <small>Supported format: .csv files up to 10MB</small>
                <br />
                <small>Streaming mode with real-time progress</small>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Streaming Progress */}
      {streamingImport && (
        <div className="streaming-progress" style={{
          backgroundColor: '#f8f9fa',
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          padding: '15px',
          marginTop: '15px'
        }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#495057' }}>📊 Import Progress</h4>
          
          {/* Progress Bar */}
          <div style={{
            backgroundColor: '#e9ecef',
            borderRadius: '4px',
            height: '20px',
            marginBottom: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              backgroundColor: '#007bff',
              height: '100%',
              width: `${streamProgress.progress}%`,
              transition: 'width 0.3s ease',
              borderRadius: '4px'
            }}></div>
          </div>
          
          {/* Progress Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '10px',
            marginBottom: '10px',
            fontSize: '14px'
          }}>
            <div><strong>Progress:</strong> {streamProgress.progress}%</div>
            <div><strong>Processed:</strong> {streamProgress.processed} / {streamProgress.total}</div>
            <div><strong>Successful:</strong> {streamProgress.successful}</div>
            <div><strong>Duplicates:</strong> {streamProgress.duplicates}</div>
            <div><strong>Errors:</strong> {streamProgress.errors}</div>
          </div>
          
          {/* Current Message */}
          <div style={{
            fontSize: '13px',
            color: '#6c757d',
            fontStyle: 'italic',
            marginBottom: '10px'
          }}>
            {streamProgress.currentMessage}
          </div>
          
          {/* Message Log */}
          <div style={{
            maxHeight: '150px',
            overflowY: 'auto',
            backgroundColor: '#fff',
            border: '1px solid #ced4da',
            borderRadius: '4px',
            padding: '8px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            {streamMessages.map((msg, index) => (
              <div key={index} style={{
                color: msg.type === 'error' ? '#dc3545' : 
                       msg.type === 'complete' ? '#28a745' : 
                       msg.type === 'progress' ? '#007bff' : '#6c757d',
                marginBottom: '2px'
              }}>
                {msg.displayMessage}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Streaming Clear Progress */}
      {streamingClear && (
        <div className="streaming-progress" style={{
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '6px',
          padding: '15px',
          marginTop: '15px'
        }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#856404' }}>🗑️ Clear Progress</h4>
          
          {/* Progress Bar */}
          <div style={{
            backgroundColor: '#ffeaa7',
            borderRadius: '4px',
            height: '20px',
            marginBottom: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              backgroundColor: '#e17055',
              height: '100%',
              width: `${clearProgress.progress}%`,
              transition: 'width 0.3s ease',
              borderRadius: '4px'
            }}></div>
          </div>
          
          {/* Clear Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '10px',
            marginBottom: '10px',
            fontSize: '14px'
          }}>
            <div><strong>Progress:</strong> {clearProgress.progress || 0}%</div>
            <div><strong>Total Count:</strong> {typeof clearProgress.totalCount === 'number' ? clearProgress.totalCount : 0}</div>
            <div><strong>Total Deleted:</strong> {clearProgress.deleted || 0}</div>
            {clearProgress.currentCollection && (
              <div><strong>Current:</strong> {clearProgress.currentCollection}</div>
            )}
          </div>

          {/* Collection Progress */}
          {Object.keys(clearProgress.collections || {}).length > 0 && (
            <div style={{
              backgroundColor: '#f8f9fa',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              padding: '10px',
              marginBottom: '10px',
              fontSize: '13px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Collections to Clear:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '5px' }}>
                {Object.entries(clearProgress.collections).map(([collection, count]) => (
                  <div key={collection} style={{
                    padding: '4px 8px',
                    backgroundColor: clearProgress.collectionResults?.[collection] !== undefined ? '#d4edda' : '#fff',
                    border: '1px solid #ced4da',
                    borderRadius: '3px',
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}>
                    <span>{collection}:</span>
                    <span>
                      {clearProgress.collectionResults?.[collection] !== undefined 
                        ? `${clearProgress.collectionResults[collection]} deleted`
                        : `${count} found`
                      }
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Current Message */}
          <div style={{
            fontSize: '13px',
            color: '#856404',
            fontStyle: 'italic',
            marginBottom: '10px'
          }}>
            {clearProgress.currentMessage}
          </div>
          
          {/* Message Log */}
          <div style={{
            maxHeight: '150px',
            overflowY: 'auto',
            backgroundColor: '#fff',
            border: '1px solid #ffeaa7',
            borderRadius: '4px',
            padding: '8px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            {clearMessages.map((msg, index) => (
              <div key={index} style={{
                color: msg.type === 'error' ? '#dc3545' : 
                       msg.type === 'complete' ? '#28a745' : 
                       msg.type === 'progress' ? '#e17055' : '#856404',
                marginBottom: '2px'
              }}>
                {msg.displayMessage}
              </div>
            ))}
          </div>
        </div>
      )}


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
                <>
                  <p><strong>Total Cleared:</strong> {importResult.summary.cleared} events</p>
                  {importResult.summary.details && Object.keys(importResult.summary.details).length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <strong>Breakdown by Collection:</strong>
                      <div style={{ 
                        marginTop: '5px', 
                        fontSize: '14px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '5px'
                      }}>
                        {Object.entries(importResult.summary.details).map(([collection, count]) => (
                          <div key={collection} style={{
                            padding: '4px 8px',
                            backgroundColor: '#f8f9fa',
                            border: '1px solid #dee2e6',
                            borderRadius: '3px',
                            display: 'flex',
                            justifyContent: 'space-between'
                          }}>
                            <span>{collection}:</span>
                            <span><strong>{count}</strong></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
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
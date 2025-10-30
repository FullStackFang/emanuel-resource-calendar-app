// Enhanced CSV Import Component with Field Mapping
// Multi-step wizard: Upload → Map Fields → Preview → Import
import React, { useState, useRef } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import FieldMappingStep from './csv-import/FieldMappingStep';
import './CSVImportWithMapping.css';

const IMPORT_STEPS = [
  { id: 'upload', title: 'Upload File', icon: '📁', description: 'Select and analyze your Excel or CSV file' },
  { id: 'mapping', title: 'Map Fields', icon: '🔗', description: 'Connect data columns to event properties' },
  { id: 'preview', title: 'Preview', icon: '👁️', description: 'Review data before import' },
  { id: 'import', title: 'Import', icon: '⚡', description: 'Execute the import process' }
];

export default function CSVImportWithMapping({ apiToken, availableCalendars = [] }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const fileInputRef = useRef(null);
  
  // Step management
  const [currentStep, setCurrentStep] = useState('upload');
  const [stepsCompleted, setStepsCompleted] = useState(new Set());
  
  // File and analysis data
  const [selectedFile, setSelectedFile] = useState(null);
  const [csvAnalysis, setCsvAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  
  // Field mapping data
  const [fieldMappings, setFieldMappings] = useState({});
  const [mappingValid, setMappingValid] = useState(false);
  
  // Preview data
  const [previewData, setPreviwData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  
  // Import execution
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  
  // Settings - removed targetCalendarId since we're importing to templeEvents__Events collection

  // Auth headers
  const getAuthHeaders = () => {
    if (!apiToken) {
      throw new Error('API token not set');
    }
    return {
      'Authorization': `Bearer ${apiToken}`
    };
  };

  // Reset all state
  const resetWizard = () => {
    setCurrentStep('upload');
    setStepsCompleted(new Set());
    setSelectedFile(null);
    setCsvAnalysis(null);
    setAnalysisError(null);
    setFieldMappings({});
    setMappingValid(false);
    setPreviwData(null);
    setPreviewError(null);
    setImportResult(null);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Step 1: File Upload and Analysis
  const handleFileSelect = async (file) => {
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      setAnalysisError('Please select a CSV or Excel file (.csv, .xlsx, .xls)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setAnalysisError('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    setAnalysisError(null);
    await analyzeCSVFile(file);
  };

  const analyzeCSVFile = async (file) => {
    try {
      setAnalyzing(true);
      setAnalysisError(null);

      const formData = new FormData();
      formData.append('csvFile', file);

      const response = await fetch(`${API_BASE_URL}/admin/csv-import/analyze`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Analysis failed: ${response.status} - ${errorText}`);
      }

      const analysisResult = await response.json();
      setCsvAnalysis(analysisResult);
      
      // Mark upload step as completed and move to mapping
      setStepsCompleted(prev => new Set([...prev, 'upload']));
      setCurrentStep('mapping');
      
      logger.debug('CSV analysis completed:', analysisResult);
      
    } catch (error) {
      logger.error('Error analyzing CSV file:', error);
      setAnalysisError(`Failed to analyze CSV: ${error.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // Step 2: Field Mapping
  const handleMappingChange = (mappings, isValid) => {
    setFieldMappings(mappings);
    setMappingValid(isValid);
    
    if (isValid) {
      setStepsCompleted(prev => new Set([...prev, 'mapping']));
    } else {
      setStepsCompleted(prev => {
        const newSet = new Set(prev);
        newSet.delete('mapping');
        newSet.delete('preview');
        newSet.delete('import');
        return newSet;
      });
    }
  };

  // Step 3: Preview
  const generatePreview = async () => {
    if (!mappingValid || !csvAnalysis) return;

    try {
      setPreviewing(true);
      setPreviewError(null);

      const previewRequest = {
        fieldMappings,
        previewRows: 10,
        validateOnly: false
      };

      // For now, we'll generate a mock preview
      // TODO: Implement actual preview endpoint
      setTimeout(() => {
        const mockPreview = {
          previewRows: csvAnalysis.samples,
          transformedSamples: Object.entries(fieldMappings).reduce((acc, [field, mapping]) => {
            if (mapping.csvColumn && csvAnalysis.samples[mapping.csvColumn]) {
              acc[field] = csvAnalysis.samples[mapping.csvColumn].slice(0, 3);
            }
            return acc;
          }, {}),
          validationWarnings: [],
          estimatedTotal: csvAnalysis.totalRows || 0
        };
        
        setPreviwData(mockPreview);
        setStepsCompleted(prev => new Set([...prev, 'preview']));
        setPreviewing(false);
      }, 1000);

    } catch (error) {
      logger.error('Error generating preview:', error);
      setPreviewError(`Failed to generate preview: ${error.message}`);
      setPreviewing(false);
    }
  };

  // Step 4: Import Execution
  const executeImport = async () => {
    if (!selectedFile || !mappingValid) return;

    try {
      setImporting(true);
      setImportError(null);
      setImportProgress({ processed: 0, total: 0, message: 'Starting import...' });

      // Generate unique import session ID
      const importSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Prepare form data for streaming import
      const formData = new FormData();
      formData.append('csvFile', selectedFile);
      formData.append('fieldMappings', JSON.stringify(fieldMappings));
      formData.append('importSessionId', importSessionId);
      formData.append('importOptions', JSON.stringify({
        forceOverwrite: false,
        preserveEnrichments: true
      }));

      // Start streaming import
      const response = await fetch(`${API_BASE_URL}/admin/csv-import/execute`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Import request failed');
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const progressData = JSON.parse(line);

              if (progressData.type === 'progress') {
                setImportProgress({
                  processed: progressData.processed || 0,
                  total: progressData.total || 0,
                  created: progressData.created || 0,
                  updated: progressData.updated || 0,
                  skipped: progressData.skipped || 0,
                  errors: progressData.errors || 0,
                  message: progressData.message || 'Processing...'
                });
              } else if (progressData.type === 'complete') {
                setImportResult({
                  success: true,
                  importSessionId: importSessionId,
                  summary: progressData.summary,
                  statistics: progressData.statistics
                });
                setStepsCompleted(prev => new Set([...prev, 'import']));
              } else if (progressData.type === 'error') {
                throw new Error(progressData.message);
              }
            } catch (parseError) {
              logger.error('Error parsing progress data:', parseError);
            }
          }
        }
      }

      setImporting(false);

    } catch (error) {
      logger.error('Error executing import:', error);
      setImportError(`Import failed: ${error.message}`);
      setImporting(false);
    }
  };

  // Navigation
  const canGoToStep = (stepId) => {
    const stepIndex = IMPORT_STEPS.findIndex(s => s.id === stepId);
    const currentIndex = IMPORT_STEPS.findIndex(s => s.id === currentStep);
    
    // Can always go backwards
    if (stepIndex <= currentIndex) return true;
    
    // Can go forward if previous steps are completed
    const previousSteps = IMPORT_STEPS.slice(0, stepIndex);
    return previousSteps.every(step => stepsCompleted.has(step.id));
  };

  const goToStep = (stepId) => {
    if (canGoToStep(stepId)) {
      setCurrentStep(stepId);
    }
  };

  const goToNextStep = () => {
    const currentIndex = IMPORT_STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex < IMPORT_STEPS.length - 1) {
      const nextStep = IMPORT_STEPS[currentIndex + 1];
      if (canGoToStep(nextStep.id)) {
        setCurrentStep(nextStep.id);
      }
    }
  };

  const goToPreviousStep = () => {
    const currentIndex = IMPORT_STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      const prevStep = IMPORT_STEPS[currentIndex - 1];
      setCurrentStep(prevStep.id);
    }
  };

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="step-indicator">
      {IMPORT_STEPS.map((step, index) => {
        const isActive = step.id === currentStep;
        const isCompleted = stepsCompleted.has(step.id);
        const canAccess = canGoToStep(step.id);

        return (
          <div key={step.id} className="step-indicator-item">
            <button
              className={`step-button ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${!canAccess ? 'disabled' : ''}`}
              onClick={() => goToStep(step.id)}
              disabled={!canAccess}
            >
              <div className="step-icon">{isCompleted ? '✓' : step.icon}</div>
              <div className="step-info">
                <div className="step-title">{step.title}</div>
                <div className="step-description">{step.description}</div>
              </div>
            </button>
            {index < IMPORT_STEPS.length - 1 && (
              <div className={`step-connector ${isCompleted ? 'completed' : ''}`}></div>
            )}
          </div>
        );
      })}
    </div>
  );

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'upload':
        return renderUploadStep();
      case 'mapping':
        return renderMappingStep();
      case 'preview':
        return renderPreviewStep();
      case 'import':
        return renderImportStep();
      default:
        return <div>Unknown step</div>;
    }
  };

  const renderUploadStep = () => (
    <div className="upload-step">
      <div className="step-content">
        <h3>📁 Upload Your CSV File</h3>
        <p>Select a CSV file exported from Resource Scheduler or any other system. We'll analyze its structure and help you map the fields.</p>
        
        <div className="file-upload-area">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => handleFileSelect(e.target.files[0])}
            className="file-input"
            id="csv-file-input"
          />
          
          <label htmlFor="csv-file-input" className="file-upload-label">
            <div className="upload-icon">📁</div>
            <div className="upload-text">
              {selectedFile ? selectedFile.name : 'Click to select CSV file or drag & drop'}
            </div>
            <div className="upload-hint">Maximum file size: 10MB</div>
          </label>
        </div>

        {analyzing && (
          <div className="analyzing-status">
            <div className="loading-spinner"></div>
            <span>Analyzing CSV structure...</span>
          </div>
        )}

        {analysisError && (
          <div className="error-message">
            ❌ {analysisError}
          </div>
        )}

        {csvAnalysis && (
          <div className="analysis-results">
            <h4>📊 Analysis Results</h4>
            <div className="analysis-stats">
              <div className="stat-item">
                <span className="stat-label">Columns detected:</span>
                <span className="stat-value">{csvAnalysis.columns.length}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Sample rows:</span>
                <span className="stat-value">{csvAnalysis.analysisInfo.sampleSize}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Auto-mapped fields:</span>
                <span className="stat-value">{Object.keys(csvAnalysis.detectedMappings).length}</span>
              </div>
            </div>
            
            <div className="detected-columns">
              <h5>Detected Columns:</h5>
              <div className="column-list">
                {csvAnalysis.columns.map(column => (
                  <span key={column} className="column-tag">{column}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderMappingStep = () => (
    <div className="mapping-step">
      <FieldMappingStep
        csvColumns={csvAnalysis?.columns || []}
        csvSamples={csvAnalysis?.samples || {}}
        detectedMappings={csvAnalysis?.detectedMappings || {}}
        onMappingChange={handleMappingChange}
        currentMappings={fieldMappings}
      />
    </div>
  );

  const renderPreviewStep = () => (
    <div className="preview-step">
      <div className="step-content">
        <h3>👁️ Preview Import Data</h3>
        <p>Review how your data will be transformed before importing. Check for any issues or unexpected values.</p>

        <div className="preview-controls">
          <div className="calendar-selection">
            <label htmlFor="target-calendar">Target Calendar:</label>
            <select
              id="target-calendar"
              value={targetCalendarId}
              onChange={(e) => setTargetCalendarId(e.target.value)}
              className="calendar-selector"
            >
              <option value="">-- Select Target Calendar --</option>
              {availableCalendars.map(calendar => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={generatePreview}
            disabled={!mappingValid || previewing}
            className="generate-preview-btn"
          >
            {previewing ? 'Generating...' : '🔄 Generate Preview'}
          </button>
        </div>

        {previewError && (
          <div className="error-message">❌ {previewError}</div>
        )}

        {previewData && (
          <div className="preview-results">
            <div className="preview-summary">
              <h4>Import Summary</h4>
              <div className="summary-stats">
                <div className="stat">Estimated rows: {previewData.estimatedTotal}</div>
                <div className="stat">Fields mapped: {Object.keys(fieldMappings).length}</div>
                <div className="stat">Target calendar: {targetCalendarId ? availableCalendars.find(c => c.id === targetCalendarId)?.name : 'None selected'}</div>
              </div>
            </div>

            <div className="preview-table">
              <h4>Sample Transformed Data</h4>
              <table>
                <thead>
                  <tr>
                    {Object.keys(previewData.transformedSamples).map(field => (
                      <th key={field}>{field}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map(index => (
                    <tr key={index}>
                      {Object.entries(previewData.transformedSamples).map(([field, samples]) => (
                        <td key={field}>{samples[index] || '--'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderImportStep = () => (
    <div className="import-step">
      <div className="step-content">
        <h3>⚡ Execute Import</h3>
        
        {!importing && !importResult && (
          <div className="import-confirmation">
            <p>Ready to import your data with the following settings:</p>
            <div className="import-summary">
              <div className="summary-item">📄 File: {selectedFile?.name}</div>
              <div className="summary-item">📊 Estimated rows: {previewData?.estimatedTotal}</div>
              <div className="summary-item">🎯 Target calendar: {availableCalendars.find(c => c.id === targetCalendarId)?.name}</div>
              <div className="summary-item">🔗 Mapped fields: {Object.keys(fieldMappings).length}</div>
            </div>
            
            <button
              onClick={executeImport}
              className="execute-import-btn"
              disabled={!targetCalendarId}
            >
              🚀 Start Import
            </button>
          </div>
        )}

        {importing && (
          <div className="import-progress">
            <div className="progress-indicator">
              <div className="loading-spinner"></div>
              <span>Importing data...</span>
            </div>
            <div className="progress-message">{importProgress.message}</div>
          </div>
        )}

        {importResult && (
          <div className="import-results">
            <div className={`result-header ${importResult.success ? 'success' : 'error'}`}>
              {importResult.success ? '✅ Import Completed Successfully!' : '❌ Import Failed'}
            </div>
            
            {importResult.success && (
              <div className="result-stats">
                <div className="stat">Total rows processed: {importResult.totalRows}</div>
                <div className="stat">Successfully imported: {importResult.successful}</div>
                <div className="stat">Duplicates skipped: {importResult.duplicates}</div>
                <div className="stat">Errors: {importResult.errors}</div>
              </div>
            )}
            
            <div className="result-actions">
              <button onClick={resetWizard} className="start-over-btn">
                🔄 Import Another File
              </button>
            </div>
          </div>
        )}

        {importError && (
          <div className="error-message">❌ {importError}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="csv-import-with-mapping">
      <div className="import-header">
        <h2>📋 Advanced CSV Import with Field Mapping</h2>
        <p>Import events from Resource Scheduler or any CSV format with custom field mapping.</p>
      </div>

      {renderStepIndicator()}

      <div className="step-content-container">
        {renderStepContent()}
      </div>

      <div className="step-navigation">
        {currentStep !== 'upload' && (
          <button onClick={goToPreviousStep} className="nav-btn prev-btn">
            ← Previous
          </button>
        )}
        
        {currentStep !== 'import' && stepsCompleted.has(currentStep) && (
          <button onClick={goToNextStep} className="nav-btn next-btn">
            Next →
          </button>
        )}
        
        <button onClick={resetWizard} className="nav-btn reset-btn">
          🔄 Start Over
        </button>
      </div>
    </div>
  );
}
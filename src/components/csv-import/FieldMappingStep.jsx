// Field Mapping Step Component
// Allows users to map CSV columns to UnifiedEvent schema fields
import React, { useState, useEffect } from 'react';

const UNIFIED_EVENT_FIELDS = {
  // Required fields - Map to templeEvents__Events collection
  rsId: {
    label: 'Resource Scheduler ID',
    description: 'Unique identifier from Resource Scheduler (required for matching existing events)',
    required: true,
    type: 'string'
  },
  Subject: {
    label: 'Event Subject/Title',
    description: 'The name or title of the event',
    required: true,
    type: 'string'
  },
  StartDateTime: {
    label: 'Start Date/Time',
    description: 'When the event starts (ISO format or Excel datetime)',
    required: true,
    type: 'datetime'
  },
  EndDateTime: {
    label: 'End Date/Time', 
    description: 'When the event ends (ISO format or Excel datetime)',
    required: true,
    type: 'datetime'
  },

  // Optional fields from Excel
  Location: {
    label: 'Location/Room',
    description: 'Where the event takes place (e.g., Main Sanctuary)',
    required: false,
    type: 'string'
  },
  Description: {
    label: 'Description/Notes',
    description: 'Detailed information about the event',
    required: false,
    type: 'string'
  },
  Categories: {
    label: 'Categories',
    description: 'Event category (e.g., Bar/Bas Mitzvah)',
    required: false,
    type: 'string'
  },
  EventCode: {
    label: 'Event Code',
    description: 'Event type code from Resource Scheduler',
    required: false,
    type: 'string'
  },
  RequesterName: {
    label: 'Requester Name',
    description: 'Name of the person who requested the event',
    required: false,
    type: 'string'
  },
  RequesterEmail: {
    label: 'Requester Email',
    description: 'Email of the person who requested the event',
    required: false,
    type: 'string'
  },
  RequesterID: {
    label: 'Requester ID',
    description: 'ID number of the requester',
    required: false,
    type: 'number'
  },
  AllDayEvent: {
    label: 'All Day Event',
    description: 'Whether this is an all-day event (0=No, 1=Yes)',
    required: false,
    type: 'boolean'
  },
  IsRecurring: {
    label: 'Is Recurring',
    description: 'Whether this is a recurring event (0=No, 1=Yes)',
    required: false,
    type: 'boolean'
  },
  Deleted: {
    label: 'Deleted Status',
    description: 'Whether this event has been deleted (0=Active, 1=Deleted)',
    required: false,
    type: 'boolean'
  },
  StartDate: {
    label: 'Start Date (Excel Serial)',
    description: 'Excel serial date number for start date',
    required: false,
    type: 'number'
  },
  StartTime: {
    label: 'Start Time (Excel Fraction)',
    description: 'Excel time fraction for start time',
    required: false,
    type: 'number'
  },
  EndDate: {
    label: 'End Date (Excel Serial)',
    description: 'Excel serial date number for end date',
    required: false,
    type: 'number'
  },
  EndTime: {
    label: 'End Time (Excel Fraction)',
    description: 'Excel time fraction for end time',
    required: false,
    type: 'number'
  }
};

export default function FieldMappingStep({ 
  csvColumns = [], 
  csvSamples = {}, 
  detectedMappings = {}, 
  onMappingChange,
  currentMappings = {}
}) {
  const [fieldMappings, setFieldMappings] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  // Initialize field mappings with detected mappings and current mappings
  useEffect(() => {
    const initialMappings = {};
    
    // Start with detected mappings
    Object.keys(UNIFIED_EVENT_FIELDS).forEach(field => {
      initialMappings[field] = {
        csvColumn: currentMappings[field]?.csvColumn || detectedMappings[field] || null,
        samples: []
      };
    });
    
    // Update samples for mapped columns
    Object.keys(initialMappings).forEach(field => {
      const csvColumn = initialMappings[field].csvColumn;
      if (csvColumn && csvSamples[csvColumn]) {
        initialMappings[field].samples = csvSamples[csvColumn];
      }
    });
    
    setFieldMappings(initialMappings);
  }, [detectedMappings, currentMappings, csvSamples]);

  // Validate current mappings
  useEffect(() => {
    const errors = {};
    
    // Check required fields
    Object.entries(UNIFIED_EVENT_FIELDS).forEach(([field, config]) => {
      if (config.required && !fieldMappings[field]?.csvColumn) {
        errors[field] = 'This field is required';
      }
    });
    
    // Check for duplicate mappings
    const usedColumns = new Set();
    Object.entries(fieldMappings).forEach(([field, mapping]) => {
      if (mapping.csvColumn) {
        if (usedColumns.has(mapping.csvColumn)) {
          errors[field] = 'Column already mapped to another field';
        } else {
          usedColumns.add(mapping.csvColumn);
        }
      }
    });
    
    setValidationErrors(errors);
    
    // Notify parent of mapping changes
    if (onMappingChange) {
      const isValid = Object.keys(errors).length === 0;
      const mappings = {};
      Object.entries(fieldMappings).forEach(([field, mapping]) => {
        if (mapping.csvColumn) {
          mappings[field] = mapping;
        }
      });
      
      onMappingChange(mappings, isValid);
    }
  }, [fieldMappings, onMappingChange]);

  const handleColumnSelect = (field, csvColumn) => {
    setFieldMappings(prev => ({
      ...prev,
      [field]: {
        csvColumn: csvColumn === '' ? null : csvColumn,
        samples: csvColumn && csvSamples[csvColumn] ? csvSamples[csvColumn] : []
      }
    }));
  };

  const getFieldTypeIcon = (type) => {
    switch (type) {
      case 'datetime': return '📅';
      case 'number': return '#️⃣';
      case 'categories': return '🏷️';
      case 'string': return '📝';
      default: return '📄';
    }
  };

  const renderFieldMappingRow = (field, config) => {
    const mapping = fieldMappings[field] || {};
    const error = validationErrors[field];
    const hasMapping = mapping.csvColumn !== null;

    return (
      <div key={field} className={`field-mapping-row ${error ? 'error' : ''} ${hasMapping ? 'mapped' : ''}`}>
        <div className="field-info">
          <div className="field-header">
            <span className="field-type-icon">{getFieldTypeIcon(config.type)}</span>
            <span className="field-name">
              {config.label}
              {config.required && <span className="required-indicator">*</span>}
            </span>
          </div>
          <div className="field-description">{config.description}</div>
          {error && <div className="field-error">{error}</div>}
        </div>

        <div className="mapping-controls">
          <select
            value={mapping.csvColumn || ''}
            onChange={(e) => handleColumnSelect(field, e.target.value)}
            className={`column-selector ${error ? 'error' : ''}`}
          >
            <option value="">-- Select CSV Column --</option>
            {csvColumns.map(column => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>

          {mapping.samples.length > 0 && (
            <div className="sample-data">
              <div className="sample-label">Sample data:</div>
              <div className="sample-values">
                {mapping.samples.slice(0, 3).map((sample, idx) => (
                  <span key={idx} className="sample-value">
                    {sample?.toString().substring(0, 30)}
                    {sample?.toString().length > 30 ? '...' : ''}
                  </span>
                ))}
                {mapping.samples.length > 3 && (
                  <span className="sample-more">+{mapping.samples.length - 3} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const requiredFields = Object.entries(UNIFIED_EVENT_FIELDS).filter(([_, config]) => config.required);
  const optionalFields = Object.entries(UNIFIED_EVENT_FIELDS).filter(([_, config]) => !config.required);
  
  const requiredFieldsCompleted = requiredFields.every(([field]) => fieldMappings[field]?.csvColumn);
  const totalMappedFields = Object.values(fieldMappings).filter(mapping => mapping.csvColumn).length;

  return (
    <div className="field-mapping-step">
      <div className="step-header">
        <h3>📋 Map CSV Fields to Event Properties</h3>
        <p>Connect your CSV columns to the corresponding event fields. Required fields must be mapped to continue.</p>
        
        <div className="mapping-summary">
          <div className="mapping-stats">
            <span className={`stat ${requiredFieldsCompleted ? 'success' : 'warning'}`}>
              Required: {requiredFields.filter(([field]) => fieldMappings[field]?.csvColumn).length}/{requiredFields.length}
            </span>
            <span className="stat">
              Total Mapped: {totalMappedFields}/{Object.keys(UNIFIED_EVENT_FIELDS).length}
            </span>
          </div>
          
          {Object.keys(validationErrors).length > 0 && (
            <div className="validation-warning">
              ⚠️ {Object.keys(validationErrors).length} field(s) need attention
            </div>
          )}
        </div>
      </div>

      <div className="field-mappings">
        <div className="field-group">
          <h4 className="group-title">📍 Required Fields</h4>
          <div className="field-list">
            {requiredFields.map(([field, config]) => renderFieldMappingRow(field, config))}
          </div>
        </div>

        <div className="field-group">
          <h4 className="group-title">⚙️ Optional Fields</h4>
          <div className="field-list">
            {optionalFields.map(([field, config]) => renderFieldMappingRow(field, config))}
          </div>
        </div>
      </div>

      <div className="mapping-actions">
        <button 
          type="button"
          className="auto-map-btn"
          onClick={() => {
            // Auto-map based on detected mappings
            const autoMappings = {};
            Object.keys(UNIFIED_EVENT_FIELDS).forEach(field => {
              if (detectedMappings[field]) {
                autoMappings[field] = {
                  csvColumn: detectedMappings[field],
                  samples: csvSamples[detectedMappings[field]] || []
                };
              }
            });
            setFieldMappings(prev => ({ ...prev, ...autoMappings }));
          }}
        >
          🔄 Auto-Map Detected Fields
        </button>
        
        <button 
          type="button"
          className="clear-mappings-btn"
          onClick={() => {
            const clearedMappings = {};
            Object.keys(UNIFIED_EVENT_FIELDS).forEach(field => {
              clearedMappings[field] = { csvColumn: null, samples: [] };
            });
            setFieldMappings(clearedMappings);
          }}
        >
          🗑️ Clear All Mappings
        </button>
      </div>
    </div>
  );
}
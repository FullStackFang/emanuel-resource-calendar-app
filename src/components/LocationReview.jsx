// src/components/LocationReview.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './LocationReview.css';

export default function LocationReview({ apiToken }) {
  const [pendingLocations, setPendingLocations] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('pending'); // 'pending', 'all', 'merge'
  
  // Merge wizard state
  const [showMergeWizard, setShowMergeWizard] = useState(false);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTarget, setMergeTarget] = useState(null);
  const [mergeAliases, setMergeAliases] = useState(true);
  
  // Selected items for bulk operations
  const [selectedLocations, setSelectedLocations] = useState(new Set());
  
  useEffect(() => {
    loadLocations();
  }, [apiToken]);
  
  const loadLocations = async () => {
    try {
      setLoading(true);
      
      // Load pending locations
      const pendingResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/pending`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (pendingResponse.ok) {
        const pendingData = await pendingResponse.json();
        // Sort pending locations by created date (newest first)
        const sortedPending = pendingData.sort((a, b) => 
          new Date(b.createdAt) - new Date(a.createdAt)
        );
        setPendingLocations(sortedPending);
      }
      
      // Load all locations
      const allResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (allResponse.ok) {
        const allData = await allResponse.json();
        // Sort all locations by usage count (highest first), then by name
        const sortedAll = allData.sort((a, b) => {
          const usageA = a.usageCount || 0;
          const usageB = b.usageCount || 0;
          if (usageA !== usageB) {
            return usageB - usageA; // Higher usage first
          }
          return (a.name || '').localeCompare(b.name || ''); // Then alphabetical
        });
        setAllLocations(sortedAll);
      }
    } catch (err) {
      logger.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };
  
  const handleApproveLocation = async (locationId, reviewNotes = '') => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${locationId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reviewNotes })
      });
      
      if (!response.ok) throw new Error('Failed to approve location');
      
      // Reload locations
      await loadLocations();
      setSelectedLocations(new Set());
    } catch (err) {
      logger.error('Error approving location:', err);
      setError('Failed to approve location');
    }
  };
  
  const handleBulkApprove = async () => {
    const selected = Array.from(selectedLocations);
    for (const locationId of selected) {
      await handleApproveLocation(locationId, 'Bulk approved');
    }
  };
  
  const handleMergeLocations = async () => {
    if (!mergeSource || !mergeTarget) return;
    
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          sourceId: mergeSource._id,
          targetId: mergeTarget._id,
          mergeAliases
        })
      });
      
      if (!response.ok) throw new Error('Failed to merge locations');
      
      const result = await response.json();
      logger.log('Merge successful:', result);
      
      // Reset merge wizard
      setShowMergeWizard(false);
      setMergeSource(null);
      setMergeTarget(null);
      setMergeAliases(true);
      
      // Reload locations
      await loadLocations();
    } catch (err) {
      logger.error('Error merging locations:', err);
      setError('Failed to merge locations');
    }
  };
  
  const handleUpdateAliases = async (locationId, aliases) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${locationId}/aliases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ aliases })
      });
      
      if (!response.ok) throw new Error('Failed to update aliases');
      
      await loadLocations();
    } catch (err) {
      logger.error('Error updating aliases:', err);
      setError('Failed to update aliases');
    }
  };
  
  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.9) return '#10b981'; // green
    if (confidence >= 0.7) return '#f59e0b'; // amber
    if (confidence >= 0.5) return '#ef4444'; // red
    return '#6b7280'; // gray
  };
  
  const getConfidenceLabel = (confidence) => {
    if (confidence >= 0.9) return 'Exact Match';
    if (confidence >= 0.8) return 'High Confidence';
    if (confidence >= 0.7) return 'Medium Confidence';
    if (confidence >= 0.5) return 'Low Confidence';
    return 'Uncertain';
  };
  
  if (loading) {
    return <div className="location-review loading">Loading location data...</div>;
  }
  
  return (
    <div className="location-review">
      <div className="review-header">
        <h1>Location Review & Management</h1>
        <div className="header-stats">
          <span className="stat pending-count">
            {pendingLocations.length} Pending Review
          </span>
          <span className="stat total-count">
            {allLocations.filter(l => l.status === 'approved').length} Approved
          </span>
          <span className="stat merged-count">
            {allLocations.filter(l => l.status === 'merged').length} Merged
          </span>
        </div>
      </div>
      
      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError('')} className="dismiss">×</button>
        </div>
      )}
      
      <div className="review-tabs">
        <button 
          className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          Pending Review ({pendingLocations.length})
        </button>
        <button 
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All Locations ({allLocations.length})
        </button>
        <button 
          className={`tab ${activeTab === 'merge' ? 'active' : ''}`}
          onClick={() => setActiveTab('merge')}
        >
          Merge Locations
        </button>
      </div>
      
      {activeTab === 'pending' && (
        <div className="pending-review-section">
          {selectedLocations.size > 0 && (
            <div className="bulk-actions">
              <span>{selectedLocations.size} selected</span>
              <button onClick={handleBulkApprove} className="approve-btn">
                Approve Selected
              </button>
              <button onClick={() => setSelectedLocations(new Set())} className="cancel-btn">
                Clear Selection
              </button>
            </div>
          )}
          
          {pendingLocations.length === 0 ? (
            <div className="no-pending">
              ✅ No locations pending review
            </div>
          ) : (
            <div className="pending-locations-grid">
              {pendingLocations.map(location => (
                <div key={location._id} className="pending-location-card">
                  <div className="card-header">
                    <input
                      type="checkbox"
                      checked={selectedLocations.has(location._id)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedLocations);
                        if (e.target.checked) {
                          newSelected.add(location._id);
                        } else {
                          newSelected.delete(location._id);
                        }
                        setSelectedLocations(newSelected);
                      }}
                    />
                    <h3>{location.name}</h3>
                    <span className="usage-badge">{location.usageCount || 0} uses</span>
                  </div>
                  
                  <div className="card-body">
                    <div className="location-details">
                      <p><strong>Original Text:</strong> {location.originalText}</p>
                      {location.building && <p><strong>Building:</strong> {location.building}</p>}
                      {location.floor && <p><strong>Floor:</strong> {location.floor}</p>}
                      <p><strong>Import Source:</strong> {location.importSource || 'Unknown'}</p>
                      <p><strong>Created:</strong> {new Date(location.createdAt).toLocaleDateString()}</p>
                    </div>
                    
                    {location.suggestedMatchDetails && location.suggestedMatchDetails.length > 0 && (
                      <div className="suggested-matches">
                        <h4>Possible Matches:</h4>
                        {location.suggestedMatchDetails.map((match, idx) => (
                          <div key={idx} className="match-item">
                            <div 
                              className="confidence-bar"
                              style={{ 
                                background: getConfidenceColor(match.confidence),
                                width: `${match.confidence * 100}%`
                              }}
                            />
                            <span className="match-name">{match.location.name}</span>
                            <span className="match-confidence">
                              {getConfidenceLabel(match.confidence)} ({(match.confidence * 100).toFixed(0)}%)
                            </span>
                            <button 
                              onClick={() => {
                                setMergeSource(location);
                                setMergeTarget(match.location);
                                setShowMergeWizard(true);
                                setActiveTab('merge');
                              }}
                              className="merge-btn"
                            >
                              Merge →
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {location.seenVariations && location.seenVariations.length > 1 && (
                      <div className="variations">
                        <h4>Seen Variations:</h4>
                        <div className="variation-list">
                          {location.seenVariations.map((v, idx) => (
                            <span key={idx} className="variation-tag">{v}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="card-actions">
                    <button 
                      onClick={() => handleApproveLocation(location._id)}
                      className="approve-btn"
                    >
                      Approve as New
                    </button>
                    <button 
                      onClick={() => {
                        setMergeSource(location);
                        setActiveTab('merge');
                      }}
                      className="merge-select-btn"
                    >
                      Select for Merge
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {activeTab === 'all' && (
        <div className="all-locations-section">
          <div className="locations-table-container">
            <table className="locations-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Aliases</th>
                  <th>Usage</th>
                  <th>Confidence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allLocations.map(location => (
                  <tr key={location._id} className={`status-${location.status}`}>
                    <td>
                      <strong>{location.name}</strong>
                      {location.locationCode && (
                        <span className="location-code"> ({location.locationCode})</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${location.status}`}>
                        {location.status || 'approved'}
                      </span>
                    </td>
                    <td>
                      <div className="aliases-cell">
                        {location.aliases && location.aliases.length > 0 ? (
                          location.aliases.map((alias, idx) => (
                            <span key={idx} className="alias-tag">{alias}</span>
                          ))
                        ) : (
                          <span className="no-aliases">None</span>
                        )}
                      </div>
                    </td>
                    <td className="usage-cell">
                      {location.usageCount || 0}
                    </td>
                    <td>
                      {location.confidence && (
                        <div className="confidence-display">
                          <div 
                            className="confidence-meter"
                            style={{ 
                              background: getConfidenceColor(location.confidence),
                              width: `${location.confidence * 100}%`
                            }}
                          />
                          <span>{(location.confidence * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                    <td className="actions-cell">
                      {location.status !== 'merged' && (
                        <>
                          <button 
                            onClick={() => {
                              const newAliases = prompt('Enter aliases (comma-separated):', 
                                location.aliases?.join(', ') || '');
                              if (newAliases !== null) {
                                handleUpdateAliases(location._id, 
                                  newAliases.split(',').map(a => a.trim()).filter(Boolean)
                                );
                              }
                            }}
                            className="edit-aliases-btn"
                          >
                            Edit Aliases
                          </button>
                          <button 
                            onClick={() => {
                              setMergeSource(location);
                              setActiveTab('merge');
                            }}
                            className="select-merge-btn"
                          >
                            Merge
                          </button>
                        </>
                      )}
                      {location.mergedInto && (
                        <span className="merged-info">
                          → Merged into #{location.mergedInto}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {activeTab === 'merge' && (
        <div className="merge-section">
          {showMergeWizard ? (
            <div className="merge-wizard">
              <h2>Merge Locations</h2>
              
              <div className="merge-preview">
                <div className="merge-source">
                  <h3>Source (Will be merged)</h3>
                  <div className="location-info">
                    <strong>{mergeSource?.name}</strong>
                    <p>Usage: {mergeSource?.usageCount || 0}</p>
                    {mergeSource?.aliases && mergeSource.aliases.length > 0 && (
                      <p>Aliases: {mergeSource.aliases.join(', ')}</p>
                    )}
                  </div>
                </div>
                
                <div className="merge-arrow">→</div>
                
                <div className="merge-target">
                  <h3>Target (Will be kept)</h3>
                  <div className="location-info">
                    <strong>{mergeTarget?.name}</strong>
                    <p>Usage: {mergeTarget?.usageCount || 0}</p>
                    {mergeTarget?.aliases && mergeTarget.aliases.length > 0 && (
                      <p>Aliases: {mergeTarget.aliases.join(', ')}</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="merge-options">
                <label>
                  <input
                    type="checkbox"
                    checked={mergeAliases}
                    onChange={(e) => setMergeAliases(e.target.checked)}
                  />
                  Add source name and aliases to target location
                </label>
              </div>
              
              <div className="merge-actions">
                <button onClick={handleMergeLocations} className="confirm-merge-btn">
                  Confirm Merge
                </button>
                <button 
                  onClick={() => {
                    setShowMergeWizard(false);
                    setMergeSource(null);
                    setMergeTarget(null);
                  }}
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="merge-selector">
              <h2>Select Locations to Merge</h2>
              
              <div className="merge-selection">
                <div className="selection-column">
                  <h3>Source Location (to merge from)</h3>
                  {mergeSource ? (
                    <div className="selected-location">
                      <strong>{mergeSource.name}</strong>
                      <button onClick={() => setMergeSource(null)} className="clear-btn">
                        Clear
                      </button>
                    </div>
                  ) : (
                    <p className="selection-hint">Select from the list below or go to another tab</p>
                  )}
                </div>
                
                <div className="selection-column">
                  <h3>Target Location (to merge into)</h3>
                  {mergeTarget ? (
                    <div className="selected-location">
                      <strong>{mergeTarget.name}</strong>
                      <button onClick={() => setMergeTarget(null)} className="clear-btn">
                        Clear
                      </button>
                    </div>
                  ) : (
                    <p className="selection-hint">Select from the list below</p>
                  )}
                </div>
              </div>
              
              {mergeSource && mergeTarget && (
                <button 
                  onClick={() => setShowMergeWizard(true)}
                  className="start-merge-btn"
                >
                  Review Merge →
                </button>
              )}
              
              <div className="location-selector-list">
                <h3>Available Locations</h3>
                <div className="selector-grid">
                  {allLocations
                    .filter(l => l.status !== 'merged')
                    .map(location => (
                      <div key={location._id} className="selector-item">
                        <span>{location.name}</span>
                        <div className="selector-actions">
                          {(!mergeSource || mergeSource._id !== location._id) && (
                            <button 
                              onClick={() => setMergeSource(location)}
                              className="select-source-btn"
                            >
                              Source
                            </button>
                          )}
                          {(!mergeTarget || mergeTarget._id !== location._id) && 
                           mergeSource && mergeSource._id !== location._id && (
                            <button 
                              onClick={() => setMergeTarget(location)}
                              className="select-target-btn"
                            >
                              Target
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
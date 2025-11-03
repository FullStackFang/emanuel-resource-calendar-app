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
  const [activeTab, setActiveTab] = useState('pending'); // 'pending', 'all', 'merge', 'assignment'

  // Merge wizard state
  const [showMergeWizard, setShowMergeWizard] = useState(false);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTarget, setMergeTarget] = useState(null);
  const [mergeAliases, setMergeAliases] = useState(true);

  // Selected items for bulk operations
  const [selectedLocations, setSelectedLocations] = useState(new Set());

  // Assignment tab state
  const [unassignedStrings, setUnassignedStrings] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState({});
  const [assigningString, setAssigningString] = useState(null);

  // Toast notification state
  const [toast, setToast] = useState(null);

  // Location modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null); // null for create, location object for edit
  const [locationFormData, setLocationFormData] = useState({
    name: '',
    displayName: '',
    aliases: [],
    locationCode: '',
    building: '',
    floor: '',
    capacity: '',
    features: [],
    accessibility: [],
    address: '',
    description: '',
    notes: ''
  });

  // Show toast notification
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Detect if a location string contains multiple locations (comma-separated)
  const isMultiLocationString = (locationString) => {
    // Check if it has commas (likely multiple locations)
    const hasCommas = locationString.includes(',');
    const parts = locationString.split(',').map(s => s.trim()).filter(s => s.length > 0);
    return hasCommas && parts.length > 1;
  };

  // Split multi-location string into individual parts
  const splitLocationString = (locationString) => {
    return locationString.split(',').map(s => s.trim()).filter(s => s.length > 0);
  };

  useEffect(() => {
    loadLocations();
    fetchUnassignedStrings(); // Load on initial mount
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

  // Assignment tab functions
  const fetchUnassignedStrings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/unassigned-strings`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch unassigned strings: ${response.statusText}`);
      }

      const data = await response.json();
      setUnassignedStrings(data);
      logger.log(`Loaded ${data.length} unassigned location strings`);
    } catch (err) {
      logger.error('Error fetching unassigned strings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignString = async (locationString, locationId) => {
    try {
      setAssigningString(locationString);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/assign-string`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          locationString,
          locationId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to assign location: ${response.statusText}`);
      }

      const result = await response.json();
      logger.log(`Assigned "${locationString}" to ${result.locationName}, updated ${result.eventsUpdated} events`);

      // Show success toast
      showToast(`✅ Assigned "${locationString}" to ${result.locationName} (${result.eventsUpdated} events updated)`, 'success');

      // Update unassigned strings list by removing the assigned string
      setUnassignedStrings(prev => prev.filter(item => item.locationString !== locationString));

      // Update the location in allLocations to reflect new alias
      setAllLocations(prev => prev.map(loc => {
        if (loc._id === locationId) {
          return {
            ...loc,
            aliases: result.updatedAliases || loc.aliases,
            usageCount: (loc.usageCount || 0) + result.eventsUpdated
          };
        }
        return loc;
      }));

      // Clear the selected location for this string
      setSelectedLocationIds(prev => {
        const newState = { ...prev };
        delete newState[locationString];
        return newState;
      });
    } catch (err) {
      logger.error('Error assigning location:', err);
      showToast(`❌ Error: ${err.message}`, 'error');
    } finally {
      setAssigningString(null);
    }
  };

  // Location CRUD handlers
  const handleCreateLocation = () => {
    setEditingLocation(null);
    setLocationFormData({
      name: '',
      displayName: '',
      aliases: [],
      locationCode: '',
      building: '',
      floor: '',
      capacity: '',
      features: [],
      accessibility: [],
      address: '',
      description: '',
      notes: ''
    });
    setShowLocationModal(true);
  };

  const handleEditLocation = (location) => {
    setEditingLocation(location);
    setLocationFormData({
      name: location.name || '',
      displayName: location.displayName || '',
      aliases: location.aliases || [],
      locationCode: location.locationCode || '',
      building: location.building || '',
      floor: location.floor || '',
      capacity: location.capacity?.toString() || '',
      features: location.features || [],
      accessibility: location.accessibility || [],
      address: location.address || '',
      description: location.description || '',
      notes: location.notes || ''
    });
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    try {
      const url = editingLocation
        ? `${APP_CONFIG.API_BASE_URL}/admin/locations/${editingLocation._id}`
        : `${APP_CONFIG.API_BASE_URL}/admin/locations`;

      const method = editingLocation ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(locationFormData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save location');
      }

      const savedLocation = await response.json();

      if (editingLocation) {
        // Update existing location in list
        setAllLocations(prev => prev.map(loc =>
          loc._id === savedLocation._id ? savedLocation : loc
        ));
        showToast(`✅ Updated location: ${savedLocation.name}`, 'success');
      } else {
        // Add new location to list
        setAllLocations(prev => [savedLocation, ...prev]);
        showToast(`✅ Created location: ${savedLocation.name}`, 'success');
      }

      setShowLocationModal(false);
      setEditingLocation(null);
    } catch (err) {
      logger.error('Error saving location:', err);
      showToast(`❌ Error: ${err.message}`, 'error');
    }
  };

  const handleDeleteLocation = async (location) => {
    try {
      // First, fetch the count of events referencing this location
      const countResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}/event-count`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      let eventCount = 0;
      if (countResponse.ok) {
        const countData = await countResponse.json();
        eventCount = countData.eventCount || 0;
      }

      // Show confirmation with event count
      const confirmMessage = eventCount > 0
        ? `Delete "${location.name}"?\n\nThis will remove it from ${eventCount} event${eventCount === 1 ? '' : 's'}.`
        : `Delete "${location.name}"?\n\nNo events are currently using this location.`;

      if (!confirm(confirmMessage)) {
        return;
      }

      // Proceed with deletion
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete location');
      }

      const result = await response.json();

      // Remove from list
      setAllLocations(prev => prev.filter(loc => loc._id !== location._id));

      // Show success message with cleanup info
      const successMessage = result.eventsUpdated > 0
        ? `✅ Deleted "${location.name}" and removed it from ${result.eventsUpdated} event${result.eventsUpdated === 1 ? '' : 's'}`
        : `✅ Deleted location: ${location.name}`;

      showToast(successMessage, 'success');
    } catch (err) {
      logger.error('Error deleting location:', err);
      showToast(`❌ Error: ${err.message}`, 'error');
    }
  };

  const handleCloseModal = () => {
    setShowLocationModal(false);
    setEditingLocation(null);
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
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          {toast.message}
          <button onClick={() => setToast(null)} className="toast-close">×</button>
        </div>
      )}

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
        <button
          className={`tab ${activeTab === 'assignment' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('assignment');
            if (unassignedStrings.length === 0) {
              fetchUnassignedStrings();
            }
          }}
        >
          Location Assignment ({unassignedStrings.length})
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
          <div className="all-locations-header">
            <button onClick={handleCreateLocation} className="create-location-btn">
              + Create Location
            </button>
          </div>

          <div className="locations-table-container">
            <table className="locations-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Building/Floor</th>
                  <th>Status</th>
                  <th>Aliases</th>
                  <th>Usage</th>
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
                    <td className="building-cell">
                      {location.building && <div className="building">{location.building}</div>}
                      {location.floor && <div className="floor">Floor: {location.floor}</div>}
                    </td>
                    <td>
                      <span className={`status-badge ${location.status}`}>
                        {location.status || 'approved'}
                      </span>
                    </td>
                    <td>
                      <div className="aliases-cell">
                        {location.aliases && location.aliases.length > 0 ? (
                          location.aliases.slice(0, 3).map((alias, idx) => (
                            <span key={idx} className="alias-tag">{alias}</span>
                          ))
                        ) : (
                          <span className="no-aliases">None</span>
                        )}
                        {location.aliases && location.aliases.length > 3 && (
                          <span className="more-aliases">+{location.aliases.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="usage-cell">
                      {location.usageCount || 0}
                    </td>
                    <td className="actions-cell">
                      {location.status !== 'merged' && location.status !== 'deleted' && (
                        <>
                          <button
                            onClick={() => handleEditLocation(location)}
                            className="edit-location-btn"
                            title="Edit location details"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setMergeSource(location);
                              setActiveTab('merge');
                            }}
                            className="select-merge-btn"
                            title="Merge this location"
                          >
                            Merge
                          </button>
                          <button
                            onClick={() => handleDeleteLocation(location)}
                            className="delete-location-btn"
                            title="Soft delete this location"
                          >
                            Delete
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

      {activeTab === 'assignment' && (
        <div className="assignment-section">
          <div className="assignment-header">
            <p className="description">
              Assign location strings from events to physical or virtual locations.
              Each assignment creates an alias for automatic matching of future events.
            </p>
          </div>

          <div className="assignment-stats">
            <div className="stat-card">
              <div className="stat-value">{unassignedStrings.length}</div>
              <div className="stat-label">Unassigned Strings</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{allLocations.length}</div>
              <div className="stat-label">Total Locations</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {unassignedStrings.reduce((sum, item) => sum + item.eventCount, 0)}
              </div>
              <div className="stat-label">Events to Process</div>
            </div>
          </div>

          {unassignedStrings.length === 0 ? (
            <div className="no-results">
              <p>✨ All location strings have been assigned!</p>
              <p className="sub-text">New events will automatically match based on existing aliases.</p>
            </div>
          ) : (
            <div className="assignment-list">
              <div className="list-header">
                <span className="col-location">Location String</span>
                <span className="col-events">Events</span>
                <span className="col-action">Assign To</span>
              </div>

              {unassignedStrings.map((item) => {
                const isMulti = isMultiLocationString(item.locationString);
                const parts = isMulti ? splitLocationString(item.locationString) : [];

                // For multi-location strings, show only the expanded view
                if (isMulti) {
                  return (
                    <React.Fragment key={item.normalizedString}>
                      <div className="multi-location-header">
                        <div className="multi-header-content">
                          <span className="multi-label">Multiple Locations ({parts.length}):</span>
                          <span className="multi-original">{item.locationString}</span>
                        </div>
                        <div className="multi-event-count">
                          <span className="count-badge">{item.eventCount}</span>
                          <span className="count-label">events total</span>
                        </div>
                      </div>
                      <div className="expanded-locations">
                        {parts.map((part, idx) => {
                          const partKey = `${item.normalizedString}-part-${idx}`;
                          return (
                            <div key={partKey} className="sub-location-row">
                              <div className="sub-location-info">
                                <span className="part-number">{idx + 1}.</span>
                                <span className="part-text">{part}</span>
                              </div>
                              <div className="sub-assignment-action">
                                <select
                                  value={selectedLocationIds[partKey] || ''}
                                  onChange={(e) => {
                                    setSelectedLocationIds(prev => ({
                                      ...prev,
                                      [partKey]: e.target.value
                                    }));
                                  }}
                                  disabled={assigningString === part}
                                  className="location-select"
                                >
                                  <option value="">Select location...</option>
                                  <optgroup label="Physical Locations">
                                    {allLocations
                                      .filter(loc => loc.name !== 'Non-Physical Location')
                                      .map(loc => (
                                        <option key={loc._id} value={loc._id}>
                                          {loc.displayName || loc.name}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Virtual/Non-Physical">
                                    {allLocations
                                      .filter(loc => loc.name === 'Non-Physical Location')
                                      .map(loc => (
                                        <option key={loc._id} value={loc._id}>
                                          {loc.displayName || loc.name}
                                        </option>
                                      ))}
                                  </optgroup>
                                </select>
                                <button
                                  onClick={() => {
                                    const locationId = selectedLocationIds[partKey];

                                    if (!locationId) {
                                      showToast('Please select a location first', 'error');
                                      return;
                                    }

                                    handleAssignString(part, locationId);
                                  }}
                                  disabled={assigningString === part || !selectedLocationIds[partKey]}
                                  className="assign-btn small"
                                  title={`Assign "${part}"`}
                                >
                                  {assigningString === part ? (
                                    <span>✓</span>
                                  ) : (
                                    <span>Assign</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </React.Fragment>
                  );
                }

                // For single-location strings, show normal row
                return (
                  <div key={item.normalizedString} className="assignment-row">
                    <div className="location-info">
                      <div className="location-string">
                        {item.locationString}
                      </div>
                      <div className="normalized-string">
                        normalized: {item.normalizedString}
                      </div>
                    </div>

                    <div className="event-count">
                      <span className="count-badge">{item.eventCount}</span>
                      <span className="count-label">events</span>
                    </div>

                    <div className="assignment-action">
                      <select
                        value={selectedLocationIds[item.normalizedString] || ''}
                        onChange={(e) => {
                          setSelectedLocationIds(prev => ({
                            ...prev,
                            [item.normalizedString]: e.target.value
                          }));
                        }}
                        disabled={assigningString === item.locationString}
                        className="location-select"
                      >
                        <option value="">Select location...</option>
                        <optgroup label="Physical Locations">
                          {allLocations
                            .filter(loc => loc.name !== 'Non-Physical Location')
                            .map(loc => (
                              <option key={loc._id} value={loc._id}>
                                {loc.displayName || loc.name}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Virtual/Non-Physical">
                          {allLocations
                            .filter(loc => loc.name === 'Non-Physical Location')
                            .map(loc => (
                              <option key={loc._id} value={loc._id}>
                                {loc.displayName || loc.name}
                              </option>
                            ))}
                        </optgroup>
                      </select>

                      <button
                        onClick={() => {
                          const locationId = selectedLocationIds[item.normalizedString];

                          if (!locationId) {
                            showToast('Please select a location first', 'error');
                            return;
                          }

                          handleAssignString(item.locationString, locationId);
                        }}
                        disabled={assigningString === item.locationString || !selectedLocationIds[item.normalizedString]}
                        className="assign-btn"
                        title={`Assign "${item.locationString}" and update ${item.eventCount} events`}
                      >
                        {assigningString === item.locationString ? (
                          <span>✓ Assigning...</span>
                        ) : (
                          <span>Assign</span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="assignment-footer">
            <button onClick={fetchUnassignedStrings} disabled={loading} className="refresh-btn">
              {loading ? 'Refreshing...' : '🔄 Refresh List'}
            </button>
          </div>
        </div>
      )}

      {/* Location Create/Edit Modal */}
      {showLocationModal && (
        <div className="location-modal-overlay" onClick={handleCloseModal}>
          <div className="location-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingLocation ? 'Edit Location' : 'Create New Location'}</h2>
              <button onClick={handleCloseModal} className="modal-close">×</button>
            </div>

            <div className="modal-body">
              <div className="location-form">
                {/* Core Information Section */}
                <div className="form-section">
                  <h3>Core Information</h3>
                  <div className="form-row">
                    <div className="form-field">
                      <label>Name *</label>
                      <input
                        type="text"
                        value={locationFormData.name}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Main Chapel"
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>Display Name</label>
                      <input
                        type="text"
                        value={locationFormData.displayName}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, displayName: e.target.value }))}
                        placeholder="e.g., Main Chapel - Sanctuary"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-field">
                      <label>Location Code</label>
                      <input
                        type="text"
                        value={locationFormData.locationCode}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, locationCode: e.target.value }))}
                        placeholder="e.g., TPL, CPL"
                      />
                    </div>
                  </div>

                  <div className="form-field full-width">
                    <label>Aliases (comma-separated)</label>
                    <input
                      type="text"
                      value={locationFormData.aliases.join(', ')}
                      onChange={(e) => setLocationFormData(prev => ({
                        ...prev,
                        aliases: e.target.value.split(',').map(a => a.trim()).filter(a => a)
                      }))}
                      placeholder="e.g., Temple, Main Temple, Sanctuary"
                    />
                    <small>Alternative names for automatic matching</small>
                  </div>
                </div>

                {/* Physical Details Section */}
                <div className="form-section">
                  <h3>Physical Details</h3>
                  <div className="form-row">
                    <div className="form-field">
                      <label>Building</label>
                      <input
                        type="text"
                        value={locationFormData.building}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, building: e.target.value }))}
                        placeholder="e.g., Main Building"
                      />
                    </div>
                    <div className="form-field">
                      <label>Floor</label>
                      <input
                        type="text"
                        value={locationFormData.floor}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, floor: e.target.value }))}
                        placeholder="e.g., 2nd Floor, Basement"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-field">
                      <label>Capacity</label>
                      <input
                        type="number"
                        value={locationFormData.capacity}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, capacity: e.target.value }))}
                        placeholder="Maximum occupancy"
                        min="0"
                      />
                    </div>
                    <div className="form-field">
                      <label>Address</label>
                      <input
                        type="text"
                        value={locationFormData.address}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="Physical address"
                      />
                    </div>
                  </div>
                </div>

                {/* Features & Accessibility Section */}
                <div className="form-section">
                  <h3>Features & Accessibility</h3>
                  <div className="form-field full-width">
                    <label>Features (comma-separated)</label>
                    <input
                      type="text"
                      value={locationFormData.features.join(', ')}
                      onChange={(e) => setLocationFormData(prev => ({
                        ...prev,
                        features: e.target.value.split(',').map(f => f.trim()).filter(f => f)
                      }))}
                      placeholder="e.g., projector, kitchen, stage, sound system"
                    />
                  </div>

                  <div className="form-field full-width">
                    <label>Accessibility (comma-separated)</label>
                    <input
                      type="text"
                      value={locationFormData.accessibility.join(', ')}
                      onChange={(e) => setLocationFormData(prev => ({
                        ...prev,
                        accessibility: e.target.value.split(',').map(a => a.trim()).filter(a => a)
                      }))}
                      placeholder="e.g., wheelchair accessible, elevator, ramp"
                    />
                  </div>
                </div>

                {/* Additional Information Section */}
                <div className="form-section">
                  <h3>Additional Information</h3>
                  <div className="form-field full-width">
                    <label>Description</label>
                    <textarea
                      value={locationFormData.description}
                      onChange={(e) => setLocationFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe this location..."
                      rows="3"
                    />
                  </div>

                  <div className="form-field full-width">
                    <label>Internal Notes</label>
                    <textarea
                      value={locationFormData.notes}
                      onChange={(e) => setLocationFormData(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Internal notes for staff..."
                      rows="2"
                    />
                  </div>
                </div>

                {editingLocation && (
                  <div className="form-section read-only">
                    <h3>System Information</h3>
                    <div className="form-row">
                      <div className="info-field">
                        <label>Status:</label>
                        <span>{editingLocation.status || 'approved'}</span>
                      </div>
                      <div className="info-field">
                        <label>Usage Count:</label>
                        <span>{editingLocation.usageCount || 0} events</span>
                      </div>
                    </div>
                    {editingLocation.createdAt && (
                      <div className="info-field">
                        <label>Created:</label>
                        <span>{new Date(editingLocation.createdAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={handleCloseModal} className="cancel-btn">
                Cancel
              </button>
              <button onClick={handleSaveLocation} className="save-btn">
                {editingLocation ? 'Save Changes' : 'Create Location'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// src/components/LocationReview.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useLocations } from '../context/LocationContext';
import './LocationReview.css';

export default function LocationReview({ apiToken }) {
  // Get refreshLocations from global context to sync after changes
  const { refreshLocations: refreshGlobalLocations } = useLocations();

  const [allLocations, setAllLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'merge', 'assignment', 'hierarchy'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'approved', 'merged', 'deleted'

  // Merge wizard state
  const [showMergeWizard, setShowMergeWizard] = useState(false);
  const [mergeSources, setMergeSources] = useState([]); // Array for multiple sources
  const [mergeTarget, setMergeTarget] = useState(null);
  const [mergeAliases, setMergeAliases] = useState(true);

  // Assignment tab state
  const [unassignedStrings, setUnassignedStrings] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState({});
  const [assigningString, setAssigningString] = useState(null);

  // Toast notification state
  const [toast, setToast] = useState(null);

  // Deletion progress state
  const [deletionProgress, setDeletionProgress] = useState(null);
  const [showDeletionModal, setShowDeletionModal] = useState(false);

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
    isReservable: false,
    address: '',
    description: '',
    notes: ''
  });

  // Hierarchy view state - tracks which parent cards are expanded
  const [expandedParents, setExpandedParents] = useState({});

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

      // Load all locations
      const allResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (allResponse.ok) {
        const allData = await allResponse.json();
        // Sort all locations by reservable status first (reservable at top), then alphabetically by name
        const sortedAll = allData.sort((a, b) => {
          // Sort by reservable first (reservable locations at top)
          if (a.isReservable !== b.isReservable) {
            return b.isReservable ? 1 : -1;
          }
          // Then alphabetically by name
          return (a.name || '').localeCompare(b.name || '');
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
  
  const handleMergeLocations = async () => {
    if (mergeSources.length === 0 || !mergeTarget) return;

    try {
      showToast(`Merging ${mergeSources.length} location${mergeSources.length === 1 ? '' : 's'}...`, 'info');

      // Merge each source into the target sequentially
      let successCount = 0;
      let totalEvents = 0;

      for (const source of mergeSources) {
        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/merge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            sourceId: source._id,
            targetId: mergeTarget._id,
            mergeAliases
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to merge ${source.name}`);
        }

        const result = await response.json();
        logger.log(`Merged ${source.name} into ${mergeTarget.name}:`, result);
        successCount++;
        totalEvents += result.eventsUpdated || 0;
      }

      // Reset merge wizard
      setShowMergeWizard(false);
      setMergeSources([]);
      setMergeTarget(null);
      setMergeAliases(true);

      // Reload locations
      await loadLocations();

      // Refresh global LocationContext
      refreshGlobalLocations();

      // Show success message
      showToast(
        `✅ Successfully merged ${successCount} location${successCount === 1 ? '' : 's'} into ${mergeTarget.name}. Updated ${totalEvents} event${totalEvents === 1 ? '' : 's'}.`,
        'success'
      );
    } catch (err) {
      logger.error('Error merging locations:', err);
      showToast(`❌ Error: ${err.message}`, 'error');
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
      isReservable: false,
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
      isReservable: location.isReservable === true,
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

      // Refresh global LocationContext so other components get the update
      refreshGlobalLocations();

      setShowLocationModal(false);
      setEditingLocation(null);
    } catch (err) {
      logger.error('Error saving location:', err);
      showToast(`❌ Error: ${err.message}`, 'error');
    }
  };

  const handleToggleReservable = async (location) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ isReservable: !location.isReservable })
      });

      if (!response.ok) throw new Error('Failed to update location reservable status');

      const updatedLocation = await response.json();
      setAllLocations(prev => prev.map(l => l._id === updatedLocation._id ? updatedLocation : l));
      showToast(`✅ ${updatedLocation.name} is now ${updatedLocation.isReservable ? 'reservable' : 'not reservable'}`, 'success');

      // Refresh global LocationContext
      refreshGlobalLocations();
    } catch (err) {
      logger.error('Error updating location reservable status:', err);
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

      // Show progress modal
      setDeletionProgress({
        locationId: location._id,
        locationName: location.name,
        status: 'starting',
        totalEvents: eventCount,
        processedEvents: 0,
        percentage: 0
      });
      setShowDeletionModal(true);

      // Start deletion
      const deletePromise = fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Poll for progress if there are events to process
      let pollInterval;
      if (eventCount > 0) {
        pollInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(
              `${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}/delete-progress`,
              {
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );

            if (progressResponse.ok) {
              const progressData = await progressResponse.json();
              setDeletionProgress(prev => ({
                ...prev,
                ...progressData
              }));
            }
          } catch (err) {
            logger.error('Error polling deletion progress:', err);
          }
        }, 500); // Poll every 500ms
      }

      // Wait for deletion to complete
      const response = await deletePromise;

      // Stop polling
      if (pollInterval) {
        clearInterval(pollInterval);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete location');
      }

      const result = await response.json();

      // Final progress update
      setDeletionProgress({
        locationId: location._id,
        locationName: location.name,
        status: 'completed',
        totalEvents: result.totalEvents || eventCount,
        processedEvents: result.eventsUpdated || 0,
        percentage: 100
      });

      // Wait a moment to show completion, then close modal
      setTimeout(() => {
        setShowDeletionModal(false);
        setDeletionProgress(null);

        // Remove from list
        setAllLocations(prev => prev.filter(loc => loc._id !== location._id));

        // Refresh global LocationContext
        refreshGlobalLocations();

        // Show success message
        const successMessage = result.eventsUpdated > 0
          ? `✅ Deleted "${location.name}" and removed it from ${result.eventsUpdated} event${result.eventsUpdated === 1 ? '' : 's'}`
          : `✅ Deleted location: ${location.name}`;

        showToast(successMessage, 'success');
      }, 1500);

    } catch (err) {
      logger.error('Error deleting location:', err);

      // Update progress to show error
      setDeletionProgress(prev => prev ? {
        ...prev,
        status: 'error',
        error: err.message
      } : null);

      // Close modal after a moment
      setTimeout(() => {
        setShowDeletionModal(false);
        setDeletionProgress(null);
        showToast(`❌ Error: ${err.message}`, 'error');
      }, 2000);
    }
  };

  const handleCloseModal = () => {
    setShowLocationModal(false);
    setEditingLocation(null);
  };

  // Truncate long strings for display
  const truncateString = (str, maxLength = 50) => {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
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
          <span className="stat total-count">
            {allLocations.length} Total Locations
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
        <button
          className={`tab ${activeTab === 'hierarchy' ? 'active' : ''}`}
          onClick={() => setActiveTab('hierarchy')}
        >
          Hierarchy View
        </button>
      </div>

      {activeTab === 'all' && (
        <div className="all-locations-section">
          <div className="all-locations-header">
            <button onClick={handleCreateLocation} className="create-location-btn">
              + Create Location
            </button>
            <div className="status-filter">
              <label htmlFor="status-filter">Filter by Status:</label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="status-filter-select"
              >
                <option value="all">All Locations ({allLocations.length})</option>
                <option value="active">Active ({allLocations.filter(l => !l.status || l.status === 'approved').length})</option>
                <option value="inactive">Inactive ({allLocations.filter(l => l.status === 'merged' || l.status === 'deleted').length})</option>
                <option value="reservable">Reservable Only ({allLocations.filter(l => l.isReservable === true).length})</option>
              </select>
            </div>
          </div>

          <div className="locations-table-container">
            <table className="locations-table">
              <thead>
                <tr>
                  <th className="details-header">Location Details</th>
                  <th className="aliases-header">Aliases</th>
                  <th className="reservable-header">Reservable</th>
                  <th className="usage-header">Usage</th>
                  <th className="actions-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allLocations
                  .filter(l => {
                    if (statusFilter === 'all') return true;
                    if (statusFilter === 'active') return !l.status || l.status === 'approved';
                    if (statusFilter === 'inactive') return l.status === 'merged' || l.status === 'deleted';
                    if (statusFilter === 'reservable') return l.isReservable === true;
                    return true;
                  })
                  .map(location => (
                  <tr key={location._id} className={`status-${location.status || 'approved'}`}>
                    <td className="location-details-cell">
                      <div className="location-summary">
                        <div className="location-name-row">
                          <strong className="location-name">{location.name}</strong>
                          {location.locationCode && (
                            <span className="location-code">({location.locationCode})</span>
                          )}
                          <span className={`status-badge ${location.status || 'approved'}`}>
                            {location.status || 'approved'}
                          </span>
                        </div>
                        <div className="location-meta">
                          {location.building && (
                            <span className="building-info">
                              {location.building}
                              {location.floor && ` • ${location.floor}`}
                            </span>
                          )}
                          {location.status === 'merged' && location.mergedInto && (
                            <span className="merge-info">→ Merged into #{location.mergedInto}</span>
                          )}
                          {location.status === 'deleted' && location.deletedBy && (
                            <span className="delete-info">Deleted by {location.deletedBy}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="aliases-cell-wide">
                      {location.aliases && location.aliases.length > 0 ? (
                        <div className="aliases-list">
                          {location.aliases.map((alias, idx) => (
                            <span key={idx} className="alias-tag">{alias}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="no-data">None</span>
                      )}
                    </td>
                    <td className="reservable-cell">
                      <button
                        className={`reservable-toggle ${location.isReservable ? 'reservable' : 'not-reservable'}`}
                        onClick={() => handleToggleReservable(location)}
                      >
                        {location.isReservable ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td className="usage-cell">
                      <span className="usage-count">{location.usageCount || 0}</span>
                    </td>
                    <td className="actions-cell">
                      {location.status !== 'merged' && location.status !== 'deleted' ? (
                        <>
                          <button
                            onClick={() => handleEditLocation(location)}
                            className="edit-location-btn"
                            title="Edit location details"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteLocation(location)}
                            className="delete-location-btn"
                            title="Soft delete this location"
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="no-actions">—</span>
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
                  <h3>Sources (Will be merged) - {mergeSources.length} location{mergeSources.length === 1 ? '' : 's'}</h3>
                  {mergeSources.map(source => (
                    <div key={source._id} className="location-info">
                      <strong title={source.name}>{truncateString(source.name, 60)}</strong>
                      <p>Usage: {source.usageCount || 0} events</p>
                      {source.aliases && source.aliases.length > 0 && (
                        <p className="aliases-preview">Aliases: {source.aliases.slice(0, 3).join(', ')}{source.aliases.length > 3 ? '...' : ''}</p>
                      )}
                    </div>
                  ))}
                  <div className="total-usage">
                    Total Events: {mergeSources.reduce((sum, s) => sum + (s.usageCount || 0), 0)}
                  </div>
                </div>

                <div className="merge-arrow">→</div>

                <div className="merge-target">
                  <h3>Target (Will be kept)</h3>
                  <div className="location-info">
                    <strong title={mergeTarget?.name}>{truncateString(mergeTarget?.name, 60)}</strong>
                    <p>Current Usage: {mergeTarget?.usageCount || 0} events</p>
                    {mergeTarget?.aliases && mergeTarget.aliases.length > 0 && (
                      <p>Current Aliases: {mergeTarget.aliases.join(', ')}</p>
                    )}
                    <p className="merged-usage">
                      Final Usage: {(mergeTarget?.usageCount || 0) + mergeSources.reduce((sum, s) => sum + (s.usageCount || 0), 0)} events
                    </p>
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
                    setMergeSources([]);
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
                  <h3>Source Locations (to merge from)</h3>
                  {mergeSources.length > 0 ? (
                    <div className="selected-locations-list">
                      {mergeSources.map(source => (
                        <div key={source._id} className="selected-location-item">
                          <strong title={source.name}>{truncateString(source.name, 40)}</strong>
                          <button
                            onClick={() => setMergeSources(prev => prev.filter(s => s._id !== source._id))}
                            className="remove-btn"
                            title="Remove from sources"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setMergeSources([])}
                        className="clear-all-btn"
                      >
                        Clear All ({mergeSources.length})
                      </button>
                    </div>
                  ) : (
                    <p className="selection-hint">Select one or more locations from the list below</p>
                  )}
                </div>

                <div className="selection-column">
                  <h3>Target Location (to merge into)</h3>
                  {mergeTarget ? (
                    <div className="selected-location">
                      <strong title={mergeTarget.name}>{truncateString(mergeTarget.name, 40)}</strong>
                      <button onClick={() => setMergeTarget(null)} className="clear-btn">
                        Clear
                      </button>
                    </div>
                  ) : (
                    <p className="selection-hint">Select one location from the list below</p>
                  )}
                </div>
              </div>

              {mergeSources.length > 0 && mergeTarget && (
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
                    .filter(l => l.status !== 'merged' && l.status !== 'deleted')
                    .map(location => {
                      const isSelectedAsSource = mergeSources.some(s => s._id === location._id);
                      const isSelectedAsTarget = mergeTarget?._id === location._id;

                      return (
                        <div key={location._id} className={`selector-item ${isSelectedAsSource ? 'selected-source' : ''} ${isSelectedAsTarget ? 'selected-target' : ''}`}>
                          <span title={location.name}>{truncateString(location.name, 50)}</span>
                          <div className="selector-actions">
                            {!isSelectedAsTarget && (
                              <button
                                onClick={() => {
                                  if (isSelectedAsSource) {
                                    // Remove from sources if already selected
                                    setMergeSources(prev => prev.filter(s => s._id !== location._id));
                                  } else {
                                    // Add to sources
                                    setMergeSources(prev => [...prev, location]);
                                  }
                                }}
                                className={`select-source-btn ${isSelectedAsSource ? 'selected' : ''}`}
                              >
                                {isSelectedAsSource ? '✓ Source' : '+ Source'}
                              </button>
                            )}
                            {!isSelectedAsSource && !isSelectedAsTarget && (
                              <button
                                onClick={() => setMergeTarget(location)}
                                className="select-target-btn"
                              >
                                Set Target
                              </button>
                            )}
                            {isSelectedAsTarget && (
                              <span className="target-badge">★ Target</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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

      {activeTab === 'hierarchy' && (() => {
        // Build parent-child hierarchy
        const reservableParents = allLocations.filter(loc =>
          loc.isReservable &&
          loc.status !== 'merged' &&
          loc.status !== 'deleted'
        );

        const locationsWithParents = allLocations.filter(loc =>
          loc.parentLocationId &&
          loc.status !== 'merged' &&
          loc.status !== 'deleted'
        );

        const standaloneLocations = allLocations.filter(loc =>
          !loc.parentLocationId &&
          loc.status !== 'merged' &&
          loc.status !== 'deleted'
        );

        // Group children by parent
        const childrenByParent = {};
        locationsWithParents.forEach(child => {
          const parentId = child.parentLocationId.toString();
          if (!childrenByParent[parentId]) {
            childrenByParent[parentId] = [];
          }
          childrenByParent[parentId].push(child);
        });

        return (
          <div className="hierarchy-section">
            <div className="hierarchy-header">
              <h3>Location Hierarchy</h3>
              <p className="description">
                Reservable locations with their linked child locations. Child locations will group under their parent on the calendar.
              </p>
            </div>

            {/* Reservable Parents with Children */}
            <div className="hierarchy-group">
              <h4 className="group-title">Reservable Locations ({reservableParents.length})</h4>

              {reservableParents.map(parent => {
                const children = childrenByParent[parent._id.toString()] || [];
                const parentId = parent._id.toString();
                const isExpanded = expandedParents[parentId] ?? (children.length > 0);

                const toggleExpanded = () => {
                  setExpandedParents(prev => ({
                    ...prev,
                    [parentId]: !isExpanded
                  }));
                };

                return (
                  <div key={parent._id} className="parent-card">
                    <div className="parent-header">
                      <div className="parent-info">
                        {children.length > 0 && (
                          <button
                            className="expand-toggle"
                            onClick={toggleExpanded}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        )}
                        <div className="parent-details">
                          <div className="parent-name">
                            {parent.displayName || parent.name}
                            {parent.locationCode && (
                              <span className="location-code"> ({parent.locationCode})</span>
                            )}
                          </div>
                          <div className="parent-meta">
                            {parent.building && <span>🏢 {parent.building}</span>}
                            {parent.floor && <span>📍 {parent.floor}</span>}
                            {parent.capacity && <span>👥 {parent.capacity}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="parent-actions">
                        <span className="child-count">
                          {children.length > 0
                            ? `${children.length} linked location${children.length !== 1 ? 's' : ''}`
                            : 'No linked locations'}
                        </span>
                        <button
                          onClick={() => handleEditLocation(parent)}
                          className="action-btn"
                        >
                          Edit
                        </button>
                      </div>
                    </div>

                    {isExpanded && children.length > 0 && (
                      <div className="children-list">
                        {children.map(child => (
                          <div key={child._id} className="child-item">
                            <div className="child-details">
                              <span className="child-name">
                                {child.displayName || child.name}
                              </span>
                              {child.importSource && (
                                <span className="import-badge">{child.importSource}</span>
                              )}
                              {child.usageCount > 0 && (
                                <span className="usage-info">
                                  {child.usageCount} event{child.usageCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div className="child-actions">
                              <button
                                onClick={() => handleEditLocation(child)}
                                className="action-btn-small"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Standalone Locations */}
            {standaloneLocations.length > 0 && (
              <div className="hierarchy-group">
                <h4 className="group-title">
                  Standalone Locations ({standaloneLocations.filter(l => !l.isReservable).length} non-reservable)
                </h4>
                <div className="standalone-list">
                  {standaloneLocations
                    .filter(loc => !loc.isReservable)
                    .map(location => (
                      <div key={location._id} className="standalone-item">
                        <div className="standalone-details">
                          <span className="standalone-name">
                            {location.displayName || location.name}
                          </span>
                          {location.importSource && (
                            <span className="import-badge">{location.importSource}</span>
                          )}
                        </div>
                        <button
                          onClick={() => handleEditLocation(location)}
                          className="action-btn-small"
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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

                  <div className="form-field checkbox-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={locationFormData.isReservable}
                        onChange={(e) => setLocationFormData(prev => ({ ...prev, isReservable: e.target.checked }))}
                      />
                      <span>Location is Reservable</span>
                    </label>
                    <div className="help-text">When enabled, this location can be reserved through the public reservation form</div>
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

      {/* Deletion Progress Modal */}
      {showDeletionModal && deletionProgress && (
        <div className="modal-overlay">
          <div className="modal-content deletion-progress-modal">
            <div className="modal-header">
              <h2>Deleting Location</h2>
            </div>

            <div className="modal-body">
              <div className="deletion-info">
                <p className="location-name">
                  <strong>{deletionProgress.locationName}</strong>
                </p>

                {deletionProgress.status === 'error' ? (
                  <div className="error-status">
                    <div className="error-icon">❌</div>
                    <p className="error-message">{deletionProgress.error}</p>
                  </div>
                ) : deletionProgress.status === 'completed' ? (
                  <div className="success-status">
                    <div className="success-icon">✅</div>
                    <p className="success-message">
                      Successfully deleted from {deletionProgress.processedEvents} event
                      {deletionProgress.processedEvents === 1 ? '' : 's'}
                    </p>
                  </div>
                ) : (
                  <div className="progress-status">
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${deletionProgress.percentage || 0}%` }}
                      />
                    </div>
                    <p className="progress-text">
                      {deletionProgress.status === 'starting'
                        ? 'Preparing to delete...'
                        : `Removing from events: ${deletionProgress.processedEvents || 0} / ${deletionProgress.totalEvents || 0} (${deletionProgress.percentage || 0}%)`
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>

            {(deletionProgress.status === 'completed' || deletionProgress.status === 'error') && (
              <div className="modal-footer">
                <button
                  onClick={() => {
                    setShowDeletionModal(false);
                    setDeletionProgress(null);
                  }}
                  className="close-btn"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
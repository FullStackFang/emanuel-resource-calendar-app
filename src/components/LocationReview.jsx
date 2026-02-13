// src/components/LocationReview.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useLocations } from '../context/LocationContext';
import LoadingSpinner from './shared/LoadingSpinner';
import './LocationReview.css';

export default function LocationReview({ apiToken }) {
  // Get refreshLocations from global context to sync after changes
  const { refreshLocations: refreshGlobalLocations } = useLocations();

  const [allLocations, setAllLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Toast notification state
  const [toast, setToast] = useState(null);

  // Deletion progress state
  const [deletionProgress, setDeletionProgress] = useState(null);
  const [showDeletionModal, setShowDeletionModal] = useState(false);

  // In-button delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Location modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
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

  // Show toast notification
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    loadLocations();
  }, [apiToken]);

  const loadLocations = async () => {
    try {
      setLoading(true);

      const allResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (allResponse.ok) {
        const allData = await allResponse.json();
        // Sort by reservable status first (reservable at top), then alphabetically
        const sortedAll = allData.sort((a, b) => {
          if (a.isReservable !== b.isReservable) {
            return b.isReservable ? 1 : -1;
          }
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
        setAllLocations(prev => prev.map(loc =>
          loc._id === savedLocation._id ? savedLocation : loc
        ));
        showToast(`Updated location: ${savedLocation.name}`, 'success');
      } else {
        setAllLocations(prev => [savedLocation, ...prev]);
        showToast(`Created location: ${savedLocation.name}`, 'success');
      }

      refreshGlobalLocations();
      setShowLocationModal(false);
      setEditingLocation(null);
    } catch (err) {
      logger.error('Error saving location:', err);
      showToast(`Error: ${err.message}`, 'error');
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
      showToast(`${updatedLocation.name} is now ${updatedLocation.isReservable ? 'reservable' : 'not reservable'}`, 'success');
      refreshGlobalLocations();
    } catch (err) {
      logger.error('Error updating location reservable status:', err);
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleDeleteLocationClick = (location) => {
    if (confirmDeleteId === location._id) {
      // Second click - proceed with delete
      setConfirmDeleteId(null);
      handleDeleteLocation(location);
    } else {
      // First click - show confirmation
      setConfirmDeleteId(location._id);
    }
  };

  const handleDeleteLocation = async (location) => {
    try {
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

      setDeletionProgress({
        locationId: location._id,
        locationName: location.name,
        status: 'starting',
        totalEvents: eventCount,
        processedEvents: 0,
        percentage: 0
      });
      setShowDeletionModal(true);

      const deletePromise = fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/${location._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

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
        }, 500);
      }

      const response = await deletePromise;

      if (pollInterval) {
        clearInterval(pollInterval);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete location');
      }

      const result = await response.json();

      setDeletionProgress({
        locationId: location._id,
        locationName: location.name,
        status: 'completed',
        totalEvents: result.totalEvents || eventCount,
        processedEvents: result.eventsUpdated || 0,
        percentage: 100
      });

      setTimeout(() => {
        setShowDeletionModal(false);
        setDeletionProgress(null);
        setAllLocations(prev => prev.filter(loc => loc._id !== location._id));
        refreshGlobalLocations();

        const successMessage = result.eventsUpdated > 0
          ? `Deleted "${location.name}" and removed it from ${result.eventsUpdated} event${result.eventsUpdated === 1 ? '' : 's'}`
          : `Deleted location: ${location.name}`;

        showToast(successMessage, 'success');
      }, 1500);

    } catch (err) {
      logger.error('Error deleting location:', err);

      setDeletionProgress(prev => prev ? {
        ...prev,
        status: 'error',
        error: err.message
      } : null);

      setTimeout(() => {
        setShowDeletionModal(false);
        setDeletionProgress(null);
        showToast(`Error: ${err.message}`, 'error');
      }, 2000);
    }
  };

  const handleCloseModal = () => {
    setShowLocationModal(false);
    setEditingLocation(null);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  // Calculate stats
  const stats = {
    total: allLocations.length,
    reservable: allLocations.filter(l => l.isReservable).length
  };

  return (
    <div className="location-review">
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          {toast.message}
          <button onClick={() => setToast(null)} className="toast-close">×</button>
        </div>
      )}

      {/* Page Header */}
      <div className="location-review-header">
        <div className="location-review-header-content">
          <h2>Location Management</h2>
          <p className="location-review-header-subtitle">
            Manage physical and virtual locations
          </p>
        </div>
        <button onClick={handleCreateLocation} className="add-location-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Location
        </button>
      </div>

      {/* Stats Row */}
      <div className="location-stats">
        <div className="location-stat-card total">
          <div className="location-stat-icon total">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="location-stat-content">
            <h4>{stats.total}</h4>
            <p>Total Locations</p>
          </div>
        </div>

        <div className="location-stat-card reservable">
          <div className="location-stat-icon reservable">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="location-stat-content">
            <h4>{stats.reservable}</h4>
            <p>Reservable</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
          <button onClick={() => setError('')} className="dismiss">×</button>
        </div>
      )}

      {/* Locations Section */}
      <div className="all-locations-section">
        <div className="all-locations-header">
          <div className="filter-group">
            <label htmlFor="status-filter">Filter:</label>
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
                        >
                          Edit
                        </button>
                        <div className="confirm-button-group" style={{ display: 'inline-flex' }}>
                          <button
                            onClick={() => handleDeleteLocationClick(location)}
                            className={`delete-location-btn ${confirmDeleteId === location._id ? 'confirming' : ''}`}
                            disabled={deletionProgress?.locationId === location._id}
                          >
                            {deletionProgress?.locationId === location._id
                              ? 'Deleting...'
                              : confirmDeleteId === location._id
                                ? 'Confirm?'
                                : 'Delete'}
                          </button>
                          {confirmDeleteId === location._id && (
                            <button
                              className="confirm-cancel-x delete-cancel-x"
                              onClick={() => setConfirmDeleteId(null)}
                              style={{ padding: '0 8px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
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
                    <div className="error-icon">Error</div>
                    <p className="error-message">{deletionProgress.error}</p>
                  </div>
                ) : deletionProgress.status === 'completed' ? (
                  <div className="success-status">
                    <div className="success-icon">Done</div>
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

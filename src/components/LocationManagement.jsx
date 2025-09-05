// src/components/LocationManagement.jsx
import React, { useState, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import featureConfigService from '../services/featureConfigService';
import './LocationManagement.css';

// Icon-based multi-select for features with category support
function IconMultiSelect({ options, selectedValues, onSelectionChange, label, categories = [] }) {
  const toggleOption = (value) => {
    const newSelection = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onSelectionChange(newSelection);
  };

  // Group options by category
  const groupedOptions = options.reduce((groups, option) => {
    const category = option.category || 'other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(option);
    return groups;
  }, {});

  return (
    <div className="icon-multi-select">
      <div className="selection-header">
        <span className="selection-count">{selectedValues.length}/{options.length} selected</span>
      </div>
      
      {Object.entries(groupedOptions).map(([categoryKey, categoryOptions]) => {
        const category = categories.find(c => c.key === categoryKey);
        return (
          <div key={categoryKey} className="feature-category-group">
            <h4 className="category-header">
              {category?.name || categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1)}
            </h4>
            <div className="icon-grid">
              {categoryOptions.map(option => (
                <label key={option.value} className={`icon-option ${selectedValues.includes(option.value) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option.value)}
                    onChange={() => toggleOption(option.value)}
                    className="icon-checkbox"
                  />
                  <div className="icon-content">
                    <span className="feature-icon">{option.icon}</span>
                    <span className="feature-label">{option.label}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Multi-select dropdown component (for accessibility)
function MultiSelectDropdown({ options, selectedValues, onSelectionChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (value) => {
    const newSelection = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onSelectionChange(newSelection);
  };

  const removeTag = (value) => {
    onSelectionChange(selectedValues.filter(v => v !== value));
  };

  return (
    <div className="multi-select-dropdown" ref={dropdownRef}>
      <div className="dropdown-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="placeholder">
          {selectedValues.length === 0 ? placeholder : `${selectedValues.length} selected`}
        </span>
        <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </div>
      
      {isOpen && (
        <div className="dropdown-menu">
          {options.map(option => (
            <label key={option.value || option} className="dropdown-option">
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value || option)}
                onChange={() => toggleOption(option.value || option)}
              />
              <span>{option.label || option.replace(/-/g, ' ')}</span>
            </label>
          ))}
        </div>
      )}

      {selectedValues.length > 0 && (
        <div className="selected-tags">
          {selectedValues.map(value => {
            const option = options.find(opt => (opt.value || opt) === value);
            return (
              <span key={value} className="tag">
                {option?.label || option || value}
                <button type="button" onClick={() => removeTag(value)} className="tag-remove">
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LocationManagement({ apiToken }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingLocation, setEditingLocation] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Dynamic capabilities state
  const [capabilities, setCapabilities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  
  // Form state for add/edit
  const [formData, setFormData] = useState({
    name: '',
    locationCode: '',
    displayName: '',
    building: '',
    floor: '',
    capacity: '',
    features: [],
    accessibility: [],
    active: true,
    description: '',
    notes: ''
  });
  
  // Dynamic feature options from capabilities
  const getFeatureOptions = () => {
    return capabilities
      .filter(cap => cap.active && cap.category !== 'accessibility')
      .map(cap => ({
        value: cap.key,
        label: cap.name,
        icon: cap.icon || '📦',
        category: cap.category
      }));
  };
  
  const getAccessibilityOptions = () => {
    return capabilities
      .filter(cap => cap.active && cap.category === 'accessibility')
      .map(cap => cap.key);
  };
  
  useEffect(() => {
    loadLocations();
    loadCapabilities();
  }, [apiToken]);
  
  const loadCapabilities = async () => {
    try {
      setCapabilitiesLoading(true);
      const [categoriesData, capabilitiesData] = await Promise.all([
        featureConfigService.getCategories(),
        featureConfigService.getRoomCapabilityTypes()
      ]);
      
      setCategories(categoriesData);
      setCapabilities(capabilitiesData);
      logger.debug('Loaded capabilities:', { 
        categoriesCount: categoriesData.length,
        capabilitiesCount: capabilitiesData.length 
      });
    } catch (err) {
      logger.error('Error loading capabilities:', err);
      setError('Failed to load location capabilities');
    } finally {
      setCapabilitiesLoading(false);
    }
  };
  
  const loadLocations = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load locations');
      
      const data = await response.json();
      setLocations(data);
    } catch (err) {
      logger.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };
  
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };
  
  
  const handleAddLocation = () => {
    setFormData({
      name: '',
      locationCode: '',
      displayName: '',
      building: '',
      floor: '',
      capacity: '',
      features: [],
      accessibility: [],
      active: true,
      description: '',
      notes: ''
    });
    setEditingLocation(null);
    setShowAddForm(true);
  };
  
  const handleEditLocation = (location) => {
    setFormData({
      name: location.name || '',
      locationCode: location.locationCode || '',
      displayName: location.displayName || location.name || '',
      building: location.building || '',
      floor: location.floor || '',
      capacity: location.capacity || '',
      features: location.features || [],
      accessibility: location.accessibility || [],
      active: location.active !== false,
      description: location.description || '',
      notes: location.notes || ''
    });
    setEditingLocation(location);
    setShowAddForm(true);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...formData,
        capacity: parseInt(formData.capacity) || 0
      };
      
      const url = editingLocation 
        ? `${APP_CONFIG.API_BASE_URL}/admin/rooms/${editingLocation._id}`
        : `${APP_CONFIG.API_BASE_URL}/admin/rooms`;
      
      const method = editingLocation ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save location');
      }
      
      const savedLocation = await response.json();
      
      if (editingLocation) {
        setLocations(prev => prev.map(l => l._id === savedLocation._id ? savedLocation : l));
      } else {
        setLocations(prev => [...prev, savedLocation]);
      }
      
      setShowAddForm(false);
      setEditingLocation(null);
    } catch (err) {
      logger.error('Error saving location:', err);
      setError(err.message || 'Failed to save location');
    }
  };
  
  const handleDeleteLocation = async (locationId) => {
    if (!confirm('Are you sure you want to delete this location?')) return;
    
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/rooms/${locationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to delete location');
      
      setLocations(prev => prev.filter(l => l._id !== locationId));
    } catch (err) {
      logger.error('Error deleting location:', err);
      setError('Failed to delete location');
    }
  };
  
  const handleToggleActive = async (location) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/rooms/${location._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ ...location, active: !location.active })
      });
      
      if (!response.ok) throw new Error('Failed to update location');
      
      const updatedLocation = await response.json();
      setLocations(prev => prev.map(l => l._id === updatedLocation._id ? updatedLocation : l));
    } catch (err) {
      logger.error('Error updating location:', err);
      setError('Failed to update location status');
    }
  };
  
  if (loading) {
    return <div className="location-management loading">Loading locations...</div>;
  }
  
  return (
    <div className="location-management">
      <div className="admin-header">
        <h1>Location Management</h1>
        <button className="add-location-btn" onClick={handleAddLocation}>
          + Add New Location
        </button>
      </div>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      {showAddForm && (
        <div className="location-form-overlay">
          <div className="location-form">
            <h2>{editingLocation ? 'Edit Location' : 'Add New Location'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="name">Location Name *</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="locationCode">Location Code</label>
                  <input
                    type="text"
                    id="locationCode"
                    name="locationCode"
                    value={formData.locationCode}
                    onChange={handleInputChange}
                    placeholder="e.g., TPL, CPL, MUS"
                  />
                  <div className="help-text">Legacy calendar location code (optional)</div>
                </div>
                
                <div className="form-group">
                  <label htmlFor="displayName">Display Name</label>
                  <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    placeholder="Full descriptive name"
                  />
                  <div className="help-text">Full name shown in detailed views</div>
                </div>
                
                <div className="form-group">
                  <label htmlFor="building">Building *</label>
                  <input
                    type="text"
                    id="building"
                    name="building"
                    value={formData.building}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="floor">Floor *</label>
                  <input
                    type="text"
                    id="floor"
                    name="floor"
                    value={formData.floor}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="capacity">Capacity *</label>
                  <input
                    type="number"
                    id="capacity"
                    name="capacity"
                    value={formData.capacity}
                    onChange={handleInputChange}
                    min="1"
                    required
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Features</label>
                {capabilitiesLoading ? (
                  <div className="loading-placeholder">Loading capabilities...</div>
                ) : (
                  <IconMultiSelect
                    options={getFeatureOptions()}
                    selectedValues={formData.features}
                    onSelectionChange={(selected) => setFormData(prev => ({ ...prev, features: selected }))}
                    label="Location Features"
                    categories={categories}
                  />
                )}
              </div>
              
              <div className="form-group">
                <label>Accessibility</label>
                {capabilitiesLoading ? (
                  <div className="loading-placeholder">Loading accessibility options...</div>
                ) : (
                  <MultiSelectDropdown
                    options={getAccessibilityOptions()}
                    selectedValues={formData.accessibility}
                    onSelectionChange={(selected) => setFormData(prev => ({ ...prev, accessibility: selected }))}
                    placeholder="Select accessibility features..."
                  />
                )}
              </div>
              
              <div className="form-group">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows="3"
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="notes">Internal Notes</label>
                <textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows="2"
                />
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="active"
                    checked={formData.active}
                    onChange={handleInputChange}
                  />
                  <span>Location is Active</span>
                </label>
              </div>
              
              <div className="form-actions">
                <button type="submit" className="save-btn">
                  {editingLocation ? 'Update Location' : 'Add Location'}
                </button>
                <button 
                  type="button" 
                  className="cancel-btn"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingLocation(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      <div className="locations-table-container">
        <table className="locations-table">
          <thead>
            <tr>
              <th>Location Name</th>
              <th>Code</th>
              <th>Building/Floor</th>
              <th>Capacity</th>
              <th>Features</th>
              <th>Accessibility</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.map(location => (
              <tr key={location._id}>
                <td className="location-name">
                  <strong>{location.name}</strong>
                  {location.locationCode && (
                    <div className="location-code">Code: {location.locationCode}</div>
                  )}
                  {location.description && (
                    <div className="location-desc">{location.description}</div>
                  )}
                </td>
                <td className="location-code-cell">
                  {location.locationCode ? (
                    <span className="code-badge">{location.locationCode}</span>
                  ) : (
                    <span className="no-data">None</span>
                  )}
                </td>
                <td>{location.building} - {location.floor}</td>
                <td className="capacity">{location.capacity}</td>
                <td className="features">
                  {location.features?.length > 0 ? (
                    <div className="tag-list">
                      {location.features.slice(0, 3).map(f => (
                        <span key={f} className="tag">{f}</span>
                      ))}
                      {location.features.length > 3 && (
                        <span className="tag">+{location.features.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    <span className="no-data">None</span>
                  )}
                </td>
                <td className="accessibility">
                  {location.accessibility?.length > 0 ? (
                    <div className="tag-list">
                      {location.accessibility.map(a => (
                        <span key={a} className="tag accessibility-tag">♿ {a}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="no-data">None</span>
                  )}
                </td>
                <td>
                  <button
                    className={`status-toggle ${location.active ? 'active' : 'inactive'}`}
                    onClick={() => handleToggleActive(location)}
                  >
                    {location.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="actions">
                  <button
                    className="edit-btn"
                    onClick={() => handleEditLocation(location)}
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteLocation(location._id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {locations.length === 0 && (
          <div className="no-locations">
            No locations found. Click "Add New Location" to get started.
          </div>
        )}
      </div>
    </div>
  );
}
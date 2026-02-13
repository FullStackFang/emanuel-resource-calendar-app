// src/components/FeatureManagement.jsx
import React, { useState, useEffect } from 'react';
import featureConfigService from '../services/featureConfigService';
import LoadingSpinner from './shared/LoadingSpinner';
import { logger } from '../utils/logger';
import './FeatureManagement.css';

export default function FeatureManagement({ apiToken }) {
  const [activeTab, setActiveTab] = useState('capabilities');
  const [categories, setCategories] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  // In-button delete confirmation state: tracks { id, type } of item being confirmed
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  
  // Form state for adding new items
  const [formData, setFormData] = useState({
    key: '',
    name: '',
    description: '',
    category: '',
    dataType: 'boolean',
    icon: '',
    displayOrder: 1,
    active: true,
    hasCost: false
  });

  // Available icons for selection
  const availableIcons = [
    '🍽️', '📽️', '🎬', '📝', '🎹', '🎭', '🎤', '🪑', '📺', '🔊',
    '💡', '❄️', '🌐', '🖥️', '☕', '📚', '💃', '👶', '♿', '🦻',
    '🌸', '🕯️', '📹', '✡️', '🏛️', '📍', '🎯', '🎨', '🎪', '🎻'
  ];

  useEffect(() => {
    loadFeatureConfig();
  }, []);

  const loadFeatureConfig = async () => {
    try {
      setLoading(true);
      setError('');

      const [categoriesData, capabilitiesData, servicesData] = await Promise.all([
        featureConfigService.getCategories(),
        featureConfigService.getRoomCapabilityTypes(),
        featureConfigService.getEventServiceTypes()
      ]);

      setCategories(categoriesData);
      setCapabilities(capabilitiesData);
      setServices(servicesData);
    } catch (err) {
      logger.error('Error loading feature configuration:', err);
      setError('Failed to load feature configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = (type) => {
    setAddType(type);
    setIsEditMode(false);
    setEditingItem(null);
    setShowAddModal(true);
    setFormData({
      key: '',
      name: '',
      description: '',
      category: type === 'category' ? '' : (categories[0]?.key || ''),
      dataType: 'boolean',
      icon: '',
      displayOrder: 1,
      active: true,
      hasCost: false
    });
  };

  const handleEdit = (item, type) => {
    setAddType(type);
    setIsEditMode(true);
    setEditingItem(item);
    setShowAddModal(true);
    setFormData({
      key: item.key,
      name: item.name,
      description: item.description || '',
      category: item.category || (categories[0]?.key || ''),
      dataType: item.dataType || 'boolean',
      icon: item.icon || '',
      displayOrder: item.displayOrder || 1,
      active: item.active !== false,
      hasCost: item.hasCost === true
    });
  };


  const handleDeleteClick = (item, type) => {
    if (confirmDeleteId === item._id) {
      // Second click - proceed with delete
      setConfirmDeleteId(null);
      confirmDelete(item, type);
    } else {
      // First click - show confirmation
      setConfirmDeleteId(item._id);
    }
  };

  const confirmDelete = async (item, type) => {
    try {
      setError('');
      setDeletingId(item._id);

      if (!apiToken) {
        throw new Error('Authentication required');
      }

      switch (type) {
        case 'category':
          await featureConfigService.deleteCategory(item._id, apiToken);
          break;
        case 'capability':
          await featureConfigService.deleteRoomCapability(item._id, apiToken);
          break;
        case 'service':
          await featureConfigService.deleteEventService(item._id, apiToken);
          break;
        default:
          throw new Error('Invalid type');
      }

      logger.info('Feature deleted successfully:', { type, id: item._id, key: item.key });

      // Reload the configuration
      await loadFeatureConfig();
    } catch (err) {
      logger.error('Error deleting feature:', err);
      setError(err.message || 'Failed to delete feature');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setError('');
      
      if (!apiToken) {
        throw new Error('Authentication required');
      }

      let result;
      
      if (isEditMode && editingItem) {
        // Update existing item
        switch (addType) {
          case 'category':
            result = await featureConfigService.updateCategory(editingItem._id, formData, apiToken);
            break;
          case 'capability':
            result = await featureConfigService.updateRoomCapability(editingItem._id, formData, apiToken);
            break;
          case 'service':
            result = await featureConfigService.updateEventService(editingItem._id, formData, apiToken);
            break;
          default:
            throw new Error('Invalid type');
        }
        logger.info('Feature updated successfully:', result);
      } else {
        // Create new item
        switch (addType) {
          case 'category':
            result = await featureConfigService.createCategory(formData, apiToken);
            break;
          case 'capability':
            result = await featureConfigService.createRoomCapability(formData, apiToken);
            break;
          case 'service':
            result = await featureConfigService.createEventService(formData, apiToken);
            break;
          default:
            throw new Error('Invalid type');
        }
        logger.info('Feature created successfully:', result);
      }
      
      // Reload the configuration
      await loadFeatureConfig();
      
      // Close modal and reset state
      setShowAddModal(false);
      setIsEditMode(false);
      setEditingItem(null);
      
      // Reset form
      setFormData({
        key: '',
        name: '',
        description: '',
        category: '',
        dataType: 'boolean',
        icon: '',
        displayOrder: 1,
        active: true,
        hasCost: false
      });
    } catch (err) {
      logger.error('Error saving feature:', err);
      setError(err.message || `Failed to ${isEditMode ? 'update' : 'create'} feature`);
    }
  };

  const groupByCategory = (items) => {
    const grouped = {};
    items.forEach(item => {
      const cat = item.category || 'uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });
    return grouped;
  };

  if (loading) {
    return (
      <div className="feature-management">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="feature-management">
      <div className="header">
        <h2>Feature Management</h2>
        <p className="subtitle">Configure room capabilities and event services</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'capabilities' ? 'active' : ''}`}
          onClick={() => setActiveTab('capabilities')}
        >
          Room Capabilities ({capabilities.length})
        </button>
        <button 
          className={`tab ${activeTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveTab('services')}
        >
          Event Services ({services.length})
        </button>
        <button 
          className={`tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          Categories ({categories.length})
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'capabilities' && (
          <div className="capabilities-tab">
            <div className="tab-header">
              <h3>Room Capabilities</h3>
              <button className="add-btn" onClick={() => handleAddNew('capability')}>
                + Add Capability
              </button>
            </div>
            
            <div className="info-box">
              <p>Room capabilities define what a room physically has or what activities it permits.</p>
            </div>

            {Object.entries(groupByCategory(capabilities)).map(([categoryKey, items]) => {
              const category = categories.find(c => c.key === categoryKey);
              return (
                <div key={categoryKey} className="category-group">
                  <h4>{category?.name || categoryKey}</h4>
                  <div className="feature-management-grid">
                    {items.map(capability => (
                      <div key={capability._id} className="feature-card">
                        <div className="feature-actions">
                          <button
                            className="action-btn edit-btn"
                            onClick={() => handleEdit(capability, 'capability')}
                          >
                            Edit
                          </button>
                          <div className="confirm-button-group">
                            <button
                              className={`action-btn delete-btn ${confirmDeleteId === capability._id ? 'confirming' : ''}`}
                              onClick={() => handleDeleteClick(capability, 'capability')}
                              disabled={deletingId === capability._id}
                            >
                              {deletingId === capability._id ? 'Deleting...' : (confirmDeleteId === capability._id ? 'Confirm?' : 'Delete')}
                            </button>
                            {confirmDeleteId === capability._id && (
                              <button className="confirm-cancel-x" onClick={() => setConfirmDeleteId(null)}>✕</button>
                            )}
                          </div>
                        </div>
                        <div className="feature-icon">{capability.icon}</div>
                        <div className="feature-content">
                          <div className="feature-name">{capability.name}</div>
                          <div className="feature-key">Key: {capability.key}</div>
                          <div className="feature-description">{capability.description}</div>
                          <div className="feature-meta">
                            <span className="data-type">Type: {capability.dataType}</span>
                            <span className={`status ${capability.active ? 'active' : 'inactive'}`}>
                              {capability.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'services' && (
          <div className="services-tab">
            <div className="tab-header">
              <h3>Event Services</h3>
              <button className="add-btn" onClick={() => handleAddNew('service')}>
                + Add Service
              </button>
            </div>
            
            <div className="info-box">
              <p>Event services are additional amenities or setup requirements that can be requested for an event.</p>
            </div>

            {Object.entries(groupByCategory(services)).map(([categoryKey, items]) => {
              const category = categories.find(c => c.key === categoryKey);
              return (
                <div key={categoryKey} className="category-group">
                  <h4>{category?.name || categoryKey}</h4>
                  <div className="feature-management-grid">
                    {items.map(service => (
                      <div key={service._id} className="feature-card">
                        <div className="feature-actions">
                          <button
                            className="action-btn edit-btn"
                            onClick={() => handleEdit(service, 'service')}
                          >
                            Edit
                          </button>
                          <div className="confirm-button-group">
                            <button
                              className={`action-btn delete-btn ${confirmDeleteId === service._id ? 'confirming' : ''}`}
                              onClick={() => handleDeleteClick(service, 'service')}
                              disabled={deletingId === service._id}
                            >
                              {deletingId === service._id ? 'Deleting...' : (confirmDeleteId === service._id ? 'Confirm?' : 'Delete')}
                            </button>
                            {confirmDeleteId === service._id && (
                              <button className="confirm-cancel-x" onClick={() => setConfirmDeleteId(null)}>✕</button>
                            )}
                          </div>
                        </div>
                        <div className="feature-icon">{service.icon}</div>
                        <div className="feature-content">
                          <div className="feature-name">
                            {service.name}
                            {service.hasCost && <span className="cost-badge">💲</span>}
                          </div>
                          <div className="feature-key">Key: {service.key}</div>
                          <div className="feature-description">{service.description}</div>
                          <div className="feature-meta">
                            <span className="data-type">Type: {service.dataType}</span>
                            <span className={`status ${service.active ? 'active' : 'inactive'}`}>
                              {service.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="categories-tab">
            <div className="tab-header">
              <h3>Feature Categories</h3>
              <button className="add-btn" onClick={() => handleAddNew('category')}>
                + Add Category
              </button>
            </div>
            
            <div className="info-box">
              <p>Categories organize room capabilities and event services into logical groups.</p>
            </div>

            <div className="category-list">
              {categories.map(category => (
                <div key={category._id} className="category-item">
                  <div className="category-info">
                    <div className="category-name">{category.name}</div>
                    <div className="category-key">Key: {category.key}</div>
                    <div className="category-description">{category.description}</div>
                  </div>
                  <div className="category-stats">
                    <span className="stat">
                      {capabilities.filter(c => c.category === category.key).length} capabilities
                    </span>
                    <span className="stat">
                      {services.filter(s => s.category === category.key).length} services
                    </span>
                    <span className={`status ${category.active ? 'active' : 'inactive'}`}>
                      {category.active ? 'Active' : 'Inactive'}
                    </span>
                    <div className="category-actions">
                      <button
                        className="action-btn edit-btn"
                        onClick={() => handleEdit(category, 'category')}
                      >
                        Edit
                      </button>
                      <div className="confirm-button-group">
                        <button
                          className={`action-btn delete-btn ${confirmDeleteId === category._id ? 'confirming' : ''}`}
                          onClick={() => handleDeleteClick(category, 'category')}
                          disabled={deletingId === category._id}
                        >
                          {deletingId === category._id ? 'Deleting...' : (confirmDeleteId === category._id ? 'Confirm?' : 'Delete')}
                        </button>
                        {confirmDeleteId === category._id && (
                          <button className="confirm-cancel-x" onClick={() => setConfirmDeleteId(null)}>✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {isEditMode ? 'Edit' : 'Add New'} {
                  addType === 'category' ? 'Category' :
                  addType === 'capability' ? 'Room Capability' :
                  'Event Service'
                }
              </h3>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="key">Key (Unique Identifier) *</label>
                <input
                  type="text"
                  id="key"
                  value={formData.key}
                  onChange={(e) => setFormData({...formData, key: e.target.value})}
                  placeholder={
                    addType === 'category' ? 'e.g., facilities' :
                    addType === 'capability' ? 'e.g., hasBalcony' :
                    'e.g., needsPhotography'
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="name">Display Name *</label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder={
                    addType === 'category' ? 'e.g., Facilities & Amenities' :
                    addType === 'capability' ? 'e.g., Balcony/Outdoor Space' :
                    'e.g., Photography Services'
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Brief description of this feature"
                  rows="3"
                />
              </div>

              {addType !== 'category' && (
                <>
                  <div className="form-group">
                    <label htmlFor="category">Category *</label>
                    <select
                      id="category"
                      value={formData.category}
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                      required
                    >
                      <option value="">Select a category</option>
                      {categories.map(cat => (
                        <option key={cat.key} value={cat.key}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="dataType">Data Type *</label>
                    <select
                      id="dataType"
                      value={formData.dataType}
                      onChange={(e) => setFormData({...formData, dataType: e.target.value})}
                      required
                    >
                      <option value="boolean">Yes/No (boolean)</option>
                      <option value="number">Number</option>
                      <option value="text">Text</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Icon</label>
                    <div className="icon-picker">
                      {availableIcons.map(icon => (
                        <button
                          key={icon}
                          type="button"
                          className={`icon-option ${formData.icon === icon ? 'selected' : ''}`}
                          onClick={() => setFormData({...formData, icon})}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>

                  {addType === 'service' && (
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={formData.hasCost}
                          onChange={(e) => setFormData({...formData, hasCost: e.target.checked})}
                        />
                        This service has an associated cost
                      </label>
                    </div>
                  )}
                </>
              )}

              <div className="form-group">
                <label htmlFor="displayOrder">Display Order</label>
                <input
                  type="number"
                  id="displayOrder"
                  value={formData.displayOrder}
                  onChange={(e) => setFormData({...formData, displayOrder: parseInt(e.target.value) || 1})}
                  min="1"
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData({...formData, active: e.target.checked})}
                  />
                  Active (visible to users)
                </label>
              </div>

              <div className="form-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="submit-btn">
                  {isEditMode ? 'Update' : 'Add'} {addType === 'category' ? 'Category' : addType === 'capability' ? 'Capability' : 'Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
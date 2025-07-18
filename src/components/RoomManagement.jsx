// src/components/RoomManagement.jsx
import React, { useState, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './RoomManagement.css';

// Icon-based multi-select for features
function IconMultiSelect({ options, selectedValues, onSelectionChange, label }) {
  const toggleOption = (value) => {
    const newSelection = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onSelectionChange(newSelection);
  };

  return (
    <div className="icon-multi-select">
      <div className="selection-header">
        <span className="selection-count">{selectedValues.length}/{options.length} selected</span>
      </div>
      <div className="icon-grid">
        {options.map(option => (
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

export default function RoomManagement({ apiToken }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingRoom, setEditingRoom] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form state for add/edit
  const [formData, setFormData] = useState({
    name: '',
    building: '',
    floor: '',
    capacity: '',
    features: [],
    accessibility: [],
    active: true,
    description: '',
    notes: ''
  });
  
  // Feature options with icons
  const featureOptions = [
    { value: 'kitchen', label: 'Kitchen', icon: '🍽️' },
    { value: 'av-equipment', label: 'AV Equipment', icon: '📽️' },
    { value: 'projector', label: 'Projector', icon: '🎬' },
    { value: 'whiteboard', label: 'Whiteboard', icon: '📝' },
    { value: 'piano', label: 'Piano', icon: '🎹' },
    { value: 'stage', label: 'Stage', icon: '🎭' },
    { value: 'microphone', label: 'Microphone', icon: '🎤' },
    { value: 'tables', label: 'Tables & Chairs', icon: '🪑' },
    { value: 'tv', label: 'TV/Monitor', icon: '📺' },
    { value: 'sound-system', label: 'Sound System', icon: '🔊' },
    { value: 'lighting', label: 'Lighting Control', icon: '💡' },
    { value: 'air-conditioning', label: 'Air Conditioning', icon: '❄️' },
    { value: 'wifi', label: 'WiFi', icon: '🌐' },
    { value: 'computer', label: 'Computer Access', icon: '🖥️' },
    { value: 'coffee', label: 'Coffee Station', icon: '☕' },
    { value: 'books', label: 'Library/Books', icon: '📚' }
  ];
  
  const accessibilityOptions = [
    'wheelchair-accessible', 'hearing-loop', 'elevator', 
    'ramp', 'accessible-restroom', 'braille-signage'
  ];
  
  useEffect(() => {
    loadRooms();
  }, [apiToken]);
  
  const loadRooms = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load rooms');
      
      const data = await response.json();
      setRooms(data);
    } catch (err) {
      logger.error('Error loading rooms:', err);
      setError('Failed to load rooms');
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
  
  
  const handleAddRoom = () => {
    setFormData({
      name: '',
      building: '',
      floor: '',
      capacity: '',
      features: [],
      accessibility: [],
      active: true,
      description: '',
      notes: ''
    });
    setEditingRoom(null);
    setShowAddForm(true);
  };
  
  const handleEditRoom = (room) => {
    setFormData({
      name: room.name || '',
      building: room.building || '',
      floor: room.floor || '',
      capacity: room.capacity || '',
      features: room.features || [],
      accessibility: room.accessibility || [],
      active: room.active !== false,
      description: room.description || '',
      notes: room.notes || ''
    });
    setEditingRoom(room);
    setShowAddForm(true);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...formData,
        capacity: parseInt(formData.capacity) || 0
      };
      
      const url = editingRoom 
        ? `${APP_CONFIG.API_BASE_URL}/admin/rooms/${editingRoom._id}`
        : `${APP_CONFIG.API_BASE_URL}/admin/rooms`;
      
      const method = editingRoom ? 'PUT' : 'POST';
      
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
        throw new Error(errorData.error || 'Failed to save room');
      }
      
      const savedRoom = await response.json();
      
      if (editingRoom) {
        setRooms(prev => prev.map(r => r._id === savedRoom._id ? savedRoom : r));
      } else {
        setRooms(prev => [...prev, savedRoom]);
      }
      
      setShowAddForm(false);
      setEditingRoom(null);
    } catch (err) {
      logger.error('Error saving room:', err);
      setError(err.message || 'Failed to save room');
    }
  };
  
  const handleDeleteRoom = async (roomId) => {
    if (!confirm('Are you sure you want to delete this room?')) return;
    
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to delete room');
      
      setRooms(prev => prev.filter(r => r._id !== roomId));
    } catch (err) {
      logger.error('Error deleting room:', err);
      setError('Failed to delete room');
    }
  };
  
  const handleToggleActive = async (room) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/rooms/${room._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ ...room, active: !room.active })
      });
      
      if (!response.ok) throw new Error('Failed to update room');
      
      const updatedRoom = await response.json();
      setRooms(prev => prev.map(r => r._id === updatedRoom._id ? updatedRoom : r));
    } catch (err) {
      logger.error('Error updating room:', err);
      setError('Failed to update room status');
    }
  };
  
  if (loading) {
    return <div className="room-management loading">Loading rooms...</div>;
  }
  
  return (
    <div className="room-management">
      <div className="admin-header">
        <h1>Room Management</h1>
        <button className="add-room-btn" onClick={handleAddRoom}>
          + Add New Room
        </button>
      </div>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      {showAddForm && (
        <div className="room-form-overlay">
          <div className="room-form">
            <h2>{editingRoom ? 'Edit Room' : 'Add New Room'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="name">Room Name *</label>
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
                <IconMultiSelect
                  options={featureOptions}
                  selectedValues={formData.features}
                  onSelectionChange={(selected) => setFormData(prev => ({ ...prev, features: selected }))}
                  label="Room Features"
                />
              </div>
              
              <div className="form-group">
                <label>Accessibility</label>
                <MultiSelectDropdown
                  options={accessibilityOptions}
                  selectedValues={formData.accessibility}
                  onSelectionChange={(selected) => setFormData(prev => ({ ...prev, accessibility: selected }))}
                  placeholder="Select accessibility features..."
                />
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
                  <span>Room is Active</span>
                </label>
              </div>
              
              <div className="form-actions">
                <button type="submit" className="save-btn">
                  {editingRoom ? 'Update Room' : 'Add Room'}
                </button>
                <button 
                  type="button" 
                  className="cancel-btn"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingRoom(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      <div className="rooms-table-container">
        <table className="rooms-table">
          <thead>
            <tr>
              <th>Room Name</th>
              <th>Location</th>
              <th>Capacity</th>
              <th>Features</th>
              <th>Accessibility</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map(room => (
              <tr key={room._id}>
                <td className="room-name">
                  <strong>{room.name}</strong>
                  {room.description && (
                    <div className="room-desc">{room.description}</div>
                  )}
                </td>
                <td>{room.building} - {room.floor}</td>
                <td className="capacity">{room.capacity}</td>
                <td className="features">
                  {room.features?.length > 0 ? (
                    <div className="tag-list">
                      {room.features.slice(0, 3).map(f => (
                        <span key={f} className="tag">{f}</span>
                      ))}
                      {room.features.length > 3 && (
                        <span className="tag">+{room.features.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    <span className="no-data">None</span>
                  )}
                </td>
                <td className="accessibility">
                  {room.accessibility?.length > 0 ? (
                    <div className="tag-list">
                      {room.accessibility.map(a => (
                        <span key={a} className="tag accessibility-tag">♿ {a}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="no-data">None</span>
                  )}
                </td>
                <td>
                  <button
                    className={`status-toggle ${room.active ? 'active' : 'inactive'}`}
                    onClick={() => handleToggleActive(room)}
                  >
                    {room.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="actions">
                  <button
                    className="edit-btn"
                    onClick={() => handleEditRoom(room)}
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteRoom(room._id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {rooms.length === 0 && (
          <div className="no-rooms">
            No rooms found. Click "Add New Room" to get started.
          </div>
        )}
      </div>
    </div>
  );
}
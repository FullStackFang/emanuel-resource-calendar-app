// src/components/PreferencesModal.jsx
import React, { useState } from 'react';
import Modal from './Modal';

function PreferencesModal({ isOpen, onClose, preferences, onSave }) {
  const [editedPreferences, setEditedPreferences] = useState({...preferences});
  
  const handleChange = (e) => {
    const { name, checked } = e.target;
    setEditedPreferences(prevState => ({
      ...prevState,
      [name]: checked
    }));
  };
  
  const handleSave = () => {
    onSave(editedPreferences);
    onClose();
  };
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="User Preferences"
    >
      <div className="preferences-form">
        <h3>Calendar Permissions</h3>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="canReadEvents"
              checked={editedPreferences.canReadEvents}
              onChange={handleChange}
            />
            Can view events
          </label>
        </div>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="canWriteEvents"
              checked={editedPreferences.canWriteEvents}
              onChange={handleChange}
            />
            Can create and edit events
          </label>
        </div>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="canDeleteEvents"
              checked={editedPreferences.canDeleteEvents}
              onChange={handleChange}
            />
            Can delete events
          </label>
        </div>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="canManageCategories"
              checked={editedPreferences.canManageCategories}
              onChange={handleChange}
            />
            Can manage categories
          </label>
        </div>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="canManageLocations"
              checked={editedPreferences.canManageLocations}
              onChange={handleChange}
            />
            Can manage locations
          </label>
        </div>
        
        <div className="form-actions">
          <button 
            className="cancel-button" 
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            className="save-button" 
            onClick={handleSave}
          >
            Save Preferences
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default PreferencesModal;
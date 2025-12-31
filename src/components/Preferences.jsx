// src/components/Preferences.jsx
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loadUserPreferences, saveUserPreferences } from '../services/userPreferencesService';
import LoadingSpinner from './shared/LoadingSpinner';
import './Preferences.css'; 

function Preferences({ accessToken }) {
  const { instance } = useMsal();
  const [preferences, setPreferences] = useState({
    canReadEvents: true,
    canWriteEvents: true, 
    canDeleteEvents: true,
    canManageCategories: true,
    canManageLocations: true,
    defaultView: 'week',
    defaultGroupBy: 'categories'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const loadPreferences = async () => {
      if (accessToken) {
        try {
          // Get the active account
          const activeAccount = instance.getActiveAccount();
          if (!activeAccount) {
            console.error("No active account found");
            setIsLoading(false);
            return;
          }
          
          const userId = activeAccount.homeAccountId || activeAccount.localAccountId;
          const savedPreferences = await loadUserPreferences(userId);
          
          if (savedPreferences) {
            setPreferences(savedPreferences);
          }
        } catch (error) {
          console.error("Failed to load preferences:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    loadPreferences();
  }, [accessToken, instance]);

  const handleChange = (e) => {
    const { name, checked, value, type } = e.target;
    setPreferences(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaveStatus('Saving...');

    try {
      const activeAccount = instance.getActiveAccount();
      if (!activeAccount) {
        console.error("No active account found");
        setSaveStatus('Error: No active account found');
        return;
      }
      
      const userId = activeAccount.homeAccountId || activeAccount.localAccountId;
      const success = await saveUserPreferences(userId, preferences);
      
      if (success) {
        setSaveStatus('Preferences saved successfully!');
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus('Failed to save preferences. Please try again.');
      }
    } catch (error) {
      console.error("Error saving preferences:", error);
      setSaveStatus('An error occurred while saving preferences.');
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="preferences-container">
      <h2>User Preferences</h2>
      <form onSubmit={handleSubmit}>
        <div className="preferences-section">
          <h3>Permissions</h3>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="canReadEvents"
                checked={preferences.canReadEvents}
                onChange={handleChange}
              />
              View events
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="canWriteEvents"
                checked={preferences.canWriteEvents}
                onChange={handleChange}
              />
              Create and edit events
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="canDeleteEvents"
                checked={preferences.canDeleteEvents}
                onChange={handleChange}
              />
              Delete events
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="canManageCategories"
                checked={preferences.canManageCategories}
                onChange={handleChange}
              />
              Manage categories
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="canManageLocations"
                checked={preferences.canManageLocations}
                onChange={handleChange}
              />
              Manage locations
            </label>
          </div>
        </div>

        <div className="preferences-section">
          <h3>Default Settings</h3>
          
          <div className="form-group">
            <label>Default View</label>
            <select 
              name="defaultView" 
              value={preferences.defaultView}
              onChange={handleChange}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Default Grouping</label>
            <select 
              name="defaultGroupBy" 
              value={preferences.defaultGroupBy}
              onChange={handleChange}
            >
              <option value="categories">Categories</option>
              <option value="locations">Locations</option>
            </select>
          </div>
        </div>
        
        <div className="form-actions">
          <button type="submit" className="save-button">Save Preferences</button>
          {saveStatus && <div className="save-status">{saveStatus}</div>}
        </div>
      </form>
    </div>
  );
}

export default Preferences;
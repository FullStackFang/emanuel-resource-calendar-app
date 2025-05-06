// src/components/MySettings.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import './Settings.css';
import APP_CONFIG from '../config/config';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

// Time zone options
const timeZoneOptions = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
];

// Default preferences object - used multiple times
const defaultPreferences = {
  startOfWeek: 'Sunday',
  createEvents: false,
  editEvents: false,
  deleteEvents: false,
  isAdmin: false,
  defaultView: 'week',
  defaultGroupBy: 'categories',
  preferredZoomLevel: 100,
  preferredTimeZone: 'America/New_York'
};

export default function MySettings({ apiToken }) {
    const { accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [userProfile, setUserProfile] = useState(null);
    const [formData, setFormData] = useState({
        displayName: '',
        email: '',
        preferences: { ...defaultPreferences }
    });

  // Separate function for creating a new user
  const createNewUser = useCallback(async (userData) => {
    if (!apiToken) return null;
    
    try {
      const response = await fetch(`${API_BASE_URL}/users/current`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(userData)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create user profile: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      throw error;
    }
  }, [apiToken]);

  // Fetch user profile
  const fetchUserProfile = useCallback(async () => {
    if (!apiToken) {
      setError('Not signed in. Please sign in to view your settings.');
      setLoading(false);
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/users/current`, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });
      
      if (response.status === 404) {
        // Get account info
        const userAccount = accounts.length > 0 ? accounts[0] : null;
        const userEmail = userAccount?.username || '';
        const userName = userAccount?.name || (userEmail ? userEmail.split('@')[0] : 'New User');
        
        // Prepare user data
        const newUserData = {
          displayName: userName,
          email: userEmail,
          preferences: { ...defaultPreferences }
        };
        
        // Create new user
        try {
          const createdUser = await createNewUser(newUserData);
          setUserProfile(createdUser);
          setFormData({
            displayName: createdUser.displayName || '',
            email: createdUser.email || '',
            preferences: {
              ...defaultPreferences,
              ...createdUser.preferences
            }
          });
        } catch (createErr) {
          setError('Error creating your profile. Please try again later.');
        }
        
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.statusText}`);
      }
      
      const data = await response.json();
      setUserProfile(data);
      setFormData({
        displayName: data.displayName || '',
        email: data.email || '',
        preferences: {
          ...defaultPreferences,
          ...data.preferences
        }
      });
    } catch (err) {
      setError('Error loading your settings. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [apiToken, accounts, createNewUser]);

  // Load user data on mount
  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  // Handle form input changes - memoized to prevent recreating on every render
  const handleInputChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  }, []);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage('');
    setLoading(true);

    if (!apiToken) {
      setError('Not signed in. Please sign in to save your settings.');
      setLoading(false);
      return;
    }

    try {
      const userAccount = accounts.length > 0 ? accounts[0] : null;
      const userEmail = userAccount?.username || '';

      const userData = {
        displayName: formData.displayName,
        email: userEmail,
        preferences: { ...formData.preferences }
      };

      const response = await fetch(`${API_BASE_URL}/users/current`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        throw new Error(`Error saving settings: ${response.statusText}`);
      }

      const updatedUser = await response.json();
      setUserProfile(updatedUser);
      setSuccessMessage('Settings saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError('Failed to save settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Show loading indicator
  if (loading && !userProfile) {
    return <div className="settings-loading">Loading your settings...</div>;
  }

  return (
    <div className="settings-container">
      <h2>My Settings</h2>
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="displayName">Display Name:</label>
          <input
            type="text"
            id="displayName"
            name="displayName"
            value={formData.displayName}
            onChange={handleInputChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            name="email"
            value={accounts.length > 0 ? accounts[0].username : formData.email}
            disabled
          />
          <small>Email is linked to your Microsoft account and cannot be changed.</small>
        </div>
        
        <h3>Calendar Preferences</h3>
        
        <div className="form-group">
          <label htmlFor="preferences.startOfWeek">Start of Week:</label>
          <select
            id="preferences.startOfWeek"
            name="preferences.startOfWeek"
            value={formData.preferences.startOfWeek}
            onChange={handleInputChange}
          >
            <option value="Sunday">Sunday</option>
            <option value="Monday">Monday</option>
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="preferences.defaultView">Default View:</label>
          <select
            id="preferences.defaultView"
            name="preferences.defaultView"
            value={formData.preferences.defaultView}
            onChange={handleInputChange}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="preferences.defaultGroupBy">Default Group By:</label>
          <select
            id="preferences.defaultGroupBy"
            name="preferences.defaultGroupBy"
            value={formData.preferences.defaultGroupBy}
            onChange={handleInputChange}
          >
            <option value="categories">Categories</option>
            <option value="locations">Locations</option>
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="preferences.preferredTimeZone">Preferred Time Zone:</label>
          <select
            id="preferences.preferredTimeZone"
            name="preferences.preferredTimeZone"
            value={formData.preferences.preferredTimeZone}
            onChange={handleInputChange}
          >
            {timeZoneOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="preferences.preferredZoomLevel">Zoom Level:</label>
          <input
            id="preferences.preferredZoomLevel"
            name="preferences.preferredZoomLevel"
            type="number"
            min="50"
            max="150"
            step="10"
            value={formData.preferences.preferredZoomLevel}
            onChange={handleInputChange}
          />
        </div>
                
        <div className="form-actions">
          <button type="submit" className="save-button" disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
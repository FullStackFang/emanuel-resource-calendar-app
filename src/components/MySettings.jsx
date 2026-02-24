// src/components/MySettings.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import LoadingSpinner from './shared/LoadingSpinner';
import { usePermissions } from '../hooks/usePermissions';
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
    const { canSubmitReservation, canApproveReservations, isAdmin } = usePermissions();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [userProfile, setUserProfile] = useState(null);
    const [notifPrefs, setNotifPrefs] = useState({
        emailOnConfirmations: true,
        emailOnStatusUpdates: true,
        emailOnAdminChanges: true,
        emailOnNewRequests: true,
        emailOnEditRequests: true,
    });
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
          const np = createdUser.notificationPreferences || {};
          setNotifPrefs({
            emailOnConfirmations: np.emailOnConfirmations !== false,
            emailOnStatusUpdates: np.emailOnStatusUpdates !== false,
            emailOnAdminChanges: np.emailOnAdminChanges !== false,
            emailOnNewRequests: np.emailOnNewRequests !== false,
            emailOnEditRequests: np.emailOnEditRequests !== false,
          });
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
      const np2 = data.notificationPreferences || {};
      setNotifPrefs({
        emailOnConfirmations: np2.emailOnConfirmations !== false,
        emailOnStatusUpdates: np2.emailOnStatusUpdates !== false,
        emailOnAdminChanges: np2.emailOnAdminChanges !== false,
        emailOnNewRequests: np2.emailOnNewRequests !== false,
        emailOnEditRequests: np2.emailOnEditRequests !== false,
      });
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

  // Handle notification preference toggle (immediate save, not bundled with main form)
  const handleNotifPrefToggle = useCallback(async (key) => {
    if (!apiToken) return;
    const newValue = !notifPrefs[key];
    setNotifPrefs(prev => ({ ...prev, [key]: newValue }));
    try {
      const response = await fetch(`${API_BASE_URL}/users/current/notification-preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({ [key]: newValue })
      });
      if (!response.ok) {
        // Revert on failure
        setNotifPrefs(prev => ({ ...prev, [key]: !newValue }));
        throw new Error('Failed to update notification preference');
      }
    } catch (err) {
      setNotifPrefs(prev => ({ ...prev, [key]: !newValue }));
      setError('Failed to update notification preference. Please try again.');
      setTimeout(() => setError(null), 3000);
    }
  }, [apiToken, notifPrefs]);

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
    return <LoadingSpinner />;
  }

  return (
    <div className="settings-page">
      {/* Page Header - Editorial Style */}
      <div className="settings-header">
        <div className="settings-header-content">
          <h1>My Profile</h1>
          <p className="settings-header-subtitle">Manage your account and calendar preferences</p>
        </div>
      </div>

      <div className="settings-container">
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
                
        {canSubmitReservation && (
          <>
            <h3>Email Notifications</h3>

            <div className="notification-section full-width">
              <div className="notification-section-title">My Reservations</div>
              <div className="notification-toggle-item">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={notifPrefs.emailOnConfirmations}
                    onChange={() => handleNotifPrefToggle('emailOnConfirmations')}
                  />
                  <span>Confirmation emails when I submit requests</span>
                </label>
                <small>Receive a confirmation when you submit, resubmit, or request an edit.</small>
              </div>
              <div className="notification-toggle-item">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={notifPrefs.emailOnStatusUpdates}
                    onChange={() => handleNotifPrefToggle('emailOnStatusUpdates')}
                  />
                  <span>Status update emails for my events</span>
                </label>
                <small>Notified when your event is published, rejected, or under review.</small>
              </div>
              <div className="notification-toggle-item">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={notifPrefs.emailOnAdminChanges}
                    onChange={() => handleNotifPrefToggle('emailOnAdminChanges')}
                  />
                  <span>Notification when an admin updates my event</span>
                </label>
                <small>Notified when an approver modifies your published event.</small>
              </div>
            </div>

            {canApproveReservations && (
              <div className="notification-section full-width">
                <div className="notification-section-title">Review Queue</div>
                <div className="notification-toggle-item">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={notifPrefs.emailOnNewRequests}
                      onChange={() => handleNotifPrefToggle('emailOnNewRequests')}
                    />
                    <span>Alert when new requests are submitted</span>
                  </label>
                  <small>Receive an alert when a reservation is submitted or resubmitted.</small>
                </div>
                <div className="notification-toggle-item">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={notifPrefs.emailOnEditRequests}
                      onChange={() => handleNotifPrefToggle('emailOnEditRequests')}
                    />
                    <span>Alert when edit requests need review</span>
                  </label>
                  <small>Receive an alert when a requester submits an edit request.</small>
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="notification-section-note full-width">
                System error notifications are always enabled.
              </div>
            )}
          </>
        )}

        <div className="form-actions">
          <button type="submit" className="save-button" disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
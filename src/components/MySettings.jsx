// src/components/MySettings.jsx
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import './Settings.css'; // Assuming you have this CSS file already

// API endpoint - use the full URL to your API server
const API_BASE_URL = 'http://localhost:3001/api';

export default function MySettings({ apiToken }) {
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [userProfile, setUserProfile] = useState(null);
    const [formData, setFormData] = useState({
        displayName: '',
        email: '',
        preferences: {
            startOfWeek: 'Sunday',
            createEvents: true,
            editEvents: true,
            deleteEvents: false,
            isAdmin: false,
            defaultView: 'week',
            defaultGroupBy: 'categories',
            preferredZoomLevel: 100,
        }
    });

  // Fetch the current user from MongoDB when apiToken becomes available
  useEffect(() => {
    const fetchUserProfile = async () => {
        // Add these debug logs
        console.log("API Token available:", !!apiToken);
        console.log("API Token length:", apiToken?.length);
        
        setLoading(true);
        if (!apiToken) {
            setError('Not signed in. Please sign in to view your settings.');
            setLoading(false);
            return;
        }
        
        try {
            console.log("Fetching user profile from:", `${API_BASE_URL}/users/current`);
            const response = await fetch(`${API_BASE_URL}/users/current`, {
                headers: {
                    Authorization: `Bearer ${apiToken}`
                }
            });
            
            console.log("Response status:", response.status);
            
            if (response.status === 404) {
                console.log('User not found in database, will create new user profile');
                
                // Get MSAL account info
                const userAccount = accounts.length > 0 ? accounts[0] : null;
                const userEmail = userAccount?.username || '';
                const userName = userAccount?.name || (userEmail ? userEmail.split('@')[0] : 'New User');
                
                console.log('Using MSAL account info:', { userEmail, userName });
                
                // Prepare user data
                const newUserData = {
                    displayName: userName,
                    email: userEmail,
                    preferences: {
                        startOfWeek: 'Sunday',
                        createEvents: false,
                        editEvents: false,
                        deleteEvents: false,
                        isAdmin: false,
                        defaultView: 'week',
                        defaultGroupBy: 'categories',
                        preferredZoomLevel: 100
                    }
                };
                
                console.log('Creating new user with data:', newUserData);
                
                // Immediately create the user
                try {
                    const createResponse = await fetch(`${API_BASE_URL}/users/current`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${apiToken}`
                        },
                        body: JSON.stringify(newUserData)
                    });
                    
                    if (!createResponse.ok) {
                        throw new Error(`Failed to create user profile: ${createResponse.statusText}`);
                    }
                    
                    const createdUser = await createResponse.json();
                    console.log('Successfully created new user:', createdUser);
                    
                    setUserProfile(createdUser);
                    setFormData({
                        displayName: createdUser.displayName || '',
                        email: createdUser.email || '',
                        preferences: {
                            startOfWeek: createdUser.preferences?.startOfWeek || 'Sunday',
                            createEvents: createdUser.preferences?.createEvents ?? false,
                            editEvents: createdUser.preferences?.editEvents ?? false,
                            deleteEvents: createdUser.preferences?.deleteEvents ?? false,
                            isAdmin: createdUser.preferences?.isAdmin ?? false,
                            defaultView: createdUser.preferences?.defaultView || 'week',
                            defaultGroupBy: createdUser.preferences?.defaultGroupBy || 'categories',
                            preferredZoomLevel: createdUser.preferences?.preferredZoomLevel || 100
                        }
                    });
                } catch (createErr) {
                    console.error('Error creating new user profile:', createErr);
                    setError('Error creating your profile. Please try again later.');
                }
                
                setLoading(false);
                return;
            }
            
            if (!response.ok) {
                throw new Error(`Failed to fetch user profile: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('User profile data received:', data);
            setUserProfile(data);
            setFormData({
                displayName: data.displayName || '',
                email: data.email || '',
                preferences: {
                    startOfWeek: data.preferences?.startOfWeek || 'Sunday',
                    createEvents: data.preferences?.createEvents ?? true,
                    editEvents: data.preferences?.editEvents ?? true,
                    deleteEvents: data.preferences?.deleteEvents ?? false,
                    isAdmin: data.preferences?.isAdmin ?? false,
                    defaultView: data.preferences?.defaultView || 'week',
                    defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
                    preferredZoomLevel: data.preferences?.preferredZoomLevel || 100
                }
            });
        } catch (err) {
            console.error('Error fetching user profile:', err);
            setError('Error loading your settings. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    fetchUserProfile();
  }, [apiToken, accounts]);

  // Handle form input changes
  const handleInputChange = (e) => {
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
  };

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
        const method = 'PUT';  // Always use PUT
        const endpoint = `${API_BASE_URL}/users/current`;  // Always use /users/current

        const userAccount = accounts.length > 0 ? accounts[0] : null;
        const userEmail = userAccount?.username || '';

        const userData = {
            displayName: formData.displayName,
            email: userEmail,
            preferences: {
                startOfWeek: formData.preferences.startOfWeek,
                createEvents: formData.preferences.createEvents,
                editEvents: formData.preferences.editEvents,
                deleteEvents: formData.preferences.deleteEvents,
                isAdmin: formData.preferences.isAdmin,
                defaultView: formData.preferences.defaultView,
                defaultGroupBy: formData.preferences.defaultGroupBy,
                preferredZoomLevel: formData.preferences.preferredZoomLevel
            }
        };

        // Add these debug logs
        console.log("Submitting to endpoint:", endpoint);
        console.log("With method:", method);
        console.log("Authorization available:", !!apiToken);
        console.log("Request headers:", {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken?.substring(0, 10)}...`
        });
        console.log("Request payload:", userData);

        const response = await fetch(endpoint, {
            method,
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
            console.error('Error saving settings:', err);
            setError('Failed to save settings. Please try again.');
        } finally {
            setLoading(false);
        }
    };

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
                // Use the account email directly from MSAL if available
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
        
        <h3>Event Permissions</h3>
        
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              id="preferences.createEvents"
              name="preferences.createEvents"
              checked={formData.preferences.createEvents}
              onChange={handleInputChange}
            />
            Allow Creating Events
          </label>
        </div>
        
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              id="preferences.editEvents"
              name="preferences.editEvents"
              checked={formData.preferences.editEvents}
              onChange={handleInputChange}
            />
            Allow Editing Events
          </label>
        </div>
        
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              id="preferences.deleteEvents"
              name="preferences.deleteEvents"
              checked={formData.preferences.deleteEvents}
              onChange={handleInputChange}
            />
            Allow Deleting Events
          </label>
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              id="preferences.isAdmin"
              name="preferences.isAdmin"
              checked={formData.preferences.isAdmin}
              onChange={handleInputChange}
            />
            Allow Admin Rights
          </label>
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
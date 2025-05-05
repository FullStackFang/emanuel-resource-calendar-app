// src/components/UserSettingsManager.jsx
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useUserPreferences } from '../hooks/useUserPreferences';
import './Settings.css';
import APP_CONFIG from '../config/config';

// MongoDB API endpoint - replace with your Azure Function or API endpoint
const API_BASE_URL = APP_CONFIG.API_BASE_URL;
// const API_BASE_URL = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api';

export default function UserSettingsManager() {
  const { instance } = useMsal();
  const { prefs, updatePrefs } = useUserPreferences();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    userId: '',
    email: '',
    displayName: '',
    preferences: {
      startOfWeek: 'Sunday',
      createEvents: true,
      editEvents: true,
      deleteEvents: false
    }
  });

  // Get current user info
  const getCurrentUserInfo = async () => {
    const accounts = instance.getAllAccounts();
    if (accounts.length === 0) return null;
    
    try {
      const currentAccount = accounts[0];
      return {
        userId: currentAccount.homeAccountId,
        email: currentAccount.username,
        displayName: currentAccount.name || currentAccount.username.split('@')[0]
      };
    } catch (err) {
      console.error('Error getting current user info:', err);
      return null;
    }
  };

  // Fetch users from MongoDB
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/users`);
      if (!response.ok) {
        throw new Error(`Error fetching users: ${response.statusText}`);
      }
      const data = await response.json();
      setUsers(data);
      
      // Check if current user exists in the database
      const currentUser = await getCurrentUserInfo();
      if (currentUser) {
        const userExists = data.some(user => user.email === currentUser.email);
        if (!userExists) {
          // Create user in database if they don't exist
          await createUser({
            ...currentUser,
            preferences: {
              startOfWeek: prefs.defaultStartOfWeek || 'Sunday',
              createEvents: true,
              editEvents: true,
              deleteEvents: false
            }
          });
          // Refresh user list
          const updatedResponse = await fetch(`${API_BASE_URL}/users`);
          if (updatedResponse.ok) {
            const updatedData = await updatedResponse.json();
            setUsers(updatedData);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load user settings. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Create a new user
  const createUser = async (userData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });
      
      if (!response.ok) {
        throw new Error(`Error creating user: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Error creating user:', err);
      setError('Failed to create user. Please try again.');
      return null;
    }
  };

  // Update user settings
  const updateUser = async (userId, userData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });
      
      if (!response.ok) {
        throw new Error(`Error updating user: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Error updating user:', err);
      setError('Failed to update user settings. Please try again.');
      return null;
    }
  };

  // Delete user
  const deleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Error deleting user: ${response.statusText}`);
      }
      
      // Refresh user list
      fetchUsers();
      setSelectedUser(null);
    } catch (err) {
      console.error('Error deleting user:', err);
      setError('Failed to delete user. Please try again.');
    }
  };

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name.includes('.')) {
      // Handle nested properties (e.g., preferences.startOfWeek)
      const [parent, child] = name.split('.');
      setFormData({
        ...formData,
        [parent]: {
          ...formData[parent],
          [child]: type === 'checkbox' ? checked : value
        }
      });
    } else {
      // Handle top-level properties
      setFormData({
        ...formData,
        [name]: type === 'checkbox' ? checked : value
      });
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (editMode && selectedUser) {
      // Update existing user
      const updated = await updateUser(selectedUser._id, formData);
      if (updated) {
        setUsers(users.map(user => 
          user._id === selectedUser._id ? { ...user, ...formData } : user
        ));
        setSelectedUser({ ...selectedUser, ...formData });
        setEditMode(false);
      }
    } else {
      // Create new user
      const created = await createUser(formData);
      if (created) {
        setUsers([...users, created]);
        setSelectedUser(created);
        setEditMode(false);
      }
    }
  };

  // Select a user to view/edit
  const handleSelectUser = (user) => {
    setSelectedUser(user);
    setFormData({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      preferences: {
        startOfWeek: user.preferences.startOfWeek || 'Sunday',
        createEvents: user.preferences.createEvents || false,
        editEvents: user.preferences.editEvents || false,
        deleteEvents: user.preferences.deleteEvents || false
      }
    });
    setEditMode(false);
  };

  // Toggle edit mode
  const handleEditToggle = () => {
    setEditMode(!editMode);
  };

  // Load users on component mount
  useEffect(() => {
    fetchUsers();
  }, []);

  // If user settings from Office JS change, update our preferences
  useEffect(() => {
    if (selectedUser && prefs) {
      // If the Office preferences change, we can update our user's preferences to match
      const currentUserData = users.find(user => user._id === selectedUser._id);
      if (currentUserData && currentUserData.preferences.startOfWeek !== prefs.defaultStartOfWeek) {
        updateUser(selectedUser._id, {
          ...currentUserData,
          preferences: {
            ...currentUserData.preferences,
            startOfWeek: prefs.defaultStartOfWeek
          }
        });
      }
    }
  }, [prefs, selectedUser]);

  if (loading) {
    return <div className="settings-loading">Loading user settings...</div>;
  }

  return (
    <div className="user-settings-manager">
      <h2>User Settings Manager</h2>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="user-settings-layout">
        <div className="user-list">
          <h3>Users</h3>
          <ul>
            {users.map((user) => (
              <li 
                key={user._id} 
                className={selectedUser && selectedUser._id === user._id ? 'selected' : ''}
                onClick={() => handleSelectUser(user)}
              >
                {user.displayName} ({user.email})
              </li>
            ))}
          </ul>
        </div>
        
        <div className="user-detail">
          {selectedUser ? (
            <>
              <div className="user-detail-header">
                <h3>{editMode ? 'Edit User' : 'User Details'}</h3>
                <div className="user-actions">
                  <button 
                    className="edit-button" 
                    onClick={handleEditToggle}
                  >
                    {editMode ? 'Cancel' : 'Edit'}
                  </button>
                  
                  {!editMode && (
                    <button 
                      className="delete-button" 
                      onClick={() => deleteUser(selectedUser._id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              
              {editMode ? (
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
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
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
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                      <option value="Saturday">Saturday</option>
                    </select>
                  </div>
                  
                  <div className="form-group checkbox">
                    <label>
                      <input 
                        type="checkbox"
                        id="preferences.createEvents"
                        name="preferences.createEvents"
                        checked={formData.preferences.createEvents}
                        onChange={handleInputChange}
                      />
                      Can create events
                    </label>
                  </div>
                  
                  <div className="form-group checkbox">
                    <label>
                      <input 
                        type="checkbox"
                        id="preferences.editEvents"
                        name="preferences.editEvents"
                        checked={formData.preferences.editEvents}
                        onChange={handleInputChange}
                      />
                      Can edit events
                    </label>
                  </div>
                  
                  <div className="form-group checkbox">
                    <label>
                      <input 
                        type="checkbox"
                        id="preferences.deleteEvents"
                        name="preferences.deleteEvents"
                        checked={formData.preferences.deleteEvents}
                        onChange={handleInputChange}
                      />
                      Can delete events
                    </label>
                  </div>
                  
                  <div className="form-actions">
                    <button type="submit" className="save-button">Save Changes</button>
                  </div>
                </form>
              ) : (
                <div className="user-info">
                  <div className="info-item">
                    <span className="label">Display Name:</span>
                    <span className="value">{selectedUser.displayName}</span>
                  </div>
                  
                  <div className="info-item">
                    <span className="label">Email:</span>
                    <span className="value">{selectedUser.email}</span>
                  </div>
                  
                  <div className="info-item">
                    <span className="label">User ID:</span>
                    <span className="value">{selectedUser.userId}</span>
                  </div>
                  
                  <h4>Preferences</h4>
                  
                  <div className="info-item">
                    <span className="label">Start of Week:</span>
                    <span className="value">{selectedUser.preferences.startOfWeek}</span>
                  </div>
                  
                  <div className="info-item">
                    <span className="label">Create Events:</span>
                    <span className="value">
                      {selectedUser.preferences.createEvents ? 'Yes' : 'No'}
                    </span>
                  </div>
                  
                  <div className="info-item">
                    <span className="label">Edit Events:</span>
                    <span className="value">
                      {selectedUser.preferences.editEvents ? 'Yes' : 'No'}
                    </span>
                  </div>
                  
                  <div className="info-item">
                    <span className="label">Delete Events:</span>
                    <span className="value">
                      {selectedUser.preferences.deleteEvents ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="no-selection">
              <p>Select a user from the list to view details or create a new user.</p>
              <button onClick={() => {
                setFormData({
                  userId: '',
                  email: '',
                  displayName: '',
                  preferences: {
                    startOfWeek: 'Sunday',
                    createEvents: true,
                    editEvents: true,
                    deleteEvents: false
                  }
                });
                setSelectedUser(null);
                setEditMode(true);
              }}>Create New User</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
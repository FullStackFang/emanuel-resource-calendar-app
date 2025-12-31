// src/components/UserAdmin.jsx
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import LoadingSpinner from './shared/LoadingSpinner';
import './Admin.css'; // Assuming you have similar styling for admin pages
import APP_CONFIG from '../config/config';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;
// const API_BASE_URL = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api';
// const API_BASE_URL = 'http://localhost:3001/api';

export default function UserAdmin({ apiToken }) {
  const { accounts } = useMsal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [editingRows, setEditingRows] = useState({});
  // New state for creating user
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    displayName: '',
    email: '',
    preferences: {
      startOfWeek: 'Sunday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100,
      createEvents: false,
      editEvents: false,
      deleteEvents: false,
      isAdmin: false
    }
  });
  
  // Fetch all users when component mounts
  useEffect(() => {
    const fetchUsers = async () => {
      if (!apiToken) {
        setError('Authentication required to access user management.');
        setLoading(false);
        return;
      }

      try {
        console.log('Fetching all users...');
        const response = await fetch(`${API_BASE_URL}/users`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          throw new Error(`Error fetching users: ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`Retrieved ${data.length} users`);
        setUsers(data);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError('Failed to load users. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [apiToken]);

  // Toggle editing mode for a specific user
  const toggleEditing = (userId) => {
    setEditingRows(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  // Handle input changes for a specific user
  const handleInputChange = (userId, field, value) => {
    setUsers(users.map(user => {
      if (user._id === userId) {
        if (field.includes('.')) {
          // Handle nested fields (preferences)
          const [parent, child] = field.split('.');
          return {
            ...user,
            [parent]: {
              ...user[parent],
              [child]: value
            }
          };
        } else {
          // Handle top-level fields
          return {
            ...user,
            [field]: value
          };
        }
      }
      return user;
    }));
  };

  // New function to handle input changes for the new user form
  const handleNewUserInputChange = (field, value) => {
    if (field.includes('.')) {
      // Handle nested fields (preferences)
      const [parent, child] = field.split('.');
      setNewUser({
        ...newUser,
        [parent]: {
          ...newUser[parent],
          [child]: value
        }
      });
    } else {
      // Handle top-level fields
      setNewUser({
        ...newUser,
        [field]: value
      });
    }
  };

  // Save changes for a specific user
  const saveChanges = async (userId) => {
    setError(null);
    setSuccessMessage('');
    setLoading(true);

    try {
      const userToUpdate = users.find(user => user._id === userId);
      
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          displayName: userToUpdate.displayName,
          email: userToUpdate.email,
          preferences: userToUpdate.preferences
        })
      });

      if (!response.ok) {
        throw new Error(`Error updating user: ${response.statusText}`);
      }

      const updatedUser = await response.json();
      
      // Update the user in the state
      setUsers(users.map(user => {
        if (user._id === updatedUser._id) {
          return updatedUser;
        }
        return user;
      }));

      // Exit editing mode
      toggleEditing(userId);
      
      setSuccessMessage(`User ${updatedUser.displayName} updated successfully.`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error updating user:', err);
      setError('Failed to update user. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // New function to create a user
  const createUser = async () => {
    setError(null);
    setSuccessMessage('');
    setLoading(true);

    try {
      // Validate required fields
      if (!newUser.email || !newUser.displayName) {
        setError('Email and Display Name are required fields.');
        setLoading(false);
        return;
      }

      // Create a properly formatted user object based on your API requirements
      const userToCreate = {
        email: newUser.email,
        displayName: newUser.displayName,
        // Add this field which might be required by your API
        userId: newUser.email.split('@')[0] + Date.now(), // Generate a unique userId
        preferences: {
          startOfWeek: newUser.preferences.startOfWeek || 'Sunday',
          defaultView: newUser.preferences.defaultView || 'week',
          defaultGroupBy: newUser.preferences.defaultGroupBy || 'categories',
          preferredZoomLevel: newUser.preferences.preferredZoomLevel || 100,
          createEvents: newUser.preferences.createEvents ?? true,
          editEvents: newUser.preferences.editEvents ?? true,
          deleteEvents: newUser.preferences.deleteEvents ?? false,
          isAdmin: newUser.preferences.isAdmin ?? false
        },
        // Add creation timestamp
        createdAt: new Date().toISOString()
      };

      console.log('Creating user with data:', userToCreate);

      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(userToCreate)
      });

      console.log('API response status:', response.status);

      if (!response.ok) {
        // Try to get the error details from the response
        let errorMessage = 'Error creating user';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || `${errorMessage}: ${response.statusText}`;
          console.error('Error response body:', errorData);
        } catch (parseError) {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const createdUser = await response.json();
      console.log('User created successfully:', createdUser);

      // Add the new user to the state
      setUsers([...users, createdUser]);
      
      // Reset the form and exit creating mode
      setNewUser({
        displayName: '',
        email: '',
        preferences: {
          startOfWeek: 'Sunday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100,
          createEvents: true,
          editEvents: true,
          deleteEvents: false,
          isAdmin: false
        }
      });
      setIsCreatingUser(false);
      
      setSuccessMessage(`User ${createdUser.displayName} created successfully.`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error creating user:', err);
      setError(`Failed to create user: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Function to handle deleting a user
  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Error deleting user: ${response.statusText}`);
      }

      // Remove user from state
      setUsers(users.filter(user => user._id !== userId));
      setSuccessMessage('User deleted successfully.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error deleting user:', err);
      setError('Failed to delete user. Please try again.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  // Get current user's email to identify them in the list
  const currentUserEmail = accounts.length > 0 ? accounts[0].username : '';

  if (loading && users.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="admin-container">
      <h2>User Management</h2>
      
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      
      <div className="admin-actions">
        <button 
          className="create-user-button"
          onClick={() => setIsCreatingUser(!isCreatingUser)}
        >
          {isCreatingUser ? 'Cancel' : '+ Add New User'}
        </button>
      </div>
      
      {/* New User Form */}
      {isCreatingUser && (
        <div className="new-user-form">
          <h3>Create New User</h3>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="newDisplayName">Display Name:</label>
              <input
                id="newDisplayName"
                type="text"
                value={newUser.displayName}
                onChange={(e) => handleNewUserInputChange('displayName', e.target.value)}
                placeholder="Display Name"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="newEmail">Email:</label>
              <input
                id="newEmail"
                type="email"
                value={newUser.email}
                onChange={(e) => handleNewUserInputChange('email', e.target.value)}
                placeholder="email@example.com"
                required
              />
            </div>
          </div>
          
          <h4>Preferences</h4>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="newDefaultView">Default View:</label>
              <select
                id="newDefaultView"
                value={newUser.preferences.defaultView}
                onChange={(e) => handleNewUserInputChange('preferences.defaultView', e.target.value)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="newStartOfWeek">Start of Week:</label>
              <select
                id="newStartOfWeek"
                value={newUser.preferences.startOfWeek}
                onChange={(e) => handleNewUserInputChange('preferences.startOfWeek', e.target.value)}
              >
                <option value="Sunday">Sunday</option>
                <option value="Monday">Monday</option>
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Permissions:</label>
              <div className="checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={newUser.preferences.createEvents}
                    onChange={(e) => handleNewUserInputChange('preferences.createEvents', e.target.checked)}
                  />
                  Create Events
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={newUser.preferences.editEvents}
                    onChange={(e) => handleNewUserInputChange('preferences.editEvents', e.target.checked)}
                  />
                  Edit Events
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={newUser.preferences.deleteEvents}
                    onChange={(e) => handleNewUserInputChange('preferences.deleteEvents', e.target.checked)}
                  />
                  Delete Events
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={newUser.preferences.isAdmin}
                    onChange={(e) => handleNewUserInputChange('preferences.isAdmin', e.target.checked)}
                  />
                  Admin Access
                </label>
              </div>
            </div>
          </div>
          
          <div className="form-actions">
            <button 
              className="save-button"
              onClick={createUser}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
            <button 
              className="cancel-button"
              onClick={() => setIsCreatingUser(false)}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Default View</th>
              <th>Start of Week</th>
              <th>Permissions</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-results">No users found</td>
              </tr>
            ) : (
              users.map(user => (
                <tr key={user._id} className={user.email === currentUserEmail ? 'current-user-row' : ''}>
                  <td>
                    {editingRows[user._id] ? (
                      <input
                        type="text"
                        value={user.displayName || ''}
                        onChange={(e) => handleInputChange(user._id, 'displayName', e.target.value)}
                        className="inline-edit-input"
                      />
                    ) : (
                      user.displayName || 'Unnamed User'
                    )}
                  </td>
                  <td>
                    {editingRows[user._id] ? (
                      <input
                        type="email"
                        value={user.email || ''}
                        onChange={(e) => handleInputChange(user._id, 'email', e.target.value)}
                        className="inline-edit-input"
                      />
                    ) : (
                      user.email
                    )}
                  </td>
                  <td>
                    {editingRows[user._id] ? (
                      <select
                        value={user.preferences?.defaultView || 'week'}
                        onChange={(e) => handleInputChange(user._id, 'preferences.defaultView', e.target.value)}
                        className="inline-edit-select"
                      >
                        <option value="day">Day</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                      </select>
                    ) : (
                      user.preferences?.defaultView || 'week'
                    )}
                  </td>
                  <td>
                    {editingRows[user._id] ? (
                      <select
                        value={user.preferences?.startOfWeek || 'Sunday'}
                        onChange={(e) => handleInputChange(user._id, 'preferences.startOfWeek', e.target.value)}
                        className="inline-edit-select"
                      >
                        <option value="Sunday">Sunday</option>
                        <option value="Monday">Monday</option>
                      </select>
                    ) : (
                      user.preferences?.startOfWeek || 'Sunday'
                    )}
                  </td>
                  <td>
                    {editingRows[user._id] ? (
                      <div className="inline-checkboxes">
                        <label>
                          <input
                            type="checkbox"
                            checked={user.preferences?.createEvents ?? true}
                            onChange={(e) => handleInputChange(user._id, 'preferences.createEvents', e.target.checked)}
                          />
                          Create
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={user.preferences?.editEvents ?? true}
                            onChange={(e) => handleInputChange(user._id, 'preferences.editEvents', e.target.checked)}
                          />
                          Edit
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={user.preferences?.deleteEvents ?? false}
                            onChange={(e) => handleInputChange(user._id, 'preferences.deleteEvents', e.target.checked)}
                          />
                          Delete
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={user.preferences?.isAdmin ?? false}
                            onChange={(e) => handleInputChange(user._id, 'preferences.isAdmin', e.target.checked)}
                          />
                          Admin
                        </label>
                      </div>
                    ) : (
                      <ul className="permissions-list">
                        {user.preferences?.createEvents && <li>Create</li>}
                        {user.preferences?.editEvents && <li>Edit</li>}
                        {user.preferences?.deleteEvents && <li>Delete</li>}
                        {user.preferences?.isAdmin && <li>Admin</li>}
                      </ul>
                    )}
                  </td>
                  <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}</td>
                  <td className="actions-cell">
                    {editingRows[user._id] ? (
                        <div className="button-group">
                        <button 
                            className="save-button"
                            onClick={() => saveChanges(user._id)}
                        >
                            Save
                        </button>
                        <button 
                            className="cancel-button"
                            onClick={() => toggleEditing(user._id)}
                        >
                            Cancel
                        </button>
                        </div>
                    ) : (
                        <div className="button-group">
                        <button 
                            className="edit-button"
                            onClick={() => toggleEditing(user._id)}
                        >
                            Edit
                        </button>
                        {user.email !== currentUserEmail && (
                            <button 
                            className="delete-button"
                            onClick={() => handleDelete(user._id)}
                            >
                            Delete
                            </button>
                        )}
                        </div>
                    )}
                    </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
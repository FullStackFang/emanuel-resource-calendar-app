// src/components/UserAdmin.jsx
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import './Admin.css'; // Assuming you have similar styling for admin pages

const API_BASE_URL = 'http://localhost:3001/api';

export default function UserAdmin({ apiToken }) {
  const { accounts } = useMsal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [editingRows, setEditingRows] = useState({});
  
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
    return <div className="admin-loading">Loading users...</div>;
  }

  return (
    <div className="admin-container">
      <h2>User Management</h2>
      
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      
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
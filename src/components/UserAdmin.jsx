// src/components/UserAdmin.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import './UserAdmin.css';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

// Get initials from user name
const getInitials = (name) => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
};

export default function UserAdmin({ apiToken }) {
  const { accounts } = useMsal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [editingRows, setEditingRows] = useState({});
  const [showModal, setShowModal] = useState(false);
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

  // Calculate stats
  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter(u => u.preferences?.isAdmin).length;
    const activeRecently = users.filter(u => {
      if (!u.lastLogin) return false;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return new Date(u.lastLogin) > thirtyDaysAgo;
    }).length;
    return { total, admins, activeRecently };
  }, [users]);

  // Fetch all users when component mounts
  useEffect(() => {
    const fetchUsers = async () => {
      if (!apiToken) {
        setError('Authentication required to access user management.');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/users`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          throw new Error(`Error fetching users: ${response.statusText}`);
        }

        const data = await response.json();
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
          const [parent, child] = field.split('.');
          return {
            ...user,
            [parent]: {
              ...user[parent],
              [child]: value
            }
          };
        } else {
          return {
            ...user,
            [field]: value
          };
        }
      }
      return user;
    }));
  };

  // Handle input changes for the new user form
  const handleNewUserInputChange = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setNewUser({
        ...newUser,
        [parent]: {
          ...newUser[parent],
          [child]: value
        }
      });
    } else {
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

      setUsers(users.map(user => {
        if (user._id === updatedUser._id) {
          return updatedUser;
        }
        return user;
      }));

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

  // Create a new user
  const createUser = async () => {
    setError(null);
    setSuccessMessage('');
    setLoading(true);

    try {
      if (!newUser.email || !newUser.displayName) {
        setError('Email and Display Name are required fields.');
        setLoading(false);
        return;
      }

      const userToCreate = {
        email: newUser.email,
        displayName: newUser.displayName,
        userId: newUser.email.split('@')[0] + Date.now(),
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
        createdAt: new Date().toISOString()
      };

      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(userToCreate)
      });

      if (!response.ok) {
        let errorMessage = 'Error creating user';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || `${errorMessage}: ${response.statusText}`;
        } catch {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const createdUser = await response.json();
      setUsers([...users, createdUser]);

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
      setShowModal(false);

      setSuccessMessage(`User ${createdUser.displayName} created successfully.`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error creating user:', err);
      setError(`Failed to create user: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Delete a user
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

  const currentUserEmail = accounts.length > 0 ? accounts[0].username : '';

  if (loading && users.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="user-admin">
      {/* Page Header */}
      <div className="user-admin-header">
        <div className="user-admin-header-content">
          <h2>User Management</h2>
          <p className="user-admin-header-subtitle">
            Manage user accounts and permissions
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="add-user-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add User
        </button>
      </div>

      {/* Stats Row */}
      <div className="user-stats">
        <div className="user-stat-card total">
          <div className="user-stat-icon total">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="user-stat-content">
            <h4>{stats.total}</h4>
            <p>Total Users</p>
          </div>
        </div>

        <div className="user-stat-card admins">
          <div className="user-stat-icon admins">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 15l-2-2m0 0l2-2m-2 2h8" />
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
            </svg>
          </div>
          <div className="user-stat-content">
            <h4>{stats.admins}</h4>
            <p>Administrators</p>
          </div>
        </div>

        <div className="user-stat-card active">
          <div className="user-stat-icon active">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div className="user-stat-content">
            <h4>{stats.activeRecently}</h4>
            <p>Active (30 days)</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="error-message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </div>
      )}

      {successMessage && (
        <div className="success-message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* Users Grid */}
      {users.length > 0 ? (
        <div className="users-grid">
          {users.map((user) => {
            const isCurrentUser = user.email === currentUserEmail;
            const isEditing = editingRows[user._id];

            return (
              <div
                key={user._id}
                className={`user-card ${isCurrentUser ? 'current-user' : ''} ${isEditing ? 'editing' : ''}`}
              >
                <div className="user-card-header">
                  <div className="user-avatar">
                    {getInitials(user.displayName)}
                  </div>
                  <div className="user-card-info">
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={user.displayName || ''}
                          onChange={(e) => handleInputChange(user._id, 'displayName', e.target.value)}
                          className="inline-edit-input"
                          placeholder="Display Name"
                        />
                        <input
                          type="email"
                          value={user.email || ''}
                          onChange={(e) => handleInputChange(user._id, 'email', e.target.value)}
                          className="inline-edit-input"
                          placeholder="Email"
                        />
                      </>
                    ) : (
                      <>
                        <h3 className="user-card-name">
                          {user.displayName || 'Unnamed User'}
                          {isCurrentUser && <span className="you-badge">You</span>}
                        </h3>
                        <p className="user-card-email">{user.email}</p>
                      </>
                    )}
                  </div>
                </div>

                <div className="user-card-details">
                  <div className="user-detail-item">
                    <span className="user-detail-label">Default View</span>
                    {isEditing ? (
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
                      <span className="user-detail-value">
                        {(user.preferences?.defaultView || 'week').charAt(0).toUpperCase() +
                         (user.preferences?.defaultView || 'week').slice(1)}
                      </span>
                    )}
                  </div>
                  <div className="user-detail-item">
                    <span className="user-detail-label">Week Starts</span>
                    {isEditing ? (
                      <select
                        value={user.preferences?.startOfWeek || 'Sunday'}
                        onChange={(e) => handleInputChange(user._id, 'preferences.startOfWeek', e.target.value)}
                        className="inline-edit-select"
                      >
                        <option value="Sunday">Sunday</option>
                        <option value="Monday">Monday</option>
                      </select>
                    ) : (
                      <span className="user-detail-value">
                        {user.preferences?.startOfWeek || 'Sunday'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="user-permissions">
                  <span className="permissions-label">Permissions</span>
                  {isEditing ? (
                    <div className="permissions-checkboxes">
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
                    <div className="permissions-badges">
                      {user.preferences?.createEvents && (
                        <span className="permission-badge create">Create</span>
                      )}
                      {user.preferences?.editEvents && (
                        <span className="permission-badge edit">Edit</span>
                      )}
                      {user.preferences?.deleteEvents && (
                        <span className="permission-badge delete">Delete</span>
                      )}
                      {user.preferences?.isAdmin && (
                        <span className="permission-badge admin">Admin</span>
                      )}
                      {!user.preferences?.createEvents &&
                       !user.preferences?.editEvents &&
                       !user.preferences?.deleteEvents &&
                       !user.preferences?.isAdmin && (
                        <span className="no-permissions">No permissions</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="user-last-login">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Last login: {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                </div>

                <div className="user-card-actions">
                  {isEditing ? (
                    <>
                      <button className="save-btn" onClick={() => saveChanges(user._id)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Save
                      </button>
                      <button className="cancel-btn" onClick={() => toggleEditing(user._id)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="edit-btn" onClick={() => toggleEditing(user._id)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      {!isCurrentUser && (
                        <button className="delete-btn" onClick={() => handleDelete(user._id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="no-users">
          <div className="empty-state-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3>No users yet</h3>
          <p>Create your first user to get started</p>
          <button onClick={() => setShowModal(true)} className="add-user-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Your First User
          </button>
        </div>
      )}

      {/* Add User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New User</h3>
            </div>

            <div className="modal-body">
              <div className="form-section">
                <h4 className="form-section-title">User Information</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>
                      Display Name <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      value={newUser.displayName}
                      onChange={(e) => handleNewUserInputChange('displayName', e.target.value)}
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      Email <span className="required">*</span>
                    </label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => handleNewUserInputChange('email', e.target.value)}
                      placeholder="john@example.com"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Preferences</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Default View</label>
                    <select
                      value={newUser.preferences.defaultView}
                      onChange={(e) => handleNewUserInputChange('preferences.defaultView', e.target.value)}
                    >
                      <option value="day">Day</option>
                      <option value="week">Week</option>
                      <option value="month">Month</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Week Starts On</label>
                    <select
                      value={newUser.preferences.startOfWeek}
                      onChange={(e) => handleNewUserInputChange('preferences.startOfWeek', e.target.value)}
                    >
                      <option value="Sunday">Sunday</option>
                      <option value="Monday">Monday</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Permissions</h4>
                <div className="permissions-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={newUser.preferences.createEvents}
                      onChange={(e) => handleNewUserInputChange('preferences.createEvents', e.target.checked)}
                    />
                    <span className="permission-text">
                      <span className="permission-name">Create Events</span>
                      <span className="permission-desc">Can create new events</span>
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={newUser.preferences.editEvents}
                      onChange={(e) => handleNewUserInputChange('preferences.editEvents', e.target.checked)}
                    />
                    <span className="permission-text">
                      <span className="permission-name">Edit Events</span>
                      <span className="permission-desc">Can modify existing events</span>
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={newUser.preferences.deleteEvents}
                      onChange={(e) => handleNewUserInputChange('preferences.deleteEvents', e.target.checked)}
                    />
                    <span className="permission-text">
                      <span className="permission-name">Delete Events</span>
                      <span className="permission-desc">Can remove events</span>
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={newUser.preferences.isAdmin}
                      onChange={(e) => handleNewUserInputChange('preferences.isAdmin', e.target.checked)}
                    />
                    <span className="permission-text">
                      <span className="permission-name">Administrator</span>
                      <span className="permission-desc">Full system access</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="modal-actions">
                <button
                  className="cancel-btn"
                  onClick={() => setShowModal(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  className="save-btn"
                  onClick={createUser}
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

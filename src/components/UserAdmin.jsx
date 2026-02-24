// src/components/UserAdmin.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import './UserAdmin.css';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

// Role definitions matching backend permissionUtils.js
const ROLES = {
  viewer: { name: 'Viewer', description: 'View calendar only' },
  requester: { name: 'Requester', description: 'Submit & manage own requests' },
  approver: { name: 'Approver', description: 'Manage all events & requests' },
  admin: { name: 'Admin', description: 'Full system access' }
};

// Department definitions for specialized field editing
const DEPARTMENTS = {
  '': { name: 'None', description: 'No department-specific edit access' },
  security: { name: 'Security', description: 'Can edit door times on events' },
  maintenance: { name: 'Maintenance', description: 'Can edit setup/teardown times' },
  it: { name: 'IT', description: 'Information Technology' },
  clergy: { name: 'Clergy', description: 'Clergy staff' },
  membership: { name: 'Membership', description: 'Membership department' },
  communications: { name: 'Communications', description: 'Communications department' },
  streicker: { name: 'Streicker', description: 'Streicker Center' }
};

// Derive role from legacy fields for backward compatibility
const deriveRole = (user) => {
  if (user.role) return user.role;
  if (user.isAdmin === true || user.preferences?.isAdmin === true) return 'admin';
  if (user.permissions?.canViewAllReservations === true) return 'approver';
  if (user.preferences?.createEvents === true || user.preferences?.editEvents === true) return 'requester';
  return 'viewer';
};

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
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [newUser, setNewUser] = useState({
    displayName: '',
    email: '',
    role: 'viewer',
    department: '',
    preferences: {
      startOfWeek: 'Sunday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100
    }
  });

  // Calculate stats - now using role-based counting
  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter(u => deriveRole(u) === 'admin').length;
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
          role: userToUpdate.role || deriveRole(userToUpdate),
          department: userToUpdate.department || null,
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
        role: newUser.role || 'viewer',
        department: newUser.department || null,
        preferences: {
          startOfWeek: newUser.preferences.startOfWeek || 'Sunday',
          defaultView: newUser.preferences.defaultView || 'week',
          defaultGroupBy: newUser.preferences.defaultGroupBy || 'categories',
          preferredZoomLevel: newUser.preferences.preferredZoomLevel || 100
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
        role: 'viewer',
        department: '',
        preferences: {
          startOfWeek: 'Sunday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100
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

  // Handle delete button click - two-step confirmation
  const handleDeleteClick = (userId) => {
    if (confirmDeleteId === userId) {
      // Already in confirm state, proceed with delete
      handleDelete(userId);
    } else {
      // First click - enter confirm state
      setConfirmDeleteId(userId);
    }
  };

  // Delete a user (called after confirmation)
  const handleDelete = async (userId) => {
    try {
      setDeletingId(userId);
      setConfirmDeleteId(null);

      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Error deleting user: ${response.statusText}`);
      }

      setUsers(prevUsers => prevUsers.filter(user => user._id !== userId));
      setSuccessMessage('User deleted successfully.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error deleting user:', err);
      setError('Failed to delete user. Please try again.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setDeletingId(null);
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
                  <span className="permissions-label">Role</span>
                  {isEditing ? (
                    <div className="role-selector">
                      <select
                        value={user.role || deriveRole(user)}
                        onChange={(e) => handleInputChange(user._id, 'role', e.target.value)}
                        className="role-select"
                      >
                        {Object.entries(ROLES).map(([key, { name, description }]) => (
                          <option key={key} value={key} title={description}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <span className="role-description">
                        {ROLES[user.role || deriveRole(user)]?.description}
                      </span>
                    </div>
                  ) : (
                    <div className="permissions-badges">
                      <span className={`permission-badge ${deriveRole(user)}`}>
                        {ROLES[deriveRole(user)]?.name || 'Viewer'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="user-department">
                  <span className="permissions-label">Department</span>
                  {isEditing ? (
                    <div className="department-selector">
                      <select
                        value={user.department || ''}
                        onChange={(e) => handleInputChange(user._id, 'department', e.target.value || null)}
                        className="department-select"
                      >
                        {Object.entries(DEPARTMENTS).map(([key, { name, description }]) => (
                          <option key={key} value={key} title={description}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <span className="department-description">
                        {DEPARTMENTS[user.department || '']?.description}
                      </span>
                    </div>
                  ) : (
                    <div className="permissions-badges">
                      {user.department ? (
                        <span className={`permission-badge department-${user.department}`}>
                          {DEPARTMENTS[user.department]?.name || user.department}
                        </span>
                      ) : (
                        <span className="permission-badge no-department">None</span>
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
                      <button className="edit-btn" onClick={() => toggleEditing(user._id)} disabled={confirmDeleteId === user._id}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      {!isCurrentUser && (
                        <div className="confirm-button-group">
                          <button
                            className={`delete-btn ${confirmDeleteId === user._id ? 'confirming' : ''}`}
                            onClick={() => handleDeleteClick(user._id)}
                            disabled={deletingId === user._id}
                          >
                            {deletingId === user._id ? (
                              <>
                                <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                                </svg>
                                Deleting...
                              </>
                            ) : confirmDeleteId === user._id ? (
                              'Confirm?'
                            ) : (
                              <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                                Delete
                              </>
                            )}
                          </button>
                          {confirmDeleteId === user._id && (
                            <button
                              className="cancel-confirm-x"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
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
                <h4 className="form-section-title">Role</h4>
                <div className="role-selection">
                  <select
                    value={newUser.role}
                    onChange={(e) => handleNewUserInputChange('role', e.target.value)}
                    className="role-select-modal"
                  >
                    {Object.entries(ROLES).map(([key, { name }]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <p className="role-description-text">
                    {ROLES[newUser.role]?.description}
                  </p>
                  <div className="role-capabilities">
                    <h5>Role capabilities:</h5>
                    <ul>
                      {newUser.role === 'viewer' && (
                        <li>View calendar events</li>
                      )}
                      {newUser.role === 'requester' && (
                        <>
                          <li>View calendar events</li>
                          <li>Submit and manage own reservation requests</li>
                        </>
                      )}
                      {newUser.role === 'approver' && (
                        <>
                          <li>View calendar events</li>
                          <li>Submit and manage own reservation requests</li>
                          <li>Approve/reject all reservations</li>
                          <li>Create, edit, and delete published events</li>
                        </>
                      )}
                      {newUser.role === 'admin' && (
                        <>
                          <li>All approver capabilities</li>
                          <li>Access Admin modules (Users, Categories, Locations)</li>
                          <li>Full system configuration access</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Department (Optional)</h4>
                <div className="department-selection">
                  <select
                    value={newUser.department || ''}
                    onChange={(e) => handleNewUserInputChange('department', e.target.value || null)}
                    className="department-select-modal"
                  >
                    {Object.entries(DEPARTMENTS).map(([key, { name }]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <p className="department-description-text">
                    {DEPARTMENTS[newUser.department || '']?.description}
                  </p>
                  {newUser.department && (
                    <div className="department-capabilities">
                      <h5>Department can edit:</h5>
                      <ul>
                        {newUser.department === 'security' && (
                          <>
                            <li>Door open time</li>
                            <li>Door close time</li>
                            <li>Door notes</li>
                          </>
                        )}
                        {newUser.department === 'maintenance' && (
                          <>
                            <li>Setup time</li>
                            <li>Teardown time</li>
                            <li>Setup notes</li>
                            <li>Event notes</li>
                          </>
                        )}
                      </ul>
                    </div>
                  )}
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

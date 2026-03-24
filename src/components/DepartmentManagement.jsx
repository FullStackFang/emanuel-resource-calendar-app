// src/components/DepartmentManagement.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { usePolling } from '../hooks/usePolling';
import { logger } from '../utils/logger';
import './DepartmentManagement.css';

// Get initials from department name
const getInitials = (name) => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
};

export default function DepartmentManagement({ apiToken }) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [departmentToDelete, setDepartmentToDelete] = useState(null);

  // Button confirmation states: 'idle' | 'confirming' | 'saving'
  const [saveButtonState, setSaveButtonState] = useState('idle');
  const [deleteButtonState, setDeleteButtonState] = useState('idle');
  const [resequencing, setResequencing] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    key: '',
    description: '',
    displayOrder: 1
  });

  // Calculate stats
  const stats = useMemo(() => {
    return { total: departments.length };
  }, [departments]);

  // Silent background refresh (no loading spinner, swallow errors)
  const silentRefresh = useCallback(async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/departments`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setDepartments(data);
      }
    } catch { /* silent */ }
  }, [apiToken]);

  usePolling(silentRefresh, 300_000, !!apiToken);

  useEffect(() => {
    loadDepartments();
  }, []);

  const loadDepartments = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/departments`, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load departments: ${response.status}`);
      }

      const data = await response.json();
      setDepartments(data);
    } catch (err) {
      logger.error('Error loading departments:', err);
      setError(err.message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  };

  const handleResequence = async () => {
    try {
      setResequencing(true);
      setError('');

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/departments/resequence`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to resequence departments: ${response.status}`);
      }

      await loadDepartments();
    } catch (err) {
      logger.error('Error resequencing departments:', err);
      setError(err.message || 'Failed to resequence departments');
    } finally {
      setResequencing(false);
    }
  };

  // Auto-generate key from name
  const generateKey = (name) => {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  };

  const handleAddNew = () => {
    setEditingDepartment(null);
    setShowModal(true);
    setSaveButtonState('idle');
    setFormData({
      name: '',
      key: '',
      description: '',
      displayOrder: departments.length + 1
    });
  };

  const handleEdit = (department) => {
    setEditingDepartment(department);
    setShowModal(true);
    setSaveButtonState('idle');
    setFormData({
      name: department.name,
      key: department.key,
      description: department.description || '',
      displayOrder: department.displayOrder || 1
    });
  };

  const handleDelete = (department) => {
    setDepartmentToDelete(department);
    setShowDeleteConfirm(true);
    setDeleteButtonState('idle');
  };

  const confirmDelete = async () => {
    // First click: switch to confirming state
    if (deleteButtonState === 'idle') {
      setDeleteButtonState('confirming');
      return;
    }

    // Second click: perform the delete
    try {
      setDeleteButtonState('saving');
      setError('');

      if (!apiToken) {
        throw new Error('Authentication required');
      }

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/departments/${departmentToDelete._id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete department');
      }

      logger.info('Department deleted successfully:', departmentToDelete.name);

      await loadDepartments();

      setShowDeleteConfirm(false);
      setDepartmentToDelete(null);
      setDeleteButtonState('idle');
    } catch (err) {
      logger.error('Error deleting department:', err);
      setError(err.message || 'Failed to delete department');
      setDeleteButtonState('idle');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // First click: switch to confirming state
    if (saveButtonState === 'idle') {
      if (!formData.name.trim()) {
        setError('Department name is required');
        return;
      }
      setSaveButtonState('confirming');
      return;
    }

    // Second click: perform the save
    try {
      setSaveButtonState('saving');
      setError('');

      if (!apiToken) {
        throw new Error('Authentication required');
      }

      if (!formData.name.trim()) {
        throw new Error('Department name is required');
      }

      const url = editingDepartment
        ? `${APP_CONFIG.API_BASE_URL}/departments/${editingDepartment._id}`
        : `${APP_CONFIG.API_BASE_URL}/departments`;

      const method = editingDepartment ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save department');
      }

      const result = await response.json();
      logger.info('Department saved successfully:', result);

      await loadDepartments();

      setShowModal(false);
      setEditingDepartment(null);
      setSaveButtonState('idle');
    } catch (err) {
      logger.error('Error saving department:', err);
      setError(err.message || 'Failed to save department');
      setSaveButtonState('idle');
    }
  };

  // Helper to update form data and reset confirm state
  const updateFormData = (updates) => {
    const newData = { ...formData, ...updates };
    // Auto-generate key when name changes (only for new departments)
    if (updates.name !== undefined && !editingDepartment) {
      newData.key = generateKey(updates.name);
    }
    setFormData(newData);
    if (saveButtonState === 'confirming') {
      setSaveButtonState('idle');
    }
  };

  if (loading) {
    return <LoadingSpinner variant="card" text="Loading..." />;
  }

  return (
    <div className="department-management">
      {/* Page Header */}
      <div className="department-management-header">
        <div className="department-management-header-content">
          <h2>Department Management</h2>
          <p className="department-management-header-subtitle">
            Manage departments for user assignment and reservation forms
          </p>
        </div>
        <div className="department-header-actions">
          <button
            onClick={handleResequence}
            className="resequence-btn"
            disabled={resequencing || departments.length === 0}
            title="Remove gaps in display order numbering"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
              <path d="M7 3v3M7 18v3M17 3v3M17 18v3" />
            </svg>
            {resequencing ? 'Resequencing...' : 'Resequence'}
          </button>
          <button onClick={handleAddNew} className="add-department-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Department
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="department-stats">
        <div className="department-stat-card total">
          <div className="department-stat-icon total">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <div className="department-stat-content">
            <h4>{stats.total}</h4>
            <p>Total Departments</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </div>
      )}

      {/* Departments Grid */}
      <div className="departments-list">
        {departments.length > 0 ? (
          <div className="departments-grid">
            {departments.map((department) => (
              <div
                key={department._id}
                className="department-card"
              >
                <div className="department-card-header">
                  <div className="department-icon">
                    {getInitials(department.name)}
                  </div>
                  <div className="department-card-info">
                    <h3 className="department-card-name">{department.name}</h3>
                    <div className="department-card-meta">
                      <span className="department-order-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12l7-7 7 7" />
                        </svg>
                        #{department.displayOrder}
                      </span>
                      {department.key && (
                        <span className="department-key-badge">
                          {department.key}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="department-card-description">
                  {department.description}
                </p>

                <div className="department-card-actions">
                  <button
                    onClick={() => handleEdit(department)}
                    className="edit-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(department)}
                    className="delete-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-departments">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <h3>No departments yet</h3>
            <p>Create your first department to start organizing users</p>
            <button onClick={handleAddNew} className="add-department-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Your First Department
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingDepartment ? 'Edit Department' : 'Create New Department'}</h3>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>
                    Department Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormData({ name: e.target.value })}
                    placeholder="Enter department name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>
                    Key <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.key}
                    onChange={(e) => updateFormData({ key: e.target.value })}
                    placeholder="e.g. security, maintenance"
                  />
                  <span className="form-hint">
                    Used internally for user assignment. Auto-generated from name.
                  </span>
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => updateFormData({ description: e.target.value })}
                    placeholder="Add a description for this department"
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label>Display Order</label>
                  <input
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) =>
                      updateFormData({ displayOrder: parseInt(e.target.value) || 1 })
                    }
                    min="1"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <div className="modal-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setSaveButtonState('idle');
                    }}
                    className="cancel-btn"
                    disabled={saveButtonState === 'saving'}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`save-btn ${saveButtonState === 'confirming' ? 'confirming' : ''}`}
                    disabled={saveButtonState === 'saving'}
                  >
                    {saveButtonState === 'saving' ? (
                      editingDepartment ? 'Saving...' : 'Creating...'
                    ) : saveButtonState === 'confirming' ? (
                      editingDepartment ? 'Confirm Save' : 'Confirm Create'
                    ) : (
                      editingDepartment ? 'Save Changes' : 'Create Department'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && departmentToDelete && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content delete-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Department</h3>
            </div>

            <div className="modal-body">
              <div className="delete-confirm-content">
                <div className="delete-confirm-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </div>
                <p>
                  Are you sure you want to delete{' '}
                  <span className="department-name-highlight">"{departmentToDelete.name}"</span>?
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <div className="modal-actions">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteButtonState('idle');
                  }}
                  className="cancel-btn"
                  disabled={deleteButtonState === 'saving'}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className={`delete-btn ${deleteButtonState === 'confirming' ? 'confirming' : ''}`}
                  disabled={deleteButtonState === 'saving'}
                >
                  {deleteButtonState === 'saving'
                    ? 'Deleting...'
                    : deleteButtonState === 'confirming'
                    ? 'Confirm Delete'
                    : 'Delete Department'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// src/components/CategoryManagement.jsx
import React, { useState, useEffect, useMemo } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './CategoryManagement.css';

// Preset color swatches for quick selection
const COLOR_PRESETS = [
  '#3b6eb8', // Primary blue
  '#059669', // Green
  '#dc2626', // Red
  '#d97706', // Orange
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#be185d', // Pink
  '#4f46e5', // Indigo
  '#65a30d', // Lime
  '#ea580c', // Deep orange
  '#0284c7', // Sky blue
  '#9333ea', // Violet
];

// Get initials from category name
const getInitials = (name) => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Determine if a color is light (for text contrast)
const isLightColor = (hex) => {
  if (!hex) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
};

export default function CategoryManagement({ apiToken }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  // Button confirmation states: 'idle' | 'confirming' | 'saving'
  const [saveButtonState, setSaveButtonState] = useState('idle');
  const [deleteButtonState, setDeleteButtonState] = useState('idle');
  const [resequencing, setResequencing] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    color: '#3b6eb8',
    description: '',
    displayOrder: 1
  });

  // Calculate stats
  const stats = useMemo(() => {
    return { total: categories.length };
  }, [categories]);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/categories`, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load categories: ${response.status}`);
      }

      const data = await response.json();
      setCategories(data);
    } catch (err) {
      logger.error('Error loading categories:', err);
      setError(err.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const handleResequence = async () => {
    try {
      setResequencing(true);
      setError('');

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/categories/resequence`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to resequence categories: ${response.status}`);
      }

      // Reload categories to show updated order
      await loadCategories();
    } catch (err) {
      logger.error('Error resequencing categories:', err);
      setError(err.message || 'Failed to resequence categories');
    } finally {
      setResequencing(false);
    }
  };

  const handleAddNew = () => {
    setEditingCategory(null);
    setShowModal(true);
    setSaveButtonState('idle');
    setFormData({
      name: '',
      color: '#3b6eb8',
      description: '',
      displayOrder: categories.length + 1
    });
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setShowModal(true);
    setSaveButtonState('idle');
    setFormData({
      name: category.name,
      color: category.color || '#3b6eb8',
      description: category.description || '',
      displayOrder: category.displayOrder || 1
    });
  };

  const handleDelete = (category) => {
    setCategoryToDelete(category);
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
        `${APP_CONFIG.API_BASE_URL}/categories/${categoryToDelete._id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete category');
      }

      logger.info('Category deleted successfully:', categoryToDelete.name);

      // Reload categories
      await loadCategories();

      // Close confirmation dialog
      setShowDeleteConfirm(false);
      setCategoryToDelete(null);
      setDeleteButtonState('idle');
    } catch (err) {
      logger.error('Error deleting category:', err);
      setError(err.message || 'Failed to delete category');
      setDeleteButtonState('idle');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // First click: switch to confirming state
    if (saveButtonState === 'idle') {
      // Validate before showing confirm
      if (!formData.name.trim()) {
        setError('Category name is required');
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
        throw new Error('Category name is required');
      }

      const url = editingCategory
        ? `${APP_CONFIG.API_BASE_URL}/categories/${editingCategory._id}`
        : `${APP_CONFIG.API_BASE_URL}/categories`;

      const method = editingCategory ? 'PUT' : 'POST';

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
        throw new Error(errorData.error || 'Failed to save category');
      }

      const result = await response.json();
      logger.info('Category saved successfully:', result);

      // Reload categories
      await loadCategories();

      // Close modal and reset
      setShowModal(false);
      setEditingCategory(null);
      setSaveButtonState('idle');
    } catch (err) {
      logger.error('Error saving category:', err);
      setError(err.message || 'Failed to save category');
      setSaveButtonState('idle');
    }
  };

  const handleColorSelect = (color) => {
    setFormData({ ...formData, color });
    // Reset confirm state when form data changes
    if (saveButtonState === 'confirming') {
      setSaveButtonState('idle');
    }
  };

  // Helper to update form data and reset confirm state
  const updateFormData = (updates) => {
    setFormData({ ...formData, ...updates });
    // Reset confirm state when form data changes
    if (saveButtonState === 'confirming') {
      setSaveButtonState('idle');
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="category-management">
      {/* Page Header */}
      <div className="category-management-header">
        <div className="category-management-header-content">
          <h2>Category Management</h2>
          <p className="category-management-header-subtitle">
            Organize and customize event categories for your calendar
          </p>
        </div>
        <div className="category-header-actions">
          <button
            onClick={handleResequence}
            className="resequence-btn"
            disabled={resequencing || categories.length === 0}
            title="Remove gaps in display order numbering"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
              <path d="M7 3v3M7 18v3M17 3v3M17 18v3" />
            </svg>
            {resequencing ? 'Resequencing...' : 'Resequence'}
          </button>
          <button onClick={handleAddNew} className="add-category-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Category
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="category-stats">
        <div className="category-stat-card total">
          <div className="category-stat-icon total">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
          <div className="category-stat-content">
            <h4>{stats.total}</h4>
            <p>Total Categories</p>
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

      {/* Categories Grid */}
      <div className="categories-list">
        {categories.length > 0 ? (
          <div className="categories-grid">
            {categories.map((category) => (
              <div
                key={category._id}
                className="category-card"
                style={{ '--category-color': category.color }}
              >
                <div className="category-card-header">
                  <div
                    className="category-color-indicator"
                    style={{
                      backgroundColor: category.color,
                      color: isLightColor(category.color) ? '#1c1917' : '#ffffff'
                    }}
                  >
                    {getInitials(category.name)}
                  </div>
                  <div className="category-card-info">
                    <h3 className="category-card-name">{category.name}</h3>
                    <div className="category-card-meta">
                      <span className="category-order-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12l7-7 7 7" />
                        </svg>
                        #{category.displayOrder}
                      </span>
                      <span className={`category-type-badge ${category.type}`}>
                        {category.type}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="category-card-description">
                  {category.description}
                </p>

                <div className="category-card-actions">
                  <button
                    onClick={() => handleEdit(category)}
                    className="edit-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(category)}
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
          <div className="no-categories">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3>No categories yet</h3>
            <p>Create your first category to start organizing events</p>
            <button onClick={handleAddNew} className="add-category-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Your First Category
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCategory ? 'Edit Category' : 'Create New Category'}</h3>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>
                    Category Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormData({ name: e.target.value })}
                    placeholder="Enter category name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Color</label>
                  <div className="color-picker-group">
                    <div className="color-picker-wrapper">
                      <input
                        type="color"
                        value={formData.color}
                        onChange={(e) => updateFormData({ color: e.target.value })}
                      />
                      <div
                        className="color-preview"
                        style={{ backgroundColor: formData.color }}
                      >
                        {formData.name || 'Preview'}
                      </div>
                    </div>
                    <div className="color-swatches">
                      {COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`color-swatch-btn ${formData.color === color ? 'selected' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => handleColorSelect(color)}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => updateFormData({ description: e.target.value })}
                    placeholder="Add a description for this category"
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
                      editingCategory ? 'Saving...' : 'Creating...'
                    ) : saveButtonState === 'confirming' ? (
                      editingCategory ? 'Confirm Save' : 'Confirm Create'
                    ) : (
                      editingCategory ? 'Save Changes' : 'Create Category'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && categoryToDelete && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content delete-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Category</h3>
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
                  <span className="category-name-highlight">"{categoryToDelete.name}"</span>?
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
                    : 'Delete Category'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

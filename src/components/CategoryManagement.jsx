// src/components/CategoryManagement.jsx
import React, { useState, useEffect } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './CategoryManagement.css';

export default function CategoryManagement({ apiToken }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    color: '#1E90FF',
    description: '',
    displayOrder: 1
  });

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

  const handleAddNew = () => {
    setEditingCategory(null);
    setShowModal(true);
    setFormData({
      name: '',
      color: '#1E90FF',
      description: '',
      displayOrder: categories.length + 1
    });
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setShowModal(true);
    setFormData({
      name: category.name,
      color: category.color || '#1E90FF',
      description: category.description || '',
      displayOrder: category.displayOrder || 1
    });
  };

  const handleDelete = (category) => {
    setCategoryToDelete(category);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    try {
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
    } catch (err) {
      logger.error('Error deleting category:', err);
      setError(err.message || 'Failed to delete category');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
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
    } catch (err) {
      logger.error('Error saving category:', err);
      setError(err.message || 'Failed to save category');
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="category-management">
      <div className="category-management-header">
        <h2>Category Management</h2>
        <button onClick={handleAddNew} className="add-category-btn">
          + Add Category
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="categories-list">
        <table className="categories-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Color</th>
              <th>Name</th>
              <th>Description</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category._id}>
                <td>{category.displayOrder}</td>
                <td>
                  <div
                    className="color-swatch"
                    style={{ backgroundColor: category.color }}
                  ></div>
                </td>
                <td className="category-name">{category.name}</td>
                <td className="category-description">{category.description}</td>
                <td>
                  <span className={`category-type-badge ${category.type}`}>
                    {category.type}
                  </span>
                </td>
                <td className="actions">
                  <button
                    onClick={() => handleEdit(category)}
                    className="edit-btn"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(category)}
                    className="delete-btn"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {categories.length === 0 && (
          <div className="no-categories">No categories found</div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editingCategory ? 'Edit Category' : 'Add New Category'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Color</label>
                <input
                  type="color"
                  value={formData.color}
                  onChange={(e) =>
                    setFormData({ ...formData, color: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Display Order</label>
                <input
                  type="number"
                  value={formData.displayOrder}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      displayOrder: parseInt(e.target.value) || 1
                    })
                  }
                  min="1"
                />
              </div>

              <div className="modal-actions">
                <button type="submit" className="save-btn">
                  {editingCategory ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && categoryToDelete && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content delete-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Delete</h3>
            <p>
              Are you sure you want to delete the category "{categoryToDelete.name}"?
            </p>
            <div className="modal-actions">
              <button onClick={confirmDelete} className="delete-btn">
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="cancel-btn"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// src/components/CategorySelectorModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import LoadingSpinner from './shared/LoadingSpinner';
import './CategorySelectorModal.css';

/**
 * CategorySelectorModal - Modal for selecting event categories
 *
 * Features:
 * - Fetches categories from templeEvents__Categories collection
 * - 4-column grid layout (wider than tall)
 * - Multi-select with visual checkboxes
 * - Category colors displayed as left border
 * - ESC key and overlay click to close
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Called when modal is closed/cancelled
 * @param {Function} onSave - Called with selected categories array when saved
 * @param {string[]} initialCategories - Initially selected category names
 */
export default function CategorySelectorModal({
  isOpen,
  onClose,
  onSave,
  initialCategories = []
}) {
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Reset selection when modal opens with new initial categories
  useEffect(() => {
    if (isOpen) {
      setSelectedCategories([...initialCategories]);
      fetchCategories();
    }
  }, [isOpen, initialCategories]);

  // Fetch categories from API
  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/categories`);
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      const data = await response.json();
      setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
      setError('Failed to load categories. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle ESC key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to close
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Toggle category selection
  const toggleCategory = (categoryName) => {
    setSelectedCategories(prev =>
      prev.includes(categoryName)
        ? prev.filter(c => c !== categoryName)
        : [...prev, categoryName]
    );
  };

  // Handle save
  const handleSave = () => {
    onSave(selectedCategories);
    onClose();
  };

  // Clear all selections
  const handleClearAll = () => {
    setSelectedCategories([]);
  };

  if (!isOpen) return null;

  return (
    <div className="category-modal-overlay" onClick={handleOverlayClick}>
      <div className="category-modal">
        {/* Header */}
        <div className="category-modal-header">
          <h3 className="category-modal-title">Select Categories</h3>
          <button
            className="category-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="category-modal-content">
          {loading ? (
            <LoadingSpinner minHeight={150} size={40} />
          ) : error ? (
            <div className="category-error">
              <p>{error}</p>
              <button onClick={fetchCategories}>Retry</button>
            </div>
          ) : categories.length === 0 ? (
            <div className="category-empty">
              No categories available. Please add categories in the admin panel.
            </div>
          ) : (
            <>
              {/* Quick actions */}
              <div className="category-quick-actions">
                <button
                  type="button"
                  className="category-quick-btn"
                  onClick={handleClearAll}
                >
                  Clear All
                </button>
                <span className="category-count">
                  {selectedCategories.length} of {categories.length} selected
                </span>
              </div>

              {/* Category grid - 4 columns */}
              <div className="category-grid">
                {categories.map(cat => (
                  <div
                    key={cat._id || cat.name}
                    className={`category-item ${selectedCategories.includes(cat.name) ? 'selected' : ''}`}
                    onClick={() => toggleCategory(cat.name)}
                    style={{ '--category-color': cat.color || '#808080' }}
                  >
                    <div className="category-checkbox">
                      {selectedCategories.includes(cat.name) && (
                        <span className="category-check">✓</span>
                      )}
                    </div>
                    <div className="category-info">
                      <span className="category-name">{cat.name}</span>
                      {cat.description && (
                        <span className="category-description">{cat.description}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="category-modal-footer">
          <button
            type="button"
            className="category-btn category-btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="category-btn category-btn-save"
            onClick={handleSave}
            disabled={loading}
          >
            Save {selectedCategories.length > 0 && `(${selectedCategories.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

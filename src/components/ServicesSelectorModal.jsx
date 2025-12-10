// src/components/ServicesSelectorModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import './ServicesSelectorModal.css';

/**
 * Service configuration data structure
 */
const SERVICE_SECTIONS = {
  seating: {
    title: '1. Seating & Setup',
    icon: '🪑',
    fields: [
      {
        name: 'seatingArrangement',
        label: 'Preferred Seating Arrangement',
        type: 'single-select',
        options: ['Theater', 'Classroom', 'Banquet Rounds', 'U-Shape', 'Boardroom', 'Cocktail', 'Other']
      },
      {
        name: 'presenterChairs',
        label: 'Chairs for presenters/panel',
        type: 'single-select',
        options: ['1-2 chairs', '3-4 chairs', '5+ chairs', 'Head table setup']
      }
    ]
  },
  catering: {
    title: '2. Catering',
    icon: '🍽️',
    fields: [
      {
        name: 'cateringApproach',
        label: 'Catering approach',
        type: 'single-select',
        options: ['Book catering through temple', 'Handle ourselves', 'Snacks only']
      },
      {
        name: 'refreshmentType',
        label: 'Type of Refreshments or Meal',
        type: 'multi-select',
        conditional: { field: 'cateringApproach', values: ['Book catering through temple', 'Handle ourselves', 'Snacks only'] },
        options: ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Dessert', 'Appetizers/Hors d\'oeuvres', 'Light refreshments']
      },
      {
        name: 'dietaryRestrictions',
        label: 'Dietary restrictions',
        type: 'text',
        placeholder: 'e.g., Kosher, vegetarian, gluten-free, nut allergies...'
      }
    ]
  },
  beverages: {
    title: '3. Beverages',
    icon: '🥤',
    fields: [
      {
        name: 'nonAlcoholicBeverages',
        label: 'Non-alcoholic',
        type: 'multi-select',
        options: ['Coffee', 'Tea', 'Soft drinks', 'Sparkling water', 'Juice', 'Lemonade']
      },
      {
        name: 'alcoholicBeverages',
        label: 'Alcoholic',
        type: 'multi-select',
        options: ['White wine', 'Red wine', 'Prosecco', 'Champagne', 'Vodka', 'Gin', 'Tequila', 'Whisky', 'Scotch', 'Other']
      }
    ]
  },
  tableSettings: {
    title: '4. Table Settings',
    icon: '🍴',
    fields: [
      {
        name: 'linens',
        label: 'Linens',
        type: 'single-select',
        options: ['White tablecloths', 'Colored tablecloths', 'Table runners only', 'Full linen service']
      },
      {
        name: 'placeSettings',
        label: 'Place settings',
        type: 'multi-select',
        options: ['Napkins', 'Plates', 'Utensils', 'Cups/Glasses', 'Chargers', 'Centerpieces']
      },
      {
        name: 'flowers',
        label: 'Flowers',
        type: 'single-select',
        options: ['Small centerpieces', 'Large centerpieces', 'Bud vases', 'Custom arrangement']
      }
    ]
  },
  avSupport: {
    title: '5. A/V Support',
    icon: '🎤',
    fields: [
      {
        name: 'avEquipment',
        label: 'A/V Equipment needed',
        type: 'multi-select',
        options: ['Livestreaming', 'Screen/Projector', 'Podium with Mic', 'Handheld mics', 'Lavalier mics', 'Keyboard/Piano', 'Mic stands', 'Spotify/Music hookup', 'Music stands', 'Recording']
      }
    ]
  },
  photography: {
    title: '6. Photography/Video',
    icon: '📷',
    fields: [
      {
        name: 'photographer',
        label: 'Photographer',
        type: 'yes-no'
      },
      {
        name: 'videographer',
        label: 'Videographer',
        type: 'yes-no'
      }
    ]
  }
};

/**
 * ServicesSelectorModal - Modal for selecting event services
 *
 * Features:
 * - Sectioned layout for different service categories
 * - Single-select, multi-select, yes/no, and text inputs
 * - Conditional fields (e.g., meal type only shows when catering is selected)
 * - ESC key and overlay click to close
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Called when modal is closed/cancelled
 * @param {Function} onSave - Called with selected services object when saved
 * @param {object} initialServices - Initially selected services
 */
export default function ServicesSelectorModal({
  isOpen,
  onClose,
  onSave,
  initialServices = {}
}) {
  const [services, setServices] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    seating: true,
    catering: true,
    beverages: true,
    tableSettings: true,
    avSupport: true,
    photography: true
  });

  // Reset selection when modal opens with new initial services
  useEffect(() => {
    if (isOpen) {
      setServices({ ...initialServices });
    }
  }, [isOpen, initialServices]);

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

  // Toggle section expansion
  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  // Handle single-select change
  const handleSingleSelect = (fieldName, value) => {
    setServices(prev => ({
      ...prev,
      [fieldName]: prev[fieldName] === value ? '' : value
    }));
  };

  // Handle multi-select toggle
  const handleMultiSelect = (fieldName, value) => {
    setServices(prev => {
      const currentValues = prev[fieldName] || [];
      const newValues = currentValues.includes(value)
        ? currentValues.filter(v => v !== value)
        : [...currentValues, value];
      return {
        ...prev,
        [fieldName]: newValues
      };
    });
  };

  // Handle "None" option for multi-select with allowNone
  const handleNoneToggle = (fieldName) => {
    setServices(prev => ({
      ...prev,
      [fieldName]: prev[`${fieldName}_none`] ? [] : [],
      [`${fieldName}_none`]: !prev[`${fieldName}_none`]
    }));
  };

  // Handle yes/no toggle
  const handleYesNo = (fieldName, value) => {
    setServices(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Handle text input change
  const handleTextChange = (fieldName, value) => {
    setServices(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Check if a conditional field should be visible
  const isFieldVisible = (field) => {
    if (!field.conditional) return true;
    const { field: condField, values } = field.conditional;
    return values.includes(services[condField]);
  };

  // Handle save
  const handleSave = () => {
    onSave(services);
    onClose();
  };

  // Clear all selections
  const handleClearAll = () => {
    setServices({});
  };

  // Count total selected services
  const countSelectedServices = () => {
    let count = 0;
    Object.entries(services).forEach(([key, value]) => {
      if (key.endsWith('_none')) return; // Skip "none" flags
      if (Array.isArray(value)) {
        count += value.length;
      } else if (value && value !== '' && value !== false) {
        count += 1;
      }
    });
    return count;
  };

  // Render a single field based on type
  const renderField = (field, sectionKey) => {
    if (!isFieldVisible(field)) return null;

    const { name, label, type, options, placeholder, allowNone, noneLabel } = field;

    switch (type) {
      case 'single-select':
        return (
          <div key={name} className="services-field">
            <label className="services-field-label">{label}</label>
            <div className="services-options-row">
              {options.map(option => (
                <button
                  key={option}
                  type="button"
                  className={`services-option-btn ${services[name] === option ? 'selected' : ''}`}
                  onClick={() => handleSingleSelect(name, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );

      case 'multi-select':
        return (
          <div key={name} className="services-field">
            <label className="services-field-label">{label}</label>
            {allowNone && (
              <div className="services-none-option">
                <button
                  type="button"
                  className={`services-none-btn ${services[`${name}_none`] ? 'selected' : ''}`}
                  onClick={() => handleNoneToggle(name)}
                >
                  {noneLabel}
                </button>
              </div>
            )}
            {!services[`${name}_none`] && (
              <div className="services-options-grid">
                {options.map(option => (
                  <div
                    key={option}
                    className={`services-checkbox-item ${(services[name] || []).includes(option) ? 'selected' : ''}`}
                    onClick={() => handleMultiSelect(name, option)}
                  >
                    <div className="services-checkbox">
                      {(services[name] || []).includes(option) && (
                        <span className="services-check">✓</span>
                      )}
                    </div>
                    <span className="services-checkbox-label">{option}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'yes-no':
        return (
          <div key={name} className="services-field services-field-inline">
            <label className="services-field-label">{label}</label>
            <div className="services-yes-no">
              <button
                type="button"
                className={`services-yn-btn ${services[name] === true ? 'selected yes' : ''}`}
                onClick={() => handleYesNo(name, true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={`services-yn-btn ${services[name] === false ? 'selected no' : ''}`}
                onClick={() => handleYesNo(name, false)}
              >
                No
              </button>
            </div>
          </div>
        );

      case 'text':
        return (
          <div key={name} className="services-field">
            <label className="services-field-label">{label}</label>
            <input
              type="text"
              className="services-text-input"
              value={services[name] || ''}
              onChange={(e) => handleTextChange(name, e.target.value)}
              placeholder={placeholder}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // Check if a section has any selected values
  const sectionHasSelections = (section) => {
    const { fields } = section;
    return fields.some(field => {
      const value = services[field.name];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'boolean') {
        return value === true; // Only count "Yes" as a selection
      }
      if (typeof value === 'string') {
        return value !== '';
      }
      return false;
    });
  };

  // Render a section
  const renderSection = (sectionKey, section) => {
    const { title, icon, fields } = section;
    const isExpanded = expandedSections[sectionKey];
    const hasSelections = sectionHasSelections(section);

    return (
      <div key={sectionKey} className={`services-section ${isExpanded ? 'expanded' : 'collapsed'} ${hasSelections ? 'has-selections' : ''}`}>
        <div
          className={`services-section-header ${hasSelections ? 'has-selections' : ''}`}
          onClick={() => toggleSection(sectionKey)}
        >
          <span className="services-section-icon">{icon}</span>
          <h4 className="services-section-title">{title}</h4>
          {hasSelections && <span className="services-section-check">✓</span>}
          <span className="services-section-toggle">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
        {isExpanded && (
          <div className="services-section-content">
            {fields.map(field => renderField(field, sectionKey))}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  const selectedCount = countSelectedServices();

  return (
    <div className="services-modal-overlay" onClick={handleOverlayClick}>
      <div className="services-modal">
        {/* Header */}
        <div className="services-modal-header">
          <h3 className="services-modal-title">Select Services</h3>
          <button
            className="services-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="services-modal-content">
          {/* Quick actions */}
          <div className="services-quick-actions">
            <button
              type="button"
              className="services-quick-btn"
              onClick={handleClearAll}
            >
              Clear All
            </button>
            <span className="services-count">
              {selectedCount} service{selectedCount !== 1 ? 's' : ''} selected
            </span>
          </div>

          {/* Service sections */}
          <div className="services-sections">
            {Object.entries(SERVICE_SECTIONS).map(([key, section]) =>
              renderSection(key, section)
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="services-modal-footer">
          <button
            type="button"
            className="services-btn services-btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="services-btn services-btn-save"
            onClick={handleSave}
          >
            Save {selectedCount > 0 && `(${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Export the service sections for use in other components
export { SERVICE_SECTIONS };

// src/components/ServicesSelectorModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import useScrollLock from '../hooks/useScrollLock';
import './ServicesSelectorModal.css';

/**
 * Service configuration data structure
 */
const SERVICE_SECTIONS = {
  seating: {
    title: '1. Seating & Setup',
    icon: '\u{1FA91}',
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
    icon: '\u{1F37D}\uFE0F',
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
    icon: '\u{1F964}',
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
    icon: '\u{1F374}',
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
    icon: '\u{1F3A4}',
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
    icon: '\u{1F4F7}',
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
 * ServicesContent - Inline content for selecting event services
 *
 * Controlled component: receives services data and a change callback.
 * Used both inside ServicesSelectorModal (as a modal) and inline in the Services tab.
 *
 * @param {object} services - Current services selections
 * @param {Function} onServicesChange - Called with updater function: (prev => next)
 * @param {boolean} readOnly - Whether fields are read-only
 */
export function ServicesContent({ services, onServicesChange, readOnly = false, collapsible = true }) {
  const [expandedSections, setExpandedSections] = useState({
    seating: true,
    catering: true,
    beverages: true,
    tableSettings: true,
    avSupport: true,
    photography: true
  });

  // Toggle section expansion (only used when collapsible=true)
  const toggleSection = (sectionKey) => {
    if (!collapsible) return;
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  // Handle single-select change
  const handleSingleSelect = (fieldName, value) => {
    if (readOnly) return;
    onServicesChange(prev => ({
      ...prev,
      [fieldName]: prev[fieldName] === value ? '' : value
    }));
  };

  // Handle multi-select toggle
  const handleMultiSelect = (fieldName, value) => {
    if (readOnly) return;
    onServicesChange(prev => {
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
    if (readOnly) return;
    onServicesChange(prev => ({
      ...prev,
      [fieldName]: prev[`${fieldName}_none`] ? [] : [],
      [`${fieldName}_none`]: !prev[`${fieldName}_none`]
    }));
  };

  // Handle yes/no toggle
  const handleYesNo = (fieldName, value) => {
    if (readOnly) return;
    onServicesChange(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Handle text input change
  const handleTextChange = (fieldName, value) => {
    if (readOnly) return;
    onServicesChange(prev => ({
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

  // Render a section
  const renderSection = (sectionKey, section) => {
    const { title, icon, fields } = section;
    const isExpanded = collapsible ? expandedSections[sectionKey] : true;
    const hasSelections = sectionHasSelections(section);

    return (
      <div key={sectionKey} className={`services-section ${isExpanded ? 'expanded' : 'collapsed'} ${hasSelections ? 'has-selections' : ''} ${!collapsible ? 'services-section--flat' : ''}`}>
        <div
          className={`services-section-header ${hasSelections ? 'has-selections' : ''} ${!collapsible ? 'services-section-header--flat' : ''}`}
          onClick={collapsible ? () => toggleSection(sectionKey) : undefined}
        >
          <span className="services-section-icon">{icon}</span>
          <h4 className="services-section-title">{title}</h4>
          {collapsible && hasSelections && <span className="services-section-check">✓</span>}
          {collapsible && (
            <span className="services-section-toggle">
              {isExpanded ? '\u25BC' : '\u25B6'}
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="services-section-content">
            {fields.map(field => renderField(field, sectionKey))}
          </div>
        )}
      </div>
    );
  };

  const selectedCount = countSelectedServices();

  return (
    <div className={`services-content-inline ${readOnly ? 'services-content--readonly' : ''}`}>
      {/* Quick actions */}
      <div className="services-quick-actions">
        {!readOnly && (
          <button
            type="button"
            className="services-quick-btn"
            onClick={() => onServicesChange(() => ({}))}
          >
            Clear All
          </button>
        )}
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

      {/* Additional needs */}
      <div className={`services-notes-section ${services.serviceNotes ? 'has-content' : ''}`}>
        <div className="services-notes-header">
          <span className="services-section-icon">{'\u{1F4DD}'}</span>
          <label className="services-notes-label" htmlFor="serviceNotes">Additional Needs</label>
          {services.serviceNotes && <span className="services-section-check">✓</span>}
        </div>
        <textarea
          id="serviceNotes"
          className="services-notes-textarea"
          value={services.serviceNotes || ''}
          onChange={(e) => handleTextChange('serviceNotes', e.target.value)}
          placeholder={readOnly ? '' : 'List any other needs not covered above \u2014 e.g., special lighting, additional furniture, accessibility requirements...'}
          rows={3}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

/**
 * ServicesSelectorModal - Modal wrapper for ServicesContent
 *
 * Thin wrapper that adds modal chrome (overlay, header, footer, ESC/click-outside).
 * The actual content is rendered by ServicesContent.
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Called when modal is closed/cancelled
 * @param {Function} onSave - Called with selected services object when saved
 * @param {object} initialServices - Initially selected services
 * @param {boolean} readOnly - Whether fields are read-only
 */
export default function ServicesSelectorModal({
  isOpen,
  onClose,
  onSave,
  initialServices = {},
  readOnly = false
}) {
  const [services, setServices] = useState({});

  // Reset selection when modal opens with new initial services
  useEffect(() => {
    if (isOpen) {
      setServices({ ...initialServices });
    }
  }, [isOpen, initialServices]);

  // Lock body scroll when modal is open (runs before paint to prevent jitter)
  useScrollLock(isOpen);

  // Handle ESC key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to close
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle save
  const handleSave = () => {
    onSave(services);
    onClose();
  };

  // Count total selected services (for footer button label)
  const countSelectedServices = () => {
    let count = 0;
    Object.entries(services).forEach(([key, value]) => {
      if (key.endsWith('_none')) return;
      if (Array.isArray(value)) {
        count += value.length;
      } else if (value && value !== '' && value !== false) {
        count += 1;
      }
    });
    return count;
  };

  if (!isOpen) return null;

  const selectedCount = countSelectedServices();

  return (
    <div className="services-modal-overlay" onClick={handleOverlayClick}>
      <div className={`services-modal ${readOnly ? 'services-modal--readonly' : ''}`}>
        {/* Header */}
        <div className="services-modal-header">
          <h3 className="services-modal-title">{readOnly ? 'Services' : 'Select Services'}</h3>
          <button
            className="services-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content — delegates to ServicesContent */}
        <div className="services-modal-content">
          <ServicesContent
            services={services}
            onServicesChange={setServices}
            readOnly={readOnly}
          />
        </div>

        {/* Footer */}
        <div className="services-modal-footer">
          {readOnly ? (
            <button
              type="button"
              className="services-btn services-btn-cancel"
              onClick={onClose}
            >
              Close
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Export the service sections for use in other components
export { SERVICE_SECTIONS };

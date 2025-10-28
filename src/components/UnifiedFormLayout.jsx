import React from 'react';
import './UnifiedFormLayout.css';

/**
 * UnifiedFormLayout - Shared form layout component with consistent styling
 *
 * Provides:
 * - Sticky action bar at top
 * - Scrollable form sections
 * - Consistent field rendering
 * - Validation error display
 *
 * @param {object} props
 * @param {string} props.title - Form title displayed in action bar
 * @param {array} props.actions - Action buttons configuration
 * @param {array} props.sections - Form sections with fields
 * @param {boolean} props.hasChanges - Show unsaved changes indicator
 * @param {object} props.errors - Validation errors by field name
 * @param {string} props.className - Additional CSS classes
 * @param {function} props.onSubmit - Form submit handler (optional)
 * @param {node} props.headerContent - Additional content in action bar (optional)
 */
const UnifiedFormLayout = ({
  title,
  actions = [],
  sections = [],
  hasChanges = false,
  errors = {},
  className = '',
  onSubmit,
  headerContent,
  children // Allow custom content instead of automatic section rendering
}) => {

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit(e);
    }
  };

  /**
   * Render a single field based on type
   */
  const renderField = (field) => {
    const {
      type,
      name,
      label,
      value,
      onChange,
      required = false,
      disabled = false,
      options = [],
      placeholder,
      rows = 3,
      min,
      max,
      step,
      gridSpan = 'auto',
      customRender,
      helpText,
      ...fieldProps
    } = field;

    const fieldId = `field-${name}`;
    const hasError = errors[name];
    const fieldClassName = `form-group ${gridSpan === 'full' ? 'full-width' : ''} ${hasError ? 'has-error' : ''}`;

    // Custom render function provided
    if (customRender) {
      return (
        <div key={name} className={fieldClassName}>
          {customRender()}
        </div>
      );
    }

    // Standard field types
    return (
      <div key={name} className={fieldClassName}>
        {label && (
          <label htmlFor={fieldId}>
            {label}
            {required && <span className="required-indicator"> *</span>}
          </label>
        )}

        {type === 'text' && (
          <input
            type="text"
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            {...fieldProps}
          />
        )}

        {type === 'number' && (
          <input
            type="number"
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            {...fieldProps}
          />
        )}

        {type === 'textarea' && (
          <textarea
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            rows={rows}
            {...fieldProps}
          />
        )}

        {type === 'date' && (
          <input
            type="date"
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            {...fieldProps}
          />
        )}

        {type === 'time' && (
          <input
            type="time"
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            {...fieldProps}
          />
        )}

        {type === 'datetime-local' && (
          <input
            type="datetime-local"
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            {...fieldProps}
          />
        )}

        {type === 'select' && (
          <select
            id={fieldId}
            name={name}
            value={value || ''}
            onChange={onChange}
            disabled={disabled}
            required={required}
            {...fieldProps}
          >
            <option value="">Select...</option>
            {options.map((option) => (
              <option
                key={typeof option === 'string' ? option : option.value}
                value={typeof option === 'string' ? option : option.value}
              >
                {typeof option === 'string' ? option : option.label}
              </option>
            ))}
          </select>
        )}

        {type === 'checkbox' && (
          <div className="checkbox-wrapper">
            <input
              type="checkbox"
              id={fieldId}
              name={name}
              checked={!!value}
              onChange={onChange}
              disabled={disabled}
              {...fieldProps}
            />
            {helpText && <span className="help-text">{helpText}</span>}
          </div>
        )}

        {type === 'radio' && (
          <div className="radio-group">
            {options.map((option) => {
              const optionValue = typeof option === 'string' ? option : option.value;
              const optionLabel = typeof option === 'string' ? option : option.label;
              const radioId = `${fieldId}-${optionValue}`;

              return (
                <div key={optionValue} className="radio-option">
                  <input
                    type="radio"
                    id={radioId}
                    name={name}
                    value={optionValue}
                    checked={value === optionValue}
                    onChange={onChange}
                    disabled={disabled}
                    {...fieldProps}
                  />
                  <label htmlFor={radioId}>{optionLabel}</label>
                </div>
              );
            })}
          </div>
        )}

        {helpText && type !== 'checkbox' && (
          <small className="help-text">{helpText}</small>
        )}

        {hasError && (
          <span className="error-message">{errors[name]}</span>
        )}
      </div>
    );
  };

  /**
   * Render a form section with fields
   */
  const renderSection = (section, index) => {
    const {
      title: sectionTitle,
      className: sectionClassName = '',
      fields = [],
      visible = true,
      collapsible = false,
      defaultCollapsed = false,
      gridColumns = 2 // Default to 2 columns, can be 1, 2, or 3
    } = section;

    if (!visible) return null;

    // Determine grid class based on column count
    let gridClass = 'form-grid';
    if (gridColumns === 1) gridClass += ' single-column';
    else if (gridColumns === 3) gridClass += ' three-column';

    return (
      <section key={index} className={`form-section ${sectionClassName}`}>
        {sectionTitle && <h2 className="section-title">{sectionTitle}</h2>}

        <div className={gridClass}>
          {fields.map(renderField)}
        </div>
      </section>
    );
  };

  /**
   * Render an action button
   */
  const renderAction = (action, index) => {
    const {
      label,
      onClick,
      variant = 'secondary',
      disabled = false,
      icon,
      hidden = false,
      type = 'button',
      className: customClassName
    } = action;

    if (hidden) return null;

    // Use custom className if provided, otherwise fall back to variant-based class
    const buttonClass = customClassName
      ? `action-btn ${customClassName}`
      : `action-btn ${variant}-btn`;

    return (
      <button
        key={index}
        type={type}
        className={buttonClass}
        onClick={onClick}
        disabled={disabled}
      >
        {icon ? `${icon} ${label}` : label}
      </button>
    );
  };

  return (
    <div className={`unified-form-layout ${className}`}>
      {/* Sticky Action Bar */}
      <div className="unified-action-bar">
        <div className="action-bar-content">
          {title && <h2 className="form-title">{title}</h2>}
          {hasChanges && (
            <span className="unsaved-changes-indicator" title="You have unsaved changes">
              ● Unsaved changes
            </span>
          )}
          <div className="review-actions">
            {headerContent}
            {actions.map(renderAction)}
          </div>
        </div>
      </div>

      {/* Scrollable Form Content */}
      <div className="unified-form-content">
        <div className="form-content-wrapper">
          <form onSubmit={handleFormSubmit}>
            {children ? children : sections.map(renderSection)}
          </form>
        </div>
      </div>
    </div>
  );
};

export default UnifiedFormLayout;

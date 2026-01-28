// src/components/MultiSelect.jsx
// Multi-select dropdown component using Emanuel Modern Design System
import React, { useState, useRef, useEffect } from 'react';
import './MultiSelect.css';

function MultiSelect({
  options,
  selected,
  onChange,
  label,
  customHeight,
  customPadding
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  const prevSelectedRef = useRef(selected);

  // Only update localSelected when props.selected actually changes
  useEffect(() => {
    const selectedChanged =
      JSON.stringify(prevSelectedRef.current) !== JSON.stringify(selected);

    if (selectedChanged) {
      setLocalSelected(selected);
      prevSelectedRef.current = selected;
    }
  }, [selected]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
          onChange(localSelected);
        }
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, localSelected, onChange, selected]);

  const toggleOption = (option, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    setLocalSelected(prev =>
      prev.includes(option)
        ? prev.filter(item => item !== option)
        : [...prev, option]
    );
  };

  const selectAll = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setLocalSelected(options);
    onChange(options);
  };

  const selectNone = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setLocalSelected([]);
    onChange([]);
  };

  const toggleDropdown = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isOpen) {
      if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
        onChange(localSelected);
      }
    }
    setIsOpen(!isOpen);
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalSelected([]);
    if (onChange) {
      onChange([]);
    }
  };

  // Build trigger style with optional custom height/padding
  const triggerStyle = {};
  if (customHeight) triggerStyle.height = customHeight;
  if (customPadding) triggerStyle.padding = customPadding;

  return (
    <div ref={dropdownRef} className="multiselect-container">
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.stopPropagation()}
        className="multiselect-trigger"
        style={Object.keys(triggerStyle).length > 0 ? triggerStyle : undefined}
      >
        <span className={`multiselect-trigger-text ${localSelected.length === 0 ? 'placeholder' : ''}`}>
          {localSelected.length === 0
            ? label || 'Select options'
            : localSelected.length === 1
              ? localSelected[0]
              : `${localSelected.length} selected`}
        </span>
        <div className="multiselect-trigger-actions">
          {localSelected.length > 0 && (
            <span
              onClick={handleClear}
              className="multiselect-clear"
              title="Clear all selections"
            >
              ×
            </span>
          )}
          <span className={`multiselect-chevron ${isOpen ? 'open' : ''}`}>
            ▼
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="multiselect-dropdown">
          {options.length === 0 ? (
            <div className="multiselect-empty">
              No options available
            </div>
          ) : (
            <>
              {/* All/None buttons */}
              <div className="multiselect-actions">
                <button
                  onClick={selectAll}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="multiselect-action-btn"
                >
                  All
                </button>
                <button
                  onClick={selectNone}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="multiselect-action-btn"
                >
                  None
                </button>
              </div>

              {/* Options list */}
              {options.map((option) => (
                <div
                  key={option}
                  onClick={(e) => toggleOption(option, e)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`multiselect-option ${localSelected.includes(option) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={localSelected.includes(option)}
                    onChange={() => {}} // Controlled by parent click
                    className="multiselect-checkbox"
                  />
                  <span className="multiselect-option-label">
                    {option}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default MultiSelect;

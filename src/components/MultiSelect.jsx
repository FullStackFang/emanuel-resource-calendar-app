// Updated MultiSelect component
import React, { useState, useRef, useEffect } from 'react';

function MultiSelect({ options, selected, onChange, label }) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected);
  const dropdownRef = useRef(null);

  // Sync local state with prop when prop changes
  useEffect(() => {
    setLocalSelected(selected);
  }, [selected]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (isOpen) {
          // Apply changes when closing dropdown
          setIsOpen(false);
          onChange(localSelected);
        }
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, localSelected, onChange]);

  const toggleOption = (option, event) => {
    // Prevent default to avoid issues with label's native behavior
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    // Update only local state when toggling options
    setLocalSelected(prev => 
      prev.includes(option) 
        ? prev.filter(item => item !== option) 
        : [...prev, option]
    );
  };

  const toggleDropdown = () => {
    if (isOpen) {
      // Apply changes when closing dropdown
      onChange(localSelected);
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="multi-select-container" ref={dropdownRef}>
      <label>{label}</label>
      <div 
        className={`multi-select-header ${isOpen ? 'active' : ''}`}
        onClick={toggleDropdown}
      >
        <div className="selected-text">
          {localSelected.length === 0 
            ? 'Select options' 
            : localSelected.length === 1 
              ? localSelected[0] 
              : `${localSelected.length} selected`}
        </div>
        <div className="dropdown-arrow">▼</div>
      </div>
      
      {isOpen && (
        <div className="multi-select-options">
          {options.map(option => (
            <div
              key={option}
              className={`multi-select-option ${localSelected.includes(option) ? 'selected' : ''}`}
              onClick={(e) => toggleOption(option, e)}
            >
              <input
                type="checkbox"
                checked={localSelected.includes(option)}
                onChange={(e) => toggleOption(option, e)}
                id={`option-${option}`}
                onClick={(e) => e.stopPropagation()}
              />
              <label 
                htmlFor={`option-${option}`}
                onClick={(e) => toggleOption(option, e)}
              >
                {option}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MultiSelect;
// src/components/MultiSelect.jsx
// Multi-select dropdown component using Emanuel Modern Design System
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './MultiSelect.css';

function MultiSelect({
  options,
  selected,
  onChange,
  label,
  customHeight,
  customPadding,
  searchable = false,
  icon = null
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const searchInputRef = useRef(null);

  const prevSelectedRef = useRef(selected);

  // Only update localSelected when props.selected actually changes.
  // Skip while dropdown is open to prevent parent re-renders (e.g.,
  // Calendar's dynamicCategories effect) from overwriting the user's
  // in-progress selections.
  useEffect(() => {
    if (isOpen) return;

    const selectedChanged =
      JSON.stringify(prevSelectedRef.current) !== JSON.stringify(selected);

    if (selectedChanged) {
      setLocalSelected(selected);
      prevSelectedRef.current = selected;
    }
  }, [selected, isOpen]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery('');
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

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      // Small delay to allow dropdown animation
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, searchable]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase().trim();
    return options.filter(option => option.toLowerCase().includes(query));
  }, [options, searchQuery]);

  const toggleOption = useCallback((option, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    setLocalSelected(prev =>
      prev.includes(option)
        ? prev.filter(item => item !== option)
        : [...prev, option]
    );
  }, []);

  const selectAll = useCallback((event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setLocalSelected(options);
    onChange(options);
  }, [options, onChange]);

  const selectNone = useCallback((event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setLocalSelected([]);
    onChange([]);
  }, [onChange]);

  const toggleDropdown = useCallback((event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isOpen) {
      if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
        onChange(localSelected);
      }
      setSearchQuery('');
    }
    setIsOpen(!isOpen);
  }, [isOpen, localSelected, selected, onChange]);

  const handleClear = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalSelected([]);
    setSearchQuery('');
    if (onChange) {
      onChange([]);
    }
  }, [onChange]);

  const handleSearchChange = useCallback((e) => {
    e.stopPropagation();
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchKeyDown = useCallback((e) => {
    // Prevent dropdown from closing on Enter in search
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
    }
    // Close on Escape
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchQuery('');
      triggerRef.current?.focus();
    }
  }, []);

  // Build trigger style with optional custom height/padding
  const triggerStyle = {};
  if (customHeight) triggerStyle.height = customHeight;
  if (customPadding) triggerStyle.padding = customPadding;

  const isAllSelected = localSelected.length === options.length && options.length > 0;
  const isNoneSelected = localSelected.length === 0;
  const isFiltered = !isAllSelected && !isNoneSelected;

  // Determine trigger display text
  const triggerContent = () => {
    if (localSelected.length === 0) {
      return <span className="multiselect-trigger-text placeholder">{label || 'Select options'}</span>;
    }
    if (localSelected.length === 1) {
      return <span className="multiselect-trigger-text">{localSelected[0]}</span>;
    }
    if (isAllSelected) {
      return (
        <span className="multiselect-trigger-text">
          All {label || 'options'}
          <span className="multiselect-count-badge all">{localSelected.length}</span>
        </span>
      );
    }
    return (
      <span className="multiselect-trigger-text">
        {localSelected.length} {label || 'selected'}
        <span className="multiselect-count-badge">{localSelected.length}/{options.length}</span>
      </span>
    );
  };

  return (
    <div ref={dropdownRef} className={`multiselect-container ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.stopPropagation()}
        className={`multiselect-trigger ${isFiltered ? 'has-filter' : ''} ${isOpen ? 'open' : ''}`}
        style={Object.keys(triggerStyle).length > 0 ? triggerStyle : undefined}
      >
        {icon && <span className="multiselect-trigger-icon">{icon}</span>}
        {triggerContent()}
        <div className="multiselect-trigger-actions">
          {localSelected.length > 0 && !isAllSelected && (
            <span
              onClick={handleClear}
              className="multiselect-clear"
              title="Clear all selections"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          )}
          <span className={`multiselect-chevron ${isOpen ? 'open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="multiselect-dropdown">
          {/* Sticky header with search + actions */}
          <div className="multiselect-header">
            {searchable && (
              <div className="multiselect-search">
                <svg className="multiselect-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="multiselect-search-input"
                  placeholder={`Search ${label || 'options'}...`}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                {searchQuery && (
                  <button
                    className="multiselect-search-clear"
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); searchInputRef.current?.focus(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M7.5 2.5L2.5 7.5M2.5 2.5L7.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="multiselect-actions">
              <button
                onClick={selectAll}
                onMouseDown={(e) => e.stopPropagation()}
                className={`multiselect-action-btn ${isAllSelected ? 'active' : ''}`}
              >
                Select All
              </button>
              <span className="multiselect-actions-divider"></span>
              <button
                onClick={selectNone}
                onMouseDown={(e) => e.stopPropagation()}
                className={`multiselect-action-btn ${isNoneSelected ? 'active' : ''}`}
              >
                Clear
              </button>
              <span className="multiselect-selected-count">
                {localSelected.length}/{options.length}
              </span>
            </div>
          </div>

          {/* Options list */}
          <div className="multiselect-options-list">
            {options.length === 0 ? (
              <div className="multiselect-empty">
                No options available
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="multiselect-empty">
                No matches for "{searchQuery}"
              </div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option}
                  onClick={(e) => toggleOption(option, e)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`multiselect-option ${localSelected.includes(option) ? 'selected' : ''}`}
                >
                  <span className="multiselect-check-box">
                    {localSelected.includes(option) && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5L4 7.5L8 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span className="multiselect-option-label">
                    {option}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiSelect;

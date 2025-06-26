// Simplified MultiSelect component matching SingleSelect styling
import React, { useState, useRef, useEffect } from 'react';

function MultiSelect({ 
  options, 
  selected, 
  onChange, 
  label
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


  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', fontSize: '13px' }}>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #dadce0',
          borderRadius: '4px',
          backgroundColor: '#f8f9fa',
          color: '#3c4043',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
          height: '32px'
        }}
      >
        <span style={{ color: localSelected.length === 0 ? '#9aa0a6' : '#3c4043' }}>
          {localSelected.length === 0 
            ? label || 'Select options' 
            : localSelected.length === 1 
              ? localSelected[0] 
              : `${localSelected.length} selected`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {localSelected.length > 0 && (
            <span
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLocalSelected([]);
                if (onChange) {
                  onChange([]);
                }
              }}
              style={{
                cursor: 'pointer',
                color: '#5f6368',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                padding: '2px'
              }}
              title="Clear all selections"
            >
              ×
            </span>
          )}
          <span style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            color: '#5f6368'
          }}>
            ▼
          </span>
        </div>
      </button>
      
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: '1px solid #dadce0',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            marginTop: '2px'
          }}
        >
          {options.length === 0 ? (
            <div style={{ 
              padding: '12px', 
              textAlign: 'center', 
              color: '#666',
              fontSize: '12px'
            }}>
              No options available
            </div>
          ) : (
            options.map((option) => (
              <div
                key={option}
                onClick={(e) => toggleOption(option, e)}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: localSelected.includes(option) ? '#e8f0fe' : 'white',
                  color: '#374151',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: '13px',
                  transition: 'background-color 0.1s',
                  display: 'flex',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  if (!localSelected.includes(option)) {
                    e.target.style.backgroundColor = '#f5f5f5';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!localSelected.includes(option)) {
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={localSelected.includes(option)}
                  onChange={() => {}} // Controlled by parent click
                  style={{ marginRight: '8px', pointerEvents: 'none' }}
                />
                <span style={{ flex: 1, userSelect: 'none' }}>
                  {option}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default MultiSelect;
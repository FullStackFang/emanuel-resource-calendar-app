import React, { useState, useRef, useEffect } from 'react';

const SimpleMultiSelect = ({ 
  options = [], 
  selected = [], 
  onChange, 
  label = "Select options",
  maxHeight = 200 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // DEBUG: Log all interactions
  useEffect(() => {
    console.log('SimpleMultiSelect render:', {
      options: options.length,
      selected: selected.length,
      label,
      hasOnChange: typeof onChange === 'function'
    });
  }, [options, selected, label, onChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      console.log('Click outside detected');
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        console.log('Closing dropdown from outside click');
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        console.log('Removing outside click listener');
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleToggleDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Toggle dropdown clicked, current state:', isOpen);
    setIsOpen(!isOpen);
  };

  const handleToggleOption = (option) => {
    console.log('Option clicked:', option);
    console.log('Current selected:', selected);
    console.log('onChange function:', typeof onChange);
    
    if (typeof onChange !== 'function') {
      console.error('onChange is not a function!');
      return;
    }

    const newSelected = selected.includes(option)
      ? selected.filter(item => item !== option)
      : [...selected, option];
    
    console.log('New selected will be:', newSelected);
    onChange(newSelected);
  };

  const handleSelectAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Select All clicked');
    if (typeof onChange === 'function') {
      onChange(options);
    }
  };

  const handleSelectNone = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Select None clicked');
    if (typeof onChange === 'function') {
      onChange([]);
    }
  };

  const handleOptionClick = (e, option) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Option div clicked:', option);
    handleToggleOption(option);
  };

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'relative', 
        width: '100%',
        fontSize: '13px'
      }}
      onClick={(e) => {
        console.log('Container clicked');
        e.stopPropagation();
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleToggleDropdown}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: 'white',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px'
        }}
      >
        <span>
          {selected.length === 0 
            ? `Select ${label.toLowerCase()}` 
            : `${selected.length} selected`
          }
        </span>
        <span style={{ 
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s'
        }}>
          ▼
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            maxHeight: `${maxHeight}px`,
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            marginTop: '2px'
          }}
          onClick={(e) => {
            console.log('Dropdown container clicked');
            e.stopPropagation();
          }}
        >
          {/* Select All/None Controls */}
          {options.length > 0 && (
            <div style={{
              borderBottom: '1px solid #eee',
              padding: '8px',
              display: 'flex',
              gap: '8px'
            }}>
              <button
                type="button"
                onClick={handleSelectAll}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  border: '1px solid #ddd',
                  borderRadius: '3px',
                  backgroundColor: '#f8f9fa',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                All
              </button>
              <button
                type="button"
                onClick={handleSelectNone}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  border: '1px solid #ddd',
                  borderRadius: '3px',
                  backgroundColor: '#f8f9fa',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                None
              </button>
            </div>
          )}

          {/* Options */}
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
                onClick={(e) => handleOptionClick(e, option)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: selected.includes(option) ? '#e3f2fd' : 'white',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  transition: 'background-color 0.1s'
                }}
                onMouseEnter={(e) => {
                  if (!selected.includes(option)) {
                    e.target.style.backgroundColor = '#f5f5f5';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!selected.includes(option)) {
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => {}} // Handled by parent click
                  style={{ margin: 0, pointerEvents: 'none' }} // Prevent checkbox from interfering
                />
                <span>{option}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleMultiSelect;
import React, { useState, useRef, useEffect } from 'react';

const SingleSelect = ({ 
  options = [], 
  selected = '', 
  onChange, 
  placeholder = "Select option" 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleToggleDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleOptionClick = (option) => {
    if (typeof onChange === 'function') {
      onChange(option);
    }
    setIsOpen(false);
  };

  const handleClearSelection = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onChange === 'function') {
      onChange('');
    }
  };

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'relative', 
        width: '100%',
        fontSize: '13px'
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleToggleDropdown}
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
        <span style={{ color: selected ? '#3c4043' : '#9aa0a6' }}>
          {selected || placeholder}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {selected && (
            <span
              onClick={handleClearSelection}
              style={{
                cursor: 'pointer',
                color: '#5f6368',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                padding: '2px'
              }}
              title="Clear selection"
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

      {/* Dropdown */}
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
                onClick={() => handleOptionClick(option)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: selected === option ? '#e8f0fe' : 'white',
                  color: '#374151',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: '13px',
                  transition: 'background-color 0.1s'
                }}
                onMouseEnter={(e) => {
                  if (selected !== option) {
                    e.target.style.backgroundColor = '#f5f5f5';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selected !== option) {
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                {option}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default SingleSelect;
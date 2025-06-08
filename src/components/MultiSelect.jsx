// Fixed MultiSelect component with proper portal event handling
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

function MultiSelect({ 
  options, 
  selected, 
  onChange, 
  label,
  dropdownDirection = 'down',
  maxHeight = 300,
  showTabs = false,
  allLabel = 'All',
  frequentLabel = 'Frequently Used',
  usePortal = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected);
  const [activeTab, setActiveTab] = useState('all');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef(null);
  const optionsRef = useRef(null);
  const triggerRef = useRef(null);
  const portalDropdownRef = useRef(null); // NEW: Separate ref for portal dropdown
  
  const prevSelectedRef = useRef(selected);

  const frequentlyUsed = [
    'Streicker Cultural Center',
    'Streicker Outreach Center',
    'Teens',
    'Worship',
    'Young Families of Emanu-El',
    'Religious School',
    'Shabbat Worship Service'
  ];

  // Calculate dropdown position for portal rendering
  useEffect(() => {
    if (isOpen && usePortal && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      //const scrollX = window.scrollX || document.documentElement.scrollLeft;
      
      setDropdownPosition({
        top: dropdownDirection === 'up' 
          ? rect.top + scrollY - 5// Position just above the button (let CSS handle the rest)
          : rect.bottom + scrollY,
        left: rect.left,
        width: rect.width
      });
    }
  }, [isOpen, usePortal, dropdownDirection]);

  // Only update localSelected when props.selected actually changes
  useEffect(() => {
    const selectedChanged = 
      JSON.stringify(prevSelectedRef.current) !== JSON.stringify(selected);
    
    if (selectedChanged) {
      setLocalSelected(selected);
      prevSelectedRef.current = selected;
    }
  }, [selected]);

  // FIXED: Updated click outside handler to work with portal
  useEffect(() => {
    function handleClickOutside(event) {
      const triggerElement = triggerRef.current;
      const dropdownElement = usePortal ? portalDropdownRef.current : optionsRef.current;
      
      // Check if click is outside both trigger and dropdown
      const clickedOutside = triggerElement && !triggerElement.contains(event.target) &&
                            dropdownElement && !dropdownElement.contains(event.target);
      
      if (isOpen && clickedOutside) {
        setIsOpen(false);
        if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
          onChange(localSelected);
        }
      }
    }
    
    if (isOpen) {
      // Add slight delay to prevent immediate closure
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, localSelected, onChange, selected, usePortal]);

  // FIXED: Prevent event bubbling for option interactions
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

  // FIXED: Tab switching with proper event handling
  const handleTabSwitch = (tab, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setActiveTab(tab);
  };

  const displayOptions = showTabs && activeTab === 'frequent' 
    ? options.filter(opt => frequentlyUsed.includes(opt))
    : options;

  // Dropdown content component with fixed event handling
  const DropdownContent = () => (
    <div 
      className={`multi-select-options ${dropdownDirection === 'up' ? 'dropdown-up' : ''}`}
      ref={usePortal ? portalDropdownRef : optionsRef}
      onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent event bubbling
      onClick={(e) => e.stopPropagation()} // FIXED: Prevent event bubbling
      style={{
        maxHeight: `${maxHeight}px`,
        overflowY: 'auto',
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        ...(usePortal ? {
          position: 'fixed',
          top: `${dropdownPosition.top}px`,
          left: `${dropdownPosition.left}px`,
          width: `${dropdownPosition.width}px`,
          zIndex: 9999,
          // Use transform to position relative to the calculated point
          transform: dropdownDirection === 'up' ? 'translateY(-100%)' : 'translateY(0)'
        } : {
          position: 'absolute',
          width: '100%',
          zIndex: 1000,
          ...(dropdownDirection === 'up' ? {
            bottom: '100%',
            top: 'auto',
            marginBottom: '5px'
          } : {
            top: '100%',
            marginTop: '5px'
          })
        })
      }}
    >
      {showTabs && (
        <div className="multi-select-tabs" style={{
          display: 'flex',
          borderBottom: '1px solid #eee',
          backgroundColor: '#f5f5f5',
          position: 'sticky',
          top: 0,
          zIndex: 1
        }}>
          <button
            type="button"
            className={activeTab === 'all' ? 'active' : ''}
            onClick={(e) => handleTabSwitch('all', e)}
            onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              backgroundColor: activeTab === 'all' ? 'white' : 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === 'all' ? 'bold' : 'normal',
              borderBottom: activeTab === 'all' ? '2px solid #0066cc' : 'none'
            }}
          >
            {allLabel}
          </button>
          <button
            type="button"
            className={activeTab === 'frequent' ? 'active' : ''}
            onClick={(e) => handleTabSwitch('frequent', e)}
            onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              backgroundColor: activeTab === 'frequent' ? 'white' : 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === 'frequent' ? 'bold' : 'normal',
              borderBottom: activeTab === 'frequent' ? '2px solid #0066cc' : 'none'
            }}
          >
            {frequentLabel}
          </button>
        </div>
      )}
      
      <div style={{ padding: showTabs ? '5px 0' : '0' }}>
        {displayOptions.map(option => (
          <div
            key={option}
            className={`multi-select-option ${localSelected.includes(option) ? 'selected' : ''}`}
            onClick={(e) => toggleOption(option, e)}
            onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              backgroundColor: localSelected.includes(option) ? '#f0f0f0' : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!localSelected.includes(option)) {
                e.target.style.backgroundColor = '#f5f5f5';
              }
            }}
            onMouseLeave={(e) => {
              if (!localSelected.includes(option)) {
                e.target.style.backgroundColor = 'transparent';
              }
            }}
          >
            <input
              type="checkbox"
              checked={localSelected.includes(option)}
              onChange={(e) => toggleOption(option, e)}
              onClick={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
              onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
              style={{ marginRight: '8px', pointerEvents: 'none' }} // FIXED: Disable direct interaction
            />
            <label 
              onClick={(e) => toggleOption(option, e)}
              onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
              style={{ cursor: 'pointer', flex: 1, userSelect: 'none' }} // FIXED: Prevent text selection
            >
              {option}
            </label>
          </div>
        ))}
        
        {showTabs && activeTab === 'frequent' && displayOptions.length === 0 && (
          <div style={{ padding: '12px', textAlign: 'center', color: '#666' }}>
            No frequently used items
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="multi-select-container" ref={dropdownRef} style={{ position: 'relative' }}>
      <label>{label}</label>
      <div 
        ref={triggerRef}
        className={`multi-select-header ${isOpen ? 'active' : ''}`}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.stopPropagation()} // FIXED: Prevent bubbling
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
        usePortal 
          ? createPortal(<DropdownContent />, document.body)
          : <DropdownContent />
      )}
    </div>
  );
}

export default MultiSelect;
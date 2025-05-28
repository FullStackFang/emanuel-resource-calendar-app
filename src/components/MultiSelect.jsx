import React, { useState, useRef, useEffect } from 'react';

function MultiSelect({ 
  options, 
  selected, 
  onChange, 
  label,
  dropdownDirection = 'down',
  maxHeight = 300,
  showTabs = false,
  allLabel = 'All',
  frequentLabel = 'Frequently Used'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected);
  const [activeTab, setActiveTab] = useState('all');
  const dropdownRef = useRef(null);
  const optionsRef = useRef(null);
  
  // Track previous selected value to avoid unnecessary updates
  const prevSelectedRef = useRef(selected);

  // Define frequently used categories (you can customize this list)
  const frequentlyUsed = [
    'Streicker Cultural Center',
    'Streicker Outreach Center',
    'Teens',
    'Worship',
    'Young Families of Emanu-El',
    'Religious School',
    'Shabbat Worship Service'
  ];

  // Only update localSelected when props.selected actually changes
  useEffect(() => {
    // Deep comparison for arrays
    const selectedChanged = 
      JSON.stringify(prevSelectedRef.current) !== JSON.stringify(selected);
    
    if (selectedChanged) {
      setLocalSelected(selected);
      prevSelectedRef.current = selected;
    }
  }, [selected]);

  // Adjust dropdown position when it opens
  useEffect(() => {
    if (isOpen && optionsRef.current && dropdownDirection === 'up') {
      const optionsHeight = optionsRef.current.offsetHeight;
      optionsRef.current.style.bottom = '100%';
      optionsRef.current.style.top = 'auto';
      optionsRef.current.style.marginBottom = '5px';
      optionsRef.current.style.marginTop = '0';
    }
  }, [isOpen, dropdownDirection]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (isOpen) {
          setIsOpen(false);
          // Only call onChange if values actually changed
          if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
            onChange(localSelected);
          }
        }
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, localSelected, onChange, selected]);

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
      if (JSON.stringify(localSelected) !== JSON.stringify(selected)) {
        onChange(localSelected);
      }
    }
    setIsOpen(!isOpen);
  };

  // Get the options to display based on active tab
  const displayOptions = showTabs && activeTab === 'frequent' 
    ? options.filter(opt => frequentlyUsed.includes(opt))
    : options;

  return (
    <div className="multi-select-container" ref={dropdownRef} style={{ position: 'relative' }}>
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
        <div 
          className={`multi-select-options ${dropdownDirection === 'up' ? 'dropdown-up' : ''}`}
          ref={optionsRef}
          style={{
            maxHeight: `${maxHeight}px`,
            overflowY: 'auto',
            position: 'absolute',
            width: '100%',
            zIndex: 1000,
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            ...(dropdownDirection === 'up' ? {
              bottom: '100%',
              top: 'auto',
              marginBottom: '5px'
            } : {
              top: '100%',
              marginTop: '5px'
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
                onClick={() => setActiveTab('all')}
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
                onClick={() => setActiveTab('frequent')}
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
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: localSelected.includes(option) ? '#f0f0f0' : 'transparent',
                  ':hover': {
                    backgroundColor: '#f5f5f5'
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={localSelected.includes(option)}
                  onChange={(e) => toggleOption(option, e)}
                  id={`option-${option}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginRight: '8px' }}
                />
                <label 
                  htmlFor={`option-${option}`}
                  onClick={(e) => toggleOption(option, e)}
                  style={{ cursor: 'pointer', flex: 1 }}
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
      )}
    </div>
  );
}

export default MultiSelect;
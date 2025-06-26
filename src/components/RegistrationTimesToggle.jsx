// src/components/RegistrationTimesToggle.jsx
import React from 'react';

function RegistrationTimesToggle({ showRegistrationTimes, onToggle }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: '#f8f9fa',
      borderRadius: '6px',
      border: '1px solid #e5e7eb',
      fontSize: '13px',
      fontWeight: '500'
    }}>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        margin: 0,
        color: showRegistrationTimes ? '#3b82f6' : '#6b7280'
      }}>
        <input
          type="checkbox"
          checked={showRegistrationTimes}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ 
            margin: 0,
            accentColor: '#3b82f6'
          }}
        />
        <span style={{ fontSize: '14px' }}>⏱️</span>
        Setup/Teardown
      </label>
    </div>
  );
}

export default RegistrationTimesToggle;
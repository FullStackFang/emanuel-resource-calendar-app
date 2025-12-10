// src/components/OffsiteLocationModal.jsx
import React, { useState, useEffect } from 'react';
import './RecurrencePatternModal.css'; // Reuse same modal styling

/**
 * OffsiteLocationModal - Modal for entering offsite location details
 */
export default function OffsiteLocationModal({
  isOpen,
  onClose,
  onSave,
  initialName = '',
  initialAddress = ''
}) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);

  // Initialize values when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setAddress(initialAddress);
    }
  }, [isOpen, initialName, initialAddress]);

  const handleSave = () => {
    if (!name.trim() || !address.trim()) {
      alert('Both Offsite Location Name and Address are required');
      return;
    }
    onSave(name.trim(), address.trim());
    onClose();
  };

  const handleRemove = () => {
    onSave('', '');
    onClose();
  };

  const handleDiscard = () => {
    setName(initialName);
    setAddress(initialAddress);
    onClose();
  };

  if (!isOpen) return null;

  const hasExistingData = initialName || initialAddress;

  return (
    <div className="recurrence-modal-overlay" onClick={handleDiscard}>
      <div
        className="recurrence-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '500px' }}
      >
        <div className="recurrence-modal-header">
          <h2>Offsite Location</h2>
          <button
            type="button"
            className="recurrence-close-btn"
            onClick={handleDiscard}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="recurrence-modal-body">
          <div style={{ padding: '8px 0' }}>
            {/* Location Name Input */}
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="offsite-name"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151'
                }}
              >
                Location Name *
              </label>
              <input
                id="offsite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Lincoln Center, Central Park"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  outline: 'none'
                }}
                autoFocus
              />
            </div>

            {/* Address Input */}
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="offsite-address"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151'
                }}
              >
                Address *
              </label>
              <input
                id="offsite-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g., 10 Lincoln Center Plaza, New York, NY 10023"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            {/* Preview */}
            {name.trim() && address.trim() && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#fff8f5',
                  borderRadius: '8px',
                  border: '1px solid #FF7043',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <span style={{ fontSize: '24px' }}>📍</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    {address}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="recurrence-modal-footer">
          <button
            type="button"
            className="recurrence-btn recurrence-btn-save"
            onClick={handleSave}
          >
            Save
          </button>
          <button
            type="button"
            className="recurrence-btn recurrence-btn-discard"
            onClick={handleDiscard}
          >
            Cancel
          </button>
          <button
            type="button"
            className="recurrence-btn recurrence-btn-remove"
            onClick={handleRemove}
            disabled={!hasExistingData}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

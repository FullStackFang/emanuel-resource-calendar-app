// src/components/VirtualMeetingModal.jsx
import React, { useState, useEffect } from 'react';
import './RecurrencePatternModal.css'; // Reuse same modal styling

/**
 * Detect virtual meeting platform from URL
 */
const detectPlatform = (url) => {
  if (!url) return null;
  const lower = url.toLowerCase();

  if (lower.includes('zoom.us')) return { name: 'Zoom', icon: '📹', color: '#2D8CFF' };
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com'))
    return { name: 'Microsoft Teams', icon: '💼', color: '#6264A7' };
  if (lower.includes('meet.google.com'))
    return { name: 'Google Meet', icon: '🎥', color: '#00897B' };
  if (lower.includes('webex.com'))
    return { name: 'Webex', icon: '🌐', color: '#07C160' };

  return { name: 'Virtual Meeting', icon: '🌐', color: '#1a73e8' };
};

/**
 * VirtualMeetingModal - Simple modal for entering virtual meeting URLs
 */
export default function VirtualMeetingModal({
  isOpen,
  onClose,
  onSave,
  initialUrl = ''
}) {
  const [url, setUrl] = useState(initialUrl);
  const [platform, setPlatform] = useState(null);

  // Update platform when URL changes
  useEffect(() => {
    setPlatform(detectPlatform(url));
  }, [url]);

  // Initialize URL when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl);
    }
  }, [isOpen, initialUrl]);

  const handleSave = () => {
    onSave(url.trim());
    onClose();
  };

  const handleRemove = () => {
    onSave('');
    onClose();
  };

  const handleDiscard = () => {
    setUrl(initialUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="recurrence-modal-overlay" onClick={handleDiscard}>
      <div
        className="recurrence-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '500px' }}
      >
        <div className="recurrence-modal-header">
          <h2>Virtual Meeting</h2>
          <button
            type="button"
            className="recurrence-close-btn"
            onClick={handleDiscard}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="recurrence-modal-body">
          <div style={{ padding: '8px 0' }}>
            {/* URL Input */}
            <div style={{ marginBottom: '20px' }}>
              <label
                htmlFor="virtual-url"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151'
                }}
              >
                Meeting URL
              </label>
              <input
                id="virtual-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://zoom.us/j/123456789 or teams link..."
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

            {/* Platform Preview */}
            {platform && url.trim() && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <span style={{ fontSize: '24px' }}>{platform.icon}</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                    {platform.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    Meeting link detected
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
            disabled={!initialUrl}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

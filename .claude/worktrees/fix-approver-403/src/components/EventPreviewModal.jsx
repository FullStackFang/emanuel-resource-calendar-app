// src/components/EventPreviewModal.jsx
import React, { useState } from 'react';
import Modal from './Modal';

const EventPreviewModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  eventData, 
  registrationEventData = null 
}) => {
  const [showDebug, setShowDebug] = useState(false);
  if (!isOpen || !eventData) {
    return null;
  }

  const formatTime = (dateTimeString) => {
    if (!dateTimeString) return 'N/A';
    return new Date(dateTimeString).toLocaleString();
  };

  const formatDuration = (minutes) => {
    if (!minutes || minutes === 0) return 'None';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const mainEventStart = new Date(eventData.start?.dateTime);
  const mainEventEnd = new Date(eventData.end?.dateTime);
  const duration = Math.round((mainEventEnd - mainEventStart) / (1000 * 60));

  // Calculate registration event times if setup/teardown are specified
  let registrationStart = null;
  let registrationEnd = null;
  let registrationDuration = null;

  if (eventData.setupMinutes > 0 || eventData.teardownMinutes > 0) {
    registrationStart = new Date(mainEventStart.getTime() - (eventData.setupMinutes || 0) * 60 * 1000);
    registrationEnd = new Date(mainEventEnd.getTime() + (eventData.teardownMinutes || 0) * 60 * 1000);
    registrationDuration = Math.round((registrationEnd - registrationStart) / (1000 * 60));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} hideTitle={true}>
      <div style={{ 
        textAlign: 'center',
        padding: '20px 0'
      }}>
        <h2 style={{ 
          fontSize: '24px',
          fontWeight: '600',
          color: '#111827',
          marginBottom: '24px'
        }}>
          Preview Event Data
        </h2>
        
        <div style={{ 
          textAlign: 'left',
          backgroundColor: '#f8f9fa', 
          padding: '12px', 
          borderRadius: '6px', 
          marginBottom: '12px' 
        }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#0078d4', fontSize: '16px' }}>Main Event</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', fontSize: '14px' }}>
            <strong>Subject:</strong>
            <span>{eventData.subject || 'Untitled Event'}</span>
            
            <strong>Start Time:</strong>
            <span>{formatTime(eventData.start?.dateTime)}</span>
            
            <strong>End Time:</strong>
            <span>{formatTime(eventData.end?.dateTime)}</span>
            
            <strong>Duration:</strong>
            <span>{formatDuration(duration)}</span>
            
            <strong>Location:</strong>
            <span>{eventData.location?.displayName || 'Unspecified'}</span>
            
            <strong>Categories:</strong>
            <span>{Array.isArray(eventData.categories) ? eventData.categories.join(', ') : 'None'}</span>
            
            <strong>All Day:</strong>
            <span>{eventData.isAllDay ? 'Yes' : 'No'}</span>
          </div>
          
          {eventData.body?.content && (
            <div style={{ marginTop: '6px' }}>
              <strong>Notes:</strong>
              <div style={{ marginTop: '2px', padding: '6px', backgroundColor: 'white', borderRadius: '4px', fontSize: '13px' }}>
                {eventData.body.content}
              </div>
            </div>
          )}
        </div>

        {/* Setup/Teardown Information */}
        {(eventData.setupMinutes > 0 || eventData.teardownMinutes > 0) && (
          <div style={{ 
            textAlign: 'left',
            backgroundColor: '#fff4e6', 
            padding: '12px', 
            borderRadius: '6px', 
            marginBottom: '12px' 
          }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#d83b01', fontSize: '16px' }}>Setup & Teardown</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', fontSize: '14px' }}>
                <strong>Setup Time:</strong>
                <span>{formatDuration(eventData.setupMinutes)} before event</span>
                
                <strong>Teardown Time:</strong>
                <span>{formatDuration(eventData.teardownMinutes)} after event</span>
                
                <strong>Total Time:</strong>
                <span>{formatDuration((eventData.setupMinutes || 0) + duration + (eventData.teardownMinutes || 0))}</span>
                
                {eventData.assignedTo && (
                  <>
                    <strong>Assigned To:</strong>
                    <span>{eventData.assignedTo}</span>
                  </>
                )}
                
                {eventData.registrationNotes && (
                  <>
                    <strong>Registration Notes:</strong>
                    <span>{eventData.registrationNotes}</span>
                  </>
                )}
              </div>
          </div>
        )}

        {/* Debug Information */}
        <div style={{ marginBottom: '12px' }}>
          <button
            onClick={() => setShowDebug(!showDebug)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#6b7280',
              marginBottom: '8px',
              transition: 'all 0.2s'
            }}
          >
            <span style={{ 
              transform: showDebug ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              fontSize: '12px'
            }}>▶</span>
            Debug Information (Raw Data)
          </button>
          
          {showDebug && (
            <div style={{ marginTop: '8px' }}>
              {/* Registration Event Preview */}
              {eventData.createRegistrationEvent && registrationStart && (
                <div style={{ 
                  textAlign: 'left',
                  backgroundColor: '#f3f9f1', 
                  padding: '10px', 
                  borderRadius: '6px', 
                  marginBottom: '10px' 
                }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#107c10', fontSize: '14px' }}>Registration Event (Will Be Created)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px', fontSize: '13px' }}>
                    <strong>Subject:</strong>
                    <span>[SETUP/TEARDOWN] {eventData.subject}</span>
                    
                    <strong>Start Time:</strong>
                    <span>{formatTime(registrationStart.toISOString())}</span>
                    
                    <strong>End Time:</strong>
                    <span>{formatTime(registrationEnd.toISOString())}</span>
                    
                    <strong>Duration:</strong>
                    <span>{formatDuration(registrationDuration)}</span>
                    
                    <strong>Calendar:</strong>
                    <span>TempleRegistrations</span>
                    
                    <strong>Category:</strong>
                    <span>Security/Maintenance</span>
                  </div>
                </div>
              )}
              
              <h4 style={{ margin: '0 0 6px 0', color: '#6b7280', fontSize: '14px' }}>Raw Event Data</h4>
              <pre style={{ 
                backgroundColor: '#f1f1f1', 
                padding: '8px', 
                borderRadius: '6px', 
                fontSize: '11px', 
                overflow: 'auto',
                maxHeight: '200px',
                margin: '0'
              }}>
                {JSON.stringify(eventData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Warning for unusual values */}
        {(eventData.setupMinutes > 240 || eventData.teardownMinutes > 240) && (
          <div style={{ 
            backgroundColor: '#ffebee', 
            border: '1px solid #f44336', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '10px' 
          }}>
            <strong style={{ color: '#d32f2f' }}>⚠️ Warning:</strong>
            <span style={{ marginLeft: '8px', fontSize: '13px' }}>
              Setup or teardown time seems unusually long (over 4 hours). Please verify these values are correct.
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'center',
          marginTop: '16px' 
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: '#6b7280',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#f9fafb';
              e.target.style.color = '#111827';
              e.target.style.borderColor = '#d1d5db';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'white';
              e.target.style.color = '#6b7280';
              e.target.style.borderColor = '#e5e7eb';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.15s ease',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#2563eb';
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#3b82f6';
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
            }}
          >
            Confirm & Save Event
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default EventPreviewModal;
// src/components/EventPreviewModal.jsx
import React from 'react';
import Modal from './Modal';

const EventPreviewModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  eventData, 
  registrationEventData = null 
}) => {
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
    <Modal isOpen={isOpen} onClose={onClose} title="Preview Event Data">
      <div style={{ maxWidth: '600px', lineHeight: '1.5' }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#0078d4' }}>Main Event</h3>
        
        <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
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
            <div style={{ marginTop: '10px' }}>
              <strong>Notes:</strong>
              <div style={{ marginTop: '4px', padding: '8px', backgroundColor: 'white', borderRadius: '4px', fontSize: '13px' }}>
                {eventData.body.content}
              </div>
            </div>
          )}
        </div>

        {/* Setup/Teardown Information */}
        {(eventData.setupMinutes > 0 || eventData.teardownMinutes > 0) && (
          <>
            <h3 style={{ margin: '0 0 15px 0', color: '#d83b01' }}>Setup & Teardown</h3>
            
            <div style={{ backgroundColor: '#fff4e6', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
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
          </>
        )}

        {/* Registration Event Preview */}
        {eventData.createRegistrationEvent && registrationStart && (
          <>
            <h3 style={{ margin: '0 0 15px 0', color: '#107c10' }}>Registration Event (Will Be Created)</h3>
            
            <div style={{ backgroundColor: '#f3f9f1', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', fontSize: '14px' }}>
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
          </>
        )}

        {/* Debug Information */}
        <details style={{ marginBottom: '20px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>
            🔧 Debug Information (Raw Data)
          </summary>
          <pre style={{ 
            backgroundColor: '#f1f1f1', 
            padding: '10px', 
            borderRadius: '4px', 
            fontSize: '11px', 
            overflow: 'auto',
            maxHeight: '300px'
          }}>
            {JSON.stringify(eventData, null, 2)}
          </pre>
        </details>

        {/* Warning for unusual values */}
        {(eventData.setupMinutes > 240 || eventData.teardownMinutes > 240) && (
          <div style={{ 
            backgroundColor: '#ffebee', 
            border: '1px solid #f44336', 
            padding: '10px', 
            borderRadius: '4px', 
            marginBottom: '15px' 
          }}>
            <strong style={{ color: '#d32f2f' }}>⚠️ Warning:</strong>
            <span style={{ marginLeft: '8px', fontSize: '14px' }}>
              Setup or teardown time seems unusually long (over 4 hours). Please verify these values are correct.
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              backgroundColor: '#0078d4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
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
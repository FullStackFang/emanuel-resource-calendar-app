// src/components/EventForm.jsx
import React, { useState, useEffect, useRef } from 'react';
import MultiSelect from './MultiSelect';
import './EventForm.css';

// ===== ADD THESE FUNCTIONS AT THE TOP OF EventForm.jsx (outside the component) =====

/**
 * Convert UTC time to display time based on user's timezone
 * @param {string} utcDateString - ISO date string in UTC
 * @param {string} userTz - User's preferred timezone
 * @returns {object} Object with date and time strings formatted for form inputs
 */
const utcToDisplayTime = (utcDateString, userTz) => {
  if (!utcDateString) return { date: '', time: '' };
  
  // Ensure UTC indicator
  const utcString = utcDateString.endsWith('Z') ? utcDateString : `${utcDateString}Z`;
  const date = new Date(utcString);
  
  // Format date in YYYY-MM-DD format
  const dateStr = date.toLocaleDateString('en-CA', { // en-CA gives YYYY-MM-DD format
    timeZone: userTz
  });
  
  // Format time in 24-hour format for input fields
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: userTz
  });
  
  return { date: dateStr, time: timeStr };
};

/**
 * Convert display time back to UTC for API
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {string} ISO date string in UTC
 */
const displayToUtcTime = (dateStr, timeStr) => {
  if (!dateStr) return '';
  
  // Create a date in the user's local timezone
  const localDate = new Date(`${dateStr}T${timeStr || '00:00'}`);
  
  // Convert to UTC ISO string
  return localDate.toISOString();
};

/**
 * Parse location string to array and filter to only include values from availableLocations
 * @param {string|object} location - Location data from event
 * @param {array} availableOptions - Available location options from MultiSelect
 * @returns {array} Array of valid location strings
 */
const parseLocationsFromEvent = (location, availableOptions) => {
  if (!location) return [];
  
  // The delimiter used for locations (make sure this is consistent)
  const LOCATION_DELIMITER = '; ';
  
  // Parse the locations from the event
  let parsedLocations = [];
  if (typeof location === 'object' && location.displayName) {
    parsedLocations = location.displayName.split(LOCATION_DELIMITER).map(loc => loc.trim());
  } else if (typeof location === 'string') {
    parsedLocations = location.split(LOCATION_DELIMITER).map(loc => loc.trim());
  }
  
  // Filter to only include values that exist in availableOptions
  return parsedLocations.filter(loc => availableOptions.includes(loc));
};

// Add a helper function to format time in the user's timezone

function EventForm({ 
  event, 
  categories, 
  availableLocations = [], 
  schemaExtensions = [], 
  onSave, 
  onCancel, 
  readOnly = false,
  userTimeZone = 'America/New_York' // Default fallback
}) {
  // Add this time zone mapping
  const timeZoneOptions = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
  ];

  // Helper function to get the label for the current time zone
  const getTimeZoneLabel = (tzValue) => {
    const option = timeZoneOptions.find(opt => opt.value === tzValue);
    return option ? option.label : tzValue;
  };

  // Track the previous event to avoid unnecessary updates
  const prevEventRef = useRef(null);
  
  const [formData, setFormData] = useState({
    id: '',
    subject: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    locations: [], 
    category: categories[0] || ''
  });
  
  const [isAllDay, setIsAllDay] = useState(false);
  
  // Add state for MEC Categories
  const [selectedMecCategories, setSelectedMecCategories] = useState([]);
  
  // Add state for registration event creation
  const [createRegistrationEvent, setCreateRegistrationEvent] = useState(true); // Default to ON
  const [setupMinutes, setSetupMinutes] = useState(30); // Default to 30 minutes
  const [teardownMinutes, setTeardownMinutes] = useState(15); // Default to 15 minutes
  const [registrationNotes, setRegistrationNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const availableMecCategories = [
    'Community',
    'Membership',
    'Bernard Museum of Judaica',
    'Club One East',
    'Community As Family',
    'Daily Worship Service',
    'Downtown Class',
    'Emanu-El Cares',
    'Emanu-El Downtown',
    'Families with Young Children',
    'Holiday',
    'Interfaith Dialogue',
    'Israel',
    'Learning',
    'Men\'s Club',
    'Nursery School',
    'Religious School',
    'Shabbat Worship Service',
    'Skirball Academy',
    'Stettenheim Library',
    'Streicker Cultural Center',
    'Streicker Outreach Center',
    'Teens',
    'Tikkun Olam',
    'Women of Emanu-El',
    'Worship',
    'Young Families of Emanu-El',
    'Young Families Uptown',
    'Young Members',
    'Young Professionals'
  ];
    
  // Initialize form with event data - only run when event changes
  useEffect(() => {
    // Check if event has actually changed (by ID)
    if (event && prevEventRef.current && event.id === prevEventRef.current.id) {
      return;
    }
    
    // Update the previous event ref
    prevEventRef.current = event;
    
    if (event) {
      console.log("OPENING EVENT FORM:");
      console.log(`  Raw start: ${event.start?.dateTime}`);
      console.log(`  Raw end: ${event.end?.dateTime}`);
      
      // Set event ID and subject
      const newFormData = {
        id: event.id || '',
        subject: event.subject || '',
        locations: parseLocationsFromEvent(event.location, availableLocations),
        category: event.category || categories[0] || ''
      };
      
      if (event.start?.dateTime) {
        const startDisplay = utcToDisplayTime(event.start.dateTime, userTimeZone);
        newFormData.startDate = startDisplay.date;
        newFormData.startTime = startDisplay.time;
      }

      if (event.end?.dateTime) {
        const endDisplay = utcToDisplayTime(event.end.dateTime, userTimeZone);
        newFormData.endDate = endDisplay.date;
        newFormData.endTime = endDisplay.time;
      }

      // Check if this is an all-day event
      const isAllDayEvent = event.isAllDay || (
        event.start?.dateTime && event.end?.dateTime &&
        event.start.dateTime.includes('T00:00:00') && 
        event.end.dateTime.includes('T00:00:00')
      );

      setIsAllDay(isAllDayEvent);
      if (isAllDayEvent) {
        newFormData.startTime = '';
        newFormData.endTime = '';
      }
      
      console.log(`  Display values: startDate=${newFormData.startDate}, startTime=${newFormData.startTime}`);
    
      // Apply the form data update
      setFormData(newFormData);
      
      // Reset MEC Categories for now (will be populated from event data later)
      setSelectedMecCategories([]);
      
      // Load registration event data if they exist
      const hasRegistrationData = (event.setupMinutes && event.setupMinutes > 0) || 
                                 (event.teardownMinutes && event.teardownMinutes > 0) ||
                                 event.registrationNotes || event.assignedTo;
      
      setCreateRegistrationEvent(hasRegistrationData || true); // Default to true even for existing events
      setSetupMinutes(event.setupMinutes || 30);
      setTeardownMinutes(event.teardownMinutes || 15);
      setRegistrationNotes(event.registrationNotes || '');
      setAssignedTo(event.assignedTo || '');
    } else {
      // Handle new event creation - initialize with defaults
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      const defaultStartTime = '09:00';
      const defaultEndTime = '10:00';
      
      setFormData({
        id: '',
        subject: '',
        startDate: today.toISOString().split('T')[0],
        startTime: defaultStartTime,
        endDate: today.toISOString().split('T')[0],
        endTime: defaultEndTime,
        locations: [],
        category: categories[0] || ''
      });
      
      setIsAllDay(false);
      setSelectedMecCategories([]);
      setCreateRegistrationEvent(true); // Default to true for new events
      setSetupMinutes(30);
      setTeardownMinutes(15);
      setRegistrationNotes('');
      setAssignedTo('');
    }
  }, [event, categories, availableLocations, userTimeZone]); 

  // Inside the EventForm component, after the previous useEffect
  useEffect(() => {
    // Skip if no event data is loaded or if this is the initial render
    if (!event?.start?.dateTime || !prevEventRef.current) return;
    
    console.log(`TIMEZONE CHANGED TO: ${userTimeZone}`);
    
    // Convert the UTC times to display times in the new timezone
    const startDisplay = utcToDisplayTime(event.start.dateTime, userTimeZone);
    const endDisplay = utcToDisplayTime(event.end.dateTime, userTimeZone);
    
    // Update just the time fields with the new timezone values
    setFormData(prev => ({
      ...prev,
      startDate: startDisplay.date,
      startTime: isAllDay ? '' : startDisplay.time,
      endDate: endDisplay.date,
      endTime: isAllDay ? '' : endDisplay.time
    }));
    
  }, [userTimeZone]); // This effect runs only when userTimeZone changes

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAllDayToggle = () => {
    // Just toggle the flag without changing time values
    setIsAllDay(!isAllDay);
  };

  const handleLocationChange = (selectedLocations) => {
    // Filter locations to ensure they only contain values from availableLocations
    const validLocations = selectedLocations.filter(loc => availableLocations.includes(loc));
    
    setFormData(prev => ({
      ...prev,
      locations: validLocations
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!formData.subject || !formData.startDate || !formData.endDate) {
      alert('Please fill out all required fields');
      return;
    }
    
    console.log("SAVING EVENT:");
    console.log(`  Form values: startDate=${formData.startDate}, startTime=${formData.startTime}`);
    
    // Convert display times to UTC for API
    const startUtc = displayToUtcTime(
      formData.startDate, 
      isAllDay ? '00:00' : formData.startTime
    );
    
    const endUtc = displayToUtcTime(
      formData.endDate, 
      isAllDay ? '00:00' : formData.endTime
    );
    
    console.log(`  Converted to UTC: start=${startUtc}, end=${endUtc}`);
    
    // For all-day events spanning a single day, end date should be next day
    let adjustedEndUtc = endUtc;
    if (isAllDay && formData.startDate === formData.endDate) {
      const endDate = new Date(endUtc);
      endDate.setDate(endDate.getDate() + 1);
      adjustedEndUtc = endDate.toISOString();
      console.log(`  Adjusted all-day end: ${adjustedEndUtc}`);
    }
    
    // Build the payload for Graph API
    const eventData = {
      id: formData.id,
      subject: formData.subject,
      start: { 
        dateTime: startUtc, 
        timeZone: 'UTC' 
      },
      end: { 
        dateTime: adjustedEndUtc, 
        timeZone: 'UTC' 
      },
      location: { 
        displayName: formData.locations.length > 0 
          ? formData.locations.join('; ') 
          : '' 
      },
      categories: [formData.category],
      isAllDay,
      setupMinutes: createRegistrationEvent ? setupMinutes : 0,
      teardownMinutes: createRegistrationEvent ? teardownMinutes : 0,
      registrationNotes: createRegistrationEvent ? registrationNotes : '',
      assignedTo: createRegistrationEvent ? assignedTo : '',
      createRegistrationEvent
    };
    
    console.log("Final event data:", eventData);
    onSave(eventData);
  };

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="subject">Subject *</label>
        <input
          type="text"
          id="subject"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          required
          disabled={readOnly}
        />
      </div>
      {/* Add this new time zone indicator with the friendly label */}
      <div className="timezone-indicator">
        Displayed In: {getTimeZoneLabel(userTimeZone)}
      </div>

      <div className="datetime-section">
        <div className="datetime-fields">
          <div className="form-group">
            <label htmlFor="startDate">Start Date *</label>
            <div className="date-time-container">
              <input
                type="date"
                id="startDate"
                name="startDate"
                value={formData.startDate}
                onChange={handleChange}
                required
                disabled={readOnly}
                className="date-input"
              />
              {!isAllDay && (
                <input
                  type="time"
                  id="startTime"
                  name="startTime"
                  value={formData.startTime}
                  onChange={handleChange}
                  required
                  disabled={readOnly}
                  className="time-input"
                />
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="endDate">End Date *</label>
            <div className="date-time-container">
              <input
                type="date"
                id="endDate"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
                required
                disabled={readOnly}
                className="date-input"
              />
              {!isAllDay && (
                <input
                  type="time"
                  id="endTime"
                  name="endTime"
                  value={formData.endTime}
                  onChange={handleChange}
                  required
                  disabled={readOnly}
                  className="time-input"
                />
              )}
            </div>
          </div>
        </div>
        
        <div className="allday-column">
          <div className="all-day-toggle">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={handleAllDayToggle}
                disabled={readOnly}
              />
              <span className="toggle-slider"></span>
            </label>
            <span className="toggle-label">All day</span>
          </div>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            name="category"
            value={formData.category}
            onChange={handleChange}
            disabled={readOnly}
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="location">Locations</label>
          {readOnly ? (
            <div className="readonly-display">
              {formData.locations && formData.locations.length > 0 
                ? formData.locations.join(', ') 
                : 'No locations selected'}
            </div>
          ) : (
            <MultiSelect
              options={availableLocations}
              selected={formData.locations || []}
              onChange={handleLocationChange}
              label="Select location(s)"
            />
          )}
        </div>
      </div>

      {/* MEC Categories Multi-Select */}
      <div className="form-group">
        <label htmlFor="mecCategories">MEC Categories</label>
        {readOnly ? (
          <div className="readonly-display">
            {selectedMecCategories && selectedMecCategories.length > 0 
              ? selectedMecCategories.join(', ') 
              : 'No MEC categories selected'}
          </div>
        ) : (
          <div className="mec-categories-wrapper">
            <MultiSelect
              options={availableMecCategories}
              selected={selectedMecCategories}
              onChange={setSelectedMecCategories}
              label="Categories"
              showTabs={true}
              allLabel="All Categories"
              frequentLabel="Most Used"
              dropdownDirection="up"
              maxHeight={200}
            />
          </div>
        )}
      </div>

      {/* Registration Event Toggle */}
      {!readOnly && (
        <div className="form-group registration-toggle-section">
          <div style={{
            padding: '8px 10px',
            background: '#f8f9fa',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
            marginBottom: '8px'
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              margin: 0,
              fontWeight: 600,
              fontSize: '13px'
            }}>
              <input
                type="checkbox"
                checked={createRegistrationEvent || false}
                onChange={(e) => setCreateRegistrationEvent(e.target.checked)}
                style={{ 
                  margin: 0,
                  accentColor: '#3b82f6'
                }}
              />
              <span style={{ fontSize: '14px' }}>🔧</span>
              Create setup/teardown registration event
            </label>
            <div style={{
              fontSize: '11px',
              color: '#6b7280',
              marginTop: '2px',
              marginLeft: '30px'
            }}>
              For security and maintenance staff preparation
            </div>
          </div>

          {/* Registration Details Section */}
          {createRegistrationEvent && (
            <div className="registration-details-section" style={{
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              padding: '10px',
              background: '#ffffff',
              marginBottom: '8px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '8px',
                borderBottom: '1px solid #f3f4f6',
                paddingBottom: '6px'
              }}>
                <span style={{ fontSize: '14px' }}>🔧</span>
                <h4 style={{ margin: 0, color: '#374151', fontSize: '13px', fontWeight: 600 }}>
                  Registration Event Details
                </h4>
              </div>

              {/* Setup/Teardown Times */}
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="setupMinutes">Setup Time (minutes before)</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="number"
                      id="setupMinutes"
                      value={setupMinutes || 0}
                      onChange={(e) => setSetupMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                      min="0"
                      max="240"
                      style={{ width: '60px', height: '28px' }}
                    />
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {[15, 30, 45, 60].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setSetupMinutes(preset)}
                          style={{
                            padding: '3px 6px',
                            fontSize: '10px',
                            border: '1px solid #ccc',
                            borderRadius: '3px',
                            background: setupMinutes === preset ? '#3b82f6' : 'white',
                            color: setupMinutes === preset ? 'white' : '#666',
                            cursor: 'pointer',
                            height: '24px'
                          }}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="teardownMinutes">Teardown Time (minutes after)</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="number"
                      id="teardownMinutes"
                      value={teardownMinutes || 0}
                      onChange={(e) => setTeardownMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                      min="0"
                      max="240"
                      style={{ width: '60px', height: '28px' }}
                    />
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {[15, 30, 45, 60].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setTeardownMinutes(preset)}
                          style={{
                            padding: '3px 6px',
                            fontSize: '10px',
                            border: '1px solid #ccc',
                            borderRadius: '3px',
                            background: teardownMinutes === preset ? '#3b82f6' : 'white',
                            color: teardownMinutes === preset ? 'white' : '#666',
                            cursor: 'pointer',
                            height: '24px'
                          }}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Additional Registration Fields */}
              <div className="form-group">
                <label htmlFor="registrationNotes">Registration Notes (optional)</label>
                <textarea
                  id="registrationNotes"
                  value={registrationNotes || ''}
                  onChange={(e) => setRegistrationNotes(e.target.value)}
                  placeholder="Additional instructions for security/maintenance staff..."
                  style={{
                    width: '100%',
                    minHeight: '40px',
                    padding: '5px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
              </div>

              <div className="form-group">
                <label htmlFor="assignedTo">Assigned To (optional)</label>
                <input
                  type="text"
                  id="assignedTo"
                  value={assignedTo || ''}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="Security Team, Maintenance, etc."
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                    height: '32px'
                  }}
                />
              </div>

              {/* Registration Preview */}
              {(setupMinutes > 0 || teardownMinutes > 0) && formData.startDate && formData.startTime && formData.endDate && formData.endTime && (
                <div style={{
                  background: '#f0f7ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '4px',
                  padding: '8px',
                  marginTop: '8px',
                  fontSize: '11px',
                  color: '#1e40af'
                }}>
                  <strong>Registration Event Preview:</strong><br />
                  {(() => {
                    // Calculate the actual start and end times
                    const eventStart = new Date(`${formData.startDate}T${formData.startTime}`);
                    const eventEnd = new Date(`${formData.endDate}T${formData.endTime}`);
                    
                    // Calculate setup start time
                    const setupStart = new Date(eventStart);
                    setupStart.setMinutes(setupStart.getMinutes() - setupMinutes);
                    
                    // Calculate teardown end time
                    const teardownEnd = new Date(eventEnd);
                    teardownEnd.setMinutes(teardownEnd.getMinutes() + teardownMinutes);
                    
                    const formatTime = (date) => {
                      return date.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                      });
                    };
                    
                    const totalMinutes = setupMinutes + teardownMinutes;
                    const hours = Math.floor(totalMinutes / 60);
                    const mins = totalMinutes % 60;
                    const totalTimeStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
                    
                    return (
                      <>
                        • Reserved time: <strong>{formatTime(setupStart)} - {formatTime(teardownEnd)}</strong><br />
                        • Setup: {setupMinutes}min before ({formatTime(setupStart)} - {formatTime(eventStart)})<br />
                        • Event: {formatTime(eventStart)} - {formatTime(eventEnd)}<br />
                        • Teardown: {teardownMinutes}min after ({formatTime(eventEnd)} - {formatTime(teardownEnd)})<br />
                        • Total extra time: {totalTimeStr}<br />
                        {assignedTo && `• Assigned to: ${assignedTo}`}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {!readOnly && (
          <button type="submit" className="save-button">
            Save
          </button>
        )}
      </div>
    </form>
  );
}

export default EventForm;
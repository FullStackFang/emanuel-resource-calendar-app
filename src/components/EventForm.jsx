// src/components/EventForm.jsx
import React, { useState, useEffect, useRef } from 'react';
import MultiSelect from './MultiSelect';
import './EventForm.css';

// Add this to EventForm.jsx
function formatTimeForInput(date, userTimeZone) {
  if (!date) return '';
  
  // Format the time in 24-hour format (HH:MM) expected by time inputs
  // This ensures the time shown in the form matches what the user expects to see
  // in their preferred timezone
  const options = { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false,
    timeZone: userTimeZone 
  };
  
  const timeString = date.toLocaleTimeString('en-US', options);
  return timeString;
}

/**
 * Format date for ISO string for consistent API usage
 * @param {Date} date - The date object
 * @returns {string} ISO formatted date string
 */
const formatDateForAPI = (localDate) => {
  if (!localDate) return null;
  
  // Create a UTC ISO string by explicitly building it
  return localDate.toISOString();
};

/**
 * Parse ISO date string to local Date object
 * @param {string} isoString - ISO date string
 * @returns {Date} Local date object
 */
const parseAPIDateToLocal = (isoString) => {
  if (!isoString) return new Date();
  
  // Ensure the string has a Z to indicate UTC
  const utcDateString = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
  
  // Create a date object - it will be in the user's local time zone
  return new Date(utcDateString);
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
const formatTimeInUserTimezone = (date) => {
  if (!date) return '';
  
  // Use the same approach as in Calendar.jsx's formatEventTime
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: userTimeZone,
  });
};

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
  
  // Format functions for separate date and time fields
  function formatDateOnly(date) {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }

  // Format time only for the time input
  function formatTimeOnly(date) {
    if (!date) return '';
    
    // Option 1: Use the 24-hour format expected by the time input
    // This converts the time to the user's timezone first
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: userTimeZone,
    });
    
    return timeStr;
  }
  
  // Initialize form with event data - only run when event changes
  useEffect(() => {
    // Check if event has actually changed (by ID)
    if (event && prevEventRef.current && event.id === prevEventRef.current.id) {
      return;
    }
    
    // Update the previous event ref
    prevEventRef.current = event;
    
    if (event) {
      // Process dates only once when the event changes
      const startDateTime = event.start?.dateTime ? parseAPIDateToLocal(event.start.dateTime) : new Date();
      const endDateTime = event.end?.dateTime ? parseAPIDateToLocal(event.end.dateTime) : new Date();
      
      // Check if this is an all-day event
      const isAllDayEvent = event.isAllDay || 
        (startDateTime.getHours() === 0 &&
         startDateTime.getMinutes() === 0 &&
         endDateTime.getHours() === 0 &&
         endDateTime.getMinutes() === 0);
      
      // Format date in YYYY-MM-DD format for the date input
      const startDate = formatDateOnly(startDateTime);
      const endDate = formatDateOnly(endDateTime);
      
      // Format time in user's timezone for the time input
      const startTime = formatTimeForInput(startDateTime, userTimeZone);
      const endTime = formatTimeForInput(endDateTime, userTimeZone);
      
      // Handle locations
      const locationValues = parseLocationsFromEvent(event.location, availableLocations);
      
      // Set form data in a single state update
      setIsAllDay(isAllDayEvent);
      setFormData({
        id: event.id || '', 
        subject: event.subject || '',
        startDate,
        startTime: isAllDayEvent ? '' : startTime,
        endDate,
        endTime: isAllDayEvent ? '' : endTime,
        locations: locationValues,
        category: event.category || categories[0] || ''
      });
    }
  }, [event, categories, availableLocations]); // Removed parsedDates and schemaExtensions

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
  
    // Combine date and time
    let startTime = formData.startTime || '00:00';
    let endTime = formData.endTime || '00:00';
    
    // If it's an all-day event, set times to 00:00 for submission
    if (isAllDay) {
      startTime = '00:00';
      endTime = '00:00';
    }
    
    const startDate = new Date(`${formData.startDate}T${startTime}`);
    const endDate = new Date(`${formData.endDate}T${endTime}`);
    
    // For all-day events spanning a single day, end date should be next day
    if (isAllDay && formData.startDate === formData.endDate) {
      endDate.setDate(endDate.getDate() + 1);
    }
    
    const formattedStartDate = formatDateForAPI(startDate);
    const formattedEndDate = formatDateForAPI(endDate);
  
    // Format the location field
    const LOCATION_DELIMITER = '; ';
    const locationDisplayName = formData.locations.length > 0 
      ? formData.locations.join(LOCATION_DELIMITER) 
      : '';
    
    // Build the payload for Graph API
    const eventData = {
      id: formData.id,
      subject: formData.subject,
      start: { 
        dateTime: formattedStartDate, 
        timeZone: isAllDay ? undefined : 'UTC' 
      },
      end: { 
        dateTime: formattedEndDate, 
        timeZone: isAllDay ? undefined : 'UTC' 
      },
      location: { displayName: locationDisplayName },
      categories: [ formData.category ],
      isAllDay: isAllDay
    };
  
    // Handle schema extensions if needed
    // (Keep your existing code for schema extensions)
  
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
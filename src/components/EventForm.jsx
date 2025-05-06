// src/components/EventForm.jsx
import React, { useState, useEffect } from 'react';
import MultiSelect from './MultiSelect';
import './EventForm.css';

/**
 * Format date for ISO string for consistent API usage
 * @param {Date} date - The date object
 * @returns {string} ISO formatted date string
 */
const formatDateForAPI = (date) => {
  if (!date) return null;
  
  // Create a new date in UTC
  const dateInUTC = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ));
  
  return dateInUTC.toISOString();
};

/**
 * Parse ISO date string to local Date object
 * @param {string} isoString - ISO date string
 * @returns {Date} Local date object
 */
const parseAPIDateToLocal = (isoString) => {
  if (!isoString) return new Date();
  
  // Create a date object from the ISO string
  // This will automatically convert from UTC to local time
  const date = new Date(isoString);
  
  console.log(`Parsed API date: ${isoString} to local date: ${date.toString()}`);
  
  return date;
};

/**
 * Format date for datetime-local input
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string for input
 */
const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  
  try {
    // First convert the API date to local time
    const localDate = parseAPIDateToLocal(dateString);
    
    // Then format to YYYY-MM-DDThh:mm for datetime-local input
    // Using padStart to ensure we have leading zeros
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const hours = String(localDate.getHours()).padStart(2, '0');
    const minutes = String(localDate.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch (err) {
    console.error('Error formatting date for input:', err);
    return '';
  }
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

function EventForm({ event, categories, availableLocations = [], schemaExtensions = [], onSave, onCancel, readOnly = false }) {
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
  const [extensionFields, setExtensionFields] = useState({});
  
  // Initialize form with event data
  useEffect(() => {
    if (event) {
      // Check if this is an all-day event
      const isAllDayEvent = event.isAllDay || 
        (event.start?.dateTime && event.end?.dateTime && 
        new Date(event.start.dateTime).getHours() === 0 &&
        new Date(event.start.dateTime).getMinutes() === 0 &&
        new Date(event.end.dateTime).getHours() === 0 &&
        new Date(event.end.dateTime).getMinutes() === 0);
      
      setIsAllDay(isAllDayEvent);
      
      // Process dates
      const startDateTime = event.start?.dateTime ? parseAPIDateToLocal(event.start.dateTime) : new Date();
      const endDateTime = event.end?.dateTime ? parseAPIDateToLocal(event.end.dateTime) : new Date();
      
      // Format date and time separately
      const startDate = formatDateOnly(startDateTime);
      const startTime = formatTimeOnly(startDateTime);
      const endDate = formatDateOnly(endDateTime);
      const endTime = formatTimeOnly(endDateTime);
      
      // Handle locations
      const locationValues = parseLocationsFromEvent(event.location, availableLocations);
      
      setFormData({
        id: event.id || '', 
        subject: event.subject || '',
        startDate,
        startTime,
        endDate,
        endTime,
        locations: locationValues,
        category: event.category || categories[0] || ''
      });
    }

    // Process schema extensions...
    // (keep your existing code for schema extensions)
  }, [event, categories, schemaExtensions, availableLocations]);

  // Format functions for separate date and time fields
  function formatDateOnly(date) {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }

  function formatTimeOnly(date) {
    if (!date) return '';
    return date.toTimeString().substring(0, 5);
  }

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
    if (isAllDay && 
        formData.startDate === formData.endDate) {
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
  
    // Add schema extensions
    // (keep your existing code for schema extensions)
  
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
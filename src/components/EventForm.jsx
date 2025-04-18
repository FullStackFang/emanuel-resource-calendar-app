// src/components/EventForm.jsx
import React, { useState, useEffect } from 'react';

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

function EventForm({ event, categories, eventCodes, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    subject: '',
    start: '',
    end: '',
    location: { displayName: '' }, 
    category: categories[0] || '',
    eventCode: ''
  });

  // Initialize form with event data
  useEffect(() => {
    if (event) {
      console.log('Initializing form with event:', event);
      
      // Actually utilize parseAPIDateToLocal by passing its output to formatDateForInput
      const startDate = event.start?.dateTime ? formatDateForInput(event.start.dateTime) : '';
      const endDate = event.end?.dateTime ? formatDateForInput(event.end.dateTime) : '';
      
      console.log('Formatted start date for form:', startDate);
      console.log('Formatted end date for form:', endDate);
      
      setFormData({
        id: event.id || '', // This might be undefined for new events
        subject: event.subject || '',
        start: startDate,
        end: endDate,
        location: event.location?.displayName || '',
        category: event.category || categories[0],
        eventCode: event.eventCode || eventCodes[0] || ''
      });
    }
  }, [event, categories, eventCodes]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!formData.subject || !formData.start || !formData.end) {
      alert('Please fill out all required fields');
      return;
    }
    
    console.log('Form data before submission:', formData);
    
    // Parse input dates to JavaScript Date objects
    const startDate = new Date(formData.start);
    const endDate = new Date(formData.end);
    
    console.log('Parsed start date:', startDate);
    console.log('Parsed end date:', endDate);
    
    // Format dates consistently for API submission
    const formattedStartDate = formatDateForAPI(startDate);
    const formattedEndDate = formatDateForAPI(endDate);
    
    console.log('Formatted start date for API:', formattedStartDate);
    console.log('Formatted end date for API:', formattedEndDate);
    
    // Create formatted event object (only include id if it exists and isn't a temporary id)
    const eventData = {
      ...(formData.id && !formData.id.includes('event_') ? { id: formData.id } : {}),
      subject: formData.subject,
      start: { dateTime: formattedStartDate },
      end: { dateTime: formattedEndDate },
      location: { displayName: formData.location },
      category: formData.category,
      eventCode: formData.eventCode
    };
    
    console.log('Sending event data to save:', eventData);
    
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
        />
      </div>

      <div className="form-group">
        <label htmlFor="start">Start Time *</label>
        <input
          type="datetime-local"
          id="start"
          name="start"
          value={formData.start}
          onChange={handleChange}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="end">End Time *</label>
        <input
          type="datetime-local"
          id="end"
          name="end"
          value={formData.end}
          onChange={handleChange}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="location">Location</label>
        <input
          type="text"
          id="location"
          name="location"
          value={formData.location}
          onChange={handleChange}
        />
      </div>

      <div className="form-group">
        <label htmlFor="category">Category</label>
        <select
          id="category"
          name="category"
          value={formData.category}
          onChange={handleChange}
        >
          {categories.map(category => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="eventCode">Event Code</label>
        <select
          id="eventCode"
          name="eventCode"
          value={formData.eventCode}
          onChange={handleChange}
        >
          <option value="">-- Select an Event Code --</option>
          {eventCodes?.map(code => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="save-button">
          Save
        </button>
      </div>
    </form>
  );
}

export default EventForm;
// src/components/EventForm.jsx
import React, { useState, useEffect } from 'react';

function EventForm({ event, categories, eventCodes, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    subject: '',
    start: '',
    end: '',
    location: '',
    category: categories[0] || '',
    eventCode: ''
  });

  useEffect(() => {
    if (event) {
      const formatDateForInput = (dateString) => {
        const date = new Date(dateString);
        return date.toISOString().slice(0, 16); // Format: YYYY-MM-DDThh:mm
      };

      setFormData({
        id: event.id || '',
        subject: event.subject || '',
        start: formatDateForInput(event.start?.dateTime) || '',
        end: formatDateForInput(event.end?.dateTime) || '',
        location: event.location?.displayName || '',
        category: event.category || categories[0],
        eventCode: event.eventCode || ''
      });
    }
  }, [event, categories]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.subject || !formData.start || !formData.end) {
      alert('Please fill out all required fields');
      return;
    }

    const eventData = {
      id: formData.id || `event_${Date.now()}`,
      subject: formData.subject,
      start: { dateTime: new Date(formData.start).toISOString() },
      end: { dateTime: new Date(formData.end).toISOString() },
      location: { displayName: formData.location },
      category: formData.category,
      eventCode: formData.eventCode
    };

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

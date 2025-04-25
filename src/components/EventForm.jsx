// src/components/EventForm.jsx
import React, { useState, useEffect } from 'react';
import MultiSelect from './MultiSelect';

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
 * Helper function to map schema property types to HTML input types
 * @param {string} propertyType - Schema property type
 * @returns {string} Corresponding HTML input type
 */
const getInputTypeFromPropertyType = (propertyType) => {
  switch (propertyType) {
    case 'Integer':
      return 'number';
    case 'Boolean':
      return 'checkbox';
    case 'DateTimeOffset':
    case 'DateTime':
      return 'datetime-local';
    case 'Binary':
      return 'file';
    case 'String':
    default:
      return 'text';
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

function EventForm({ event, categories, availableLocations = [], schemaExtensions = [], onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    subject: '',
    start: '',
    end: '',
    locations: [], 
    category: categories[0] || ''
  });
  
  // Add state for schema extension fields
  const [extensionFields, setExtensionFields] = useState({});
  
  // Initialize form with event data
  // Extract extension data when an event loads
  useEffect(() => {
    console.log('EVENT WITH EXTENSIONS:', JSON.stringify(event, null, 2));

    if (event) {
      // Process dates
      const startDate = event.start?.dateTime ? formatDateForInput(event.start.dateTime) : '';
      const endDate = event.end?.dateTime ? formatDateForInput(event.end.dateTime) : '';
      
      // Handle locations using consistent parsing and filtering to only include valid options
      const locationValues = parseLocationsFromEvent(event.location, availableLocations);
      
      console.log('Parsed and filtered locations:', locationValues);
      
      setFormData({
        id: event.id || '', 
        subject: event.subject || '',
        start: startDate,
        end: endDate,
        locations: locationValues,
        category: event.category || categories[0] || ''
      });
    }

    if (event && schemaExtensions && schemaExtensions.length > 0) {
      console.log('Processing schema extensions for form:', schemaExtensions);
      
      const extensionData = {};
      
      // For each schema extension
      schemaExtensions.forEach(extension => {
        console.log(`Processing extension: ${extension.id}`);
        
        // For each property in the extension
        extension.properties.forEach(prop => {
          console.log(`Checking for property: ${prop.name}`);
          
          // Check if property exists in extensions array
          let foundInExtensions = false;
          
          if (event.extensions && Array.isArray(event.extensions)) {
            console.log(`Checking extensions array with ${event.extensions.length} items`);
            for (const ext of event.extensions) {
              if (ext[prop.name] !== undefined) {
                extensionData[prop.name] = ext[prop.name];
                console.log(`Found in extensions array: ${prop.name} = ${ext[prop.name]}`);
                foundInExtensions = true;
                break;
              }
            }
          }
          
          // If not found in extensions array, check if property exists directly on the event
          if (!foundInExtensions && event[prop.name] !== undefined) {
            extensionData[prop.name] = event[prop.name];
            console.log(`Found property directly on event: ${prop.name} = ${event[prop.name]}`);
          } 
          // Initialize with default value based on property type
          else if (!foundInExtensions) {
            // Set appropriate defaults based on property type
            switch (prop.type) {
              case 'Boolean':
                extensionData[prop.name] = false;
                break;
              case 'Integer':
                extensionData[prop.name] = 0;
                break;
              case 'String':
              default:
                extensionData[prop.name] = '';
                break;
            }
            console.log(`Initialized default value for: ${prop.name} = ${extensionData[prop.name]}`);
          }
        });
      });
      
      console.log('Final extension data for form:', extensionData);
      setExtensionFields(extensionData);
    }
  }, [event, categories, schemaExtensions, availableLocations]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Create a handler for location selection changes
  const handleLocationChange = (selectedLocations) => {
    console.log('Selected locations changed:', selectedLocations);
    
    // Filter locations to ensure they only contain values from availableLocations
    const validLocations = selectedLocations.filter(loc => availableLocations.includes(loc));
    
    console.log('Valid locations after filtering:', validLocations);
    
    setFormData(prev => ({
      ...prev,
      locations: validLocations // Use only the valid selected values
    }));
  };

  // Handle extension field changes
  const handleExtensionFieldChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // For checkbox inputs, use the checked property instead of value
    const fieldValue = type === 'checkbox' ? checked : value;
    
    setExtensionFields(prev => ({
      ...prev,
      [name]: fieldValue
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
  
    // Validate form
    if (!formData.subject || !formData.start || !formData.end) {
      alert('Please fill out all required fields');
      return;
    }
  
    // Parse & format dates
    const startDate = new Date(formData.start);
    const endDate   = new Date(formData.end);
    const formattedStartDate = formatDateForAPI(startDate);
    const formattedEndDate   = formatDateForAPI(endDate);
  
    // Format the location field to be compatible with the API
    // Microsoft Graph expects a single location with a displayName
    // Use the same delimiter for consistency
    const LOCATION_DELIMITER = '; ';
    const locationDisplayName = formData.locations.length > 0 
    ? formData.locations.join(LOCATION_DELIMITER) 
    : '';
    
    console.log('Saving locations:', formData.locations);
    console.log('Location display name:', locationDisplayName);
    
    // Build the payload for schema‑extension PATCH
    const eventData = {
      // Include the ID so parent can PATCH the correct event
      id: formData.id,
  
      // Standard event properties
      subject:    formData.subject,
      start:      { dateTime: formattedStartDate, timeZone: 'UTC' },
      end:        { dateTime: formattedEndDate,   timeZone: 'UTC' },
      location:   { displayName: locationDisplayName },
      categories: [ formData.category ],
    };
  
    // Merge in each registered schema extension
    schemaExtensions.forEach(extension => {
      const extPayload = {};
      extension.properties.forEach(prop => {
        const val = extensionFields[prop.name];
        if (val !== undefined) {
          extPayload[prop.name] = val;
        }
      });
      if (Object.keys(extPayload).length > 0) {
        eventData[extension.id] = extPayload;
      }
    });
  
    console.log('[EventForm.handleSubmit] event data to save:', eventData);
  
    // Hand off to parent (which has the token and does the PATCH)
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
      <label htmlFor="location">Locations</label>
        <MultiSelect
          options={availableLocations}
          selected={formData.locations || []}
          onChange={handleLocationChange}
          label="Select location(s)"
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

      {/* Schema Extension Fields */}
      {/* 
      {schemaExtensions && schemaExtensions.length > 0 && (
        <div className="schema-extensions-section">
          <h3>Additional Properties</h3>
          {schemaExtensions.map(extension => (
            <div key={extension.id} className="extension-group">
              <h4>{extension.description || 'Custom Properties'}</h4>
              {extension.properties.map(prop => (
                <div key={prop.name} className="form-group">
                  <label htmlFor={prop.name}>{prop.name}</label>
                  {prop.type === 'Boolean' ? (
                    <input
                      type="checkbox"
                      id={prop.name}
                      name={prop.name}
                      checked={!!extensionFields[prop.name]}
                      onChange={handleExtensionFieldChange}
                    />
                  ) : (
                    <input
                      type={getInputTypeFromPropertyType(prop.type)}
                      id={prop.name}
                      name={prop.name}
                      value={extensionFields[prop.name] || ''}
                      onChange={handleExtensionFieldChange}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      */}

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
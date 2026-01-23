// src/components/SchemaExtensionAdmin.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { msalConfig } from '../config/authConfig';
import { logger } from '../utils/logger';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

function SchemaExtensionAdmin({ accessToken, apiToken }) {
  // State for extensions and form
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    description: '',
    properties: [{ name: 'eventCode', type: 'String' }]
  });
  const [message, setMessage] = useState('');

  // Load existing schema extensions
  useEffect(() => {
    if (apiToken) {
      loadSchemaExtensions();
    }
  }, [apiToken]);

  // Fetch all schema extensions owned by this app
  const loadSchemaExtensions = async () => {
    try {
        setLoading(true);

        // Fetch schema extensions via backend (uses app-only auth)
        const response = await fetch(`${API_BASE_URL}/graph/schema-extensions`, {
            headers: {
                Authorization: `Bearer ${apiToken}`
            }
        });
        
      
      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Failed to fetch schema extensions:', errorData);
        setMessage('Error loading schema extensions');
        setLoading(false);
        return;
      }
      
      const data = await response.json();
      logger.debug('Loaded schema extensions:', data.value);

      // Find extensions that match our schema name
      const schemaNameMatch = data.value.filter(ext => 
        ext.id.includes('_myCustomEvent')
      );
      logger.debug('Extensions matching schema name:', schemaNameMatch);

      // Direct look up of a specific extension
      const directExtensionMatch = data.value.filter(ext => 
        ext.id === 'ext4osqkn85_myCustomEvent'
      );
      logger.debug('Direct extension match:', directExtensionMatch);
      
      // Get your app ID
      const appId = msalConfig.auth.clientId;
      logger.debug('My App ID:', appId);
      
      // First, check if any extensions match our criteria
      const ownedByMyApp = data.value.filter(ext => ext.owner === appId);
      logger.debug('Extensions owned by my app:', ownedByMyApp);
      
      const prefixMatch = data.value.filter(ext => 
        ext.id.startsWith(`ext${appId.replace(/-/g, '')}`)
      );
      logger.debug('Extensions with my app ID prefix:', prefixMatch);
      
      // If none of the extensions match our criteria, let's use a different approach
      if (ownedByMyApp.length === 0 && prefixMatch.length === 0) {
        logger.debug('No extensions found matching app ID criteria, using fallback filtering');
        
        // Filter by target type and property names
        const filteredByProperties = data.value.filter(ext => 
          (ext.targetTypes && ext.targetTypes.includes('event')) &&
          (ext.properties && ext.properties.some(prop => 
            prop.name === 'eventCode' || 
            prop.name.includes('calendar') ||
            prop.name.includes('event')
          ))
        );
        
        logger.debug('Extensions filtered by properties:', filteredByProperties);
        
        // If this still returns nothing, at least show extensions that target events
        if (filteredByProperties.length === 0) {
          const eventExtensions = data.value.filter(ext => 
            ext.targetTypes && ext.targetTypes.includes('event')
          );
          
          logger.debug('Event-targeted extensions:', eventExtensions);
          
          setExtensions(eventExtensions.length > 0 ? eventExtensions : []);
        } else {
          setExtensions(filteredByProperties);
        }
      } else {
        // Use our original filter if we found matching extensions
        // Include schemaNameMatch in the filtered extensions
        const filteredExtensions = [...ownedByMyApp, ...prefixMatch, ...schemaNameMatch];
        
        // Remove duplicates (in case an extension matches multiple criteria)
        const uniqueExtensions = Array.from(new Set(filteredExtensions.map(ext => ext.id)))
          .map(id => filteredExtensions.find(ext => ext.id === id));
        
        logger.debug('Using combined filtered extensions:', uniqueExtensions);
        setExtensions(uniqueExtensions);
      }
      
      setLoading(false);
    } catch (err) {
      logger.error('Error fetching schema extensions:', err);
      setMessage('Error loading schema extensions');
      setLoading(false);
    }
  };

  // Handle form changes
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  // Add a property to the schema
  const addProperty = () => {
    setFormData({
      ...formData,
      properties: [...formData.properties, { name: '', type: 'String' }]
    });
  };

  // Handle property changes
  const handlePropertyChange = (index, field, value) => {
    const updatedProperties = [...formData.properties];
    updatedProperties[index] = {
      ...updatedProperties[index],
      [field]: value
    };
    
    setFormData({
      ...formData,
      properties: updatedProperties
    });
  };

  // Remove a property
  const removeProperty = (index) => {
    const updatedProperties = formData.properties.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      properties: updatedProperties
    });
  };

  // Create a new schema extension
  const createSchemaExtension = async (e) => {
    e.preventDefault();
    
    try {
      setMessage('Creating schema extension...');
      
      const appId = msalConfig.auth.clientId;
      logger.debug('App ID:', appId); // Debugging
      
      // Create the schema extension with explicit id
      // Using a simple schema name that Microsoft Graph will prefix
      const schemaId = "myCustomEvent";
      
      const schemaExtension = {
        id: schemaId,
        description: formData.description || "Custom event extension",
        targetTypes: ['event'],
        owner: appId,
        properties: formData.properties.length > 0
          ? formData.properties.map(prop => ({
              name: prop.name,
              type: prop.type
            }))
          : [{ name: "eventCode", type: "String" }]
      };

      logger.debug('Creating schema extension with payload:', JSON.stringify(schemaExtension, null, 2));

      // Create schema extension via backend (uses app-only auth)
      const response = await fetch(`${API_BASE_URL}/graph/schema-extensions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(schemaExtension)
      });
      
      const responseText = await response.text();
      logger.debug('Raw response:', responseText);
      
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { error: { message: 'Could not parse response', e } };
      }
      
      if (!response.ok) {
        logger.error('Failed to create schema extension. Status:', response.status);
        logger.error('Error details:', JSON.stringify(errorData, null, 2));
        setMessage(`Error creating schema: ${errorData.error?.message || 'Unknown error'}`);
        return;
      } else {
        // Call updateToAvailable with the new schema ID
        await updateToAvailable(errorData.id);
      }
      
      logger.debug('Schema extension created:', errorData);
      
      // Reset form
      setFormData({
        description: '',
        properties: [{ name: '', type: 'String' }]
      });
      
      setMessage(`Schema extension created: ${errorData.id}`);
      
      // Reload extensions
      loadSchemaExtensions();
    } catch (err) {
      logger.error('Error creating schema extension:', err);
      setMessage(`Error creating schema: ${err.message}`);
    }
  };

  // Update schema extension to Available status
  const updateToAvailable = async (schemaId) => {
    try {
      logger.debug(`Updating schema extension ${schemaId} to Available status...`);

      // Update schema extension via backend (uses app-only auth)
      const updateResponse = await fetch(`${API_BASE_URL}/graph/schema-extensions/${schemaId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: "Available"
        })
      });

      if (updateResponse.ok) {
        logger.debug(`Schema extension ${schemaId} updated to Available status`);
        setMessage(`Schema extension ${schemaId} created and set to Available status`);
      } else {
        const errorData = await updateResponse.json();
        logger.error('Failed to update schema extension status:', errorData);
        setMessage(`Schema created but failed to update status: ${errorData.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      logger.error('Error updating schema extension:', err);
      setMessage(`Schema created but error updating status: ${err.message}`);
    }
  };

  // Delete a schema extension
  const deleteSchemaExtension = async (id) => {
    if (!window.confirm(`Are you sure you want to delete schema extension ${id}?`)) {
      return;
    }

    try {
      setMessage(`Deleting schema extension ${id}...`);

      // Delete schema extension via backend (uses app-only auth)
      const response = await fetch(`${API_BASE_URL}/graph/schema-extensions/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Failed to delete schema extension:', errorData);
        setMessage(`Error deleting schema: ${errorData.error?.message || 'Unknown error'}`);
        return;
      }

      setMessage(`Schema extension ${id} deleted successfully`);

      // Reload extensions
      loadSchemaExtensions();
    } catch (err) {
      logger.error('Error deleting schema extension:', err);
      setMessage(`Error deleting schema: ${err.message}`);
    }
  };

  return (
    <div className="admin-container">  
      <div className="admin-content">
        <h2>Schema Extension Manager</h2>
        
        {message && (
          <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      
        {/* Create Schema Extension Section */}
        <div className="admin-section creation-section">
          <h3>Create New Schema Extension</h3>
          <form onSubmit={createSchemaExtension}>
            <div className="form-group">
              <label htmlFor="description">Description</label>
              <input
                type="text"
                id="description"
                name="description"
                value={formData.description}
                onChange={handleFormChange}
                required
                placeholder="Custom attributes for calendar events"
              />
            </div>
            
            <div className="properties-container">
              <h4>Properties</h4>
              {formData.properties.map((property, index) => (
                <div key={index} className="property-row">
                  <div className="form-group">
                    <label htmlFor={`property-name-${index}`}>Name</label>
                    <input
                      type="text"
                      id={`property-name-${index}`}
                      value={property.name}
                      onChange={(e) => handlePropertyChange(index, 'name', e.target.value)}
                      required
                      placeholder="eventCode"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor={`property-type-${index}`}>Type</label>
                    <select
                      id={`property-type-${index}`}
                      value={property.type}
                      onChange={(e) => handlePropertyChange(index, 'type', e.target.value)}
                    >
                      <option value="String">String</option>
                      <option value="Integer">Integer</option>
                      <option value="Boolean">Boolean</option>
                      <option value="Binary">Binary</option>
                      <option value="DateTime">DateTime</option>
                    </select>
                  </div>
                  
                  <button 
                    type="button" 
                    className="remove-button"
                    onClick={() => removeProperty(index)}
                    disabled={formData.properties.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            
            <div className="button-row">
              <button type="button" onClick={addProperty} className="secondary-button">
                Add Property
              </button>
              
              <button type="submit" className="primary-button">
                Create Schema Extension
              </button>
            </div>
          </form>
        </div>
        
        <hr className="section-divider" />
          
        {/* Existing Schema Extensions Section */}
        <div className="admin-section extensions-section">
          <h3>Existing Schema Extensions</h3>
          {loading ? (
            <LoadingSpinner />
          ) : extensions.length === 0 ? (
            <div className="no-data">No schema extensions found</div>
          ) : (
            <div className="schema-list">
              {extensions.map(extension => (
                <div key={extension.id} className="schema-item">
                  <h4>{extension.id}</h4>
                  <p><strong>Description:</strong> {extension.description}</p>
                  <p><strong>Status:</strong> {extension.status}</p>
                  <div className="property-list">
                    <strong>Properties:</strong>
                    <ul>
                      {extension.properties.map(prop => (
                        <li key={prop.name}>
                          {prop.name} ({prop.type})
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="schema-actions">
                    <button 
                      className="delete-button"
                      onClick={() => deleteSchemaExtension(extension.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SchemaExtensionAdmin;
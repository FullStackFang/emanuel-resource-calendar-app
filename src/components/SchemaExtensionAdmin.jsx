// src/components/SchemaExtensionAdmin.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function SchemaExtensionAdmin({ accessToken }) {
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
    if (accessToken) {
      loadSchemaExtensions();
    }
  }, [accessToken]);

  // Fetch all schema extensions owned by this app
  const loadSchemaExtensions = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('https://graph.microsoft.com/v1.0/schemaExtensions', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to fetch schema extensions:', errorData);
        setMessage('Error loading schema extensions');
        setLoading(false);
        return;
      }
      
      const data = await response.json();
      console.log('Loaded schema extensions:', data.value);
      
      // Filter to only show extensions owned by your application
      // You'll need to adjust this based on your app ID
      const appId = 'YOUR_APP_ID'; // Replace with your app ID
      const filteredExtensions = data.value.filter(ext => 
        ext.id.startsWith(`ext${appId.replace(/-/g, '')}`) || 
        ext.owner === appId
      );
      
      setExtensions(filteredExtensions);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching schema extensions:', err);
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
      
      // Generate a unique ID for the schema extension
      // This will be prefixed with your app ID by Microsoft Graph
      const extensionName = `calendarExtension_${Date.now()}`;
      
      const schemaExtension = {
        id: extensionName,
        description: formData.description,
        targetTypes: ['event'],
        properties: formData.properties.map(prop => ({
          name: prop.name,
          type: prop.type
        }))
      };
      
      console.log('Creating schema extension:', schemaExtension);
      
      const response = await fetch('https://graph.microsoft.com/v1.0/schemaExtensions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(schemaExtension)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to create schema extension:', errorData);
        setMessage(`Error creating schema: ${errorData.error?.message || 'Unknown error'}`);
        return;
      }
      
      const data = await response.json();
      console.log('Schema extension created:', data);
      
      // Reset form
      setFormData({
        description: '',
        properties: [{ name: '', type: 'String' }]
      });
      
      setMessage(`Schema extension created: ${data.id}`);
      
      // Reload extensions
      loadSchemaExtensions();
    } catch (err) {
      console.error('Error creating schema extension:', err);
      setMessage(`Error creating schema: ${err.message}`);
    }
  };

  // Delete a schema extension
  const deleteSchemaExtension = async (id) => {
    if (!window.confirm(`Are you sure you want to delete schema extension ${id}?`)) {
      return;
    }
    
    try {
      setMessage(`Deleting schema extension ${id}...`);
      
      const response = await fetch(`https://graph.microsoft.com/v1.0/schemaExtensions/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to delete schema extension:', errorData);
        setMessage(`Error deleting schema: ${errorData.error?.message || 'Unknown error'}`);
        return;
      }
      
      setMessage(`Schema extension ${id} deleted successfully`);
      
      // Reload extensions
      loadSchemaExtensions();
    } catch (err) {
      console.error('Error deleting schema extension:', err);
      setMessage(`Error deleting schema: ${err.message}`);
    }
  };

  return (
    <div className="admin-container">  
      <div className="admin-content">
        <h2>Schema Extension Manager</h2>
        
        {message && (
          <div className="message">{message}</div>
        )}
      
        <div className="admin-section">
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
                    placeholder="[Schema Property Name]"
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
            
            <div className="button-row">
              <button type="button" onClick={addProperty}>
                Add Property
              </button>
              
              <button type="submit">
                Create Schema Extension
              </button>
            </div>
          </form>
        </div>
        
        <div className="admin-section">
          <h3>Existing Schema Extensions</h3>
          {loading ? (
            <div className="loading">Loading schema extensions...</div>
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
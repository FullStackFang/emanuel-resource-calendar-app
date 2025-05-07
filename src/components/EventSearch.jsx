// src/components/EventSearch.jsx
import React, { useState, useEffect } from 'react';
import MultiSelect from './MultiSelect';
import EventForm from './EventForm';
import EventSearchExport from './EventSearchExport';
import './EventSearch.css';

// Search function implementation
async function searchEvents(token, searchTerm = '', dateRange = {}, categories = [], locations = []) {
  try {
    // Start with a basic URL
    let url = 'https://graph.microsoft.com/v1.0/me/events?$top=50&$orderby=start/dateTime';
    let filters = [];
    
    // Add simple subject search if provided
    if (searchTerm) {
      filters.push(`contains(subject,'${searchTerm.replace(/'/g, "''")}')`);
    }
    
    // Add date filters if provided
    if (dateRange.start) {
      const startDate = new Date(dateRange.start).toISOString();
      filters.push(`start/dateTime ge '${startDate}'`);
    }
    
    if (dateRange.end) {
      const endDate = new Date(dateRange.end).toISOString();
      filters.push(`end/dateTime le '${endDate}'`);
    }
    
    // Only add filters if we have any
    if (filters.length > 0) {
      url += `&$filter=${encodeURIComponent(filters.join(' and '))}`;
    }
    
    console.log("Search URL:", url);
    
    // Make the API request
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Post-filter results for categories and locations
    // This is more reliable than using OData filters for these properties
    let results = data.value || [];
    
    // Filter by categories client-side
    if (categories && categories.length > 0) {
      results = results.filter(event => {
        // Handle "Uncategorized" special case
        if (categories.includes('Uncategorized')) {
          if (!event.categories || event.categories.length === 0) {
            return true;
          }
        }
        
        // Check if any of the event's categories match our filter
        return event.categories && 
               event.categories.some(cat => categories.includes(cat));
      });
    }
    
    // Filter by locations client-side
    if (locations && locations.length > 0) {
      results = results.filter(event => {
        const eventLocation = event.location?.displayName || '';
        
        // Check if any of our location filters match
        return locations.some(loc => eventLocation.includes(loc));
      });
    }
    
    return results;
  } catch (error) {
    console.error('Error searching events:', error);
    throw error;
  }
}

function EventSearch({ 
    graphToken, 
    onEventSelect, 
    onClose, 
    outlookCategories, 
    availableLocations, 
    onSaveEvent,
    onViewInCalendar  // Add this new prop
  }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  
  // Advanced search options (always visible now)
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  
  // Selected event state
  const [selectedEvent, setSelectedEvent] = useState(null);
  
  // Handle search functionality
  const handleSearch = async () => {
    if (!searchTerm && !dateRange.start && !selectedCategories.length && !selectedLocations.length) {
      setSearchError('Please enter a search term or select search criteria');
      return;
    }
    
    setIsLoading(true);
    setSearchError(null);
    
    try {
      // Use the search function with all selected filters
      const results = await searchEvents(
        graphToken, 
        searchTerm, 
        dateRange, 
        selectedCategories, 
        selectedLocations
      );
      setSearchResults(results);
      
      // Clear selected event when search results change
      setSelectedEvent(null);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchError(`Search failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle selecting an event from results
  const handleSelectEvent = (event) => {
    setSelectedEvent(event);
  };
  
  // Handle saving the event
  const handleSaveEvent = async (updatedEvent) => {
    try {
      // Call the parent's save function
      const success = await onSaveEvent(updatedEvent);
      
      if (success) {
        // Refresh search results
        handleSearch();
        
        // Show success message
        setSearchError({ type: 'success', message: 'Event updated successfully!' });
        setTimeout(() => setSearchError(null), 3000);
      }
    } catch (error) {
      console.error("Save failed:", error);
      setSearchError(`Save failed: ${error.message}`);
    }
  };
  
  // Handle category selection
  const handleCategoryChange = (selected) => {
    setSelectedCategories(selected);
  };
  
  // Handle location selection
  const handleLocationChange = (selected) => {
    setSelectedLocations(selected);
  };
  
  return (
    <div className="event-search-container">
      <div className="search-header">
        <h2>Search Calendar Events</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      
      {/* Full-width search form */}
      <div className="search-form-full">
        <div className="search-input-container">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search for events..."
            className="search-input"
          />
          <button className="search-button" onClick={handleSearch} disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
        
        {/* Advanced options - always visible */}
        <div className="advanced-options">
          <div className="advanced-options-row">
            <div className="date-filters">
              <div className="form-group">
                <label>From:</label>
                <input 
                  type="date" 
                  value={dateRange.start}
                  onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>To:</label>
                <input 
                  type="date" 
                  value={dateRange.end}
                  onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                />
              </div>
            </div>
            
            <div className="filters-container">
              {/* Category filter */}
              <div className="filter-section">
                <label>Categories:</label>
                <MultiSelect 
                  options={[...new Set(['Uncategorized', ...outlookCategories.map(cat => cat.name)])]}
                  selected={selectedCategories}
                  onChange={handleCategoryChange}
                />
              </div>
              
              {/* Location filter */}
              <div className="filter-section">
                <label>Locations:</label>
                <MultiSelect 
                  options={availableLocations}
                  selected={selectedLocations}
                  onChange={handleLocationChange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
    {searchError && (
        <div className={`search-message ${searchError.type === 'success' ? 'success' : 'error'}`}>
            {typeof searchError === 'string' ? searchError : searchError.message}
        </div>
    )}
      
    <div className="search-results-header">
        <div className="results-count">
            {searchResults.length > 0 ? (
            <span>{searchResults.length} event{searchResults.length !== 1 ? 's' : ''} found</span>
            ) : searchTerm ? (
            <span>No events found</span>
            ) : null}
        </div>
        
        {searchResults.length > 0 && (
            <EventSearchExport 
            searchResults={searchResults}
            searchTerm={searchTerm}
            categories={selectedCategories}
            locations={selectedLocations}
            />
        )}
    </div>

      {/* Two-column layout for results and edit form */}
      <div className="search-content-columns">
        {/* Left column - Search results */}
        <div className="search-results-column">
          <div className="search-results">
            {isLoading ? (
              <div className="loading-indicator">Searching...</div>
            ) : searchResults.length > 0 ? (
              <ul className="results-list">
                {searchResults.map(event => (
                  <li 
                    key={event.id} 
                    className={`result-item ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                    onClick={() => handleSelectEvent(event)}
                  >
                    <div className="result-title">{event.subject}</div>
                    <div className="result-date">
                      {new Date(event.start.dateTime).toLocaleDateString()} 
                      {' '}{new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    
                    {/* Location tag(s) */}
                    {event.location?.displayName && (
                      <div className="result-tags">
                        <span className="location-tag">
                          <i className="location-icon">📍</i>
                          {event.location.displayName}
                        </span>
                      </div>
                    )}
                    
                    {/* Category tags */}
                    {Array.isArray(event.categories) && event.categories.length > 0 ? (
                      <div className="result-tags">
                        {event.categories.map(category => (
                          <span key={category} className="category-tag">
                            <i className="category-icon">🏷️</i>
                            {category}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="result-tags">
                        <span className="category-tag uncategorized">
                          <i className="category-icon">🏷️</i>
                          Uncategorized
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              searchTerm && !isLoading && <div className="no-results"></div>
            )}
          </div>
        </div>
        
        {/* Right column - Event form */}
        <div className="event-edit-column">
          {selectedEvent ? (
            <div className="event-detail-panel">
              <div className="detail-header">
                <h3>Edit Event</h3>
                <div className="detail-actions">
                <button 
                    className="view-in-calendar-button" 
                    onClick={() => {
                        onClose();
                        onEventSelect(selectedEvent, true);
                    }}
                    >
                    📅 View in Calendar
                  </button>
                </div>
              </div>
              
              {/* Directly use EventForm component */}
              <EventForm 
                event={selectedEvent}
                categories={[...new Set(['Uncategorized', ...outlookCategories.map(cat => cat.name)])]}
                availableLocations={availableLocations}
                onSave={handleSaveEvent}
                onCancel={() => setSelectedEvent(null)}
                readOnly={false}
              />
            </div>
          ) : (
            <div className="no-event-selected">
              <div className="no-event-message">
                <p>Select an event from the search results to edit it.</p>
                <p>You can search by text, date range, categories, or locations.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EventSearch;
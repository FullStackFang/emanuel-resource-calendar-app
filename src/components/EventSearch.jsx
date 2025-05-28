// src/components/EventSearch.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// Import from @tanstack/react-query with the QueryClientProvider
import { 
  QueryClient, 
  QueryClientProvider,
  useQuery, 
  useMutation, 
  useQueryClient 
} from '@tanstack/react-query';
import MultiSelect from './MultiSelect';
import EventForm from './EventForm';
import EventSearchExport from './EventSearchExport';
import './EventSearch.css';
import APP_CONFIG from '../config/config';

// Create a client
const queryClient = new QueryClient();

// Search function implementation
async function searchEvents(token, searchTerm = '', dateRange = {}, categories = [], locations = [], pageUrl = null, calendarId = null) {
  try {
    let baseUrl;
    if (calendarId) {
      baseUrl = `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`;
    } else {
      baseUrl = 'https://graph.microsoft.com/v1.0/me/events';
    }

    let url = pageUrl || `${baseUrl}?$top=250&$orderby=start/dateTime desc&$count=true`;
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
    
    // Only add filters if we have any and we're not using a pagination URL
    if (filters.length > 0 && !pageUrl) {
      url += `&$filter=${encodeURIComponent(filters.join(' and '))}`;
    }
    
    console.log("Search URL:", url);
    
    // Add headers to request count information if this is the first page
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'outlook.timezone="Etc/UTC"'
    };
    
    if (!pageUrl) {
      headers['ConsistencyLevel'] = 'eventual';
    }
    
    // Make the API request
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Try to get the total count if available
    const totalCount = data['@odata.count'] !== undefined ? data['@odata.count'] : null;
    
    // Post-filter results for categories and locations
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
    
    return {
      results,
      nextLink: data['@odata.nextLink'] || null,
      totalCount
    };
  } catch (error) {
    console.error('Error searching events:', error);
    throw error;
  }
}

// The internal component that uses the query hooks
function EventSearchInner({ 
  graphToken, 
  onEventSelect, 
  onClose, 
  outlookCategories, 
  availableLocations, 
  onSaveEvent,
  onViewInCalendar,
  selectedCalendarId,
  availableCalendars 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  
  // Pagination state
  const [nextLink, setNextLink] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [autoLoadMore, setAutoLoadMore] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [totalAvailableEvents, setTotalAvailableEvents] = useState(null);
  const loadingTimeoutRef = useRef(null);
  const loadingThrottleRef = useRef(false);


  // Selected event state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [searchError, setSearchError] = useState(null);
  
  // Flag to control when to run the search query
  const [shouldRunSearch, setShouldRunSearch] = useState(false);
  
  // Create a query key based on search parameters
  const searchQueryKey = useMemo(() => 
    ['events', searchTerm, dateRange, selectedCategories, selectedLocations],
    [searchTerm, dateRange, selectedCategories, selectedLocations]
  );
  
  // Get the query client
  const queryClient = useQueryClient();
  
  // Use Tanstack Query for fetching data
  const { 
    data: searchData, 
    isLoading, 
    error, 
    refetch,
    isFetching
  } = useQuery({
    queryKey: searchQueryKey,
    queryFn: async () => {
      setLoadingStatus('Searching...');
      try {
        let result;

        console.log(`Searching in calendar: ${selectedCalendarId || 'default'}`);

        result = await searchEvents(
          graphToken, 
          searchTerm, 
          dateRange, 
          selectedCategories, 
          selectedLocations,
          null, // No pageUrl for first page
          selectedCalendarId // Always pass the calendar ID
        );

        // Set the total count if available
        if (result.totalCount !== null) {
          setTotalAvailableEvents(result.totalCount);
          setLoadingStatus(`Found ${result.totalCount} events. Loading first batch...`);
        }
        
        setNextLink(result.nextLink);

        // Sort results by start date (latest first)
        const sortedResults = [...result.results].sort((a, b) => {
          const aStartTime = new Date(a.start.dateTime);
          const bStartTime = new Date(b.start.dateTime);
          
          // For descending order: most recent first (b - a)
          return bStartTime - aStartTime;
        });
        
        return sortedResults;
      } finally {
        if (!autoLoadMore) {
          setLoadingStatus('');
        }
      }
    },
    enabled: shouldRunSearch,
    keepPreviousData: true,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry token expiration errors
      if (error.message && (error.message.includes('token is expired') || 
                             error.message.includes('Lifetime validation failed'))) {
        return false;
      }
      return failureCount < 3;
    },
    onError: (error) => {
      if (error.message && (error.message.includes('token is expired') || 
                             error.message.includes('Lifetime validation failed'))) {
        setSearchError('Your session has expired. Please refresh the page to continue.');
      } else {
        setSearchError(`Search failed: ${error.message}`);
      }
      setLoadingStatus('');
      setShouldRunSearch(false);
    },
    onSuccess: (data) => {
      setShouldRunSearch(false);
      // Don't clear loading status immediately to maintain smooth transitions
      if (!autoLoadMore && !nextLink) {
        setTimeout(() => setLoadingStatus(''), 2000);
      }
    },
  });
  
  // Setup mutation for updating events
  const updateEventMutation = useMutation({
    mutationFn: (updatedEvent) => {
      // Ensure the calendarId is passed to the onSaveEvent function
      console.log("Saving event to calendar:", updatedEvent.calendarId || selectedCalendarId);
      return onSaveEvent(updatedEvent);
    },
    onSuccess: () => {
      // Rest of the function remains the same
      queryClient.invalidateQueries({ queryKey: searchQueryKey });
      setSearchError({ type: 'success', message: 'Event updated successfully!' });
      setTimeout(() => setSearchError(null), 3000);
      setSelectedEvent(null);
    },
    onError: (error) => {
      setSearchError(`Save failed: ${error.message}`);
    }
  });
  
  // Calculate total results
  const searchResults = searchData || [];

  // Load more results function
  const loadMoreResults = useCallback(async () => {
    if (!nextLink || isLoadingMore || loadingThrottleRef.current) return;
    
    // Short throttle to prevent rapid multiple calls
    loadingThrottleRef.current = true;
    setTimeout(() => { loadingThrottleRef.current = false; }, 300);
    
    setIsLoadingMore(true);
    
    try {
      // Update loading status with count information
      if (totalAvailableEvents) {
        setLoadingStatus(`Loading more... (${searchResults.length} of ${totalAvailableEvents})`);
      } else {
        setLoadingStatus('Loading more events...');
      }
      
      const result = await searchEvents(
        graphToken, 
        searchTerm, 
        dateRange, 
        selectedCategories, 
        selectedLocations, 
        nextLink,
        selectedCalendarId
      );
      
      // Update next link
      setNextLink(result.nextLink);
      
      // Append new results to existing ones
      queryClient.setQueryData(searchQueryKey, oldData => {
        const oldDataArray = oldData || [];
        // Combine old and new results
        const combinedResults = [...oldDataArray, ...result.results];
        
        // Sort all results by start date (latest first)
        const sortedResults = combinedResults.sort((a, b) => {
          const aStartTime = new Date(a.start.dateTime);
          const bStartTime = new Date(b.start.dateTime);
          
          // For descending order: most recent first (b - a)
          return bStartTime - aStartTime;
        });
        
        // Update loading status with count information
        if (totalAvailableEvents) {
          const percentLoaded = Math.round((sortedResults.length / totalAvailableEvents) * 100);
          setLoadingStatus(`Loaded ${sortedResults.length} of ${totalAvailableEvents} events (${percentLoaded}%)`);
        } else {
          setLoadingStatus(`Loaded ${sortedResults.length} events`);
        }
        
        return sortedResults;
      });
      
      // If we have a next link and auto-load is on, schedule next batch
      if (!result.nextLink) {
        // We've loaded all available events
        setLoadingStatus('All events loaded');
        setTimeout(() => setLoadingStatus(''), 2000);
      }
    } catch (error) {
      console.error('Error loading more results:', error);
      
      if (error.message && (error.message.includes('token is expired') || 
                            error.message.includes('Lifetime validation failed'))) {
        setSearchError('Your session has expired. Please refresh the page to continue.');
        setAutoLoadMore(false);
      } else {
        setSearchError(`Failed to load more results: ${error.message}`);
      }
      setLoadingStatus('');
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    nextLink, 
    isLoadingMore, 
    searchResults.length, 
    totalAvailableEvents, 
    graphToken, 
    searchTerm, 
    dateRange, 
    selectedCalendarId,
    selectedCategories, 
    selectedLocations, 
    searchQueryKey,
    queryClient
  ]);

  const scheduleNextBatch = useCallback(() => {
    // Clear any existing timeout
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    // Calculate a dynamic timeout based on result size
    const baseDelay = 300; // minimum delay
    const currentResultsSize = (searchData || []).length;
    let dynamicDelay = baseDelay;
    
    if (currentResultsSize > 200) {
      // Add additional delay for larger result sets
      dynamicDelay += Math.min(currentResultsSize / 10, 700);
    }
    
    loadingTimeoutRef.current = setTimeout(() => {
      if (autoLoadMore && nextLink && !isLoadingMore && !isLoading && !isFetching) {
        loadMoreResults();
      }
    }, dynamicDelay);
  }, [autoLoadMore, nextLink, isLoadingMore, isLoading, isFetching, searchData, loadMoreResults]);
  
  // Handle search execution
  const handleSearch = () => {
    if (!searchTerm && !dateRange.start && !dateRange.end && 
        !selectedCategories.length && !selectedLocations.length) {
      setSearchError('Please enter a search term or select search criteria');
      return;
    }
    
    setSearchError(null);
    setShouldRunSearch(true);
    refetch();
  };
  
  /*
  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(() => {
      handleSearch();
    }, 500),
    [searchTerm, dateRange, selectedCategories, selectedLocations]
  );
  
  // Auto-search when criteria change and there's at least one criterion
  useEffect(() => {
    if (searchTerm || dateRange.start || dateRange.end || 
        selectedCategories.length || selectedLocations.length) {
      debouncedSearch();
    }
    // Cancel debounced function on cleanup
    return () => debouncedSearch.cancel();
  }, [searchTerm, dateRange, selectedCategories, selectedLocations, debouncedSearch]);
  */

  useEffect(() => {
    if (autoLoadMore && nextLink && !isLoadingMore && !isLoading && !isFetching) {
      scheduleNextBatch();
    }
    
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [nextLink, isLoadingMore, autoLoadMore, isLoading, isFetching, scheduleNextBatch]);

  useEffect(() => {
    return () => {
      // Cleanup function that runs on unmount
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  // Handle selecting an event from results
  const handleSelectEvent = (event) => {
    const eventWithCalendar = {
      ...event,
      calendarId: selectedCalendarId || event.calendarId,
      calendarName: selectedCalendarId 
        ? availableCalendars?.find(cal => cal.id === selectedCalendarId)?.name 
        : event.calendarName
    };
    
    setSelectedEvent(eventWithCalendar);
  };
  
  // Handle saving the event
  const handleSaveEvent = (updatedEvent) => {
    // Ensure the event has the correct calendar ID 
    const eventToUpdate = {
      ...updatedEvent,
      calendarId: selectedCalendarId || updatedEvent.calendarId
    };
    
    updateEventMutation.mutate(eventToUpdate);
  };

  // Handle category and location selection
  const handleCategoryChange = (selected) => {
    setSelectedCategories(selected);
  };
  
  const handleLocationChange = (selected) => {
    setSelectedLocations(selected);
  };
  
  // Memoized result item renderer for standard list
  const ResultItem = useCallback((event, index) => {
    return (
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
    );
  }, [selectedEvent]);
  
  return (
    <div className="event-search-container">
      <div className="search-header">
        <h2>Search Calendar Events</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      {/* Add calendar indicator - shows which calendar is being searched */}
      {selectedCalendarId && availableCalendars && (
        <div className="current-calendar-indicator">
          Searching in: {availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || 'Selected Calendar'}
        </div>
      )}
      
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
          <button 
            className="search-button" 
            onClick={handleSearch} 
            disabled={isLoading || isFetching}
          >
            {(isLoading || isFetching) ? 'Searching...' : 'Search'}
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
            <div className="results-summary">
              <div className="results-count-number">
                {searchResults.length} event{searchResults.length !== 1 ? 's' : ''} found
                {totalAvailableEvents !== null && ` (of ${totalAvailableEvents})`}
              </div>
              {loadingStatus && (
                <div className="loading-status">{loadingStatus}</div>
              )}
            </div>
          ) : (searchTerm || dateRange.start || selectedCategories.length || selectedLocations.length) &&
            !isLoading && !isFetching ? (
            <span>No events found</span>
          ) : null}
        </div>
        
        <div className="search-results-actions">       
          {/* Export button */}
          {searchResults.length > 0 && (
            <EventSearchExport
              searchResults={searchResults}
              searchTerm={searchTerm}
              categories={selectedCategories}
              locations={selectedLocations}
              apiToken={graphToken}
              dateRange={dateRange}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
            />
          )}
        </div>
      </div>

      {/* Loading progress bar - add this right after the search-results-header div */}
      {totalAvailableEvents > 0 && (
        <div className="loading-progress-container">
          <div 
            className="loading-progress-bar"
            style={{
              width: `${Math.min((searchResults.length / totalAvailableEvents) * 100, 100)}%`,
              // Only animate when actually loading
              animation: (isLoading || isLoadingMore || isFetching) 
                ? 'progress-bar-animation 1.5s infinite ease-in-out' 
                : 'none'
            }}
          ></div>
        </div>
      )}
      {/* Two-column layout for results and edit form */}
      <div className="search-content-columns">
        {/* Left column - Search results */}
        <div className="search-results-column">
          <div className="search-results">
            {isLoading || isFetching ? (
              <div className="loading-indicator">Searching...</div>
            ) : searchResults.length > 0 ? (
              <>
                {/* Load More button at the TOP of the results list */}
                {nextLink && (
                  <div className="load-more-container load-more-top">
                    <button 
                      onClick={loadMoreResults} 
                      disabled={isLoadingMore}
                      className="load-more-button"
                    >
                      {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} loaded)`}
                    </button>
                  </div>
                )}
              
                {/* Results list */}
                <div className="results-list-container">
                  <ul className="results-list">
                    {searchResults.map((event, index) => ResultItem(event, index))}
                  </ul>
                </div>
                
                {/* Load More button at the BOTTOM of the results list */}
                {nextLink && (
                  <div className="load-more-container load-more-bottom">
                    <button 
                      onClick={loadMoreResults} 
                      disabled={isLoadingMore}
                      className="load-more-button"
                    >
                      {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} loaded)`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              (searchTerm || dateRange.start || selectedCategories.length || selectedLocations.length) &&
              !isLoading && <div className="no-results"></div>
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
                isLoading={updateEventMutation.isPending}
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

// Wrapper component that provides the QueryClient
function EventSearch(props) {
  return (
    <QueryClientProvider client={queryClient}>
      <EventSearchInner {...props} />
    </QueryClientProvider>
  );
}

export default EventSearch;
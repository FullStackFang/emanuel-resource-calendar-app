// src/components/EventSearch.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { useTimezone } from '../context/TimezoneContext';
import { 
  AVAILABLE_TIMEZONES,
  getOutlookTimezone,
  formatDateTimeWithTimezone 
} from '../utils/timezoneUtils';

// Create a client
const queryClient = new QueryClient();


// Search function implementation using unified backend search (includes CSV events)
async function searchEvents(apiToken, searchTerm = '', dateRange = {}, categories = [], locations = [], page = 1, limit = 250, calendarId = null, timezone = 'UTC') {
  try {
    // Build search parameters
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sortBy: 'startTime',
      sortOrder: 'desc'
    });

    // Add search term if provided
    if (searchTerm) {
      params.append('search', searchTerm);
    }

    // Add calendar filter if provided
    if (calendarId) {
      params.append('calendarId', calendarId);
    }

    // Filter by active events only
    params.append('status', 'active');

    console.log("Unified search params:", params.toString());
    console.log("Display timezone:", timezone);

    // Make the API request to unified search endpoint
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/cache/events?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log("Unified search response:", data);

    // Get results from unified search
    let results = data.events || [];
    
    // Debug: Log category data for first few events
    if (results.length > 0) {
      console.log("Category debugging - first 3 events:");
      results.slice(0, 3).forEach((event, index) => {
        console.log(`Event ${index + 1}:`, {
          subject: event.graphData?.subject || event.subject,
          graphCategories: event.graphData?.categories,
          mecCategories: event.internalData?.mecCategories
        });
      });
    }

    // Apply date range filtering (the backend doesn't support this yet)
    if (dateRange.start || dateRange.end) {
      results = results.filter(event => {
        const eventStartTime = new Date(event.graphData?.start?.dateTime || event.startTime);
        const eventEndTime = new Date(event.graphData?.end?.dateTime || event.endTime);
        
        if (dateRange.start && eventStartTime < new Date(dateRange.start)) {
          return false;
        }
        if (dateRange.end && eventEndTime > new Date(dateRange.end)) {
          return false;
        }
        return true;
      });
    }

    // Apply category filtering (Graph categories only)
    if (categories && categories.length > 0) {
      results = results.filter(event => {
        const eventCategories = event.graphData?.categories || [];
        
        // Handle "Uncategorized" special case
        if (categories.includes('Uncategorized')) {
          if (eventCategories.length === 0) {
            return true;
          }
        }
        
        // Check if any of the event's Graph categories match our filter
        return eventCategories.some(cat => categories.includes(cat));
      });
    }

    // Apply location filtering
    if (locations && locations.length > 0) {
      results = results.filter(event => {
        const eventLocation = event.graphData?.location?.displayName || '';
        
        // Check if any of our location filters match
        return locations.some(loc => eventLocation.toLowerCase().includes(loc.toLowerCase()));
      });
    }

    // Convert unified event format to Graph-like format for compatibility
    const convertedResults = results.map(event => ({
      id: event.eventId,
      subject: event.graphData?.subject || event.subject,
      start: {
        dateTime: event.graphData?.start?.dateTime || event.startTime,
        timeZone: event.graphData?.start?.timeZone || timezone
      },
      end: {
        dateTime: event.graphData?.end?.dateTime || event.endTime,
        timeZone: event.graphData?.end?.timeZone || timezone
      },
      location: event.graphData?.location || { displayName: event.location || '' },
      categories: event.graphData?.categories || [],
      bodyPreview: event.graphData?.bodyPreview || '',
      organizer: event.graphData?.organizer || {},
      calendarId: event.calendarId,
      calendarName: event.calendarName,
      // Include internal data for enriched display
      internalData: event.internalData,
      mecCategories: event.internalData?.mecCategories || [],
      setupMinutes: event.internalData?.setupMinutes,
      teardownMinutes: event.internalData?.teardownMinutes,
      assignedTo: event.internalData?.assignedTo,
      estimatedCost: event.internalData?.estimatedCost,
      actualCost: event.internalData?.actualCost
    }));

    return {
      results: convertedResults,
      nextLink: data.hasNextPage ? page + 1 : null,
      totalCount: data.totalCount || convertedResults.length,
      timezone: timezone
    };
  } catch (error) {
    console.error('Error searching unified events:', error);
    throw error;
  }
}

// The internal component that uses the query hooks
function EventSearchInner({ 
  graphToken, 
  apiToken,
  onEventSelect, 
  onClose, 
  outlookCategories, 
  availableLocations, 
  onSaveEvent,
  onViewInCalendar,
  selectedCalendarId,
  availableCalendars
  // REMOVED: userTimeZone, setUserTimeZone, updateUserProfilePreferences
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  
  // Collapsible search form state - show initially, collapse after search
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(true);
  
  // USE TIMEZONE CONTEXT INSTEAD OF PROPS
  const { userTimezone, setUserTimezone } = useTimezone();
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
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
  
  // Create a query key based on search parameters (using shared timezone)
  const searchQueryKey = useMemo(() => 
    ['events', searchTerm, dateRange, selectedCategories, selectedLocations, userTimezone],
    [searchTerm, dateRange, selectedCategories, selectedLocations, userTimezone]
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

        console.log(`Searching in calendar: ${selectedCalendarId || 'default'} with timezone: ${userTimezone}`);

        result = await searchEvents(
          apiToken, 
          searchTerm, 
          dateRange, 
          selectedCategories, 
          selectedLocations,
          1, // Start with page 1
          250, // Limit
          selectedCalendarId,
          userTimezone // Use shared timezone
        );

        // Set the total count if available
        if (result.totalCount !== null) {
          setTotalAvailableEvents(result.totalCount);
          setLoadingStatus(`Found ${result.totalCount} events. Loading first batch...`);
        }
        
        setHasNextPage(result.nextLink !== null);
        setCurrentPage(1); // Reset to page 1 for new search

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
      console.log("Saving event to calendar:", updatedEvent.calendarId || selectedCalendarId);
      return onSaveEvent(updatedEvent);
    },
    onSuccess: () => {
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

  // Load more results function (updated to use page-based pagination)
  const loadMoreResults = useCallback(async () => {
    if (!hasNextPage || isLoadingMore || loadingThrottleRef.current) return;
    
    loadingThrottleRef.current = true;
    setTimeout(() => { loadingThrottleRef.current = false; }, 300);
    
    setIsLoadingMore(true);
    
    try {
      if (totalAvailableEvents) {
        setLoadingStatus(`Loading more... (${searchResults.length} of ${totalAvailableEvents})`);
      } else {
        setLoadingStatus('Loading more events...');
      }
      
      const nextPage = currentPage + 1;
      const result = await searchEvents(
        apiToken, 
        searchTerm, 
        dateRange, 
        selectedCategories, 
        selectedLocations, 
        nextPage,
        250, // Limit
        selectedCalendarId,
        userTimezone // Use shared timezone
      );
      
      setHasNextPage(result.nextLink !== null);
      setCurrentPage(nextPage);
      
      // Append new results to existing ones
      queryClient.setQueryData(searchQueryKey, oldData => {
        const oldDataArray = oldData || [];
        const combinedResults = [...oldDataArray, ...result.results];
        
        const sortedResults = combinedResults.sort((a, b) => {
          const aStartTime = new Date(a.start.dateTime);
          const bStartTime = new Date(b.start.dateTime);
          return bStartTime - aStartTime;
        });
        
        if (totalAvailableEvents) {
          const percentLoaded = Math.round((sortedResults.length / totalAvailableEvents) * 100);
          setLoadingStatus(`Loaded ${sortedResults.length} of ${totalAvailableEvents} events (${percentLoaded}%)`);
        } else {
          setLoadingStatus(`Loaded ${sortedResults.length} events`);
        }
        
        return sortedResults;
      });
      
      if (!result.nextLink) {
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
    hasNextPage, 
    isLoadingMore, 
    searchResults.length, 
    totalAvailableEvents, 
    apiToken, 
    searchTerm, 
    dateRange, 
    selectedCalendarId,
    selectedCategories, 
    selectedLocations, 
    userTimezone, 
    searchQueryKey,
    queryClient,
    currentPage
  ]);

  const scheduleNextBatch = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    const baseDelay = 300;
    const currentResultsSize = (searchData || []).length;
    let dynamicDelay = baseDelay;
    
    if (currentResultsSize > 200) {
      dynamicDelay += Math.min(currentResultsSize / 10, 700);
    }
    
    loadingTimeoutRef.current = setTimeout(() => {
      if (autoLoadMore && hasNextPage && !isLoadingMore && !isLoading && !isFetching) {
        loadMoreResults();
      }
    }, dynamicDelay);
  }, [autoLoadMore, hasNextPage, isLoadingMore, isLoading, isFetching, searchData, loadMoreResults]);
  
  // Handle search execution
  const handleSearch = () => {
    if (!searchTerm && !dateRange.start && !dateRange.end && 
        !selectedCategories.length && !selectedLocations.length) {
      setSearchError('Please enter a search term or select search criteria');
      return;
    }
    
    setSearchError(null);
    setShouldRunSearch(true);
    // Collapse filters after initiating search
    setShowAdvancedOptions(false);
    refetch();
  };

  // Handle timezone change - now uses context
  const handleTimezoneChange = (newTimezone) => {
    setUserTimezone(newTimezone);
    // Context automatically handles API persistence
    
    // If there are existing search results, trigger a new search with the new timezone
    if (searchResults.length > 0) {
      setShouldRunSearch(true);
      setTimeout(() => refetch(), 100);
    }
  };

  useEffect(() => {
    if (autoLoadMore && hasNextPage && !isLoadingMore && !isLoading && !isFetching) {
      scheduleNextBatch();
    }
    
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [hasNextPage, isLoadingMore, autoLoadMore, isLoading, isFetching, scheduleNextBatch]);

  useEffect(() => {
    return () => {
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
  
  // Updated result item renderer with timezone formatting
  const ResultItem = useCallback((event, index) => {
    return (
      <li 
        key={event.id} 
        className={`result-item ${selectedEvent?.id === event.id ? 'selected' : ''}`}
        onClick={() => handleSelectEvent(event)}
      >
        <div className="result-title">{event.subject}</div>
        <div className="result-date">
          {formatDateTimeWithTimezone(event.start.dateTime, userTimezone)}
        </div>
        
        {/* Duration info */}
        <div className="result-duration">
          Duration: {formatDateTimeWithTimezone(event.start.dateTime, userTimezone)} - {formatDateTimeWithTimezone(event.end.dateTime, userTimezone)}
        </div>
        
        {/* Location tag(s) */}
        {event.location?.displayName && (
          <div className="result-tags">
            <span 
              className="location-tag"
              title={event.location.displayName} // Shows full URL on hover
            >
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
  }, [selectedEvent, userTimezone]);
  
  return (
    <div className="event-search-container">
      <div className="search-header">
        <h2>Search Calendar Events</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      {/* Add calendar and timezone indicators */}
      <div className="search-context-indicators">
        {selectedCalendarId && availableCalendars && (
          <div className="current-calendar-indicator">
            Searching in: {availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || 'Selected Calendar'}
          </div>
        )}
        
        <div className="timezone-indicator">
          Results shown in: {AVAILABLE_TIMEZONES.find(tz => tz.value === userTimezone)?.label || userTimezone}
        </div>
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
          <button 
            className="search-button" 
            onClick={handleSearch} 
            disabled={isLoading || isFetching}
          >
            {(isLoading || isFetching) ? 'Searching...' : 'Search'}
          </button>
          <button 
            className="advanced-toggle-button" 
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            type="button"
          >
            {showAdvancedOptions ? 'Hide Filters' : 'Show Filters'} {showAdvancedOptions ? '▲' : '▼'}
          </button>
        </div>
        
        {/* Advanced options - collapsible */}
        {showAdvancedOptions && (
          <div className="advanced-options">
          <div className="advanced-options-row">
            {/* Timezone selector using shared state */}
            <div className="timezone-selector">
              <div className="form-group">
                <label>Timezone:</label>
                <select
                  value={userTimezone}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  className="timezone-select"
                >
                  {AVAILABLE_TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
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
                  customHeight="36px"
                  customPadding="8px 10px"
                />
              </div>
              
              {/* Location filter */}
              <div className="filter-section">
                <label>Locations:</label>
                <MultiSelect 
                  options={availableLocations}
                  selected={selectedLocations}
                  onChange={handleLocationChange}
                  customHeight="36px"
                  customPadding="8px 10px"
                />
              </div>
            </div>
          </div>
        </div>
        )}
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
          {/* Export button - pass shared timezone to export component */}
          {searchResults.length > 0 && (
            <EventSearchExport
              searchResults={searchResults}
              searchTerm={searchTerm}
              categories={selectedCategories}
              locations={selectedLocations}
              apiToken={graphToken}
              dateRange={dateRange}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
              graphToken={graphToken}
              selectedCalendarId={selectedCalendarId}
              timezone={userTimezone} // Pass shared timezone to export
            />
          )}
        </div>
      </div>

      {/* Loading progress bar */}
      {totalAvailableEvents > 0 && (
        <div className="loading-progress-container">
          <div 
            className="loading-progress-bar"
            style={{
              width: `${Math.min((searchResults.length / totalAvailableEvents) * 100, 100)}%`,
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
                {hasNextPage && (
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
                {hasNextPage && (
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
              !isLoading ? (
                <div className="no-results">No events found matching your search criteria</div>
              ) : (
                <div className="no-results">Enter search criteria and click "Search" to find events</div>
              )
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
              
              {/* Pass shared timezone to EventForm for consistent date/time display */}
              <EventForm 
                event={selectedEvent}
                categories={[...new Set(['Uncategorized', ...outlookCategories.map(cat => cat.name)])]}
                availableLocations={availableLocations}
                onSave={handleSaveEvent}
                onCancel={() => setSelectedEvent(null)}
                readOnly={false}
                isLoading={updateEventMutation.isPending}
                userTimeZone={userTimezone} // Pass shared timezone to form
              />
            </div>
          ) : (
            <div className="no-event-selected">
              <div className="no-event-message">
                <p>Select an event from the search results to edit it.</p>
                <p>You can search by text, date range, categories, or locations.</p>
                <p>Times are displayed in: <strong>{AVAILABLE_TIMEZONES.find(tz => tz.value === userTimezone)?.label}</strong></p>
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
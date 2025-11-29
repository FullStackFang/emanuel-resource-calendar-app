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
import EventSearchExport from './EventSearchExport';
import './EventSearch.css';
import APP_CONFIG from '../config/config';
import { useTimezone } from '../context/TimezoneContext';
import {
  AVAILABLE_TIMEZONES,
  formatDateTimeWithTimezone
} from '../utils/timezoneUtils';

// Create a client
const queryClient = new QueryClient();


// Search function implementation using unified backend search (includes CSV events)
async function searchEvents(apiToken, searchTerm = '', dateRange = {}, categories = [], locations = [], page = 1, limit = null, calendarId = null, timezone = 'UTC') {
  try {
    // Build search parameters
    const params = new URLSearchParams({
      page: page.toString(),
      sortBy: 'startTime',
      sortOrder: 'desc'
    });
    
    // Add limit only if specified (no arbitrary limit)
    if (limit) {
      params.append('limit', limit.toString());
    }

    // Add search term if provided
    if (searchTerm) {
      params.append('search', searchTerm);
    }

    // Add calendar filter if provided
    if (calendarId) {
      params.append('calendarId', calendarId);
    }

    // Add category filters
    if (categories && categories.length > 0) {
      params.append('categories', categories.join(','));
    }

    // Add location filters
    if (locations && locations.length > 0) {
      params.append('locations', locations.join(','));
    }

    // Add date range filters
    if (dateRange.start) {
      params.append('startDate', dateRange.start);
    }
    if (dateRange.end) {
      params.append('endDate', dateRange.end);
    }

    // Filter by active events only
    params.append('status', 'active');

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

    // Get results from unified search
    let results = data.events || [];

    // Backend now handles all filtering - no client-side filtering needed!

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
      categories: [...(event.graphData?.categories || []), ...(event.internalData?.mecCategories || [])].filter((cat, index, arr) => arr.indexOf(cat) === index), // Merge and deduplicate categories
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
      actualCost: event.internalData?.actualCost,
      // Additional time and attendee fields - read from TOP LEVEL (canonical location)
      doorOpenTime: event.doorOpenTime || '',
      setupTime: event.setupTime || '',
      teardownTime: event.teardownTime || '',
      startTime: event.startTime || '',
      endTime: event.endTime || '',
      doorCloseTime: event.doorCloseTime || '',
      attendeeCount: event.attendeeCount || event.internalData?.attendeeCount || 0
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
  onClose,
  outlookCategories,
  availableLocations,
  onSaveEvent,
  selectedCalendarId,
  availableCalendars
  // REMOVED: userTimeZone, setUserTimeZone, updateUserProfilePreferences, onViewInCalendar, onEventSelect
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

  // Format recurrence pattern for display
  const formatRecurrencePattern = useCallback((recurrence) => {
    if (!recurrence?.pattern) return null;

    const { type, interval, daysOfWeek } = recurrence.pattern;
    const { range } = recurrence;

    let patternText = '';

    switch (type) {
      case 'daily':
        patternText = interval === 1 ? 'Daily' : `Every ${interval} days`;
        break;
      case 'weekly':
        const days = daysOfWeek?.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
        patternText = interval === 1
          ? `Weekly on ${days}`
          : `Every ${interval} weeks on ${days}`;
        break;
      case 'absoluteMonthly':
      case 'relativeMonthly':
        patternText = interval === 1 ? 'Monthly' : `Every ${interval} months`;
        break;
      case 'absoluteYearly':
      case 'relativeYearly':
        patternText = 'Yearly';
        break;
      default:
        patternText = 'Recurring';
    }

    // Add end info
    if (range?.type === 'endDate' && range.endDate) {
      patternText += ` until ${new Date(range.endDate).toLocaleDateString()}`;
    } else if (range?.type === 'numbered' && range.numberOfOccurrences) {
      patternText += ` (${range.numberOfOccurrences} occurrences)`;
    }

    return patternText;
  }, []);

  // Check if event is recurring
  const isRecurringEvent = useCallback((event) => {
    return event.graphData?.recurrence || event.isRecurringOccurrence || event.recurrence;
  }, []);

  // Format time value - extracts just the time from ISO datetime or returns time string
  const formatTimeValue = useCallback((timeValue) => {
    if (!timeValue || timeValue === '') return '--:--';

    // If it's already in HH:MM format, return as-is
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeValue)) {
      return timeValue.substring(0, 5); // Return HH:MM
    }

    // If it's an ISO datetime string, extract the time and convert to user timezone
    if (timeValue.includes('T') || timeValue.includes('-')) {
      try {
        const date = new Date(timeValue);
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: userTimezone
          });
        }
      } catch {
        // Fall through to return as-is
      }
    }

    return timeValue;
  }, [userTimezone]);

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

        result = await searchEvents(
          apiToken, 
          searchTerm, 
          dateRange, 
          selectedCategories, 
          selectedLocations,
          1, // Start with page 1
          null, // No limit - let backend return all matching results
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

        // Sort results by start date (most recent first)
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
    enabled: shouldRunSearch && !!apiToken,
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
      // Don't immediately set shouldRunSearch to false - let the query stay enabled
      // setShouldRunSearch(false);
      // Don't clear loading status immediately to maintain smooth transitions
      if (!autoLoadMore && !nextLink) {
        setTimeout(() => setLoadingStatus(''), 2000);
      }
    },
  });
  
  // Setup mutation for updating events
  const updateEventMutation = useMutation({
    mutationFn: (updatedEvent) => {
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
        null, // No limit - let backend return all matching results
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
          return bStartTime - aStartTime; // Descending: most recent first
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
    // Clear previously selected event when starting new search
    setSelectedEvent(null);
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

      
      {/* Full-width search form */}
      <div className="search-form-full">
        <div className="search-input-container">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch();
              }
            }}
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
        
        {/* Right column - Event details (read-only) */}
        <div className="event-edit-column">
          {selectedEvent ? (
            <div className="event-detail-card">
              {/* Header with title and recurrence badge */}
              <div className="detail-card-header">
                <h3 className="detail-card-title">{selectedEvent.subject || selectedEvent.eventTitle || 'Untitled Event'}</h3>
                {isRecurringEvent(selectedEvent) && (
                  <span className="recurrence-badge">🔁 Recurring</span>
                )}
              </div>

              <div className="detail-card-body">
                {/* Date & Time */}
                <div className="detail-row">
                  <span className="detail-icon">📅</span>
                  <div className="detail-content">
                    <div className="detail-value">
                      {selectedEvent.start?.dateTime
                        ? new Date(selectedEvent.start.dateTime).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            timeZone: userTimezone
                          })
                        : 'No date'}
                    </div>
                    <div className="detail-secondary">
                      {selectedEvent.start?.dateTime && selectedEvent.end?.dateTime
                        ? `${new Date(selectedEvent.start.dateTime).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: userTimezone
                          })} - ${new Date(selectedEvent.end.dateTime).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: userTimezone
                          })}`
                        : 'No time'}
                    </div>
                  </div>
                </div>

                {/* Recurrence Pattern (if recurring) */}
                {isRecurringEvent(selectedEvent) && (
                  <div className="detail-row">
                    <span className="detail-icon">🔁</span>
                    <span className="detail-value">
                      {formatRecurrencePattern(selectedEvent.graphData?.recurrence || selectedEvent.recurrence) || 'Recurring event'}
                    </span>
                  </div>
                )}

                {/* Location */}
                <div className="detail-row">
                  <span className="detail-icon">📍</span>
                  <span className="detail-value">
                    {selectedEvent.location?.displayName || 'No location specified'}
                  </span>
                </div>

                {/* Organizer */}
                {selectedEvent.organizer?.emailAddress && (
                  <div className="detail-row">
                    <span className="detail-icon">👤</span>
                    <span className="detail-value">
                      {selectedEvent.organizer.emailAddress.name || selectedEvent.organizer.emailAddress.address}
                    </span>
                  </div>
                )}

                {/* Expected Attendees */}
                {selectedEvent.attendeeCount > 0 && (
                  <div className="detail-row">
                    <span className="detail-icon">👥</span>
                    <span className="detail-value">Expected: {selectedEvent.attendeeCount} attendees</span>
                  </div>
                )}

                {/* Categories */}
                <div className="detail-row">
                  <span className="detail-icon">🏷️</span>
                  <div className="detail-tags">
                    {selectedEvent.categories && selectedEvent.categories.length > 0 ? (
                      selectedEvent.categories.map((cat, index) => (
                        <span key={index} className="category-tag">{cat}</span>
                      ))
                    ) : (
                      <span className="category-tag uncategorized">Uncategorized</span>
                    )}
                  </div>
                </div>

                {/* Description */}
                {(selectedEvent.bodyPreview || selectedEvent.internalData?.description) && (
                  <div className="detail-row detail-row-description">
                    <span className="detail-icon">📝</span>
                    <div className="detail-description">
                      {selectedEvent.bodyPreview || selectedEvent.internalData?.description}
                    </div>
                  </div>
                )}

                {/* Time Schedule Grid - 2 rows x 3 columns, earliest to latest */}
                <div className="detail-time-grid-section">
                  <div className="detail-section-header">
                    <span className="detail-icon">🕐</span>
                    <span className="detail-section-title">Time Schedule</span>
                  </div>
                  <div className="detail-time-grid">
                    {/* Row 1: Setup Start, Doors Open, Event Start */}
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Setup Start</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.setupTime)}</span>
                    </div>
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Doors Open</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.doorOpenTime)}</span>
                    </div>
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Event Start</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.startTime)}</span>
                    </div>
                    {/* Row 2: Event End, Doors Close, Teardown End */}
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Event End</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.endTime)}</span>
                    </div>
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Doors Close</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.doorCloseTime)}</span>
                    </div>
                    <div className="time-grid-cell">
                      <span className="time-grid-label">Teardown End</span>
                      <span className="time-grid-value">{formatTimeValue(selectedEvent.teardownTime)}</span>
                    </div>
                  </div>
                </div>

                {/* Setup/Teardown Duration (fallback if no specific times) */}
                {!(selectedEvent.setupTime || selectedEvent.doorOpenTime || selectedEvent.teardownTime) &&
                 (selectedEvent.setupMinutes > 0 || selectedEvent.teardownMinutes > 0) && (
                  <div className="detail-row">
                    <span className="detail-icon">⏱️</span>
                    <span className="detail-value">
                      {selectedEvent.setupMinutes > 0 && `Setup: ${selectedEvent.setupMinutes}min`}
                      {selectedEvent.setupMinutes > 0 && selectedEvent.teardownMinutes > 0 && ' | '}
                      {selectedEvent.teardownMinutes > 0 && `Teardown: ${selectedEvent.teardownMinutes}min`}
                    </span>
                  </div>
                )}

                {/* Cost Information */}
                {(selectedEvent.estimatedCost || selectedEvent.actualCost) && (
                  <div className="detail-row">
                    <span className="detail-icon">💰</span>
                    <span className="detail-value">
                      {selectedEvent.estimatedCost && `Est: $${selectedEvent.estimatedCost}`}
                      {selectedEvent.estimatedCost && selectedEvent.actualCost && ' | '}
                      {selectedEvent.actualCost && `Actual: $${selectedEvent.actualCost}`}
                    </span>
                  </div>
                )}

                {/* Assigned To */}
                {selectedEvent.assignedTo && (
                  <div className="detail-row">
                    <span className="detail-icon">👥</span>
                    <span className="detail-value">Assigned to: {selectedEvent.assignedTo}</span>
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="no-event-selected">
              <div className="no-event-message">
                <p>Select an event from the search results to view details.</p>
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
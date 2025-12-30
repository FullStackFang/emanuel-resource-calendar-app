// src/components/EventSearch.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';
import { logger } from '../utils/logger';
import MultiSelect from './MultiSelect';
import EventSearchExport from './EventSearchExport';
import CalendarSelector from './CalendarSelector';
import './EventSearch.css';
import APP_CONFIG from '../config/config';
import { useTimezone } from '../context/TimezoneContext';
import {
  AVAILABLE_TIMEZONES,
  getOutlookTimezone,
  formatDateTimeWithTimezone,
  formatEventTime
} from '../utils/timezoneUtils';

// Create a client
const queryClient = new QueryClient();

// Helper function to format time values as "9:30 AM" or show placeholder
const formatTimeOrPlaceholder = (timeValue, timezone = 'America/New_York') => {
  // If empty string, null, undefined, or "0", show placeholder
  if (!timeValue || timeValue === '' || timeValue === '0') {
    return '--:--:--';
  }

  // If it's an ISO timestamp, use toLocaleString with timezone for proper conversion
  if (timeValue.includes('T')) {
    const date = new Date(timeValue);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // Parse HH:MM format and convert to 12-hour AM/PM
  const [hours, minutes] = timeValue.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
};


// Search function implementation using unified backend search (includes CSV events)
async function searchEvents(apiToken, searchTerm = '', dateRange = {}, categories = [], locations = [], page = 1, limit = null, calendarOwner = null, timezone = 'UTC') {
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

    // Add calendar owner filter if provided (email address)
    if (calendarOwner) {
      params.append('calendarOwner', calendarOwner);
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

    logger.debug("=== EventSearch Debug ===");
    logger.debug("Search parameters sent to backend:", {
      searchTerm,
      dateRange,
      categories,
      locations,
      page,
      limit,
      calendarOwner,
      timezone
    });
    logger.debug("Unified search params:", params.toString());
    logger.debug("Display timezone:", timezone);

    // Make the API request to unified search endpoint
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/unified/events?${params.toString()}`, {
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
    logger.debug("Unified search response:", data);
    logger.debug("Backend filters applied:", data.filters);
    logger.debug("Result summary:", {
      totalCount: data.pagination?.totalCount,
      returnedCount: data.events?.length,
      totalPages: data.pagination?.totalPages,
      currentPage: data.pagination?.page
    });

    // Get results from unified search
    let results = data.events || [];
    
    // Debug: Log category data for first few events
    if (results.length > 0) {
      logger.debug("Category debugging - first 3 events:");
      results.slice(0, 3).forEach((event, index) => {
        logger.debug(`Event ${index + 1}:`, {
          subject: event.graphData?.subject || event.subject,
          graphCategories: event.graphData?.categories,
          mecCategories: event.internalData?.mecCategories
        });
      });
    }

    // Backend now handles all filtering - no client-side filtering needed!

    // Helper to check if a string is a valid ISO datetime (not just time)
    const isValidISODateTime = (str) => {
      if (!str) return false;
      // Must contain a date component (YYYY-MM-DD) to be valid
      return /^\d{4}-\d{2}-\d{2}/.test(str);
    };

    // Helper to build valid datetime string
    const buildDateTime = (isoDateTime, graphDateTime, dateStr, timeStr) => {
      // First priority: top-level ISO datetime (startDateTime/endDateTime)
      if (isoDateTime && isValidISODateTime(isoDateTime)) return isoDateTime;
      // Second priority: full ISO datetime from Graph API (must be valid ISO, not just time)
      if (graphDateTime && isValidISODateTime(graphDateTime)) return graphDateTime;
      // Third priority: combine date + time
      if (dateStr && timeStr) return `${dateStr}T${timeStr}`;
      // Fourth priority: combine date with graphDateTime if it's just a time
      if (dateStr && graphDateTime && !isValidISODateTime(graphDateTime)) {
        return `${dateStr}T${graphDateTime}`;
      }
      // Fifth priority: if we only have a date, use midnight
      if (dateStr) return `${dateStr}T00:00:00`;
      // If we only have time (no date), this is invalid for datetime parsing
      // Return null and let the display component handle it
      return null;
    };

    // Convert unified event format to Graph-like format for compatibility
    const convertedResults = results.map(event => ({
      id: event.eventId,
      subject: event.eventTitle || event.subject || event.graphData?.subject,
      start: {
        dateTime: buildDateTime(
          event.startDateTime,
          event.graphData?.start?.dateTime,
          event.startDate,
          event.startTime
        ),
        timeZone: event.startTimeZone || event.graphData?.start?.timeZone || timezone
      },
      end: {
        dateTime: buildDateTime(
          event.endDateTime,
          event.graphData?.end?.dateTime,
          event.endDate || event.startDate, // Use endDate if available, fall back to startDate
          event.endTime
        ),
        timeZone: event.endTimeZone || event.graphData?.end?.timeZone || timezone
      },
      // Location - prefer top-level fields
      location: event.graphData?.location || {
        displayName: event.locationDisplayName || event.location || event.locationDisplayNames || ''
      },
      // Categories - merge top-level, graphData, and internal categories
      categories: [
        ...(event.categories || []),
        ...(event.graphData?.categories || []),
        ...(event.internalData?.mecCategories || [])
      ].filter((cat, index, arr) => arr.indexOf(cat) === index), // Deduplicate
      bodyPreview: event.eventDescription || event.graphData?.bodyPreview || '',
      organizer: event.graphData?.organizer || {},
      calendarId: event.calendarId,
      calendarName: event.calendarName,
      // Include internal data for enriched display
      internalData: event.internalData,
      mecCategories: event.internalData?.mecCategories || [],
      setupMinutes: event.setupMinutes || event.internalData?.setupMinutes,
      teardownMinutes: event.teardownMinutes || event.internalData?.teardownMinutes,
      assignedTo: event.internalData?.assignedTo,
      estimatedCost: event.internalData?.estimatedCost,
      actualCost: event.internalData?.actualCost,
      // Top-level time fields from unified events collection
      startDate: event.startDate,
      startTime: event.startTime,
      endDate: event.endDate,
      endTime: event.endTime,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      setupTime: event.setupTime,
      teardownTime: event.teardownTime,
      doorOpenTime: event.doorOpenTime,
      doorCloseTime: event.doorCloseTime,
      eventDescription: event.eventDescription,
      eventTitle: event.eventTitle,
      locationDisplayName: event.locationDisplayName,
      locationDisplayNames: event.locationDisplayNames,
      locations: event.locations,
      locationCodes: event.locationCodes,
      isAllDayEvent: event.isAllDayEvent
    }));

    return {
      results: convertedResults,
      nextLink: data.hasNextPage ? page + 1 : null,
      totalCount: data.totalCount || convertedResults.length,
      totalCapped: data.totalCapped || false, // True if count exceeds 5000
      timezone: timezone
    };
  } catch (error) {
    logger.error('Error searching unified events:', error);
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

  // Local calendar state for search - allows changing calendar without affecting main calendar
  const [searchCalendarId, setSearchCalendarId] = useState(selectedCalendarId);

  // Collapsible search form state - show initially, collapse after search
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(true);
  
  // USE TIMEZONE CONTEXT INSTEAD OF PROPS
  const { userTimezone, setUserTimezone } = useTimezone();
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [autoLoadMore, setAutoLoadMore] = useState(false); // Disabled - user must click Load More
  const [loadingStatus, setLoadingStatus] = useState('');
  const [totalAvailableEvents, setTotalAvailableEvents] = useState(null);
  const loadingTimeoutRef = useRef(null);
  const loadingThrottleRef = useRef(false);

  // Selected event state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [searchError, setSearchError] = useState(null);
  
  // Flag to control when to run the search query
  const [shouldRunSearch, setShouldRunSearch] = useState(false);

  // Search version - only increments when Search button is clicked (prevents auto-search on typing)
  const [searchVersion, setSearchVersion] = useState(0);

  // Create a query key based on search parameters (excludes searchTerm to prevent auto-search on typing)
  const searchQueryKey = useMemo(() =>
    ['events', searchVersion, dateRange, selectedCategories, selectedLocations, userTimezone],
    [searchVersion, dateRange, selectedCategories, selectedLocations, userTimezone]
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

        // Look up the calendar owner email from availableCalendars
        // The dropdown uses calendar.id (Graph calendarId) as value
        // We need to find that calendar and get owner.address (email) for backend filtering
        const selectedCalendar = searchCalendarId
          ? availableCalendars?.find(cal => cal.id === searchCalendarId)
          : null;
        const calendarOwnerEmail = selectedCalendar?.owner?.address?.toLowerCase() || null;

        logger.debug(`EventSearch: Looking up calendar by ID: ${searchCalendarId?.substring(0, 30)}...`);
        logger.debug(`EventSearch: Selected calendar:`, selectedCalendar ? {
          name: selectedCalendar.name,
          ownerName: selectedCalendar.owner?.name,
          ownerEmail: selectedCalendar.owner?.address
        } : 'none');
        logger.debug(`EventSearch: Filtering by calendarOwner: ${calendarOwnerEmail || 'none (searching all calendars)'}`);

        result = await searchEvents(
          apiToken,
          searchTerm,
          dateRange,
          selectedCategories,
          selectedLocations,
          1, // Start with page 1
          100, // Load first 100 results; user clicks Load More for next batch
          calendarOwnerEmail, // Pass calendar owner email instead of calendarId
          userTimezone // Use shared timezone
        );

        // Set the total count if available
        if (result.totalCount !== null) {
          setTotalAvailableEvents(result.totalCount);
          const countDisplay = result.totalCapped ? `${result.totalCount}+` : result.totalCount;
          setLoadingStatus(`Found ${countDisplay} events. Showing first ${Math.min(result.results.length, 100)}.`);
        }
        
        setHasNextPage(result.nextLink !== null);
        setCurrentPage(1); // Reset to page 1 for new search

        // Sort results by start date (latest first)
        const sortedResults = [...result.results].sort((a, b) => {
          const aStartTime = new Date(a.start.dateTime);
          const bStartTime = new Date(b.start.dateTime);

          // For descending order: latest first (b - a)
          return bStartTime - aStartTime;
        });
        
        logger.debug("Query function returning:", {
          resultsCount: sortedResults.length,
          sampleTitles: sortedResults.slice(0, 3).map(r => r.subject)
        });
        
        return sortedResults;
      } finally {
        if (!autoLoadMore) {
          setLoadingStatus('');
        }
      }
    },
    enabled: shouldRunSearch && !!apiToken,
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
      // Reset search flag after successful search to prevent re-fetching on every keystroke
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
      logger.debug("Saving event to calendar:", updatedEvent.calendarId || searchCalendarId);
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
  
  logger.debug("React Query Result:", {
    searchData: searchData,
    searchResultsLength: searchResults.length,
    isLoading,
    isFetching,
    shouldRunSearch
  });

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
      // Look up the calendar owner email from availableCalendars
      const selectedCalendar = searchCalendarId
        ? availableCalendars?.find(cal => cal.id === searchCalendarId)
        : null;
      const calendarOwnerEmail = selectedCalendar?.owner?.address?.toLowerCase() || null;

      const result = await searchEvents(
        apiToken,
        searchTerm,
        dateRange,
        selectedCategories,
        selectedLocations,
        nextPage,
        100, // Load 100 at a time for pagination
        calendarOwnerEmail, // Pass calendar owner email instead of calendarId
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
      logger.error('Error loading more results:', error);
      
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
    searchCalendarId,
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
  
  // Handle search execution - only triggered by button click
  const handleSearch = () => {
    // Require at least one filter
    if (!searchTerm && !dateRange.start && !dateRange.end &&
        !selectedCategories.length && !selectedLocations.length) {
      setSearchError('Please enter a search term or select search criteria');
      return;
    }

    // Require minimum 2 characters for search term if no other filters
    const hasOtherFilters = dateRange.start || dateRange.end ||
                           selectedCategories.length > 0 || selectedLocations.length > 0;
    if (searchTerm && searchTerm.trim().length < 2 && !hasOtherFilters) {
      setSearchError('Search term must be at least 2 characters, or add a date range/category/location filter');
      return;
    }

    setSearchError(null);
    setSearchVersion(v => v + 1);  // Increment version to trigger new query
    setShouldRunSearch(true);
    // Collapse filters after initiating search
    setShowAdvancedOptions(false);
  };

  // Handle timezone change - now uses context
  const handleTimezoneChange = (newTimezone) => {
    setUserTimezone(newTimezone);
    // Context automatically handles API persistence

    // If there are existing search results, trigger a new search with the new timezone
    // Timezone is in query key, so incrementing version will refresh with new timezone
    if (searchResults.length > 0) {
      setSearchVersion(v => v + 1);
      setShouldRunSearch(true);
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
      calendarId: searchCalendarId || event.calendarId,
      calendarName: searchCalendarId
        ? availableCalendars?.find(cal => cal.id === searchCalendarId)?.name
        : event.calendarName
    };

    setSelectedEvent(eventWithCalendar);
  };

  // Handle saving the event
  const handleSaveEvent = (updatedEvent) => {
    const eventToUpdate = {
      ...updatedEvent,
      calendarId: searchCalendarId || updatedEvent.calendarId
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
          {event.start?.dateTime
            ? formatDateTimeWithTimezone(event.start.dateTime, userTimezone)
            : (event.startDate || event.startTime || 'No date')}
        </div>

        {/* Duration info */}
        <div className="result-duration">
          {event.start?.dateTime && event.end?.dateTime ? (
            <>Duration: {formatDateTimeWithTimezone(event.start.dateTime, userTimezone)} - {formatDateTimeWithTimezone(event.end.dateTime, userTimezone)}</>
          ) : (
            event.startTime && event.endTime
              ? `Time: ${event.startTime} - ${event.endTime}`
              : null
          )}
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

      {/* Add calendar selector and timezone indicators */}
      <div className="search-context-indicators">
        {availableCalendars && availableCalendars.length > 0 && (
          <div className="search-calendar-selector">
            <label>Search in calendar:</label>
            <CalendarSelector
              selectedCalendarId={searchCalendarId}
              availableCalendars={availableCalendars}
              onCalendarChange={(calendarId) => {
                setSearchCalendarId(calendarId);
                // Clear previous results when calendar changes
                setShouldRunSearch(false);
              }}
              changingCalendar={false}
            />
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
              apiToken={apiToken}
              dateRange={dateRange}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
              graphToken={graphToken}
              selectedCalendarId={searchCalendarId}
              calendarOwner={availableCalendars?.find(cal => cal.id === searchCalendarId)?.owner?.address?.toLowerCase() || null}
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
        
        {/* Right column - Event Summary (Read-Only) */}
        <div className="event-edit-column">
          {selectedEvent ? (
            <div className="event-detail-panel">
              <div className="detail-header">
                <h3>Event Summary</h3>
                <div className="detail-actions">
                  <button
                    className="view-in-calendar-button"
                    onClick={() => {
                      onClose();
                      onViewInCalendar(selectedEvent, 'week', searchCalendarId);
                    }}
                  >
                    📅 Week
                  </button>
                  <button
                    className="view-in-calendar-button"
                    onClick={() => {
                      onClose();
                      onViewInCalendar(selectedEvent, 'day', searchCalendarId);
                    }}
                  >
                    📅 Day
                  </button>
                </div>
              </div>

              {/* Read-only summary */}
              <div className="event-summary-readonly">
                {/* Title */}
                <div className="summary-row">
                  <div className="form-icon">📌</div>
                  <div className="summary-value title">{selectedEvent.subject}</div>
                </div>

                {/* Date */}
                <div className="summary-row">
                  <div className="form-icon">📅</div>
                  <div className="summary-value">
                    {selectedEvent.startDate ||
                     (selectedEvent.start?.dateTime
                       ? new Date(selectedEvent.start.dateTime).toLocaleDateString('en-US', {
                           year: 'numeric',
                           month: 'short',
                           day: 'numeric'
                         })
                       : '--')}
                  </div>
                </div>

                {/* Category */}
                <div className="summary-row">
                  <div className="form-icon">🏷️</div>
                  <div className="summary-value">
                    {(selectedEvent.categories?.length > 0 ? selectedEvent.categories.join(', ') : null) ||
                     (selectedEvent.mecCategories?.length > 0 ? selectedEvent.mecCategories.join(', ') : null) ||
                     'Uncategorized'}
                  </div>
                </div>

                {/* Time Grid - 2 rows x 3 columns */}
                <div className="summary-row">
                  <div className="form-icon">🕒</div>
                  <div className="summary-time-grid">
                    {/* Row 1: Setup Time | Door Open | Event Start */}
                    <div className="time-cell">
                      <span className="time-label">Setup Time</span>
                      <span className={`time-value ${!selectedEvent.setupTime ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.setupTime)}
                      </span>
                    </div>
                    <div className="time-cell">
                      <span className="time-label">Door Open</span>
                      <span className={`time-value ${!selectedEvent.doorOpenTime ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.doorOpenTime)}
                      </span>
                    </div>
                    <div className="time-cell">
                      <span className="time-label">Event Start</span>
                      <span className="time-value">
                        {formatEventTime(selectedEvent.start?.dateTime, userTimezone, selectedEvent.subject, selectedEvent.start?.timeZone || selectedEvent.graphData?.start?.timeZone)}
                      </span>
                    </div>
                    {/* Row 2: Event End | Door Close | Teardown */}
                    <div className="time-cell">
                      <span className="time-label">Event End</span>
                      <span className="time-value">
                        {formatEventTime(selectedEvent.end?.dateTime, userTimezone, selectedEvent.subject, selectedEvent.end?.timeZone || selectedEvent.graphData?.end?.timeZone)}
                      </span>
                    </div>
                    <div className="time-cell">
                      <span className="time-label">Door Close</span>
                      <span className={`time-value ${!selectedEvent.doorCloseTime ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.doorCloseTime)}
                      </span>
                    </div>
                    <div className="time-cell">
                      <span className="time-label">Teardown</span>
                      <span className={`time-value ${!selectedEvent.teardownTime ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.teardownTime)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Location */}
                <div className="summary-row">
                  <div className="form-icon">📍</div>
                  <div className="summary-value">
                    {selectedEvent.locationDisplayNames || selectedEvent.location?.displayName || '--'}
                  </div>
                </div>

                {/* Description */}
                <div className="summary-row">
                  <div className="form-icon">📝</div>
                  <div className="summary-value description">
                    {selectedEvent.eventDescription || selectedEvent.bodyPreview || '--'}
                  </div>
                </div>
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
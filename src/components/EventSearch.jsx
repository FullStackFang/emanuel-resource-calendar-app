// src/components/EventSearch.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DatePickerInput from './DatePickerInput';
import {
  useQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';
import { logger } from '../utils/logger';
import { keys } from '../queries/keys';
import MultiSelect from './MultiSelect';
import EventSearchExport from './EventSearchExport';
import { selectedNamesToCategoryIds } from '../utils/categoryFilterUtils';
import { deriveListLoadingState } from '../utils/listLoadingState';
import CalendarSelector from './CalendarSelector';
import LoadingSpinner from './shared/LoadingSpinner';
import './EventSearch.css';
import APP_CONFIG from '../config/config';
import { useTimezone } from '../context/TimezoneContext';
import { useDistinctEventCategoriesQuery } from '../hooks/useCategoriesQuery';
import {
  AVAILABLE_TIMEZONES,
  getOutlookTimezone,
  formatDateTimeWithTimezone,
  formatEventTime
} from '../utils/timezoneUtils';

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
async function searchEvents(apiToken, searchTerm = '', dateRange = {}, categories = [], locations = [], page = 1, limit = null, calendarOwner = null, timezone = 'UTC', { allCategoryCount = 0, allLocationCount = 0, categoryIds = [] } = {}) {
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

    // Add category filters (with count for backend all-selected detection)
    if (categories && categories.length > 0) {
      params.append('categories', categories.join(','));
      if (allCategoryCount > 0) {
        params.append('categoryCount', allCategoryCount.toString());
      }
    }

    // Add resolved categoryIds (ObjectId strings) alongside name-based filter
    if (categoryIds && categoryIds.length > 0) {
      params.append('categoryIds', categoryIds.join(','));
    }

    // Add location filters (with count for backend all-selected detection)
    if (locations && locations.length > 0) {
      params.append('locations', locations.join(','));
      if (allLocationCount > 0) {
        params.append('locationCount', allLocationCount.toString());
      }
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
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=search&${params.toString()}`, {
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
          subject: event.calendarData?.eventTitle || event.eventTitle || event.subject,
          calendarDataCategories: event.calendarData?.categories
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
    // Prioritize calendarData (authoritative) over top-level fields and graphData (legacy)
    const convertedResults = results.map(event => ({
      _id: event._id,
      id: event.eventId,
      subject: event.calendarData?.eventTitle || event.eventTitle || event.subject || event.graphData?.subject,
      start: {
        dateTime: buildDateTime(
          event.calendarData?.startDateTime || event.startDateTime,
          event.graphData?.start?.dateTime,
          event.calendarData?.startDate || event.startDate,
          event.calendarData?.startTime || event.startTime
        ),
        timeZone: event.startTimeZone || event.graphData?.start?.timeZone || timezone
      },
      end: {
        dateTime: buildDateTime(
          event.calendarData?.endDateTime || event.endDateTime,
          event.graphData?.end?.dateTime,
          event.calendarData?.endDate || event.endDate || event.calendarData?.startDate || event.startDate,
          event.calendarData?.endTime || event.endTime
        ),
        timeZone: event.endTimeZone || event.graphData?.end?.timeZone || timezone
      },
      // Location - prefer calendarData fields
      location: {
        displayName: event.calendarData?.locationDisplayNames || event.locationDisplayName || event.location || event.locationDisplayNames || event.graphData?.location?.displayName || ''
      },
      // Categories - calendarData is the source of truth for what renders on
      // the calendar, so display (and the category filter) key off it alone.
      categories: event.calendarData?.categories || [],
      bodyPreview: event.calendarData?.eventDescription || event.eventDescription || event.graphData?.bodyPreview || '',
      organizer: event.graphData?.organizer || {},
      calendarId: event.calendarId,
      calendarName: event.calendarName,
      mecCategories: event.calendarData?.categories || [],
      setupMinutes: event.calendarData?.setupTimeMinutes || event.setupTimeMinutes || 0,
      teardownMinutes: event.calendarData?.teardownTimeMinutes || event.teardownTimeMinutes || 0,
      reservationStartMinutes: event.calendarData?.reservationStartMinutes || event.reservationStartMinutes || 0,
      reservationEndMinutes: event.calendarData?.reservationEndMinutes || event.reservationEndMinutes || 0,
      assignedTo: event.calendarData?.assignedTo || event.assignedTo || '',
      estimatedCost: event.calendarData?.estimatedCost || event.estimatedCost,
      actualCost: event.calendarData?.actualCost || event.actualCost,
      // Top-level time fields from unified events collection
      startDate: event.startDate,
      startTime: event.startTime,
      endDate: event.endDate,
      endTime: event.endTime,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      setupTime: event.setupTime,
      teardownTime: event.teardownTime,
      reservationStartTime: event.calendarData?.reservationStartTime || event.reservationStartTime || '',
      reservationEndTime: event.calendarData?.reservationEndTime || event.reservationEndTime || '',
      doorOpenTime: event.doorOpenTime,
      doorCloseTime: event.doorCloseTime,
      eventDescription: event.eventDescription,
      eventTitle: event.eventTitle,
      locationDisplayName: event.locationDisplayName,
      locationDisplayNames: event.locationDisplayNames,
      locations: event.locations,
      isAllDayEvent: event.isAllDayEvent
    }));

    return {
      results: convertedResults,
      nextLink: data.pagination?.hasMore ? page + 1 : null,
      totalCount: data.pagination?.totalCount || convertedResults.length,
      totalCapped: false,
      timezone: timezone
    };
  } catch (error) {
    logger.error('Error searching unified events:', error);
    throw error;
  }
}

function EventSearch({
  graphToken,
  apiToken,
  onEventSelect,
  onClose,
  outlookCategories,
  baseCategories = [],
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
  // Per-field required-date cues. Set by handleSearch when a date is missing,
  // cleared the instant the user enters a valid value for that field.
  const [dateErrors, setDateErrors] = useState({ start: false, end: false });

  // Flag to control when to run the search query. Set true only by handleSearch
  // (the Search button); the query's success handler resets it to false. Filter
  // changes never set it, so the search runs exclusively on an explicit click.
  const [shouldRunSearch, setShouldRunSearch] = useState(false);

  // Search version - only increments when Search button is clicked (prevents auto-search on typing)
  const [searchVersion, setSearchVersion] = useState(0);

  // Snapshot of the filters that produced the currently-displayed results.
  // With manual search, the form fields (selectedCategories, dateRange, ...) are
  // a DRAFT until the user clicks Search. The visible results are frozen to the
  // last applied search, so anything that consumes "what was searched" (notably
  // the export) MUST read this snapshot, not the live draft — otherwise the
  // export filters on values the user never searched with (e.g. shows 3 results
  // but exports 0). INVARIANT: every path that bumps searchVersion must also
  // refresh this snapshot (see handleSearch and handleTimezoneChange).
  const [appliedFilters, setAppliedFilters] = useState({
    searchTerm: '',
    categories: [],
    locations: [],
    dateRange: { start: '', end: '' },
    calendarOwner: null,
  });

  // Distinct categories actually present on events (rsched imports carry
  // free-text categories that aren't registered). Unioned with registered
  // categories below so every category in use is selectable.
  const { data: distinctEventCategories = [] } = useDistinctEventCategoriesQuery(apiToken);

  // Compute full category option list for the dropdown AND "all selected"
  // detection. Single source of truth: registered categories first (by
  // displayOrder), then any additional in-use categories (alpha), with
  // 'Uncategorized' pinned at the top. Both the MultiSelect options and the
  // categoryCount sent to the backend read from this list so they stay
  // consistent.
  const allCategoryOptions = useMemo(() => {
    const registered = baseCategories
      .filter(cat => cat.active !== false && cat.name)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(cat => cat.name);
    const registeredSet = new Set(registered);
    const extras = distinctEventCategories
      .filter(name => name && !registeredSet.has(name))
      .sort((a, b) => a.localeCompare(b));
    return ['Uncategorized', ...registered, ...extras];
  }, [baseCategories, distinctEventCategories]);

  const allLocationOptions = useMemo(() => availableLocations || [], [availableLocations]);

  // Query key is keyed SOLELY on searchVersion, which increments only when the
  // user clicks Search (handleSearch) or changes timezone with results present
  // (handleTimezoneChange). Live filter state (dateRange, categories, locations,
  // timezone) is intentionally NOT part of the key: editing a filter must not
  // re-key the query, otherwise the displayed results would swap to an un-fetched
  // key and blank out. The queryFn reads the current filter values at fetch time,
  // so an explicit Search always fetches with the latest selection.
  // Built via the central factory so a cross-cutting `keys.events.all()` invalidation
  // (e.g., from the SSE bridge on server restart) reaches search results too.
  const searchQueryKey = useMemo(() =>
    keys.events.search({ version: searchVersion }),
    [searchVersion]
  );
  
  // Get the query client
  const queryClient = useQueryClient();
  
  // Use Tanstack Query for fetching data
  // queryFn returns { results, totalCount, totalCapped, hasNextPage } — side effects handled in useEffect
  const {
    data: searchData,
    isLoading,
    isPending,
    error,
    refetch,
    isFetching
  } = useQuery({
    queryKey: searchQueryKey,
    queryFn: async () => {
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

      // Normalize: all selected = no filter (avoids expensive $or queries)
      const effectiveCategories = selectedCategories.length >= allCategoryOptions.length
        ? [] : selectedCategories;
      const effectiveLocations = selectedLocations.length >= allLocationOptions.length
        ? [] : selectedLocations;

      const result = await searchEvents(
        apiToken,
        searchTerm,
        dateRange,
        effectiveCategories,
        effectiveLocations,
        1, // Start with page 1
        100, // Load first 100 results; user clicks Load More for next batch
        calendarOwnerEmail, // Pass calendar owner email instead of calendarId
        userTimezone, // Use shared timezone
        { allCategoryCount: allCategoryOptions.length, allLocationCount: allLocationOptions.length, categoryIds: selectedNamesToCategoryIds(effectiveCategories, baseCategories) }
      );

      // Sort results by start date (latest first)
      const sortedResults = [...result.results].sort((a, b) => {
        const aStartTime = new Date(a.start.dateTime);
        const bStartTime = new Date(b.start.dateTime);
        return bStartTime - aStartTime;
      });

      logger.debug("Query function returning:", {
        resultsCount: sortedResults.length,
        sampleTitles: sortedResults.slice(0, 3).map(r => r.subject)
      });

      // Return results with metadata — side effects applied in useEffect below
      return {
        results: sortedResults,
        totalCount: result.totalCount,
        totalCapped: result.totalCapped,
        hasNextPage: result.nextLink !== null
      };
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
  });

  // Whether a user-requested search is in flight. Unlike the list views, this
  // view's `enabled` is a deliberate user action (the Search button), so its
  // idle state is a legitimate "enter criteria" prompt — but once a search IS
  // requested, `isSearching` must stay true through the `pending && idle` tick
  // (after `enabled` flips, before the fetch starts) so we never flash
  // "No events found" before the request lands. deriveListLoadingState() gives
  // us exactly that: enabled (= search requested) AND isPending.
  const { isFirstLoad: isSearching } = deriveListLoadingState(
    { isPending, isFetching },
    { enabled: shouldRunSearch && !!apiToken }
  );

  // Handle query success — replaces deprecated v5 onSuccess callback
  useEffect(() => {
    if (searchData && shouldRunSearch) {
      const { totalCount, totalCapped, hasNextPage: hasMore, results } = searchData;

      if (totalCount !== null && totalCount !== undefined) {
        setTotalAvailableEvents(totalCount);
        const countDisplay = totalCapped ? `${totalCount}+` : totalCount;
        setLoadingStatus(`Found ${countDisplay} events. Showing first ${Math.min(results.length, 100)}.`);
      }

      setHasNextPage(hasMore);
      setCurrentPage(1);
      setShouldRunSearch(false);

      // Clear loading status after a brief display
      if (!autoLoadMore) {
        setTimeout(() => setLoadingStatus(''), 2000);
      }
    }
  }, [searchData, shouldRunSearch, autoLoadMore]);

  // Handle query error — replaces deprecated v5 onError callback
  useEffect(() => {
    if (error) {
      if (error.message && (error.message.includes('token is expired') ||
                             error.message.includes('Lifetime validation failed'))) {
        setSearchError('Your session has expired. Please refresh the page to continue.');
      } else {
        setSearchError(`Search failed: ${error.message}`);
      }
      setLoadingStatus('');
      setShouldRunSearch(false);
    }
  }, [error]);
  
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
  
  // Calculate total results — searchData is now { results, totalCount, ... }
  const searchResults = searchData?.results || [];
  
  logger.debug("React Query Result:", {
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

      // Normalize: all selected = no filter (avoids expensive $or queries)
      const effectiveCategories = selectedCategories.length >= allCategoryOptions.length
        ? [] : selectedCategories;
      const effectiveLocations = selectedLocations.length >= allLocationOptions.length
        ? [] : selectedLocations;

      const result = await searchEvents(
        apiToken,
        searchTerm,
        dateRange,
        effectiveCategories,
        effectiveLocations,
        nextPage,
        100, // Load 100 at a time for pagination
        calendarOwnerEmail, // Pass calendar owner email instead of calendarId
        userTimezone, // Use shared timezone
        { allCategoryCount: allCategoryOptions.length, allLocationCount: allLocationOptions.length, categoryIds: selectedNamesToCategoryIds(effectiveCategories, baseCategories) }
      );
      
      setHasNextPage(result.nextLink !== null);
      setCurrentPage(nextPage);
      
      // Append new results to existing ones
      queryClient.setQueryData(searchQueryKey, oldData => {
        const oldResults = oldData?.results || [];
        const combinedResults = [...oldResults, ...result.results];

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

        return { ...oldData, results: sortedResults };
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
    currentPage,
    allCategoryOptions,
    allLocationOptions,
    baseCategories
  ]);

  const scheduleNextBatch = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    const baseDelay = 300;
    const currentResultsSize = searchResults.length;
    let dynamicDelay = baseDelay;
    
    if (currentResultsSize > 200) {
      dynamicDelay += Math.min(currentResultsSize / 10, 700);
    }
    
    loadingTimeoutRef.current = setTimeout(() => {
      if (autoLoadMore && hasNextPage && !isLoadingMore && !isLoading && !isFetching) {
        loadMoreResults();
      }
    }, dynamicDelay);
  }, [autoLoadMore, hasNextPage, isLoadingMore, isLoading, isFetching, searchResults, loadMoreResults]);
  
  // Snapshot the current (live) filter values as the "applied" set. Called by
  // every path that (re)runs the query, so the displayed results and the export
  // always agree on what was searched. Reads the same calendarOwner resolution
  // the search queryFn uses.
  const captureAppliedFilters = () => ({
    searchTerm,
    categories: selectedCategories,
    locations: selectedLocations,
    dateRange: { ...dateRange },
    calendarOwner:
      availableCalendars?.find(cal => cal.id === searchCalendarId)?.owner?.address?.toLowerCase() || null,
  });

  // Handle search execution - only triggered by button click
  const handleSearch = () => {
    // Both dates are required. Flag the empty field(s) so they get a red cue,
    // and make sure the (possibly collapsed) filters panel is open so the cue
    // is actually visible.
    if (!dateRange.start || !dateRange.end) {
      setDateErrors({ start: !dateRange.start, end: !dateRange.end });
      setShowAdvancedOptions(true);
      setSearchError('A start date and end date are both required');
      return;
    }

    // Require minimum 2 characters for search term
    if (searchTerm && searchTerm.trim().length < 2) {
      setSearchError('Search term must be at least 2 characters');
      return;
    }

    setDateErrors({ start: false, end: false });  // Valid attempt — clear date cues
    setSearchError(null);
    setSelectedEvent(null);  // Clear stale detail panel
    setAppliedFilters(captureAppliedFilters());  // Freeze filters for results + export
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
      // This re-runs the query against the current live filters, so keep the
      // applied snapshot in lock-step (preserves the results↔export invariant).
      setAppliedFilters(captureAppliedFilters());
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

  // Handle category and location selection.
  // Filter changes only update state and the query key; they never run a search.
  // The search executes exclusively when the user clicks Search (handleSearch).
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
        {event.location?.displayName && event.location.displayName !== 'Unspecified' && (
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
        <div className="search-header-left">
          <h2>Search Events</h2>
          {searchResults.length > 0 && (
            <span className="search-header-count">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              {totalAvailableEvents !== null && ` of ${totalAvailableEvents}`}
            </span>
          )}
          {loadingStatus && (
            <span className="search-header-status">{loadingStatus}</span>
          )}
        </div>
        <div className="search-header-right">
          {availableCalendars?.length > 0 && (
            <div className="search-calendar-selector">
              <CalendarSelector
                selectedCalendarId={searchCalendarId}
                availableCalendars={availableCalendars}
                onCalendarChange={(calendarId) => {
                  setSearchCalendarId(calendarId);
                  setShouldRunSearch(false);
                }}
                changingCalendar={false}
              />
            </div>
          )}
          {searchResults.length > 0 && (
            <EventSearchExport
              baseCategories={baseCategories}
              searchResults={searchResults}
              // Export must filter on the APPLIED snapshot (what produced these
              // results), not the live draft fields — otherwise it can export a
              // different set than what is shown. See appliedFilters above.
              searchTerm={appliedFilters.searchTerm}
              categories={appliedFilters.categories}
              locations={appliedFilters.locations}
              apiToken={apiToken}
              dateRange={appliedFilters.dateRange}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
              graphToken={graphToken}
              selectedCalendarId={searchCalendarId}
              calendarOwner={appliedFilters.calendarOwner}
              timezone={userTimezone}
              allCategoryOptions={allCategoryOptions}
              allLocationOptions={allLocationOptions}
            />
          )}
          <button className="close-button" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
            </svg>
          </button>
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
              <div className={`form-group ${dateErrors.start ? 'has-error' : ''}`}>
                <label>From:</label>
                <DatePickerInput
                  value={dateRange.start}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDateRange({...dateRange, start: value});
                    if (value) setDateErrors(prev => (prev.start ? {...prev, start: false} : prev));
                  }}
                  className={dateErrors.start ? 'date-input-error' : ''}
                  aria-invalid={dateErrors.start || undefined}
                />
              </div>
              <div className={`form-group ${dateErrors.end ? 'has-error' : ''}`}>
                <label>To:</label>
                <DatePickerInput
                  value={dateRange.end}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDateRange({...dateRange, end: value});
                    if (value) setDateErrors(prev => (prev.end ? {...prev, end: false} : prev));
                  }}
                  className={dateErrors.end ? 'date-input-error' : ''}
                  aria-invalid={dateErrors.end || undefined}
                />
              </div>
            </div>
            
            <div className="filters-container">
              {/* Category filter - union of registered categories and every
                  category actually in use (see allCategoryOptions). Single
                  source shared with the "all selected" / categoryCount logic. */}
              <div className="filter-section">
                <label>Categories:</label>
                <MultiSelect
                  options={allCategoryOptions}
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
        <div
          className={`search-message ${searchError.type === 'success' ? 'success' : 'error'}`}
          role={searchError.type === 'success' ? undefined : 'alert'}
        >
          {typeof searchError === 'string' ? searchError : searchError.message}
        </div>
      )}
      

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
            {isSearching || isFetching ? (
              <LoadingSpinner variant="card" text="Searching..." />
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
              !isSearching ? (
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
                      onViewInCalendar(selectedEvent, 'week', searchCalendarId, { openModal: true });
                    }}
                  >
                    📅 Week
                  </button>
                  <button
                    className="view-in-calendar-button"
                    onClick={() => {
                      onClose();
                      onViewInCalendar(selectedEvent, 'day', searchCalendarId, { openModal: true });
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
                    {/* Row 1: Reservation Start | Door Open | Event Start */}
                    <div className="time-cell">
                      <span className="time-label">Reservation Start</span>
                      <span className={`time-value ${!(selectedEvent.reservationStartTime || selectedEvent.setupTime) ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.reservationStartTime || selectedEvent.setupTime)}
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
                    {/* Row 2: Event End | Door Close | Reservation End */}
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
                      <span className="time-label">Reservation End</span>
                      <span className={`time-value ${!(selectedEvent.reservationEndTime || selectedEvent.teardownTime) ? 'placeholder' : ''}`}>
                        {formatTimeOrPlaceholder(selectedEvent.reservationEndTime || selectedEvent.teardownTime)}
                      </span>
                    </div>
                    {/* Row 3: Setup Time | Teardown (only if they have values) */}
                    {(selectedEvent.setupTime || selectedEvent.teardownTime) && (selectedEvent.reservationStartTime || selectedEvent.reservationEndTime) && (
                      <>
                        <div className="time-cell">
                          <span className="time-label">Setup Time</span>
                          <span className={`time-value ${!selectedEvent.setupTime ? 'placeholder' : ''}`}>
                            {formatTimeOrPlaceholder(selectedEvent.setupTime)}
                          </span>
                        </div>
                        <div className="time-cell">
                          <span className="time-label">Teardown</span>
                          <span className={`time-value ${!selectedEvent.teardownTime ? 'placeholder' : ''}`}>
                            {formatTimeOrPlaceholder(selectedEvent.teardownTime)}
                          </span>
                        </div>
                        <div className="time-cell" />
                      </>
                    )}
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

export default EventSearch;
  // src/components/Calendar.jsx
  import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
  import { msalConfig } from '../config/authConfig';
  import Modal from './Modal';
  import EventForm from './EventForm';
  import MultiSelect from './MultiSelect';
  import ExportToPdfButton from './CalendarExport';
  import EventSearch from './EventSearch';
  import MonthView from './MonthView';
  import WeekView from './WeekView';
  import DayView from './DayView';
  import RegistrationTimesToggle from './RegistrationTimesToggle';
  import WeekTimelineModal from './WeekTimelineModal';
  import DayTimelineModal from './DayTimelineModal';
  import { logger } from '../utils/logger';
  import calendarDebug from '../utils/calendarDebug';
  import './Calendar.css';
  import APP_CONFIG from '../config/config';
  import './DayEventPanel.css';
  import DayEventPanel from './DayEventPanel';
  import eventDataService from '../services/eventDataService';
  import eventCacheService from '../services/eventCacheService';
  import unifiedEventService from '../services/unifiedEventService';
  import DatePicker from 'react-datepicker';
  import "react-datepicker/dist/react-datepicker.css";
  import calendarDataService from '../services/calendarDataService';
  import { useReviewModal } from '../hooks/useReviewModal';
  import ReviewModal from './shared/ReviewModal';
  import RoomReservationReview from './RoomReservationReview';
    // import { getCalendars } from '../services/graphService';
  import { 
    createLinkedEvents,
    findLinkedEvent,
    updateLinkedEvent,
    deleteLinkedEvent
  } from '../services/graphService';
  import { useTimezone } from '../context/TimezoneContext';
  import { useRooms, useLocations } from '../context/LocationContext';
  import {
    TimezoneSelector,
    formatEventTime,
    formatDateHeader,
    formatDateRangeForAPI,
    calculateEndDate,
    snapToStartOfWeek,
    formatDateObjectForGraph,
    getOutlookTimezone
  } from '../utils/timezoneUtils';
  import CalendarHeader from './CalendarHeader';

  // API endpoint - use the full URL to your API server
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  // const API_BASE_URL = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api'
  // const API_BASE_URL = 'http://localhost:3001/api';

  /*****************************************************************************
   * CONSTANTS AND CONFIGURATION
   *****************************************************************************/
  const categories = [
  ];

  /*****************************************************************************
   * MAIN CALENDAR COMPONENT
   *****************************************************************************/
  function Calendar({ 
    graphToken, 
    apiToken,
    selectedCalendarId,
    setSelectedCalendarId,
    availableCalendars,
    setAvailableCalendars,
    changingCalendar,
    setChangingCalendar,
    showRegistrationTimes: showRegistrationTimesProp
  }) {
    //---------------------------------------------------------------------------
    // STATE MANAGEMENT
    //---------------------------------------------------------------------------
    // Loading state
    const initializationStarted = useRef(false);

    // Demo variables
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [demoData, setDemoData] = useState(null);
    const [isUploadingDemo, setIsUploadingDemo] = useState(false);

    const [initializing, setInitializing] = useState(true);
    const [loading, setLoading] = useState(false);
    const [savingEvent, setSavingEvent] = useState(false);
    const [loadingState, setLoadingState] = useState({
      user: true,
      categories: true,
      extensions: true,
      events: true
    });
    
    // Core calendar data
    const [allEvents, setAllEventsState] = useState([]);
    // Ref to always have access to current allEvents in callbacks (prevents stale closure)
    const allEventsRef = useRef(allEvents);
    const [showSearch, setShowSearch] = useState(false);
    const [outlookCategories, setOutlookCategories] = useState([]);
    const [baseCategories, setBaseCategories] = useState([]); // Base categories from database
    const [schemaExtensions, setSchemaExtensions] = useState([]);

    // Track last summary time to prevent duplicate summaries
    const lastSummaryTimeRef = useRef(0);

    // Safe wrapper for setAllEvents to prevent accidentally clearing events
    const setAllEvents = useCallback((newEvents) => {
      // Validate the new events
      if (!Array.isArray(newEvents)) {
        logger.error('setAllEvents: Invalid input - not an array', { type: typeof newEvents });
        return;
      }
      
      // Setting events

      // High-level summary logging for event state updates (throttled to once per 2 seconds)
      const now = Date.now();
      const timeSinceLastSummary = now - lastSummaryTimeRef.current;

      if (newEvents.length > 0 && timeSinceLastSummary > 2000) {
        lastSummaryTimeRef.current = now;

        // Group events by category
        const categoryCounts = {};
        const locationCounts = {};
        newEvents.forEach(event => {
          const category = event.category || 'Uncategorized';
          const location = event.location?.displayName || 'Unspecified';
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
          locationCounts[location] = (locationCounts[location] || 0) + 1;
        });

        logger.info(`\n📊 EVENT LOADING SUMMARY`);
        logger.info(`   Total events loaded: ${newEvents.length}`);
        logger.info(`   Categories: ${Object.keys(categoryCounts).length} (${Object.entries(categoryCounts).map(([k,v]) => `${k}: ${v}`).join(', ')})`);
        logger.info(`   Locations: ${Object.keys(locationCounts).length} (${Object.entries(locationCounts).slice(0, 5).map(([k,v]) => `${k}: ${v}`).join(', ')}${Object.keys(locationCounts).length > 5 ? '...' : ''})`);

        // Sample event titles
        if (newEvents.length <= 5) {
          logger.info(`   Events: ${newEvents.map(e => e.subject).join(', ')}`);
        } else {
          logger.info(`   Sample events: ${newEvents.slice(0, 3).map(e => e.subject).join(', ')} ...and ${newEvents.length - 3} more`);
        }
      }

      // Warn if clearing events
      if (newEvents.length === 0 && allEvents.length > 0) {
        logger.warn('setAllEvents: Clearing all events (was ' + allEvents.length + ' events)');
      }

      setAllEventsState(newEvents);
    }, [allEvents]);

    // Update ref whenever allEvents changes to prevent stale closures in callbacks
    useEffect(() => {
      allEventsRef.current = allEvents;
    }, [allEvents]);

    // UI state
    const [groupBy, setGroupBy] = useState('locations');
    const [viewType, setViewType] = useState('week');
    const [zoomLevel, setZoomLevel] = useState(100);
    const [selectedFilter, setSelectedFilter] = useState(''); 
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedLocations, setSelectedLocations] = useState([]);

    const [currentDate, setCurrentDate] = useState(new Date());
    const dateRange = useMemo(() => {
      let start = new Date(currentDate);
      let end;
      
      if (viewType === 'week') {
        start = snapToStartOfWeek(currentDate);
        end = calculateEndDate(start, 'week');
      } else if (viewType === 'month') {
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        end = calculateEndDate(start, 'month');
      } else {
        // day view
        end = calculateEndDate(start, 'day');
      }
      
      return { start, end };
    }, [currentDate, viewType]);

    // Separate filters for month view
    const [, setSelectedCategoryFilter] = useState('');
    const [, setSelectedLocationFilter] = useState('');
    
    // Registration times toggle state
    const [showRegistrationTimes, setShowRegistrationTimes] = useState(showRegistrationTimesProp || false);

    // Profile states
    const { userTimezone, setUserTimezone } = useTimezone();
    const { rooms } = useRooms();
    const { generalLocations } = useLocations();
    const hasUserManuallyChangedTimezone = useRef(false);
    const [currentUser, setCurrentUser] = useState(null);

    // Timezone context initialized

    const [, setUserProfile] = useState(null);
    const [userPermissions, setUserPermissions] = useState({
      startOfWeek: 'Monday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100,
      preferredTimeZone: 'America/New_York',
      createEvents: true, // TEMPORARY: Set to true for testing
      editEvents: true,   // TEMPORARY: Set to true for testing
      deleteEvents: true, // TEMPORARY: Set to true for testing
      isAdmin: true,      // TEMPORARY: Set to true for testing
    });
    
    // User permissions initialized

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalType, setModalType] = useState('add'); // 'add', 'edit', 'view', 'delete'
    const [currentEvent, setCurrentEvent] = useState(null);
    const [, setNotification] = useState({ show: false, message: '', type: 'info' });

    // Event creation ReviewModal state
    const [eventReviewModal, setEventReviewModal] = useState({
      isOpen: false,
      event: null,
      mode: 'event', // 'event' for direct creation, 'create' for reservation requests
      hasChanges: false // Track if form has been modified
    });

    // Timeline modal state for location view
    const [timelineModal, setTimelineModal] = useState({
      isOpen: false,
      locationName: '',
      dateRange: [],
      events: [],
      viewType: 'week' // 'week' or 'day'
    });

    // Review modal hook for handling review functionality
    const reviewModal = useReviewModal({
      apiToken,
      graphToken,
      onSuccess: () => {
        // Reload events after successful approval/rejection
        loadEvents(true);
      },
      onError: (error) => {
        logger.error('Review modal error:', error);
        alert(error);
      }
    });

    //---------------------------------------------------------------------------
    // SIMPLE UTILITY FUNCTIONS (no dependencies on other functions)
    //---------------------------------------------------------------------------
    
    /**
     * Handle registration times toggle
     */
    const handleRegistrationTimesToggle = useCallback((enabled) => {
      setShowRegistrationTimes(enabled);
      // Registration times toggled
    }, []);
    /**
     * @param {*} event 
     * @returns 
     */
    const handleDemoDataUpload = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      if (!file.name.endsWith('.json')) {
        alert('Please select a JSON file');
        return;
      }
      
      setIsUploadingDemo(true);
      
      try {
        const text = await file.text();
        const rawJsonData = JSON.parse(text);
        
        logger.debug('Raw uploaded JSON:', rawJsonData);
        
        // Validate the structure - your JSON has a different structure
        if (!rawJsonData.events || !Array.isArray(rawJsonData.events)) {
          throw new Error('Invalid format: JSON must contain an "events" array');
        }
        
        if (rawJsonData.events.length === 0) {
          throw new Error('No events found in the uploaded file');
        }
        
        // Transform events to match your data format
        const transformedEvents = rawJsonData.events.map((event, index) => {
          try {
            // Your JSON uses "startDateTime" and "endDateTime" directly (no nested structure)
            const startDateTime = event.startDateTime;
            const endDateTime = event.endDateTime;
            
            if (!startDateTime) {
              throw new Error(`Event ${index + 1}: Missing startDateTime`);
            }
            
            if (!endDateTime) {
              throw new Error(`Event ${index + 1}: Missing endDateTime`);
            }
            
            // Parse dates - your format is like "2025-05-30T15:00:00.0000000"
            let startDate, endDate;
            
            try {
              // Handle the .0000000 format by parsing directly
              startDate = new Date(startDateTime);
              endDate = new Date(endDateTime);
            } catch (dateError) {
              throw new Error(`Invalid date format in event ${index + 1}`);
            }
            
            if (isNaN(startDate.getTime())) {
              throw new Error(`Event ${index + 1}: Invalid start date format: ${startDateTime}`);
            }
            
            if (isNaN(endDate.getTime())) {
              throw new Error(`Event ${index + 1}: Invalid end date format: ${endDateTime}`);
            }
            
            if (endDate <= startDate) {
              throw new Error(`Event ${index + 1}: End date must be after start date`);
            }

            // Use locationDisplayNames instead of deprecated location field
            const location = event.locationDisplayNames || '';

            // Your categories field is an array
            const categories = event.categories || [];
            const category = categories.length > 0 ? categories[0] : 'Uncategorized';
            
            return {
              ...event, // Keep all original fields
              id: event.id || `demo_event_${Date.now()}_${index}`,
              subject: event.subject || `Event ${index + 1}`,
              // Store as ISO strings for consistency
              startDateTime: startDate.toISOString(),
              endDateTime: endDate.toISOString(),
              location: location,
              categories: categories,
              category: category
            };
          } catch (error) {
            throw new Error(`Event ${index + 1} validation failed: ${error.message}`);
          }
        });
        
        const processedData = {
          ...rawJsonData,
          events: transformedEvents,
          totalEvents: transformedEvents.length,
          uploadDate: new Date().toISOString()
        };
        
        logger.debug('Processed demo data:', processedData);
        
        // Set demo data
        setDemoData(processedData);
        
        // Configure service for demo mode
        calendarDataService.setDemoMode(processedData);
        setIsDemoMode(true);
        
        logger.log('Demo mode activated, loading events...');
        
        // Test loading events for current date range
        const events = await calendarDataService.getEvents(dateRange);
        logger.debug('Loaded demo events for current range:', events);
        
        if (events.length === 0) {
          logger.warn('No events in current date range. Navigating to events...');
          
          // Find the date range of your events and navigate there
          const eventDates = transformedEvents.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          
          logger.debug('Event date range:', {
            earliest: earliestEvent.toLocaleDateString(),
            latest: latestEvent.toLocaleDateString(),
            currentViewStart: dateRange.start.toLocaleDateString(),
            currentViewEnd: dateRange.end.toLocaleDateString()
          });
          
          // Navigate to the earliest event
          let newStart;
          if (viewType === 'week') {
            newStart = snapToStartOfWeek(earliestEvent);
          } else if (viewType === 'month') {
            newStart = new Date(earliestEvent.getFullYear(), earliestEvent.getMonth(), 1);
          } else {
            newStart = new Date(earliestEvent);
          }
          
          const newEnd = calculateEndDate(newStart, viewType);
          setDateRange({ start: newStart, end: newEnd });
          
          // alert(`Successfully loaded ${transformedEvents.length} events. Calendar navigated to show events starting from ${earliestEvent.toLocaleDateString()}`);
        } else {
          setAllEvents(events);
          // alert(`Successfully loaded ${transformedEvents.length} events for demo mode`);
        }
        
      } catch (error) {
        logger.error('Error uploading demo data:', error);
        alert(`Error loading demo data: ${error.message}`);
      } finally {
        setIsUploadingDemo(false);
        event.target.value = '';
      }
    };
    
    /**
     * TBD
     * */
    const handleModeToggle = async () => {
      if (isDemoMode) {
        // Switching from demo to API mode
        const confirmSwitch = window.confirm('Switch to API mode? This will clear your demo data.');
        if (confirmSwitch) {
          calendarDataService.setApiMode();
          setIsDemoMode(false);
          setDemoData(null);
          
          // Reload events from API
          await loadEvents();
        }
      } else {
        // Switching from API to demo mode - need to upload data first
        alert('Please upload JSON data to enable demo mode');
      }
    };
    
    /*
    * TBD
    */
    const renderModeToggle = () => {
      const demoStats = calendarDataService.getDemoDataStats();
      
      return (
        <div className="mode-toggle-container" style={{
          padding: '12px 16px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px', flexWrap: 'wrap' }}>
            {/* Left side - Mode controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                
                <button
                  onClick={handleModeToggle}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: isDemoMode ? '#28a745' : '#0078d4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  {isDemoMode ? '📊 Demo Mode' : '🌐 API Mode'}
                </button>
              </div>
              
              {!isDemoMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label htmlFor="demo-upload" style={{
                    padding: '6px 14px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}>
                    📁 Upload Demo Data
                  </label>
                  <input
                    id="demo-upload"
                    type="file"
                    accept=".json"
                    onChange={handleDemoDataUpload}
                    disabled={isUploadingDemo}
                    style={{ display: 'none' }}
                  />
                  {isUploadingDemo && <span>Uploading...</span>}
                </div>
              )}
              
              {isDemoMode && demoStats && (
                <div style={{ fontSize: '0.9rem', color: '#6c757d' }}>
                  📊 {demoStats.totalEvents} events loaded
                  {demoStats.year && ` | 📅 ${demoStats.year}`}
                  {demoStats.dateRange?.start && demoStats.dateRange?.end && (
                    ` | 📅 ${new Date(demoStats.dateRange.start).toLocaleDateString()} - ${new Date(demoStats.dateRange.end).toLocaleDateString()}`
                  )}
                </div>
              )}
            </div>

            {/* Right side - Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <RegistrationTimesToggle
                showRegistrationTimes={showRegistrationTimes}
                onToggle={handleRegistrationTimesToggle}
              />
              
              {/* Cache Control Buttons (only show when API token is available) */}
              <button 
                className="search-button" 
                onClick={() => setShowSearch(true)}
                style={{
                  padding: '6px 14px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                  color: '#111827',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                🔍 Search & Export
              </button>
              <ExportToPdfButton 
                events={filteredEvents} 
                dateRange={dateRange} 
              />
            </div>
          </div>
        </div>
      );
    };

            
      /**
       * Check if an event has no location assigned
       * Checks if the locations array (ObjectIds) is empty
       */
      const isUnspecifiedLocation = useCallback((event) => {
        // Unspecified = locations array is empty
        return !event.locations || !Array.isArray(event.locations) || event.locations.length === 0;
      }, []);

      /** 
       * Helper function to detect if a location is a virtual meeting
       * @param {string} location - The location string to check
       * @returns {boolean} True if the location appears to be virtual
       */
      const isVirtualLocation = useCallback((location) => {
        if (!location || typeof location !== 'string') return false;
        
        const lowerLocation = location.toLowerCase().trim();
        
        // Check for common virtual meeting patterns
        const virtualPatterns = [
          // Zoom patterns
          /zoom\.us/i,
          /zoom\.com/i,
          /zoommtg:/i,
          /zoom meeting/i,
          
          // Teams patterns
          /teams\.microsoft\.com/i,
          /teams\.live\.com/i,
          /microsoft teams/i,
          
          // Google Meet patterns
          /meet\.google\.com/i,
          /hangouts\.google\.com/i,
          /google meet/i,
          
          // WebEx patterns
          /webex\.com/i,
          /cisco\.webex\.com/i,
          
          // GoToMeeting patterns
          /gotomeeting\.com/i,
          /gotomeet\.me/i,
          
          // Generic virtual meeting indicators
          /^https?:\/\//i, // Any URL starting with http/https
          /meeting.*id/i,
          /join.*meeting/i,
          /conference.*call/i,
          /dial.*in/i,
          /phone.*conference/i,
        ];
        
        // Check for explicit virtual keywords
        const virtualKeywords = [
          'virtual',
          'online',
          'remote',
          'video call',
          'video conference',
          'web conference',
          'microsoft teams meeting',
          'zoom meeting',
          'google meet',
          'webex meeting',
          'skype meeting',
          'conference call',
          'dial-in',
          'phone conference',
          'teleconference',
          'video chat',
          'online meeting',
          'web meeting',
        ];
        
        // Check patterns first
        if (virtualPatterns.some(pattern => pattern.test(lowerLocation))) {
          return true;
        }
        
        // Check keywords
        if (virtualKeywords.some(keyword => lowerLocation.includes(keyword))) {
          return true;
        }
        
        return false;
      }, []);
      
      /**
       * TBD
       */
      const isEventVirtual = useCallback((event) => {
        const locationText = event.location?.displayName?.trim() || '';
        if (!locationText) return false;
        
        // Check all locations in the event (handle multiple locations separated by semicolons or commas)
        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);
        
        // Return true if ANY location is virtual
        return eventLocations.some(location => isVirtualLocation(location));
      }, [isVirtualLocation]);

      /**
       * TBD
       */
      const hasPhysicalLocation = useCallback((event, targetLocation) => {
        const locationText = event.location?.displayName?.trim() || '';
        if (!locationText) return false;

        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);

        return eventLocations.some(location =>
          location === targetLocation
        );
      }, []);

      /**
       * TBD
       */
      const isUncategorizedEvent = useCallback((event) => {
        return !event.category || 
              event.category.trim() === '' || 
              event.category === 'Uncategorized';
      }, []);
  
      /**
       * Standardize date for API operations, ensuring consistent time zone handling
       * @param {Date} date - Local date to standardize
       * @returns {string} ISO date string in UTC
       */
      const standardizeDate = useCallback((date) => {
        if (!date) return '';
        return date.toISOString();
      }, []);
  
      
      /**
       * TBD
       */
      const getMonthDayEventPosition = useCallback((event, day) => {
        try {
          // Special handling for all-day events
          // Check both the isAllDay flag and time patterns (consistent with EventForm detection)
          const isAllDayEvent = event.isAllDay || (
            event.start?.dateTime && event.end?.dateTime &&
            event.start.dateTime.includes('T00:00:00') && 
            (event.end.dateTime.includes('T00:00:00') || event.end.dateTime.includes('T23:59:59'))
          );
          
          if (isAllDayEvent) {
            // For all-day events, use the start date in the user's timezone
            const startUtcString = event.start.dateTime.endsWith('Z') ? 
              event.start.dateTime : `${event.start.dateTime}Z`;
            const startDateUTC = new Date(startUtcString);
            
            if (isNaN(startDateUTC.getTime())) {
              logger.error('Invalid all-day event start date:', event.start.dateTime, event);
              return false;
            }
            
            // Convert to user timezone and get the date
            const eventInUserTZ = new Date(startDateUTC.toLocaleString('en-US', {
              timeZone: userTimezone
            }));
            
            // Reset to midnight for date comparison
            const eventDay = new Date(eventInUserTZ);
            eventDay.setHours(0, 0, 0, 0);
            
            const compareDay = new Date(day);
            compareDay.setHours(0, 0, 0, 0);
            
            return eventDay.getTime() === compareDay.getTime();
          }
          
          // Regular timed events
          // Ensure proper UTC format
          const utcDateString = event.start.dateTime.endsWith('Z') ? 
            event.start.dateTime : `${event.start.dateTime}Z`;
          const eventDateUTC = new Date(utcDateString);
          
          if (isNaN(eventDateUTC.getTime())) {
            logger.error('Invalid event date:', event.start.dateTime, event);
            return false;
          }
          
          // Convert to user timezone for comparison
          const eventInUserTZ = new Date(eventDateUTC.toLocaleString('en-US', {
            timeZone: userTimezone
          }));
          
          // Reset to midnight for date comparison
          const eventDay = new Date(eventInUserTZ);
          eventDay.setHours(0, 0, 0, 0);
          
          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);
          
          return eventDay.getTime() === compareDay.getTime();
        } catch (err) {
          logger.error('Error comparing event date in month view:', err, event);
          return false;
        }
      }, [userTimezone]);
  
      /**
       * Check if an event occurs on a specific day
       * @param {Object} event - The event object
       * @param {Date} day - The day to check
       * @returns {boolean} True if the event occurs on the day
       */
      const getEventPosition = useCallback((event, day) => {
        try {
          // Special handling for all-day events - use startDate field directly
          if (event.isAllDayEvent && event.startDate) {
            // event.startDate is already in "YYYY-MM-DD" format from backend
            const eventDateStr = event.startDate;

            // Compare with the day parameter
            const compareDay = new Date(day);
            const compareDateStr = compareDay.toISOString().split('T')[0];

            return eventDateStr === compareDateStr;
          }

          // For regular timed events, use the existing timezone conversion logic
          // Ensure proper UTC format
          const utcDateString = event.start.dateTime.endsWith('Z') ?
            event.start.dateTime : `${event.start.dateTime}Z`;
          const eventDateUTC = new Date(utcDateString);

          if (isNaN(eventDateUTC.getTime())) {
            logger.error('Invalid event date:', event.start.dateTime, event);
            return false;
          }

          // Convert event time to user timezone for date comparison
          const eventInUserTZ = new Date(eventDateUTC.toLocaleString('en-US', {
            timeZone: userTimezone
          }));

          // Reset time to midnight for date-only comparison
          const eventDay = new Date(eventInUserTZ);
          eventDay.setHours(0, 0, 0, 0);

          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);

          // Compare dates in user timezone
          return eventDay.getTime() === compareDay.getTime();
        } catch (err) {
          logger.error('Error comparing event date:', err, event);
          return false;
        }
      }, [userTimezone]);

      
    //---------------------------------------------------------------------------
    // DATA FUNCTIONS
    //---------------------------------------------------------------------------
    const updateUserProfilePreferences = async (updates) => {
      // No User Updates if in Demo Mode
      if (isDemoMode) {
        return false;
      }

      // No User Updates if no API Token
      if (!apiToken) {
        logger.warn("No API token available for updating preferences");
        return false;
      }

      try {
        
        const response = await fetch(`${API_BASE_URL}/users/current/preferences`, {
          method: 'PATCH',  // Or whatever method your API expects
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });
        
        if (!response.ok) {
          logger.error("Failed to update user preferences:", response.status);
          return false;
        }
        
        // Also update local state to match
        setUserPermissions(prev => ({
          ...prev,
          ...updates
        }));
        
        return true;
      } catch (error) {
        logger.error("Error updating user preferences:", error);
        return false;
      }
    };

    /**
     * Load current user information from API
     */
    const loadCurrentUser = useCallback(async () => {
      if (!apiToken) {
        return;
      }

      try {
        
        const response = await fetch(`${API_BASE_URL}/users/current`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          logger.error("Failed to load current user:", response.status);
          return;
        }
        
        const userData = await response.json();
        
        setCurrentUser({
          name: userData.name || userData.displayName,
          email: userData.email,
          id: userData.id || userData._id
        });
        
      } catch (error) {
        logger.error("Error loading current user:", error);
      }
    }, [apiToken]);

    /**
     * Load schema extensions available for this application
     */
    const loadSchemaExtensions = useCallback(async () => {
      try {
        // Get your app ID
        const schemaOwnerId = msalConfig.auth.clientId;
        
        // Filter for schema extensions owned by your app
        const response = await fetch(`https://graph.microsoft.com/v1.0/schemaExtensions?$filter=owner eq '${schemaOwnerId}'`, {
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
        
        if (!response.ok) {
          logger.error('Failed to load schema extensions');
          return [];
        }
        
        const data = await response.json();
        
        // Filter to extensions that target events
        const eventExtensions = data.value.filter(ext => 
          ext.status === 'Available' && 
          ext.targetTypes.includes('event')
        );
        
        // Store in state for use in UI
        setSchemaExtensions(eventExtensions);
        
        return eventExtensions;
      } catch (err) {
        logger.error('Error loading schema extensions:', err);
        return [];
      }
    }, [graphToken]);

    /**
     * Load base categories from database
     * @returns {Array} Array of base category objects
     */
    const loadBaseCategories = useCallback(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/categories`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          logger.error('Failed to fetch base categories:', response.status);
          return [];
        }

        const categories = await response.json();
        return categories;
      } catch (err) {
        logger.error('Error loading base categories:', err);
        return [];
      }
    }, [apiToken]);

    /**
     * Load categories from Outlook
     * @returns {Array} Array of category objects
     */
    const loadOutlookCategories = useCallback(async () => {
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          logger.error('Failed to fetch Outlook categories:', errorData);
          return [];
        }
        
        const data = await response.json();
        // Fetched Outlook categories
        
        // Extract category names
        const outlookCategories = data.value.map(cat => ({
          id: cat.id,
          name: cat.displayName,
          color: cat.color
        }));
        
        return outlookCategories;
      } catch (err) {
        logger.error('Error fetching Outlook categories:', err);
        return [];
      }
    }, [graphToken]);

    // Loads the current user's available calendars (both owned and shared)
    const loadAvailableCalendars = useCallback(async () => {
      if (!graphToken) return [];
      
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,owner,canEdit,isDefaultCalendar&$orderby=name', {
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch calendars');
        }
        
        const data = await response.json();
        const calendars = data.value.map(calendar => ({
          id: calendar.id,
          name: calendar.name,
          owner: calendar.owner,  // Keep full owner object for shared calendars
          canEdit: calendar.canEdit || false,
          isDefaultCalendar: calendar.isDefaultCalendar || false,
          // Determine if shared based on owner info
          isShared: calendar.owner && calendar.owner.address && !calendar.isDefaultCalendar || false
        }));
        
        // Update parent state with calendars
        setAvailableCalendars(calendars);
        
        return calendars;
      } catch (error) {
        logger.error('Error fetching calendars:', error);
        return [];
      }
    }, [graphToken, setAvailableCalendars]);

    /**
     * TBD
     */
    const loadDemoEvents = useCallback(async () => {
      if (!isDemoMode || !demoData) {
        logger.debug("Not in demo mode or no demo data available");
        return false;
      }
      
      setLoading(true);
      try {
        // Initialize the service with current settings
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Get events through the service (demo mode)
        const events = await calendarDataService.getEvents(dateRange);

        setAllEvents(events);
        return true;
        
      } catch (error) {
        logger.error('loadDemoEvents failed:', error);
        showNotification('Failed to load demo events: ' + error.message);
        return false;
      } finally {
        setLoading(false);
      }
    }, [isDemoMode, demoData, graphToken, apiToken, selectedCalendarId, schemaExtensions, dateRange]);

    
    /**
     * Load events from Microsoft Graph API
     *
    */
    const loadGraphEvents = useCallback(async () => {
      if (!graphToken) { return; }

      setLoading(true);
      try {
        // 1. Format your dates
        const { start, end } = formatDateRangeForAPI(dateRange.start, dateRange.end);
    
        const calendarPath = selectedCalendarId ? 
          `/me/calendars/${selectedCalendarId}/events` : 
          '/me/events';
        
        // 2. Pull down your registered schema‑extension IDs
        const extIds = schemaExtensions.map(e => e.id);
    
        // 3. Build your extensionName filter (OData)
        const extFilter = extIds
          .map(id => `id eq '${id}'`)
          .join(" or ");
    
        // 4. Page through /me/events, expanding extensions inline
        let all = [];
        let nextLink =
          `https://graph.microsoft.com/v1.0` + calendarPath +
          `?$top=50` +
          `&$orderby=start/dateTime desc` +
          `&$filter=start/dateTime ge '${start}' and start/dateTime le '${end}'` +
          `&$select=id,subject,start,end,location,organizer,body,categories,importance,showAs,sensitivity,isAllDay,seriesMasterId,type,recurrence,responseStatus,attendees,extensions,singleValueExtendedProperties,lastModifiedDateTime,createdDateTime` +
          (extFilter
            ? `&$expand=extensions($filter=${encodeURIComponent(extFilter)})`
            : "");
        
        while (nextLink) {
          const resp = await fetch(nextLink, {
            headers: { Authorization: `Bearer ${graphToken}` }
          });
          if (!resp.ok) {
            logger.error("Graph error paging events:", await resp.json());
            break;
          }
          const js = await resp.json();
          all = all.concat(js.value || []);
          nextLink = js["@odata.nextLink"] || null;
        }
    
        // 5. Check for linked registration events and extract setup/teardown data
        // Processing events for registration data
        const eventsWithRegistrationData = await Promise.all(all.map(async (evt) => {
          // Check if this event has a linked registration event
          try {
            // Checking event for extended properties
            
            if (evt.singleValueExtendedProperties) {
              const linkedEventIdProp = evt.singleValueExtendedProperties.find(
                prop => prop.id === 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name Emanuel-Calendar-App_linkedEventId'
              );
              const eventTypeProp = evt.singleValueExtendedProperties.find(
                prop => prop.id === 'String {66f5a359-4659-4830-9070-00047ec6ac6f} Name Emanuel-Calendar-App_eventType'
              );

              if (linkedEventIdProp && eventTypeProp?.value === 'main') {
                // This is a main event with a linked registration event
                const linkedEvent = await findLinkedEvent(graphToken, evt.id);
                if (linkedEvent) {
                  // Calculate setup and teardown times
                  const mainStart = new Date(evt.start.dateTime);
                  const mainEnd = new Date(evt.end.dateTime);
                  const regStart = new Date(linkedEvent.start.dateTime);
                  const regEnd = new Date(linkedEvent.end.dateTime);
                  
                  const setupMinutes = Math.round((mainStart - regStart) / (1000 * 60));
                  const teardownMinutes = Math.round((regEnd - mainEnd) / (1000 * 60));
                  
                  // Extract notes and assignment from registration event body
                  const regBody = linkedEvent.body?.content || '';
                  const assignedMatch = regBody.match(/Assigned to: (.+?)(?:\n|$)/);
                  const notesMatch = regBody.match(/Notes: (.+?)(?:\n\n|$)/s);
                  
                  const enrichedEvent = {
                    ...evt,
                    hasRegistrationEvent: true,
                    linkedEventId: linkedEvent.id,
                    setupMinutes: setupMinutes > 0 ? setupMinutes : 0,
                    teardownMinutes: teardownMinutes > 0 ? teardownMinutes : 0,
                    registrationNotes: notesMatch ? notesMatch[1].trim() : '',
                    assignedTo: assignedMatch ? assignedMatch[1].trim() : '',
                    registrationStart: linkedEvent.start.dateTime,
                    registrationEnd: linkedEvent.end.dateTime
                  };
                  return enrichedEvent;
                }
              }
            }
          } catch (error) {
            logger.error(`Error fetching linked event for ${evt.id}:`, error);
          }
          
          return evt;
        }));

        // 6. Normalize into your UI model
        const converted = eventsWithRegistrationData.map(evt => {
          // Extract extension data
          const extData = {};
          if (evt.extensions && evt.extensions.length > 0) {
            // Flatten out any extension props
            evt.extensions.forEach(x =>
              Object.entries(x).forEach(([k, v]) => {
                if (!k.startsWith("@") && k !== "id" && k !== "extensionName") {
                  extData[k] = v;
                }
              })
            );
          }
        
          // Get the actual calendar ID for this event
          // If we're fetching from a specific calendar, use that ID
          let eventCalendarId = selectedCalendarId || null;
          
          // If no specific calendar selected (using /me/events), we need to determine the calendar
          if (!eventCalendarId) {
            // First try to get from event's calendar property (if available)
            eventCalendarId = evt.calendar?.id || null;
            
            // If still no calendar ID, try to match against available calendars
            if (!eventCalendarId && availableCalendars.length > 0) {
              // For events from /me/events, we need to determine which calendar they belong to
              // Look for the default calendar first
              const defaultCalendar = availableCalendars.find(c => c.isDefaultCalendar);
              if (defaultCalendar) {
                // Check if this event likely belongs to the default calendar
                // (In most cases, events from /me/events without specific calendar info are from the default calendar)
                eventCalendarId = defaultCalendar.id;
              } else if (availableCalendars.length === 1) {
                // If only one calendar available, use it
                eventCalendarId = availableCalendars[0].id;
              } else {
                // Multiple calendars but no default - this is a problem
                logger.warn(`Could not determine calendar ID for event: ${evt.subject}. Available calendars:`, availableCalendars.map(c => c.name));
              }
            }
          }
          
          const convertedEvent = {
            id: evt.id,
            subject: evt.subject,
            // Always store ISO strings with Z to indicate UTC
            start: { dateTime: evt.start.dateTime.endsWith('Z') ?
                    evt.start.dateTime : `${evt.start.dateTime}Z` },
            end: { dateTime: evt.end.dateTime.endsWith('Z') ?
                  evt.end.dateTime : `${evt.end.dateTime}Z` },
            location: { displayName: evt.location?.displayName || "" },
            category: evt.categories?.[0] || "Uncategorized",
            // CRITICAL: Include body field for descriptions
            body: evt.body || null,
            bodyPreview: evt.bodyPreview || '',
            description: evt.description || '',
            extensions: evt.extensions || [],
            calendarId: eventCalendarId,
            calendarName: eventCalendarId ?
              availableCalendars.find(c => c.id === eventCalendarId)?.name : null,
            ...extData,
            // Include registration event data if it exists
            hasRegistrationEvent: evt.hasRegistrationEvent || false,
            linkedEventId: evt.linkedEventId || null,
            setupMinutes: evt.setupMinutes || 0,
            teardownMinutes: evt.teardownMinutes || 0,
            registrationNotes: evt.registrationNotes || '',
            assignedTo: evt.assignedTo || '',
            registrationStart: evt.registrationStart || null,
            registrationEnd: evt.registrationEnd || null
          };

          return convertedEvent;
        });

        // Sync events to unified collection first, then enrich with internal data
        let enrichedEvents = converted;
        if (apiToken) {
          try {
            // Sync events to unified collection before enrichment
            // Syncing events to unified collection before enrichment
            // Use the manual sync endpoint instead since it doesn't require calendarId
            const response = await fetch(`${API_BASE_URL}/internal-events/sync`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                events: converted,
                dateRange: {
                  start: dateRange.start.toISOString(),
                  end: dateRange.end.toISOString()
                }
              })
            });
            
            if (response.ok) {
              const syncResult = await response.json();
              // Sync result processed
            } else {
              logger.warn('Sync failed:', response.status, response.statusText);
            }
            
            // Now enrich with internal data
            enrichedEvents = await eventDataService.enrichEventsWithInternalData(converted);
            // Events enriched with internal data
            
            // Calculate registration start/end times for events with setup/teardown data
            enrichedEvents = enrichedEvents.map(event => {
              if (event._hasInternalData && (event.setupMinutes > 0 || event.teardownMinutes > 0)) {
                const mainStart = new Date(event.start.dateTime);
                const mainEnd = new Date(event.end.dateTime);
                
                // Calculate registration start (main start - setup minutes)
                const registrationStart = new Date(mainStart.getTime() - (event.setupMinutes * 60 * 1000));
                // Calculate registration end (main end + teardown minutes)  
                const registrationEnd = new Date(mainEnd.getTime() + (event.teardownMinutes * 60 * 1000));
                
                logger.debug('Calculating registration times for:', event.subject, {
                  setupMinutes: event.setupMinutes,
                  teardownMinutes: event.teardownMinutes,
                  mainStart: mainStart.toISOString(),
                  mainEnd: mainEnd.toISOString(),
                  registrationStart: registrationStart.toISOString(),
                  registrationEnd: registrationEnd.toISOString()
                });
                
                return {
                  ...event,
                  hasRegistrationEvent: true,
                  registrationStart: registrationStart.toISOString(),
                  registrationEnd: registrationEnd.toISOString()
                };
              }
              return event;
            });
          } catch (error) {
            logger.error('Failed to enrich events, using Graph data only:', error);
            // Continue with non-enriched events
          }
        }
        
        // FORCE REFRESH DEBUG: Log final events before setting
        console.log('Force Refresh DEBUG: Final enriched events before setAllEvents', {
          totalEvents: enrichedEvents.length,
          sampleEvents: enrichedEvents.slice(0, 3).map(event => ({
            id: event.id,
            subject: event.subject,
            hasBody: !!event.body,
            bodyContent: event.body?.content,
            bodyPreview: event.bodyPreview,
            description: event.description,
            _hasInternalData: event._hasInternalData
          })),
          eventsWithTestDescription: enrichedEvents.filter(event =>
            event.body?.content?.includes('Test description') ||
            event.bodyPreview?.includes('Test description') ||
            event.description?.includes('Test description')
          ).map(event => ({
            id: event.id,
            subject: event.subject,
            bodyContent: event.body?.content,
            bodyPreview: event.bodyPreview,
            description: event.description
          }))
        });

        // Events loaded from Graph API
        setAllEvents(enrichedEvents);

        // Selectively cache uncached events (fire-and-forget to avoid performance issues)
        if (apiToken && enrichedEvents.length > 0) {
          // Use setTimeout to ensure this doesn't block the main loading flow
          setTimeout(async () => {
            try {
              eventCacheService.setApiToken(apiToken);
              eventCacheService.setGraphToken(graphToken);
              
              // Group events by calendar ID and cache each group separately
              const eventsByCalendar = enrichedEvents.reduce((acc, event) => {
                // Use event's calendarId or fall back to selectedCalendarId or default calendar
                let calId = event.calendarId || selectedCalendarId;
                
                // If still no calendar ID, try to use the default calendar
                if (!calId && availableCalendars.length > 0) {
                  const defaultCalendar = availableCalendars.find(c => c.isDefaultCalendar);
                  if (defaultCalendar) {
                    calId = defaultCalendar.id;
                  }
                }
                
                if (calId) {
                  if (!acc[calId]) acc[calId] = [];
                  acc[calId].push(event);
                } else {
                  // Group uncategorized events separately
                  if (!acc['_unknown']) acc['_unknown'] = [];
                  acc['_unknown'].push(event);
                }
                return acc;
              }, {});
              
              // Selective caching for calendars
              const eventsWithoutCalendar = eventsByCalendar['_unknown'] || [];
              // Events without calendarId will be skipped from caching
              
              // Cache events for each calendar separately
              for (const [calendarId, events] of Object.entries(eventsByCalendar)) {
                // Skip unknown calendar group
                if (calendarId === '_unknown') {
                  // Skipping cache for events without valid calendar ID
                  continue;
                }
                
                try {
                  // Ensure events include enrichment data before caching
                  const eventsWithInternalData = events.map(event => ({
                    ...event,
                    // Include internal data if it exists
                    ...(event._hasInternalData ? {
                      setupMinutes: event.setupMinutes || 0,
                      teardownMinutes: event.teardownMinutes || 0,
                      registrationNotes: event.registrationNotes || '',
                      assignedTo: event.assignedTo || '',
                      mecCategories: event.mecCategories || [],
                      internalNotes: event.internalNotes || '',
                      setupStatus: event.setupStatus || 'pending',
                      estimatedCost: event.estimatedCost,
                      actualCost: event.actualCost
                    } : {})
                  }));
                  
                  const result = await eventCacheService.cacheUncachedEvents(eventsWithInternalData, calendarId);
                  logger.debug(`Selective caching completed for calendar ${calendarId}:`, result);
                } catch (cacheError) {
                  logger.warn(`Selective caching failed for calendar ${calendarId}:`, cacheError);
                }
              }
            } catch (cacheError) {
              logger.warn('Selective caching failed (non-critical):', cacheError);
            }
          }, 500); // Small delay to let UI update first
        }
        
        // Events loaded from Graph API, selective caching initiated

        return true;
      } catch (err) {
        logger.error("loadGraphEvents failed:", err);
      } finally {
        setLoading(false);
      }
    }, [graphToken, dateRange, selectedCalendarId, availableCalendars, apiToken, schemaExtensions]);

    /**
     * Load events using cache-first approach with Graph API fallback
     * @param {boolean} forceRefresh - Force refresh from Graph API
     */
    const loadEventsWithCache = useCallback(async (forceRefresh = false) => {
      if (!graphToken) {
        return false;
      }

      // If no calendar is selected, fall back to direct Graph API loading
      if (!selectedCalendarId) {
        return await loadGraphEvents();
      }

      setLoading(true);

      try {
        // Prepare parameters for cache query
        const { start, end } = formatDateRangeForAPI(dateRange.start, dateRange.end);

        if (apiToken && !forceRefresh) {
          // Try cache-first approach
          eventCacheService.setApiToken(apiToken);
          eventCacheService.setGraphToken(graphToken);
          
          try {
            const cacheResult = await eventCacheService.loadEvents({
              calendarId: selectedCalendarId,
              startTime: start,
              endTime: end,
              forceRefresh: false
            });

            if (cacheResult.source === 'cache' && cacheResult.events.length > 0) {
              setAllEvents(cacheResult.events);

              // Also check if there are any missing events in this date range that need caching
              // by running a parallel Graph API call to fill gaps
              setTimeout(async () => {
                try {
                  await loadGraphEvents();
                } catch (error) {
                  logger.warn('loadEventsWithCache: Background Graph API call failed:', error);
                }
              }, 1000); // Delay to avoid interfering with UI

              return true;
            } else if (cacheResult.source === 'graph_fallback' && cacheResult.events.length >= 0) {
              // Cache miss - backend already fetched from Graph API and cached events
              setAllEvents(cacheResult.events);
              return true;
            }
          } catch (cacheError) {
            logger.warn('loadEventsWithCache: Cache loading failed, falling back to Graph API', cacheError);
          }
        }

        // Cache miss, stale data, or force refresh - use Graph API
        const success = await loadGraphEvents();
        
        // Events are automatically cached in loadGraphEvents if successful

        return success;
      } catch (error) {
        logger.error('loadEventsWithCache failed:', error);
        return false;
      } finally {
        setLoading(false);
      }
    }, [graphToken, selectedCalendarId, apiToken, dateRange, formatDateRangeForAPI, loadGraphEvents]);

    /**
     * Load events using unified delta sync
     * @param {boolean} forceRefresh - Force full sync instead of delta
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEventsUnified = useCallback(async (forceRefresh = false, calendarsData = null) => {
      if (!graphToken || !apiToken) {
        logger.debug("loadEventsUnified: Missing tokens - returning false");
        return false;
      }

      setLoading(true);
      
      try {
        // Prepare parameters for sync
        const { start, end } = formatDateRangeForAPI(dateRange.start, dateRange.end);
        
        // Get calendar IDs to sync - include both user calendar and TempleRegistration
        const calendarIds = [];
        
        // Use passed calendar data or fallback to state
        const calendarsToUse = calendarsData || availableCalendars;
        
        // Resolve calendar IDs for sync
        if (selectedCalendarId) {
          calendarIds.push(selectedCalendarId);
          calendarDebug.logApiCall('loadEventsUnified', 'sync', { selectedCalendarId });
        } else {
          // If no specific calendar selected, find and use the actual primary calendar ID
          const primaryCalendar = calendarsToUse.find(cal => cal.isDefaultCalendar || cal.owner?.name === currentUser?.name);
          if (primaryCalendar) {
            calendarIds.push(primaryCalendar.id);
          } else if (calendarsToUse.length > 0) {
            // Fallback to first available calendar
            calendarIds.push(calendarsToUse[0].id);
          } else {
            logger.warn('loadEventsUnified: No available calendars found');
          }
        }

        // Final validation of calendar IDs
        if (calendarIds.length === 0) {
          logger.error('loadEventsUnified: No calendar IDs resolved', {
            selectedCalendarId,
            availableCalendarsCount: availableCalendars?.length || 0,
            hasCurrentUser: !!currentUser
          });
          throw new Error('No valid calendar IDs found for sync');
        }
        
        // Log which calendars we're actually syncing from
        const calendarDetails = calendarIds.map(id => {
          const calendar = calendarsToUse.find(c => c.id === id);
          return { id, name: calendar?.name || 'Unknown', isSelected: id === selectedCalendarId };
        });

        // Consolidated calendar load message
        const selectedCalendar = calendarsToUse.find(c => c.id === selectedCalendarId);
        const dateRangeStr = `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
        console.log(`📅 Loading: ${calendarDetails.map(c => c.name).join(', ')} | ${dateRangeStr}${forceRefresh ? ' | Force refresh' : ''}`);

        // Initialize unified event service
        unifiedEventService.setApiToken(apiToken);
        unifiedEventService.setGraphToken(graphToken);

        // Perform regular events loading (replaces problematic delta sync)
        let loadResult;
        try {
          loadResult = await unifiedEventService.loadEvents({
            calendarIds: calendarIds,
            startTime: start,
            endTime: end,
            forceRefresh: forceRefresh
          });
        } catch (backendError) {
          logger.error('Backend events load error:', backendError);
          throw backendError;
        }

        // Check if loadResult is valid
        if (!loadResult) {
          logger.error('Backend returned no results');
          throw new Error('Backend service returned null/undefined');
        }

        // Only update events if we got actual results
        // Don't clear existing events if regular load returns empty
        if (loadResult.events && loadResult.events.length > 0) {
          
          // Get selected calendar name for logging
          const selectedCalendar = availableCalendars.find(c => c.id === selectedCalendarId);
          const selectedCalendarName = selectedCalendar?.name || 'Unknown Calendar';
          
          // Backend now returns only events from the selected calendars
          // No need to filter on frontend anymore
          let eventsToDisplay = loadResult.events;

          console.log(`📊 ${eventsToDisplay.length} events | Source: ${loadResult.source || 'unknown'}`);
          
          // Log the events we're setting
          calendarDebug.logEventsLoaded(selectedCalendarId, selectedCalendarName, eventsToDisplay);
          
          setAllEvents(eventsToDisplay);
          calendarDebug.logEventLoadingComplete(selectedCalendarId, eventsToDisplay.length, Date.now() - (window._calendarLoadStart || Date.now()));
          return true;
        } else if (loadResult.loadResults && loadResult.loadResults.errors && loadResult.loadResults.errors.length > 0) {
          // If there were errors, don't clear events - keep existing ones
          logger.warn('loadEventsUnified: Regular load had errors, keeping existing events', {
            errorCount: loadResult.loadResults.errors.length,
            errors: loadResult.loadResults.errors
          });
          return false;
        } else {
          // No events returned but no errors - this might be legitimate (empty calendar)
          // Only clear events if this was explicitly a successful empty result
          if (loadResult.source === 'regular_load' && loadResult.loadResults?.totalEvents === 0) {
            setAllEvents([]);
            return true;
          } else {
            logger.warn('loadEventsUnified: No events returned, keeping existing events');
            return false;
          }
        }
        
      } catch (error) {
        logger.error('loadEventsUnified failed:', error);
        
        // Fallback to old cache approach if regular load fails
        logger.warn('loadEventsUnified: Falling back to cache approach');
        try {
          return await loadEventsWithCache(forceRefresh);
        } catch (fallbackError) {
          logger.error('loadEventsUnified: Fallback also failed:', fallbackError);
          return false;
        }
      } finally {
        setLoading(false);
      }
    }, [graphToken, apiToken, selectedCalendarId, availableCalendars, dateRange, formatDateRangeForAPI, loadEventsWithCache]);

    /**
     * Enhanced load events with regular Graph API queries (primary) and cache fallback
     * @param {boolean} forceRefresh - Force refresh from Graph API
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEvents = useCallback(async (forceRefresh = false, calendarsData = null) => {
      calendarDebug.logApiCall('loadEvents', 'start', { forceRefresh, isDemoMode });
      
      try {
        if (isDemoMode) {
          return await loadDemoEvents();
        } else {
          // Hybrid approach: Try regular load first, fallback to cache approach if it fails
          // Starting hybrid event loading approach
          
          try {
            // Attempt regular load first
            const regularResult = await loadEventsUnified(forceRefresh, calendarsData);
            if (regularResult) {
              // Regular load successful
              calendarDebug.logApiCall('loadEvents', 'complete', { method: 'regular' });
              return regularResult;
            }
          } catch (error) {
            logger.warn('loadEvents: Regular load failed, falling back to cache approach:', error);
            calendarDebug.logError('loadEventsUnified', error);
          }
          
          // Fallback to cache-based approach
          logger.debug('loadEvents: Using cache fallback approach');
          const cacheResult = await loadEventsWithCache(forceRefresh);
          calendarDebug.logApiCall('loadEvents', 'complete', { method: 'cache' });
          return cacheResult;
        }
      } catch (error) {
        calendarDebug.logError('loadEvents', error);
        throw error;
      }
    }, [isDemoMode, loadDemoEvents, loadEventsUnified, loadEventsWithCache]);

    /**
     * Sync events to internal database 
     * @param {Date} startDate - Start date of the range to sync
     * @param {Date} endDate - End date of the range to sync
     * @returns {Promise<Object>} Success indicator and result  
     */
    const syncEventsToInternal = useCallback(async (startDate, endDate) => {
      if (!graphToken || !apiToken) {
        logger.error('Missing tokens for sync');
        return { success: false, error: 'Authentication required' };
      }
      
      try {
        // Fetch events from Graph for the date range
        const { start, end } = formatDateRangeForAPI(startDate, endDate);
        
        const calendarPath = selectedCalendarId ? 
          `/me/calendars/${selectedCalendarId}/events` : 
          '/me/events';
        
        let allEvents = [];
        let nextLink = `https://graph.microsoft.com/v1.0${calendarPath}?$top=100&$filter=start/dateTime ge '${start}' and start/dateTime le '${end}'`;
        
        while (nextLink) {
          const resp = await fetch(nextLink, {
            headers: { Authorization: `Bearer ${graphToken}` }
          });
          
          if (!resp.ok) {
            throw new Error('Failed to fetch events from Graph');
          }
          
          const data = await resp.json();
          allEvents = allEvents.concat(data.value || []);
          nextLink = data['@odata.nextLink'] || null;
        }
        
        // Sync to internal database
        const syncResult = await eventDataService.syncEvents(allEvents, selectedCalendarId);
        
        // Reload events to show updated data
        await loadGraphEvents();
        
        return { success: true, result: syncResult };
      } catch (error) {
        logger.error('Sync failed:', error);
        return { success: false, error: error.message };
      }
    }, [graphToken, apiToken, selectedCalendarId, loadGraphEvents]);


    /**
     * Manual sync of loaded events to database
     * Creates enriched templeEvents__Events records for currently loaded events
     */
    const handleManualSync = useCallback(async () => {
      if (!allEvents || allEvents.length === 0) {
        alert('No events to sync. Please load events first.');
        return;
      }

      if (!apiToken) {
        alert('Authentication required for sync.');
        return;
      }

      setLoading(true);
      logger.debug('Starting manual sync of events to database', { eventCount: allEvents.length });

      try {
        logger.debug('Making manual sync request', {
          url: `${API_BASE_URL}/internal-events/sync`,
          eventCount: allEvents.length,
          hasApiToken: !!apiToken
        });

        // Call the manual sync endpoint
        const response = await fetch(`${API_BASE_URL}/internal-events/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            events: allEvents,
            dateRange: {
              start: dateRange.start.toISOString(),
              end: dateRange.end.toISOString()
            }
          })
        });

        logger.debug('Manual sync response received', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Manual sync HTTP error', {
            status: response.status,
            statusText: response.statusText,
            errorText
          });
          throw new Error(`Sync failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        logger.debug('Manual sync completed successfully', result);
        
        alert(`Successfully synced ${result.enrichedCount || result.totalProcessed || allEvents.length} events to database. Created: ${result.createdCount}, Updated: ${result.updatedCount}`);
        
      } catch (error) {
        logger.error('Manual sync failed:', error);
        alert(`Sync failed: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }, [allEvents, apiToken, dateRange, API_BASE_URL]);

    /**
     * Load user profile and permissions
     * @returns {Promise<boolean>} Success indicator
     */
    const loadUserProfile = useCallback(async () => {
      if (!apiToken) {
        logger.debug("No API token available");
        return false;
      }
      
      try {
        logger.debug("API token length:", apiToken.length);
        logger.debug("Fetching user profile for calendar permissions from:", `${API_BASE_URL}/users/current`);
        
        const response = await fetch(`${API_BASE_URL}/users/current`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });
        
        logger.debug("User profile response status:", response.status);
        
        if (response.status === 404) {
          logger.debug("User profile not found - permissions will use defaults");
          return false;
        }
        
        if (response.status === 401) {
          logger.debug("Unauthorized - authentication issue with API token");
          // TEMPORARY: Don't reset permissions for testing
          logger.debug("401 error but keeping test permissions");
          /*
          setUserPermissions({
            startOfWeek: 'Monday',
            defaultView: 'week',
            defaultGroupBy: 'categories',
            preferredZoomLevel: 100,
            preferredTimeZone: 'America/New_York',
            createEvents: false, 
            editEvents: false,  
            deleteEvents: false, 
            isAdmin: false
          });
          */
          return true;
        }
        
        if (response.ok) {
          const data = await response.json();
          logger.debug("Full user profile data from API:", data);
          setUserProfile(data);
          
          // Based on UserAdmin component, permissions are stored in preferences
          const hasCreatePermission = data.preferences?.createEvents ?? true;  // Default to true if not set
          const hasEditPermission = data.preferences?.editEvents ?? true;      // Default to true if not set
          const hasDeletePermission = data.preferences?.deleteEvents ?? false; // Default to false if not set
          const isAdmin = data.preferences?.isAdmin ?? false;                  // Default to false if not set
          
          const permissions = {
            startOfWeek: data.preferences?.startOfWeek || 'Monday',
            defaultView: data.preferences?.defaultView || 'week',
            defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
            preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
            preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York',
            createEvents: hasCreatePermission,
            editEvents: hasEditPermission,
            deleteEvents: hasDeletePermission,  
            isAdmin: isAdmin,
          };
          
          // TEMPORARY: Don't overwrite test permissions
          // setUserPermissions(permissions);
          if (data.preferences?.preferredTimeZone) {
            setUserTimezone(data.preferences.preferredTimeZone);
          }
          return true;
        }
        return false;
      } catch (error) {
        logger.error("Error fetching user permissions:", error);
        // TEMPORARY: Don't reset permissions for testing
        // Error loading profile but keeping test permissions
        /*
        setUserPermissions({
          startOfWeek: 'Monday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100,
          preferredTimeZone: 'America/New_York',
          createEvents: false,
          editEvents: false,
          deleteEvents: false,
          isAdmin: false
        });
        */
        return true;
      }
    }, [apiToken, API_BASE_URL]);  

    // Add this function to your component to coordinate the loading sequence
    const initializeApp = useCallback(async () => {
      // Initialize app called

      // Check if initialization has already started
      if (initializationStarted.current) {
        logger.debug("Initialization already in progress, skipping");
        return;
      }

      // Mark initialization as started immediately
      initializationStarted.current = true;

      if (!graphToken || !apiToken) {
        logger.error("Cannot initialize: Missing authentication tokens");
        return;
      }

      // Add timeout protection (30 seconds)
      const timeoutId = setTimeout(() => {
        logger.error("Initialization timeout - forcing completion of loading states");
        setLoadingState({
          user: false,
          categories: false,
          extensions: false,
          events: false
        });
        setInitializing(false);
      }, 30000);

      logger.debug("Starting application initialization...");
      try {
        // Load user profile and permissions first
        const userLoaded = await loadUserProfile();
        setLoadingState(prev => ({ ...prev, user: false }));
        
        if (!userLoaded) {
          logger.warn("Could not load user profile, continuing with defaults");
        }

        // Load current user information
        // Load current user information
        await loadCurrentUser();

        // Load available calendars
        // Load available calendars
        const calendars = await loadAvailableCalendars();
        setAvailableCalendars(calendars);
        
        // Check if the currently selected calendar still exists
        if (selectedCalendarId && !calendars.some(cal => cal.id === selectedCalendarId)) {
          calendarDebug.logError('Selected calendar no longer available', 
            new Error('Calendar removed or permissions changed'), 
            { selectedCalendarId, availableCalendarIds: calendars.map(c => c.id) }
          );
          setSelectedCalendarId(null);
        }
        
        // Set default calendar if none selected
        if (!selectedCalendarId) {
          const defaultCalendar = calendars.find(cal => cal.isDefaultCalendar);
          if (defaultCalendar) {
            calendarDebug.logStateChange('selectedCalendarId', null, defaultCalendar.id);
            setSelectedCalendarId(defaultCalendar.id);
          } else if (calendars.length > 0) {
            // If no default calendar found, select the first one
            calendarDebug.logStateChange('selectedCalendarId', null, calendars[0].id);
            setSelectedCalendarId(calendars[0].id);
          }
        }
        
        // Load base categories from database
        const baseCats = await loadBaseCategories();
        setBaseCategories(baseCats);
        logger.debug('Loaded base categories during init:', baseCats.length);

        // Load Outlook categories
        // Load Outlook categories
        const categories = await loadOutlookCategories();
        setOutlookCategories(categories);
        // Note: Don't mark categories as loaded yet - wait for events to load so dynamic categories can be generated

        // Create default categories if needed (optional)
        if (categories.length === 0) {
          // No categories found, creating defaults
          await createDefaultCategories();
        }
        
        // Step 3: Load schema extensions
        // Load schema extensions
        await loadSchemaExtensions();
        setLoadingState(prev => ({ ...prev, extensions: false }));
        
        // Step 4: Finally load events (using cache-first approach)
        // Load calendar events - pass calendar data directly to avoid race condition
        await loadEvents(false, calendars);
        setLoadingState(prev => ({ ...prev, events: false }));

        // Step 5: Mark categories as loaded after events are available (so dynamic categories can be generated)
        setLoadingState(prev => ({ ...prev, categories: false }));

        logger.log("Application initialized successfully");
        setInitializing(false);

        // Clear timeout on successful completion
        clearTimeout(timeoutId);

      } catch (error) {
        logger.error("Error during initialization:", error);
        // Ensure we exit loading state even on error
        setLoadingState({
          user: false,
          categories: false,
          extensions: false,
          events: false
        });
        setInitializing(false);

        // Clear timeout on error
        clearTimeout(timeoutId);
      }
    }, [graphToken, apiToken, loadUserProfile, loadCurrentUser, loadOutlookCategories, loadSchemaExtensions, loadGraphEvents]);

    //---------------------------------------------------------------------------
    // CACHE MANAGEMENT FUNCTIONS
    //---------------------------------------------------------------------------
    
    /**
     * Refresh events with cache control
     * @param {boolean} forceRefresh - Force refresh from Graph API
     */
    const refreshEvents = useCallback(async (forceRefresh = false) => {
      logger.debug('refreshEvents called', { forceRefresh });
      console.log(`🔄 REFRESH EVENTS TRIGGERED - Force Refresh: ${forceRefresh ? 'YES (bypassing cache)' : 'NO (using cache)'}`);

      const startTime = Date.now();
      await loadEvents(forceRefresh);

      const duration = Date.now() - startTime;
      console.log(`✅ REFRESH COMPLETE in ${duration}ms - Loaded ${allEvents.length} events`);

      // Log sample events to check body content
      if (allEvents.length > 0) {
        const eventsWithBody = allEvents.filter(e => e.body?.content);
        console.log(`📊 Events with body content: ${eventsWithBody.length}/${allEvents.length}`);

        if (eventsWithBody.length > 0) {
          console.log('📝 Sample event with body:', {
            subject: eventsWithBody[0].subject,
            bodyContent: eventsWithBody[0].body?.content?.substring(0, 100) + '...'
          });
        }
      }
    }, [loadEvents, allEvents]);

    /**
     * Invalidate cache for current calendar
     */
    const invalidateCurrentCalendarCache = useCallback(async () => {
      if (!apiToken || !selectedCalendarId) {
        logger.debug('Cannot invalidate cache: missing API token or calendar ID');
        return;
      }

      try {
        eventCacheService.setApiToken(apiToken);
        await eventCacheService.invalidateCache({ calendarId: selectedCalendarId });
        logger.debug('Cache invalidated for calendar:', selectedCalendarId);
        
        // Reload events after cache invalidation
        await loadEvents(true);
      } catch (error) {
        logger.error('Failed to invalidate cache:', error);
      }
    }, [apiToken, selectedCalendarId, loadEvents]);

    /**
     * Get cache statistics for debugging
     */
    const getCacheStats = useCallback(async () => {
      if (!apiToken) {
        logger.debug('Cannot get cache stats: missing API token');
        return null;
      }

      try {
        eventCacheService.setApiToken(apiToken);
        const stats = await eventCacheService.getCacheStats();
        logger.debug('Cache statistics:', stats);
        return stats;
      } catch (error) {
        logger.error('Failed to get cache stats:', error);
        return null;
      }
    }, [apiToken]);

    //---------------------------------------------------------------------------
    // UTILITY/HELPER FUNCTIONS
    //---------------------------------------------------------------------------
    const showNotification = (message, type = 'error') => {
      setNotification({ show: true, message, type });
      logger.debug(`[Notification] ${type}: ${message}`);
      // Auto-hide after 3 seconds
      setTimeout(() => setNotification({ show: false, message: '', type: 'info' }), 3000);
    };

    /**
     * Retry loading events after creation to ensure the new event appears
     * @param {string} eventId - The ID of the newly created event
     * @param {string} eventSubject - The subject of the newly created event for logging
     */
    const retryEventLoadAfterCreation = useCallback(async (eventId, eventSubject) => {
      // For updates (eventId already exists), just refresh once immediately
      if (eventId) {
        logger.debug(`[retryEventLoadAfterCreation] Refreshing after update: ${eventSubject}`);
        console.log(`🔄 FORCING REFRESH AFTER UPDATE for event: ${eventSubject} (ID: ${eventId})`);
        try {
          await loadEvents(true); // Force refresh to show the updated event - this bypasses cache
          logger.debug(`[retryEventLoadAfterCreation] Refresh complete for updated event: ${eventSubject}`);
          console.log(`✅ REFRESH COMPLETE - Event should now have updated body content from Graph API`);
        } catch (error) {
          logger.error(`[retryEventLoadAfterCreation] Error refreshing after update:`, error);
          console.error(`❌ REFRESH FAILED after update:`, error);
          showNotification(`Event updated but refresh failed. Try manual refresh if needed.`, 'warning');
        }
        return;
      }

      // For new events (no eventId yet), use retry logic with delays
      // This handles propagation delays in Graph API for newly created events
      const maxRetries = 3;
      const baseDelay = 500; // Start with 500ms delay

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.debug(`[retryEventLoadAfterCreation] Attempt ${attempt}/${maxRetries} for new event: ${eventSubject}`);

          // Wait before loading events (exponential backoff: 500ms, 1s, 2s)
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));

          // Reload events from the API
          await loadEvents(true); // Force refresh to ensure we get the latest data

          // For new events, we just assume success after loading
          // The stale closure issue prevented proper checking anyway
          logger.debug(`[retryEventLoadAfterCreation] Loaded events after ${attempt} attempt(s) for: ${eventSubject}`);
          return;

        } catch (error) {
          logger.error(`[retryEventLoadAfterCreation] Error in attempt ${attempt}:`, error);

          if (attempt === maxRetries) {
            logger.warn(`[retryEventLoadAfterCreation] Failed to load event after ${maxRetries} attempts. Event may appear after manual refresh.`);
            showNotification(`Event created but may take a moment to appear. Try refreshing if needed.`, 'warning');
          }
        }
      }
    }, [loadEvents, showNotification]); // Removed allEvents from dependencies to avoid stale closure

    /**
     * Get the target calendar name for event creation/editing
     * @returns {string} The name of the target calendar
     */
    const getTargetCalendarName = useCallback(() => {
      let targetCalendarId = selectedCalendarId;
      
      if (!targetCalendarId) {
        // Use same logic as handleSaveApiEvent to determine target calendar
        const writableCalendars = availableCalendars.filter(cal => 
          cal.canEdit !== false && 
          !cal.name?.toLowerCase().includes('birthday') &&
          !cal.name?.toLowerCase().includes('holiday') &&
          !cal.name?.toLowerCase().includes('vacation')
        );
        
        const preferredCalendar = writableCalendars.find(cal => 
          cal.name?.toLowerCase().includes('temple events') || 
          cal.name?.toLowerCase() === 'calendar'
        ) || writableCalendars[0];
        
        return preferredCalendar?.name || 'Unknown Calendar';
      } else {
        const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        return selectedCalendar?.name || 'Unknown Calendar';
      }
    }, [selectedCalendarId, availableCalendars]);

    /**
     * Get categories from the database (base categories only)
     * @param {string} targetCalendarId - The ID of the target calendar (not used, kept for compatibility)
     * @returns {Array} Array of category names from the database
     */
    const getCalendarSpecificCategories = useCallback((targetCalendarId) => {
      // Return all base categories from database, sorted by displayOrder
      if (baseCategories && baseCategories.length > 0) {
        const categoryNames = baseCategories
          .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
          .map(cat => cat.name);

        // Always include 'Uncategorized' as first option if not present
        if (!categoryNames.includes('Uncategorized')) {
          categoryNames.unshift('Uncategorized');
        }

        return categoryNames;
      }

      // Fallback if base categories haven't loaded yet
      return ['Uncategorized'];
    }, [baseCategories]);

    /**
     * Get the target calendar ID for event creation/editing
     * @returns {string} The ID of the target calendar
     */
    const getTargetCalendarId = useCallback(() => {
      let targetCalendarId = selectedCalendarId;
      
      if (!targetCalendarId) {
        // Use same logic as handleSaveApiEvent to determine target calendar
        const writableCalendars = availableCalendars.filter(cal => 
          cal.canEdit !== false && 
          !cal.name?.toLowerCase().includes('birthday') &&
          !cal.name?.toLowerCase().includes('holiday') &&
          !cal.name?.toLowerCase().includes('vacation')
        );
        
        const preferredCalendar = writableCalendars.find(cal => 
          cal.name?.toLowerCase().includes('temple events') || 
          cal.name?.toLowerCase() === 'calendar'
        ) || writableCalendars[0];
        
        targetCalendarId = preferredCalendar?.id;
      }
      
      return targetCalendarId;
    }, [selectedCalendarId, availableCalendars]);

    const makeBatchBody = (eventId, coreBody, extPayload, calendarId) => {
      // Determine the base URL based on whether a calendar is selected
      const baseUrl = calendarId 
        ? `/me/calendars/${calendarId}/events` 
        : '/me/events';
      
      return {
        requests: [
          {
            id: '1', 
            method: eventId ? 'PATCH' : 'POST',
            url: eventId ? `${baseUrl}/${eventId}` : baseUrl,
            headers: { 'Content-Type': 'application/json' },
            body: coreBody
          },
          ...(
            Object.keys(extPayload).length && eventId
              ? [{ 
                  id: '2', 
                  method: 'PATCH', 
                  url: `${baseUrl}/${eventId}`, 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: extPayload 
                }]
              : []
          )
        ]
      };
    };

    const patchEventBatch = async (eventId, coreBody, extPayload, calendarId, internalFields) => {
      const targetCalendarId = calendarId || selectedCalendarId;

      // Prepare Graph API fields
      const graphFields = { ...coreBody };

      // Add schema extensions to Graph fields if provided
      if (extPayload && Object.keys(extPayload).length > 0) {
        graphFields.extensions = [];
        for (const [extId, extProps] of Object.entries(extPayload)) {
          if (Object.keys(extProps).length > 0) {
            graphFields.extensions.push({
              '@odata.type': `microsoft.graph.openTypeExtension`,
              extensionName: extId,
              ...extProps
            });
          }
        }
      }

      // Debug logging for unified audit request
      logger.debug('[patchEventBatch] Using unified audit endpoint:', {
        eventId,
        hasGraphFields: Object.keys(graphFields).length > 0,
        hasInternalFields: !!internalFields && Object.keys(internalFields).length > 0,
        targetCalendarId,
        graphFields,
        internalFields
      });

      // Ensure we have an API token for the unified audit endpoint
      if (!apiToken) {
        throw new Error('API token not available for unified audit update');
      }

      // Call unified audit update endpoint
      const response = await fetch(`${API_BASE_URL}/events/${eventId || 'new'}/audit-update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          graphFields: Object.keys(graphFields).length > 0 ? graphFields : null,
          internalFields: internalFields && Object.keys(internalFields).length > 0 ? internalFields : null,
          calendarId: targetCalendarId,
          graphToken: graphToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[patchEventBatch] Unified audit update failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Unified audit update failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug('[patchEventBatch] Unified audit update successful:', {
        auditChanges: result.auditChanges,
        graphUpdated: result.graphUpdated,
        internalUpdated: result.internalUpdated,
        eventId: result.event?.id
      });

      // For new events, handle the case where we need to create the event first
      if (!eventId && !result.event?.id) {
        // Fall back to direct Graph API creation for new events
        logger.debug('[patchEventBatch] Creating new event via direct Graph API');

        const batchBody = makeBatchBody(null, coreBody, extPayload, targetCalendarId);
        const resp = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(batchBody)
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `New event creation failed: ${resp.status}`);
        }

        const batchResponse = await resp.json();
        let createdEventData = null;

        if (batchResponse.responses && batchResponse.responses.length > 0) {
          const mainResponse = batchResponse.responses.find(r => r.id === '1');
          if (mainResponse && mainResponse.status >= 200 && mainResponse.status < 300) {
            createdEventData = mainResponse.body;
            logger.debug('[patchEventBatch] New event created:', createdEventData.id);

            // Now update with internal fields using the new event ID
            if (internalFields && Object.keys(internalFields).length > 0) {
              await fetch(`${API_BASE_URL}/events/${createdEventData.id}/audit-update`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  internalFields: internalFields,
                  calendarId: targetCalendarId,
                  graphToken: graphToken
                })
              });
            }

            return createdEventData;
          }
        }

        throw new Error('Failed to create new event');
      }

      // Return the event data from the unified update
      return result.event || { id: eventId };
    };

    //---------------------------------------------------------------------------
    // DEPENDENT UTILITY FUNCTIONS - functions that depend on state or other functions
    //---------------------------------------------------------------------------
    /** 
     * Get dynamic locations from events and rooms, grouping virtual meetings
     */
    const getDynamicLocations = useCallback(() => {
      const locationsSet = new Set();

      // Add all locations from templeEvents__Locations collection (primary source)
      generalLocations.forEach(location => {
        if (location.name) {
          locationsSet.add(location.name);
        }
      });

      // Track if we need to add Unspecified or Virtual for events
      let hasEventsWithoutLocation = false;

      // Process events to find locations and check for special cases
      allEvents.forEach(event => {
        // First check if this event has a virtual meeting URL
        if (event.virtualMeetingUrl) {
          // This is a virtual meeting - use "Virtual Meeting" as the location
          const virtualLocation = generalLocations.find(loc =>
            loc.name && loc.name.toLowerCase() === 'virtual meeting'
          );
          if (virtualLocation) {
            locationsSet.add(virtualLocation.name);
          }
          return;
        }

        // Read from top-level locationDisplayNames (app field), not graphData.location.displayName
        const locationText = event.locationDisplayNames?.trim() || '';

        if (!locationText) {
          // Empty or null location - we'll need Unspecified
          hasEventsWithoutLocation = true;
          return;
        }

        // Split multiple locations by semicolon or comma
        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);

        if (eventLocations.length === 0) {
          // Empty location list - we'll need Unspecified
          hasEventsWithoutLocation = true;
          return;
        }

        // Add all locations from events
        eventLocations.forEach(location => {
          // Check if this location matches a general location name (case-insensitive)
          const matchingGeneral = generalLocations.find(loc =>
            loc.name && loc.name.toLowerCase() === location.toLowerCase()
          );

          if (matchingGeneral) {
            // Use the canonical name from the general locations database
            locationsSet.add(matchingGeneral.name);
          }
          // Note: We no longer add non-database locations
        });
      });

      // Add "Unspecified" if there are events without locations
      if (hasEventsWithoutLocation) {
        // Check if there's an "Unspecified" in the database
        const unspecifiedInDb = generalLocations.find(loc =>
          loc.name && loc.name.toLowerCase() === 'unspecified'
        );
        if (unspecifiedInDb) {
          locationsSet.add(unspecifiedInDb.name);
        } else {
          // Add "Unspecified" even if not in database
          locationsSet.add('Unspecified');
        }
      }

      // Convert to sorted array - alphabetical with Unspecified last
      const locationsArray = Array.from(locationsSet).sort((a, b) => {
        // Sort with Unspecified last
        if (a.toLowerCase() === 'unspecified' && b.toLowerCase() !== 'unspecified') return 1;
        if (b.toLowerCase() === 'unspecified' && a.toLowerCase() !== 'unspecified') return -1;

        return a.localeCompare(b);
      });

      // Return only database locations
      return locationsArray;
    }, [allEvents, generalLocations]);

    /**
     * Get categories: base categories from database + dynamic categories from events
     */
    const getDynamicCategories = useCallback(() => {
      const categoriesSet = new Set();

      // First, add all base categories from database
      if (baseCategories && baseCategories.length > 0) {
        baseCategories.forEach(cat => {
          if (cat.name && cat.name.trim() !== '') {
            categoriesSet.add(cat.name.trim());
          }
        });
      }

      // Then add dynamic categories from events
      allEvents.forEach(event => {
        let hasCategory = false;

        // Handle Graph API categories (plural array)
        if (event.categories && Array.isArray(event.categories)) {
          event.categories.forEach(cat => {
            if (cat && cat.trim() !== '') {
              categoriesSet.add(cat.trim());
              hasCategory = true;
            }
          });
        }

        // Handle legacy category (singular string) - fallback
        if (!hasCategory && event.category && event.category.trim() !== '') {
          categoriesSet.add(event.category.trim());
          hasCategory = true;
        }

        // If no category found, add 'Uncategorized'
        if (!hasCategory) {
          categoriesSet.add('Uncategorized');
        }
      });

      // Add fallback categories from Outlook when no base categories and no event categories
      if (categoriesSet.size === 0 || (categoriesSet.size === 1 && categoriesSet.has('Uncategorized'))) {
        // Use Outlook categories as fallback when no base categories and no events
        if (outlookCategories && outlookCategories.length > 0) {
          outlookCategories.forEach(cat => {
            if (cat.name && cat.name.trim() !== '') {
              categoriesSet.add(cat.name.trim());
            }
          });
          logger.debug('Added fallback categories from Outlook:', outlookCategories.length);
        }
      }

      // Convert to array and sort
      const categoriesArray = Array.from(categoriesSet).sort();

      // Categories extracted from events (or fallback categories if no events)

      // Add special options
      const finalCategories = [
        'Uncategorized',
        ...categoriesArray.filter(cat => cat !== 'Uncategorized')
      ];

      return finalCategories;
    }, [baseCategories, allEvents, outlookCategories]);
    
    /**
     * TBD
     */
    const isKnownCategory = useCallback((categoryName) => {
      if (isUncategorizedEvent({ category: categoryName })) {
        return true; 
      }
      return outlookCategories.some(cat => cat.name === categoryName);
    }, [outlookCategories, isUncategorizedEvent]);

    /**
     * TBD
     */
    const getDynamicLocationColor = useCallback((locationName) => {
      // Simple hash function to generate color
      const hash = locationName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      // Pre-defined colors for locations
      const colors = [
        '#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8E24AA',
        '#FB8C00', '#00ACC1', '#039BE5', '#795548', '#607D8B',
        '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3'
      ];
      
      return colors[Math.abs(hash) % colors.length];
    }, []);

    /**
     * TBD
     */
    const getDynamicCategoryColor = useCallback((categoryName) => {
      // Simple hash function to generate color
      const hash = categoryName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      // Pre-defined colors
      const colors = [
        '#FF6B6B', '#4ECDC4', '#556270', '#C7F464', '#FF8C94',
        '#9DE0AD', '#45ADA8', '#547980', '#594F4F', '#FE4365',
        '#83AF9B', '#FC9D9A', '#F18D9E', '#3A89C9', '#F9CDAD'
      ];
      
      return colors[Math.abs(hash) % colors.length];
    }, []); 

    /**
     * Get the color associated with a category from Outlook
     * @param {string} categoryName - The name of the category
     * @returns {string} The hex color code
     */
    const getCategoryColor = useCallback((categoryName) => {
      const category = outlookCategories.find(cat => cat.name === categoryName);
      
      if (category) {
        // Color mapping logic
        const colorMap = {
          'preset0': '#ff8c00',   // Orange
          'preset1': '#e51400',   // Red
          'preset2': '#60a917',   // Green
          'preset3': '#f472d0',   // Pink
          'preset4': '#00aba9',   // Teal
          'preset5': '#008a00',   // Dark Green
          'preset6': '#ba141a',   // Dark Red
          'preset7': '#fa6800',   // Dark Orange
          'preset8': '#1ba1e2',   // Blue
          'preset9': '#0050ef',   // Dark Blue
          'preset10': '#6a00ff',  // Purple
          'preset11': '#aa00ff',  // Dark Purple
          'preset12': '#825a2c',  // Brown
          'preset13': '#6d8764',  // Olive
          'preset14': '#647687',  // Steel
          'preset15': '#76608a',  // Mauve
        };
        return colorMap[category.color] || '#cccccc';
      } else if (isUncategorizedEvent({ category: categoryName })) {
        return '#cccccc'; // Default gray for uncategorized
      } else {
        return getDynamicCategoryColor(categoryName);
      }
    }, [outlookCategories, isUncategorizedEvent, getDynamicCategoryColor]);

    /**
     * Get the color associated with a location
     * @param {string} locationName - The name of the location
     * @returns {string} The hex color code
     */
    const getLocationColor = useCallback((locationName) => {
      // Map location names to specific colors
      const locationColorMap = {
        'TPL': '#4285F4', // Blue
        'CPL': '#EA4335', // Red
        'MUS': '#FBBC05', // Yellow
        'Nursery School': '#34A853', // Green
        '402': '#8E24AA', // Purple
        '602': '#FB8C00', // Orange
        'Virtual': '#00ACC1', // Cyan
        'Microsoft Teams Meeting': '#039BE5', // Light Blue
        'Unspecified': '#9E9E9E' // Gray
      };
      
      return locationColorMap[locationName] || getDynamicLocationColor(locationName);
      // return locationColorMap[locationName] || '#9E9E9E';
    }, [getDynamicLocationColor]);

    /**
     * TBD
     */
    const getEventContentStyle = useCallback((viewType) => {
      switch(viewType) {
        case 'day':
          return {
            fontSize: '14px',
            lineHeight: '1.4',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical'
          };
        // Other cases...
        default:
          return {};
      }
    }, []);

    /**
     * TBD
     */
    const renderEventContent = useCallback((event, viewType) => {
      const styles = getEventContentStyle(viewType);
           
      return (
        <>
          <div className="event-time" style={styles}>
            {formatEventTime(event.start.dateTime, userTimezone, event.subject)}
            {viewType !== 'month' && ` - ${formatEventTime(event.end.dateTime, userTimezone, event.subject)}`}
          </div>
          
          <div className="event-title" style={styles}>
            {event.subject}
          </div>
          
          {viewType !== 'month' && event.location?.displayName && (
            <div className="event-location" style={styles}>
              {event.location.displayName}
            </div>
          )}
          
          {viewType === 'day' && 
            Object.entries(event).filter(([key, value]) => 
              key !== 'id' && 
              key !== 'subject' && 
              key !== 'start' && 
              key !== 'end' && 
              key !== 'location' && 
              key !== 'category' &&
              key !== 'extensions' &&
              key !== 'calendarId' && 
              key !== 'organizer' && 
              key !== 'body' &&
              key !== 'isAllDay' &&
              value !== undefined &&
              value !== null &&
              value !== ''
            ).map(([key, value]) => (
              <div key={key} className="event-extension" style={styles}>
                <small>{key}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value.toString()}</small>
              </div>
            ))
          }
        </>
      );
    }, [getEventContentStyle, userTimezone]);

    //---------------------------------------------------------------------------
    // MEMOIZED VALUES - derived state
    //---------------------------------------------------------------------------
    /**
     * TBD
     */
    const getWeekdayHeaders = useCallback(() => {
      const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      if (userPermissions.startOfWeek === 'Sunday') {
        weekdays.unshift(weekdays.pop());
      }
      return weekdays;
    }, [userPermissions.startOfWeek]);

    /**
     * TBD
     */
    const getEventsForDay = useCallback((day) => {
      return allEvents.filter(event => {
        const eventDate = new Date(event.start.dateTime);
        return (
          eventDate.getFullYear() === day.getFullYear() &&
          eventDate.getMonth() === day.getMonth() &&
          eventDate.getDate() === day.getDate()
        );
      });
    }, [allEvents]);

    /**
     * TBD
     */
    const getMonthWeeks = useCallback(() => {
      const days = [];
      const year = dateRange.start.getFullYear();
      const month = dateRange.start.getMonth();
      
      // Get first day of month and last day of month
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      // Get days from previous month to fill first week
      const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      // Adjust based on user preference for start of week
      const startOfWeekIndex = userPermissions.startOfWeek === 'Sunday' ? 0 : 1; // 0 for Sunday, 1 for Monday
      
      // Calculate how many days from previous month to include
      let prevMonthDays;
      if (startOfWeekIndex === 0) { // Sunday start
        prevMonthDays = firstDayOfWeek;
      } else { // Monday start
        prevMonthDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
      }
      
      for (let i = prevMonthDays; i > 0; i--) {
        const day = new Date(year, month, 1 - i);
        days.push({ date: day, isCurrentMonth: false });
      }
      
      // Add all days from current month (same as before)
      for (let i = 1; i <= lastDay.getDate(); i++) {
        const day = new Date(year, month, i);
        days.push({ date: day, isCurrentMonth: true });
      }
      
      // Add days from next month to complete the grid
      const totalDaysAdded = days.length;
      const nextMonthDays = Math.ceil(totalDaysAdded / 7) * 7 - totalDaysAdded;
      
      for (let i = 1; i <= nextMonthDays; i++) {
        const day = new Date(year, month + 1, i);
        days.push({ date: day, isCurrentMonth: false });
      }
      
      // Group days into weeks
      const weeks = [];
      for (let i = 0; i < days.length; i += 7) {
        weeks.push(days.slice(i, i + 7));
      }
      
      return weeks;
    }, [dateRange.start, userPermissions.startOfWeek]);

    /**
     * Get all days within the current date range for the calendar view
     * @returns {Array} Array of Date objects for each day in the range
     */
    const getDaysInRange = useCallback(() => {
      const days = [];
      const currentDate = new Date(dateRange.start);
      
      while (currentDate <= dateRange.end) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return days;
    }, [dateRange.start, dateRange.end]);

    const dynamicLocations = useMemo(() => getDynamicLocations(), [getDynamicLocations]);
    const dynamicCategories = useMemo(() => getDynamicCategories(), [getDynamicCategories]);

    /**
     * Get location names from database (generalLocations) for simple arrays
     */
    const getDatabaseLocationNames = useCallback(() => {
      return generalLocations.map(location => location.name).filter(name => name);
    }, [generalLocations]);

    /**
     * Get filtered locations for MultiSelect components (EventForm)
     * Returns only locations from templeEvents__Locations database collection
     */
    const getFilteredLocationsForMultiSelect = useCallback(() => {
      return getDatabaseLocationNames();
    }, [getDatabaseLocationNames]);

    /**
     * Normalize location name for matching
     * Handles common abbreviations and variations
     */
    const normalizeLocationName = useCallback((locationName) => {
      if (!locationName) return '';

      let normalized = locationName.toLowerCase().trim();

      // Handle common abbreviations
      normalized = normalized
        .replace(/\bconf\.\s*/gi, 'conference ')
        .replace(/\bconference\b/gi, 'conf')
        .replace(/\brm\b\.?\s*/gi, 'room ')
        .replace(/\broom\s+(\d+)/gi, '$1')  // "Room 402" -> "402"
        .replace(/\bfloor\b/gi, 'fl')
        .replace(/\bfl\b\.?\s*/gi, 'floor ')
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();

      return normalized;
    }, []);

    /**
     * Check if two location names match (case-insensitive, handles abbreviations)
     */
    const locationsMatch = useCallback((loc1, loc2) => {
      if (!loc1 || !loc2) return false;

      const norm1 = normalizeLocationName(loc1);
      const norm2 = normalizeLocationName(loc2);

      // Direct match
      if (norm1 === norm2) return true;

      // Check if one contains the other (for partial matches)
      if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

      return false;
    }, [normalizeLocationName]);

    /**
     * Filter and sort events based on selected categories and locations
     */
    const filteredEvents = useMemo(() => {
      console.log('\n========== FILTERING ALL EVENTS ==========');
      console.log('[Filter] Starting filter, allEvents count:', allEvents.length);
      console.log('[Filter] Date range:', dateRange);

      // Log all events before filtering
      allEvents.forEach((event, index) => {
        console.log(`\n[Event ${index + 1}/${allEvents.length}] "${event.subject}"`);
        console.log(`  Start: ${event.start?.dateTime}`);
        console.log(`  End: ${event.end?.dateTime}`);
        console.log(`  Location: ${event.location?.displayName || 'NONE'}`);
        console.log(`  Category: ${event.category || 'NONE'}`);
      });
      console.log('\n========== STARTING FILTER LOGIC ==========\n');

      const filtered = allEvents.filter(event => {
        console.log(`\n[Filter] Processing event: "${event.subject}"`);

        // UNIFIED FILTERING FOR ALL VIEWS - Use same logic for month, week, and day
        let categoryMatch = true;
        let locationMatch = true;

        // CATEGORY FILTERING - Show all events if all categories are selected
        if (selectedCategories.length === 0) {
          // No categories selected = show NO events
          categoryMatch = false;
          console.log(`[Category Filter] Event "${event.subject}" - NO categories selected, categoryMatch: false`);
        } else if (selectedCategories.length === dynamicCategories.length) {
          // All categories selected = show ALL events regardless of category
          categoryMatch = true;
          console.log(`[Category Filter] Event "${event.subject}" - ALL categories selected, categoryMatch: true`);
        } else {
          // Partial categories selected, check if event matches
          if (isUncategorizedEvent(event)) {
            categoryMatch = selectedCategories.includes('Uncategorized');
            console.log(`[Category Filter] Event "${event.subject}" is Uncategorized, categoryMatch: ${categoryMatch}`);
          } else if (dynamicCategories.includes(event.category)) {
            categoryMatch = selectedCategories.includes(event.category);
            console.log(`[Category Filter] Event "${event.subject}" category "${event.category}", categoryMatch: ${categoryMatch}`);
          } else {
            // For unknown categories, only show if explicitly selected
            categoryMatch = selectedCategories.includes(event.category);
            console.log(`[Category Filter] Event "${event.subject}" unknown category "${event.category}", categoryMatch: ${categoryMatch}`);
          }
        }

        // LOCATION FILTERING - Show all events if all locations are selected
        if (selectedLocations.length === 0) {
          // No locations selected = show NO events
          locationMatch = false;
        } else if (selectedLocations.length === dynamicLocations.length) {
          // All locations selected = show ALL events regardless of location
          locationMatch = true;
        } else {
          // Partial locations selected, check if event matches
          // Check for virtual meeting first
          if (event.virtualMeetingUrl) {
            // This is a virtual meeting - check if "Virtual Meeting" is selected
            locationMatch = selectedLocations.includes('Virtual Meeting');
            console.log(`[Location Filter] Event "${event.subject}" is virtual meeting, match: ${locationMatch}`);
          }
          // Handle unspecified locations
          else if (isUnspecifiedLocation(event)) {
            locationMatch = selectedLocations.includes('Unspecified');
          }
          // Handle all events with locations
          else {
            // Read from top-level locationDisplayNames (app field), not graphData.location.displayName
            const locationText = event.locationDisplayNames?.trim() || '';
            const eventLocations = locationText
              .split(/[;,]/)
              .map(loc => loc.trim())
              .filter(loc => loc.length > 0);

            if (eventLocations.length === 0) {
              // Edge case: location parsing resulted in empty - treat as Unspecified
              locationMatch = selectedLocations.includes('Unspecified');
            } else {
              // Check if any event location matches selected locations (with abbreviation handling)
              locationMatch = eventLocations.some(location => {
                const matches = selectedLocations.some(selectedLoc =>
                  locationsMatch(location, selectedLoc)
                );
                console.log(`[Location Filter] Event "${event.subject}" location "${location}" matches: ${matches}`);
                return matches;
              });
              console.log(`[Location Filter] Event "${event.subject}" final locationMatch: ${locationMatch}`);
            }
          }
        }

        // Event must pass BOTH category AND location filters
        const finalResult = categoryMatch && locationMatch;
        console.log(`[Filter] Event "${event.subject}" FINAL: categoryMatch=${categoryMatch}, locationMatch=${locationMatch}, result=${finalResult}\n`);
        return finalResult;
      });
      
      // Sort the filtered events by start time
      const sorted = [...filtered].sort((a, b) => {
        const aStartTime = new Date(a.start.dateTime);
        const bStartTime = new Date(b.start.dateTime);

        if (aStartTime.getTime() !== bStartTime.getTime()) {
          return aStartTime - bStartTime;
        }

        const aEndTime = new Date(a.end.dateTime);
        const bEndTime = new Date(b.end.dateTime);
        return aEndTime - bEndTime;
      });

      // Log filter summary (only when events are filtered out)
      if (allEvents.length > 0 && sorted.length !== allEvents.length) {
        logger.info(`\n🔍 FILTER SUMMARY`);
        logger.info(`   Total events: ${allEvents.length}`);
        logger.info(`   After filters: ${sorted.length}`);
        logger.info(`   Filtered out: ${allEvents.length - sorted.length}`);
        logger.info(`   Selected categories: ${selectedCategories.length}/${dynamicCategories.length}`);
        logger.info(`   Selected locations: ${selectedLocations.length}/${dynamicLocations.length}`);
      }

      return sorted;
    }, [
      allEvents,
      selectedCategories,
      selectedLocations,
      dynamicCategories,
      dynamicLocations,
      isUncategorizedEvent,
      isUnspecifiedLocation,
      locationsMatch
    ]);

    /**
     * TBD
     */
    const getLocationGroups = useCallback(() => {
      if (groupBy !== 'locations') return {};

      console.log('[Location Grouping] Starting location grouping');
      console.log('[Location Grouping] selectedLocations:', selectedLocations);
      console.log('[Location Grouping] filteredEvents count:', filteredEvents.length);

      const groups = {};

      // Build a map of location ObjectId -> location object for quick lookup
      const locationIdMap = new Map();
      generalLocations.forEach(loc => {
        if (loc._id) {
          locationIdMap.set(loc._id.toString(), loc);
        }
      });

      // Initialize groups for all selected locations
      // selectedLocations contains location name strings
      selectedLocations.forEach(locationName => {
        // Find the location object from generalLocations
        const locationObj = generalLocations.find(loc => loc.name === locationName);

        groups[locationName] = {
          locationId: locationObj?._id?.toString() || null,
          displayName: locationName,
          events: []
        };
      });

      // Group filtered events by their actual location
      filteredEvents.forEach((event) => {
        // Check for virtual meeting first
        if (event.virtualMeetingUrl) {
          if (!groups['Virtual Meeting']) {
            groups['Virtual Meeting'] = {
              locationId: null,
              displayName: 'Virtual Meeting',
              events: []
            };
          }
          groups['Virtual Meeting'].events.push(event);
          console.log(`[Location Grouping] Event "${event.subject}" added to Virtual Meeting group`);
        } else if (isUnspecifiedLocation(event)) {
          if (!groups['Unspecified']) {
            groups['Unspecified'] = {
              locationId: null,
              displayName: 'Unspecified',
              events: []
            };
          }
          groups['Unspecified'].events.push(event);
        } else {
          // Handle all events with locations array (ObjectIds)
          if (event.locations && Array.isArray(event.locations) && event.locations.length > 0) {
            // Event has location ObjectIds - use them for direct matching
            let addedToAnyGroup = false;

            event.locations.forEach(locationId => {
              const locationIdStr = locationId.toString();
              console.log(`[Location Grouping] Event "${event.subject}" has locationId "${locationIdStr}"`);

              // Find the group with matching locationId
              const matchingGroupKey = Object.keys(groups).find(groupKey => {
                const group = groups[groupKey];
                return group.locationId === locationIdStr;
              });

              console.log(`[Location Grouping] Matching group found: ${matchingGroupKey}`);

              if (matchingGroupKey) {
                groups[matchingGroupKey].events.push(event);
                addedToAnyGroup = true;
              } else {
                console.warn(`[Location Grouping] No matching group for event "${event.subject}" with locationId "${locationIdStr}"`);
              }
            });

            // If event has locations but wasn't added to any recognized group, add to Unspecified
            if (!addedToAnyGroup) {
              console.log(`[Location Grouping] Event "${event.subject}" has unrecognized location, adding to Unspecified`);
              if (!groups['Unspecified']) {
                groups['Unspecified'] = {
                  locationId: null,
                  displayName: 'Unspecified',
                  events: []
                };
              }
              groups['Unspecified'].events.push(event);
            }
          } else {
            // Fallback for events without locations array - treat as Unspecified
            console.log(`[Location Grouping] Event "${event.subject}" has no locations array, adding to Unspecified`);
            if (!groups['Unspecified']) {
              groups['Unspecified'] = {
                locationId: null,
                displayName: 'Unspecified',
                events: []
              };
            }
            groups['Unspecified'].events.push(event);
          }
        }
      });

      return groups;
    }, [groupBy, selectedLocations, filteredEvents, isUnspecifiedLocation, generalLocations]);
    

    /**
     * TBD
     */
    const getFilteredMonthEvents = useCallback((day) => {
      if (!selectedFilter) return [];
      
      // Use allEvents directly instead of filteredEvents
      return allEvents.filter(event => {
        // First filter by date
        if (!getMonthDayEventPosition(event, day)) return false;
        
        // Then apply all the same filters used in filteredEvents
        // Remove unused eventDate variable
        // const eventDate = new Date(event.start.dateTime);
        
        // Filter by category or location based on groupBy
        if (groupBy === 'categories') {
          if (isUncategorizedEvent(event)) {
            return selectedFilter === 'Uncategorized';
          }
          return event.category === selectedFilter;
        } else {
          // For locations
          const eventLocations = event.location?.displayName 
            ? event.location.displayName.split('; ').map(loc => loc.trim())
            : [];
            
          if (selectedFilter === 'Unspecified') {
            return eventLocations.length === 0 || eventLocations.every(loc => loc === '');
          } else {
            return eventLocations.includes(selectedFilter);
          }
        }
      });
    }, [selectedFilter, allEvents, getMonthDayEventPosition, dateRange.start, dateRange.end, groupBy, isKnownCategory, isUncategorizedEvent]);

    /**
     * Create default categories in Outlook if none exist
     */
    const createDefaultCategories = async () => {
      try {
        const defaultCategories = [
        ];
        
        const createdCategories = [];
        
        for (const cat of defaultCategories) {
          const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${graphToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(cat)
          });
          
          if (response.ok) {
            const data = await response.json();
            createdCategories.push({
              id: data.id,
              name: data.displayName,
              color: data.color
            });
          } else {
            logger.error(`Failed to create category ${cat.displayName}`);
          }
        }
        
        setOutlookCategories(createdCategories);
        return createdCategories;
      } catch (err) {
        logger.error('Error creating default categories:', err);
        return [];
      }
    };

    /**
     * Create a new category in Outlook
     * @param {string} categoryName - The name of the new category
     * @returns {Object|null} The created category or null if failed
     */
    const createOutlookCategory = useCallback(async (categoryName) => {
      try {
        // Define a list of possible colors to use
        const colors = [
          'preset0', 'preset1', 'preset2', 'preset3', 'preset4', 
          'preset5', 'preset6', 'preset7', 'preset8', 'preset9',
          'preset10', 'preset11', 'preset12', 'preset13', 'preset14', 'preset15'
        ];
        
        // Pick a random color
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            displayName: categoryName,
            color: randomColor
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          logger.error(`Failed to create category ${categoryName}:`, errorData);
          return null;
        }
        
        const data = await response.json();
        logger.debug(`Created new Outlook category: ${categoryName}`, data);
        
        // Add the new category to the local state
        const newCategory = {
          id: data.id,
          name: data.displayName,
          color: data.color
        };
        
        setOutlookCategories(prev => [...prev, newCategory]);
        
        return newCategory;
      } catch (err) {
        logger.error(`Error creating category ${categoryName}:`, err);
        return null;
      }
    }, [graphToken]);
    
    //---------------------------------------------------------------------------
    // EVENT HANDLERS
    //---------------------------------------------------------------------------
    const handleDatePickerChange = useCallback((selectedDate) => {
      setCurrentDate(new Date(selectedDate));
    }, []);

    const handleEventSelect = (event, viewOnly = false) => {
      // Close the search panel
      setShowSearch(false);
      
      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);
      
      // Set calendar to day view centered on the event date
      setViewType('day');
      setDateRange({
        start: eventDate,
        end: calculateEndDate(eventDate, 'day')
      });
      
      // Only open the edit form if not viewOnly
      if (!viewOnly) {
        setCurrentEvent(event);
        setModalType('edit');
        setIsModalOpen(true);
      }
    };

    /**
     * Handle the month filter change
     */
    const handleCategoryFilterChange = useCallback((value) => {
      setSelectedCategoryFilter(value);
    }, []);

    /**
     * Handle location filter change in month view
     */
    const handleLocationFilterChange = useCallback((value) => {
      setSelectedLocationFilter(value);
    }, []);

    /**
     * Add this new handler for the month filter dropdown
     * 
     */
    const handleMonthFilterChange = useCallback((value) => {
      setSelectedFilter(value);
    },[]);

    /**
     * Handle calendar zoom in and zoom out
     * @param {string} direction - The new direction
     */
    // 
    const handleZoom = useCallback((direction) => {
      if (direction === 'in' && zoomLevel < 150) {
        setZoomLevel(zoomLevel + 10);
      } else if (direction === 'out' && zoomLevel > 70) {
        setZoomLevel(zoomLevel - 10);
      }
    },[zoomLevel]);

    /**
     * Open the Add, Edit, Delete, Save modal
     */
    const handleAddEvent = useCallback(() => {
      logger.debug('handleAddEvent called');
      logger.debug('Permissions:', userPermissions);

      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);

      // Check if user can edit the selected calendar
      if (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit) {
        showNotification("You don't have permission to create events in this calendar");
        return;
      }

      // Determine mode based on permissions
      // Users WITH createEvents permission: create events directly (mode='event')
      // Users WITHOUT createEvents permission: create reservation requests (mode='create')
      const mode = userPermissions.createEvents ? 'event' : 'create';

      // Create blank event template with current date/time
      const now = new Date();
      const startTime = new Date(now);
      startTime.setHours(9, 0, 0, 0); // Default to 9 AM

      const endTime = new Date(startTime);
      endTime.setHours(startTime.getHours() + 1); // 1 hour duration

      // Create reservation object structure (not event structure)
      // RoomReservationReview expects reservation fields like startDateTime, eventTitle, etc.
      const newReservation = {
        // Submitter Information
        requesterName: currentUser?.name || '',
        requesterEmail: currentUser?.email || '',
        department: '',
        phone: '',
        contactEmail: '',
        contactName: '',
        isOnBehalfOf: false,

        // Event Details
        eventTitle: '',
        eventDescription: '',
        startDateTime: standardizeDate(startTime),
        endDateTime: standardizeDate(endTime),
        isAllDayEvent: false,

        // Location & Setup
        requestedRooms: [],
        setupTime: '',
        teardownTime: '',
        doorOpenTime: '',
        doorCloseTime: '',
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        setupNotes: '',
        doorNotes: '',
        eventNotes: '',

        // Additional Details
        attendeeCount: '',
        specialRequirements: '',
        reviewNotes: '',

        // Calendar Info
        calendarId: selectedCalendarId,
        calendarName: selectedCalendar?.name,

        // Virtual Meeting
        virtualMeetingUrl: null,
        graphData: null
      };

      // Open ReviewModal with appropriate mode
      setEventReviewModal({
        isOpen: true,
        event: newReservation,
        mode: mode,
        hasChanges: false
      });

      logger.debug('EventReviewModal opened for adding new event', { mode });
    }, [availableCalendars, userPermissions.createEvents, selectedCalendarId, showNotification, standardizeDate, currentUser]);

    /**
     * Handle changing the calendar view type (day/week/month)
     * @param {string} newView - The new view type
     */
    const handleViewChange = useCallback((newView) => {
      setViewType(newView);
      // currentDate stays the same, dateRange will recalculate via useMemo
    }, []);

    /**
     * Handle viewing an event in the calendar
     * @param {Object} event - The event object
     * @param {Date} eventDate - The date of the event
     */
    const handleViewInCalendar = (event) => {
      logger.debug("View in calendar clicked", event); // Add debugging
      
      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);
      
      // Set calendar to day view centered on the event date
      setViewType('day');
      setDateRange({
        start: eventDate,
        end: calculateEndDate(eventDate, 'day')
      });
    };

    /**
     * Navigate to today
     */
    const handleToday = useCallback(() => {
      setCurrentDate(new Date());
    }, []);

    /**
     * Navigate to the next time period
     */
    const handleNext = useCallback(() => {
      let newDate = new Date(currentDate);
      
      switch(viewType) {
        case 'day':
          newDate.setDate(newDate.getDate() + 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() + 7);
          break;
        case 'month':
          newDate.setMonth(newDate.getMonth() + 1);
          break;
      }
      
      setCurrentDate(newDate);
    }, [viewType, currentDate]);

    /**
     * Navigate to the previous time period
     */
    const handlePrevious = useCallback(() => {
      let newDate = new Date(currentDate);
      
      switch(viewType) {
        case 'day':
          newDate.setDate(newDate.getDate() - 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() - 7);
          break;
        case 'month':
          newDate.setMonth(newDate.getMonth() - 1);
          break;
      }
      
      setCurrentDate(newDate);
    }, [viewType, currentDate]);

    const handleDayCellClick = useCallback(async (day, category = null, location = null) => {
      // Determine mode based on permissions
      // Users WITH createEvents permission: create events directly (mode='event')
      // Users WITHOUT createEvents permission: create reservation requests (mode='create')
      const mode = userPermissions.createEvents ? 'event' : 'create';

      // Get the date string without times - let user fill in times
      const dateString = day.toISOString().split('T')[0];

      // Set the category based on what view we're in
      let eventCategory = 'Uncategorized';
      let eventLocation = 'Unspecified';

      if (groupBy === 'categories' && category) {
        eventCategory = category;

        // Check if this category exists in Outlook categories
        if (category !== 'Uncategorized') {
          const categoryExists = outlookCategories.some(cat => cat.name === category);

          if (!categoryExists) {
            logger.debug(`Category ${category} doesn't exist in Outlook categories, creating it...`);
            await createOutlookCategory(category);
          }
        }
      } else if (groupBy === 'locations' && location && location !== 'Unspecified') {
        eventLocation = location;
      }

      // Create reservation object structure (not event structure)
      // RoomReservationReview expects reservation fields like startDateTime, eventTitle, etc.
      const newReservation = {
        // Submitter Information
        requesterName: currentUser?.name || '',
        requesterEmail: currentUser?.email || '',
        department: '',
        phone: '',
        contactEmail: '',
        contactName: '',
        isOnBehalfOf: false,

        // Event Details
        eventTitle: '',
        eventDescription: '',
        startDate: dateString,
        startTime: '',
        endDate: dateString,
        endTime: '',
        isAllDayEvent: false,

        // Location & Setup
        locations: (() => {
          // Convert location display name to ObjectId reference
          if (groupBy === 'locations' && eventLocation !== 'Unspecified') {
            const locationDoc = rooms.find(loc =>
              loc.name === eventLocation || loc.displayName === eventLocation
            );
            return locationDoc ? [locationDoc._id] : [];
          }
          return [];
        })(),
        setupTime: '',
        teardownTime: '',
        doorOpenTime: '',
        doorCloseTime: '',
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        setupNotes: '',
        doorNotes: '',
        eventNotes: '',

        // Additional Details
        attendeeCount: '',
        specialRequirements: '',
        reviewNotes: '',

        // Calendar Info
        calendarId: selectedCalendarId,
        calendarName: availableCalendars.find(cal => cal.id === selectedCalendarId)?.name,

        // Virtual Meeting
        virtualMeetingUrl: null,
        graphData: null
      };

      // Open ReviewModal with appropriate mode
      setEventReviewModal({
        isOpen: true,
        event: newReservation,
        mode: mode,
        hasChanges: false
      });

      logger.debug('EventReviewModal opened from day cell click', { mode, day });
    }, [userPermissions.createEvents, groupBy, selectedCalendarId, availableCalendars, outlookCategories, createOutlookCategory, standardizeDate, currentUser]);

    /**
     * Handle clicking on a location row to open timeline modal
     * @param {string} locationName - The name of the location
     * @param {Date|Array<Date>} dateOrDates - Single date for day view, array of dates for week view
     * @param {string} viewType - 'day' or 'week'
     * @param {string|null} locationId - Optional ObjectId of the location for precise matching
     */
    const handleLocationRowClick = useCallback((locationName, dateOrDates, viewType, locationId = null) => {
      // Filter events by location and date range
      let filteredModalEvents = [];
      let dateRangeArray = [];

      if (viewType === 'week' && Array.isArray(dateOrDates)) {
        // Week view: dateOrDates is array of Date objects
        const startDate = dateOrDates[0];
        const endDate = dateOrDates[dateOrDates.length - 1];

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        dateRangeArray = [formatDate(startDate), formatDate(endDate)];

        // Filter events within date range and matching location
        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start?.dateTime || event.startDateTime);

          // Check date range
          const inDateRange = eventStart >= startDate &&
            eventStart <= new Date(endDate.getTime() + 24 * 60 * 60 * 1000);

          if (!inDateRange) return false;

          // Check location match using ObjectId if available
          if (locationId) {
            // Direct ObjectId matching
            return event.locations && Array.isArray(event.locations) &&
              event.locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!event.virtualMeetingUrl;
            } else if (locationName === 'Unspecified') {
              return isUnspecifiedLocation(event);
            }
            return false;
          }
        });
      } else if (viewType === 'day') {
        // Day view: dateOrDates is a single Date object
        const currentDay = dateOrDates;
        const year = currentDay.getFullYear();
        const month = String(currentDay.getMonth() + 1).padStart(2, '0');
        const day = String(currentDay.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        dateRangeArray = [dateStr, dateStr]; // Same start and end for single day

        // Filter events for this specific day and location
        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start?.dateTime || event.startDateTime);
          const eventDateStr = `${eventStart.getFullYear()}-${String(eventStart.getMonth() + 1).padStart(2, '0')}-${String(eventStart.getDate()).padStart(2, '0')}`;

          // Check date match
          if (eventDateStr !== dateStr) return false;

          // Check location match using ObjectId if available
          if (locationId) {
            // Direct ObjectId matching
            return event.locations && Array.isArray(event.locations) &&
              event.locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!event.virtualMeetingUrl;
            } else if (locationName === 'Unspecified') {
              return isUnspecifiedLocation(event);
            }
            return false;
          }
        });
      }

      logger.debug(`Found ${filteredModalEvents.length} events for location "${locationName}" (ID: ${locationId})`, filteredModalEvents);

      // Open the appropriate timeline modal
      setTimelineModal({
        isOpen: true,
        locationName,
        locationId, // Include locationId for future use
        dateRange: dateRangeArray,
        events: filteredModalEvents,
        viewType
      });
    }, [isUnspecifiedLocation]);

    /**
     * Handle clicking on an event to open the context menu
     * @param {Object} event - The event that was clicked
     * @param {Object} e - The click event
     */
    const handleEventClick = useCallback((event, e) => {
      e.stopPropagation();

      // DEBUG: Log full event object
      console.log('📦 FULL EVENT OBJECT:', event);

      // Bypass event details modal - go directly to review modal
      (async () => {
        try {
          // Events now have top-level fields from backend - no transformation needed
          await reviewModal.openModal(event);
        } catch (error) {
          logger.error('Error opening review modal:', error);
          alert('Failed to open review modal: ' + error.message);
        }
      })();
    }, [reviewModal]); // Updated dependency for direct review modal access

    /**
     * Handle review button click
     * Opens the review modal for the selected event
     */
    const handleReviewClick = useCallback(async (event) => {
      // Close the event form modal
      setIsModalOpen(false);

      // Use the event data we already have - no transformation needed
      try {
        // Events now have top-level fields from backend
        await reviewModal.openModal(event);
      } catch (error) {
        logger.error('Error opening review modal:', error);
        alert('Failed to open review modal: ' + error.message);
      }
    }, [reviewModal]);

    /**
     * TBD
     * @returns
     */
    const handleDeleteEvent = () => {
      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
    
      if (!userPermissions.deleteEvents || (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit)) {
        showNotification("You don't have permission to delete events in this calendar");
        return;
      }
      
      // Show modal confirmation
      setModalType('delete');
      setIsModalOpen(true);
    };

    /**
     * TBD
     */
    const handleSaveDemoEvent = async (data) => {
      const isNew = !data.id || data.id.includes('demo_event_') || data.id.includes('event_');
      
      try {
        // Initialize the service
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Save through the service (demo mode)
        if (isNew) {
          await calendarDataService.createEvent(data);
        } else {
          await calendarDataService.updateEvent(data);
        }
        
        // Reload demo events to show changes
        await loadDemoEvents();
        
        logger.debug(`[handleSaveDemoEvent] ${isNew ? 'Created' : 'Updated'} demo event:`, data.subject);
        return true;
        
      } catch (error) {
        logger.error('Demo save failed:', error);
        throw error;
      }
    };

    /**
     * Handle creation of registration events for TempleEvents
     * @param {Object} eventData - The event data that was just saved
     * @param {string} calendarId - The calendar ID where the event was saved
     */
    const handleRegistrationEventCreation = async (eventData, calendarId) => {
      try {
        logger.debug('handleRegistrationEventCreation called with:', {
          calendarId,
          availableCalendars: availableCalendars.map(c => ({ id: c.id, name: c.name })),
          eventData: { 
            id: eventData.id, 
            subject: eventData.subject,
            createRegistrationEvent: eventData.createRegistrationEvent,
            setupMinutes: eventData.setupMinutes,
            teardownMinutes: eventData.teardownMinutes
          }
        });
        
        // Find the current calendar info
        const currentCalendar = availableCalendars.find(cal => cal.id === calendarId);
        if (!currentCalendar) {
          logger.debug('Calendar not found, skipping registration event creation');
          return;
        }

        // Check if this is a TempleEvents calendar (temporarily disabled for testing)
        const isTempleEventsCalendar = currentCalendar.name && 
          currentCalendar.name.toLowerCase().includes('templeevents');

        // TODO: Re-enable this check for production
        // if (!isTempleEventsCalendar) {
        //   logger.debug('Not a TempleEvents calendar, skipping registration event creation');
        //   return;
        // }
        
        logger.debug(`Creating registration event for calendar: ${currentCalendar.name} (TempleEvents: ${isTempleEventsCalendar})`);
        logger.debug('Event data for registration:', {
          createRegistrationEvent: eventData.createRegistrationEvent,
          setupMinutes: eventData.setupMinutes,
          teardownMinutes: eventData.teardownMinutes
        });

        // Check if registration event creation is enabled
        if (!eventData.createRegistrationEvent) {
          logger.debug('Registration event creation disabled, skipping');
          return;
        }

        // Check if setup/teardown times are specified
        const hasSetupTeardown = (eventData.setupMinutes && eventData.setupMinutes > 0) || 
                                (eventData.teardownMinutes && eventData.teardownMinutes > 0);

        if (!hasSetupTeardown) {
          logger.debug('No setup/teardown times specified, skipping registration event creation');
          return;
        }

        // Find Temple Event Registrations calendar (check various naming patterns)
        const registrationCalendar = availableCalendars.find(cal => 
          cal.name && (
            cal.name.toLowerCase().includes('templeregistrations') ||
            cal.name.toLowerCase().includes('temple event registrations') ||
            cal.name.toLowerCase().includes('temple registrations')
          )
        );

        if (!registrationCalendar) {
          logger.debug('Temple Registrations calendar not found, skipping registration event creation');
          logger.debug('Available calendars:', availableCalendars.map(c => c.name));
          return;
        }

        // Prepare main event data (this will be created or updated)
        const mainEventData = {
          subject: eventData.subject,
          start: eventData.start,
          end: eventData.end,
          location: eventData.location,
          categories: eventData.categories || [],
          body: eventData.body,
          isAllDay: eventData.isAllDay || false
        };

        // Calculate extended times
        const originalStart = new Date(eventData.start.dateTime);
        const originalEnd = new Date(eventData.end.dateTime);
        
        const setupMinutes = eventData.setupMinutes || 0;
        const teardownMinutes = eventData.teardownMinutes || 0;
        
        const registrationStart = new Date(originalStart.getTime() - (setupMinutes * 60 * 1000));
        const registrationEnd = new Date(originalEnd.getTime() + (teardownMinutes * 60 * 1000));

        // Create registration event data
        const registrationEventData = {
          subject: `[SETUP/TEARDOWN] ${eventData.subject}`,
          start: {
            dateTime: formatDateObjectForGraph(registrationStart),
            timeZone: eventData.start.timeZone || 'UTC'
          },
          end: {
            dateTime: formatDateObjectForGraph(registrationEnd),
            timeZone: eventData.end.timeZone || 'UTC'
          },
          location: eventData.location,
          categories: ['Security/Maintenance'],
          body: {
            content: `Setup and teardown time for: ${eventData.subject}\n\n` +
                    `Original event: ${originalStart.toLocaleString()} - ${originalEnd.toLocaleString()}\n` +
                    `Setup time: ${setupMinutes} minutes before\n` +
                    `Teardown time: ${teardownMinutes} minutes after\n\n` +
                    `${eventData.assignedTo ? `Assigned to: ${eventData.assignedTo}\n\n` : ''}` +
                    `${eventData.registrationNotes ? `Notes: ${eventData.registrationNotes}\n\n` : ''}` +
                    `This event is for security and maintenance staff to prepare and clean up the venue.`,
            contentType: 'text'
          },
          isAllDay: eventData.isAllDay || false
        };

        // Use new linked events creation for new events
        if (!eventData.id) {
          logger.debug('Creating new linked events with extended properties');
          
          const linkedEvents = await createLinkedEvents(
            graphToken,
            mainEventData,
            registrationEventData,
            calendarId,
            registrationCalendar.id
          );
          
          logger.debug('Successfully created linked events:', {
            mainEvent: linkedEvents.mainEvent.id,
            registrationEvent: linkedEvents.registrationEvent.id
          });
          
          // Update the eventData object with the new main event ID for subsequent processing
          eventData.id = linkedEvents.mainEvent.id;
          
          // Return the created event information for caching
          const result = {
            mainEventId: linkedEvents.mainEvent.id,
            registrationEventId: linkedEvents.registrationEvent.id,
            registrationCalendarId: registrationCalendar.id
          };
          
          // Store backup linking in internal data
          if (eventDataService.apiToken) {
            try {
              await eventDataService.updateInternalFields(linkedEvents.mainEvent.id, {
                registrationEventId: linkedEvents.registrationEvent.id,
                registrationCalendarId: registrationCalendar.id,
                setupMinutes: setupMinutes,
                teardownMinutes: teardownMinutes
              });
            } catch (error) {
              logger.error('Failed to store internal linking data:', error);
            }
          }
          
          // Return the result for caching
          return result;
        } else {
          // For existing events, check if a linked registration event already exists
          const existingLinkedEvent = await findLinkedEvent(graphToken, eventData.id, calendarId);
          
          if (existingLinkedEvent) {
            logger.debug('Updating existing linked registration event');
            
            // Update the linked event with new times
            await updateLinkedEvent(
              graphToken,
              eventData.id,
              mainEventData,
              calendarId,
              setupMinutes,
              teardownMinutes
            );
          } else {
            logger.debug('No existing linked event found, creating new registration event');
            
            // Fall back to old method for existing events without links
            const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${registrationCalendar.id}/events`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(registrationEventData)
            });

            if (response.ok) {
              const createdEvent = await response.json();
              logger.debug('Successfully created registration event:', createdEvent.id);
              
              // Store linking in internal data
              if (eventDataService.apiToken) {
                try {
                  await eventDataService.updateInternalFields(eventData.id, {
                    registrationEventId: createdEvent.id,
                    registrationCalendarId: registrationCalendar.id,
                    setupMinutes: setupMinutes,
                    teardownMinutes: teardownMinutes
                  });
                } catch (error) {
                  logger.error('Failed to link registration event:', error);
                }
              }
            } else {
              const error = await response.json();
              logger.error('Failed to create registration event:', error);
            }
          }
        }
      } catch (error) {
        logger.error('Error in handleRegistrationEventCreation:', error);
        // Don't throw - registration event creation is supplementary
        return null;
      }
    };

    /**
     * TBD
     */
    const handleSaveApiEvent = async (data) => {
      try {
        // Core payload
        const core = {
          subject: data.subject,
          start: data.start,
          end: data.end,
          location: data.location,
          categories: data.categories,
          isAllDay: data.isAllDay,
          body: data.body
        };
        
        // Debug logging for category mapping
        logger.debug('[handleSaveApiEvent] Event data received:', {
          'data.category': data.category,
          'data.categories': data.categories,
          'core.categories': core.categories
        });
        
        // Extensions payload
        const ext = {};
        schemaExtensions.forEach(extDef => {
          const props = {};
          extDef.properties.forEach(p => {
            const v = data[extDef.id]?.[p.name];
            if (v !== undefined) props[p.name] = v;
          });
          if (Object.keys(props).length) ext[extDef.id] = props;
        });
        
        // Internal fields payload (for setup/teardown and other internal data)
        const internal = {
          setupMinutes: data.setupMinutes || 0,
          teardownMinutes: data.teardownMinutes || 0,
          setupTime: data.setupTime || '',
          teardownTime: data.teardownTime || '',
          doorOpenTime: data.doorOpenTime || '',
          doorCloseTime: data.doorCloseTime || '',
          setupNotes: data.setupNotes || '',
          doorNotes: data.doorNotes || '',
          eventNotes: data.eventNotes || '',
          registrationNotes: data.registrationNotes || '',
          assignedTo: data.assignedTo || ''
        };
        
        // Use the selected calendar from the calendar toggle
        let targetCalendarId = selectedCalendarId;
        if (!targetCalendarId) {
          // If no calendar is selected, find the first writable calendar
          // Filter out read-only calendars like Birthdays, Holidays, etc.
          const writableCalendars = availableCalendars.filter(cal => 
            cal.canEdit !== false && 
            !cal.name?.toLowerCase().includes('birthday') &&
            !cal.name?.toLowerCase().includes('holiday') &&
            !cal.name?.toLowerCase().includes('vacation')
          );
          
          // Prefer Temple Events or main Calendar, otherwise use first writable calendar
          const preferredCalendar = writableCalendars.find(cal => 
            cal.name?.toLowerCase().includes('temple events') || 
            cal.name?.toLowerCase() === 'calendar'
          ) || writableCalendars[0];
          
          targetCalendarId = preferredCalendar?.id;
          logger.debug('[handleSaveApiEvent] No calendar selected, using first writable calendar:', preferredCalendar?.name);
        } else {
          const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
          logger.debug('[handleSaveApiEvent] Creating event in selected calendar:', selectedCalendar?.name);
          
          // Check if the selected calendar is read-only
          if (selectedCalendar && selectedCalendar.canEdit === false) {
            showNotification(`Cannot create events in read-only calendar: ${selectedCalendar.name}`, 'error');
            return false;
          }
        }
        
        // Final check to ensure we have a valid target calendar
        if (!targetCalendarId) {
          showNotification('No writable calendar available for event creation', 'error');
          return false;
        }
        
        // For new events with registration, use createLinkedEvents directly
        if (!data.id && data.createRegistrationEvent && (data.setupMinutes > 0 || data.teardownMinutes > 0)) {
          // Skip the regular batch creation and use linked events creation instead
          const registrationResult = await handleRegistrationEventCreation({
            ...data,
            createRegistrationEvent: data.createRegistrationEvent,
            setupMinutes: data.setupMinutes,
            teardownMinutes: data.teardownMinutes,
            registrationNotes: data.registrationNotes,
            assignedTo: data.assignedTo
          }, targetCalendarId);

          // Registration events are automatically stored in unified events collection
          // No manual caching needed
        } else {
          // For existing events or events without registration, use normal batch update
          const createdEvent = await patchEventBatch(data.id, core, ext, targetCalendarId, internal);
          
          // Update the data object with the actual created event ID if this was a new event
          if (createdEvent && createdEvent.id && !data.id) {
            data.id = createdEvent.id;
            logger.debug('Updated event data with new ID from Graph API:', data.id);
          }
          
          // For existing events that need registration event updates
          if (data.id && data.createRegistrationEvent) {
            const eventDataForRegistration = createdEvent || data;
            await handleRegistrationEventCreation({
              ...eventDataForRegistration,
              createRegistrationEvent: data.createRegistrationEvent,
              setupMinutes: data.setupMinutes,
              teardownMinutes: data.teardownMinutes,
              registrationNotes: data.registrationNotes,
              assignedTo: data.assignedTo
            }, targetCalendarId);
          }
        }

        // Event is now automatically stored in unified events collection via audit-update endpoint
        // No manual caching needed

        // Reload events with retry logic to ensure newly created event appears
        await retryEventLoadAfterCreation(data.id, data.subject);
        
        logger.debug(`[handleSaveApiEvent] ${data.id ? 'Updated' : 'Created'} API event:`, data.subject);
        return true;
        
      } catch (error) {
        logger.error('API save failed:', error);
        throw error;
      }
    };

    /**
     * Called by EventForm or EventSearch when the user hits "Save"
     * @param {Object} data - The payload from EventForm.handleSubmit
     * @returns {boolean} Success indicator
     */
    const handleSaveEvent = async (data) => {
      const isNew = !data.id || data.id.includes('demo_event_') || data.id.includes('event_');

      // Permission checks
      if (isNew && !userPermissions.createEvents) {
        alert("You don't have permission to create events");
        return false;
      }
      if (!isNew && !userPermissions.editEvents) {
        alert("You don't have permission to edit events");
        return false;
      }

      // Set loading state
      setSavingEvent(true);

      try {
        // Dispatch to the appropriate handler based on mode
        if (isDemoMode) {
          await handleSaveDemoEvent(data);
        } else {
          await handleSaveApiEvent(data);
        }

        // Close modal if it's open (common to both modes)
        if (isModalOpen) {
          setIsModalOpen(false);
        }

        showNotification('Event saved successfully!', 'success');
        return true;

      } catch (error) {
        logger.error('Save failed:', error);
        alert('Save failed: ' + error.message);
        return false;
      } finally {
        // Clear loading state
        setSavingEvent(false);
      }
    };

    /**
     * Handle save from EventReviewModal
     * Routes to appropriate handler based on mode:
     * - mode='event': Direct calendar event creation
     * - mode='create': Reservation request submission
     *
     * Note: Receives parameter from ReviewModal but uses eventReviewModal.event state
     * which is updated via onDataChange callback in RoomReservationReview
     */
    const handleEventReviewModalSave = useCallback(async () => {
      const { mode, event: reservationData } = eventReviewModal;

      if (!reservationData) {
        logger.error('No event data available to save');
        return;
      }

      try {
        if (mode === 'event') {
          // Direct event creation - transform reservation structure to event structure
          logger.debug('Creating event directly via handleSaveEvent', reservationData);

          // Combine separate date/time fields into ISO datetime strings
          let startDateTime, endDateTime;

          if (reservationData.startDate && reservationData.startTime) {
            startDateTime = `${reservationData.startDate}T${reservationData.startTime}:00`;
          } else if (reservationData.startDateTime) {
            startDateTime = reservationData.startDateTime;
          }

          if (reservationData.endDate && reservationData.endTime) {
            endDateTime = `${reservationData.endDate}T${reservationData.endTime}:00`;
          } else if (reservationData.endDateTime) {
            endDateTime = reservationData.endDateTime;
          }

          // Validate required fields
          if (!startDateTime || !endDateTime) {
            showNotification('Start and end times are required');
            return;
          }

          // Transform reservation structure to event structure expected by handleSaveEvent
          const eventData = {
            subject: reservationData.eventTitle || 'Untitled Event',
            start: {
              dateTime: startDateTime,
              timeZone: getOutlookTimezone(userTimezone)
            },
            end: {
              dateTime: endDateTime,
              timeZone: getOutlookTimezone(userTimezone)
            },
            location: {
              displayName: reservationData.requestedRooms && reservationData.requestedRooms.length > 0
                ? reservationData.requestedRooms.join(', ')
                : 'Unspecified'
            },
            body: {
              contentType: 'text',
              content: reservationData.eventDescription || ''
            },
            categories: [], // Graph API requires array
            isAllDay: reservationData.isAllDayEvent || false,
            attendees: reservationData.attendeeCount ? [{
              emailAddress: {
                address: '',
                name: `${reservationData.attendeeCount} attendees`
              }
            }] : [],
            calendarId: reservationData.calendarId,
            // Include internal enrichments
            setupMinutes: reservationData.setupTimeMinutes || 0,
            teardownMinutes: reservationData.teardownTimeMinutes || 0,
            setupTime: reservationData.setupTime || '',
            teardownTime: reservationData.teardownTime || '',
            doorOpenTime: reservationData.doorOpenTime || '',
            doorCloseTime: reservationData.doorCloseTime || '',
            setupNotes: reservationData.setupNotes || '',
            doorNotes: reservationData.doorNotes || '',
            eventNotes: reservationData.eventNotes || '',
            requesterName: reservationData.requesterName || '',
            requesterEmail: reservationData.requesterEmail || ''
          };

          const success = await handleSaveEvent(eventData);

          if (success) {
            showNotification('Event created successfully');
            setEventReviewModal({ isOpen: false, event: null, mode: 'event', hasChanges: false });
            loadEvents(true);
          }
        } else if (mode === 'create') {
          // Reservation request submission - use reservation structure as-is
          logger.debug('Creating reservation request', reservationData);

          const response = await fetch(`${API_BASE_URL}/events/request`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiToken}`
            },
            body: JSON.stringify(reservationData)
          });

          if (!response.ok) {
            throw new Error(`Failed to create reservation request: ${response.statusText}`);
          }

          showNotification('Reservation request submitted for approval');
          setEventReviewModal({ isOpen: false, event: null, mode: 'create', hasChanges: false });
          loadEvents(true);
        }
      } catch (error) {
        logger.error('Error saving event from ReviewModal:', error);
        showNotification(`Error: ${error.message}`);
        throw error;
      }
    }, [eventReviewModal, apiToken, handleSaveEvent, loadEvents, showNotification]);

    /**
     * Handle closing the EventReviewModal
     */
    const handleEventReviewModalClose = useCallback(() => {
      setEventReviewModal({ isOpen: false, event: null, mode: 'event' });
    }, []);

    /**
     * Handle deletion of registration events when a TempleEvents event is deleted
     * @param {string} eventId - The event ID that was deleted
     */
    const handleRegistrationEventDeletion = async (eventId) => {
      try {
        // First try the new linked events deletion method
        const linkedEventDeleted = await deleteLinkedEvent(graphToken, eventId, selectedCalendarId);
        
        if (linkedEventDeleted) {
          logger.debug('Successfully deleted linked registration event using extended properties');
          return;
        }

        // Fall back to legacy method using internal data
        if (!eventDataService.apiToken) {
          logger.debug('No API token for event data service, skipping registration event deletion');
          return;
        }

        // Try to get the internal data to find the registration event ID
        const response = await fetch(`${API_BASE_URL}/internal-events/enrich`, {
          method: 'POST',
          headers: eventDataService.getAuthHeaders(),
          body: JSON.stringify({ eventIds: [eventId] })
        });

        if (!response.ok) {
          logger.debug('Failed to fetch internal data for registration event deletion');
          return;
        }

        const enrichmentMap = await response.json();
        const internalData = enrichmentMap[eventId];

        if (!internalData || !internalData.registrationEventId) {
          logger.debug('No linked registration event found for event:', eventId);
          return;
        }

        // Delete the registration event using legacy method
        const registrationEventId = internalData.registrationEventId;
        const registrationCalendarId = internalData.registrationCalendarId;

        if (registrationCalendarId) {
          const deleteUrl = `https://graph.microsoft.com/v1.0/me/calendars/${registrationCalendarId}/events/${registrationEventId}`;
          
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${graphToken}`
            }
          });

          if (deleteResponse.ok) {
            logger.debug('Successfully deleted registration event (legacy method):', registrationEventId);
          } else if (deleteResponse.status === 404) {
            // 404 means the registration event doesn't exist in Graph API (already deleted)
            logger.debug('Registration event already deleted from Microsoft Calendar (404 - Not Found):', registrationEventId);
          } else {
            logger.error('Failed to delete registration event:', deleteResponse.status);
          }
        }
      } catch (error) {
        logger.error('Error in handleRegistrationEventDeletion:', error);
        // Don't throw - registration event deletion is supplementary
      }
    };
    
    /**
     * TBD
     */
    const handleDeleteDemoEvent = async (eventId) => {
      try {
        // Initialize the service
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Delete through the service (demo mode)
        await calendarDataService.deleteEvent(eventId);
        
        // Update local state immediately
        setAllEvents(allEvents.filter(event => event.id !== eventId));
        
        // Reload demo events to ensure consistency
        await loadDemoEvents();
        
        logger.debug(`[handleDeleteDemoEvent] Deleted demo event:`, eventId);
        return true;
        
      } catch (error) {
        logger.error('Demo delete failed:', error);
        throw error;
      }
    };

    /**
     * TBD
     */
    const handleDeleteApiEvent = async (eventId) => {
      let graphDeleted = false;
      let mongoDeleted = false;
      
      try {
        // Step 1: Delete linked registration events first (from Graph API)
        await handleRegistrationEventDeletion(eventId);
        
        // Step 2: Delete main event from Microsoft Graph API
        const apiUrl = selectedCalendarId
          ? `https://graph.microsoft.com/v1.0/me/calendars/${selectedCalendarId}/events/${eventId}`
          : `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
            
        const graphResponse = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
    
        if (!graphResponse.ok) {
          if (graphResponse.status === 404) {
            // 404 means the event doesn't exist in Graph API (already deleted)
            // This is actually a success case - treat as if deletion succeeded
            graphDeleted = true;
            logger.debug('Event already deleted from Microsoft Calendar (404 - Not Found)');
          } else {
            // Other errors are actual failures
            const error = await graphResponse.json();
            logger.error('Failed to delete event from Graph:', error);
            throw new Error(`Graph API delete failed: ${graphResponse.status}`);
          }
        } else {
          graphDeleted = true;
          logger.debug('Event deleted from Microsoft Calendar');
        }
        
        // Step 3: Delete event from MongoDB collections
        if (apiToken) {
          try {
            const mongoResponse = await fetch(`${API_BASE_URL}/internal-events/${eventId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (mongoResponse.ok) {
              const result = await mongoResponse.json();
              mongoDeleted = true;
              logger.debug('Event deleted from MongoDB:', result);
            } else {
              // If MongoDB deletion fails, log but don't fail the whole operation
              // since Graph deletion succeeded
              const mongoError = await mongoResponse.json().catch(() => ({}));
              logger.warn(`MongoDB deletion failed (${mongoResponse.status}):`, mongoError);
              // Continue with the rest of the flow
            }
          } catch (mongoError) {
            logger.warn('Error deleting from MongoDB:', mongoError);
            // Continue with the rest of the flow
          }
        }
        
        // Step 4: Update local state immediately
        setAllEvents(allEvents.filter(event => event.id !== eventId));
        
        // Step 5: Remove deleted event from cache
        if (apiToken) {
          try {
            eventCacheService.setApiToken(apiToken);
            await eventCacheService.invalidateCache({ eventIds: [eventId] });
            logger.debug('Deleted event removed from cache:', eventId);
          } catch (cacheError) {
            logger.warn('Failed to remove deleted event from cache:', cacheError);
          }
        }
        
        // Step 6: Reload events to ensure consistency
        await loadEvents();
        
        logger.debug(`[handleDeleteApiEvent] Successfully deleted event:`, {
          eventId,
          graphDeleted,
          mongoDeleted
        });
        
        return true;
        
      } catch (error) {
        logger.error('Event deletion failed:', {
          eventId,
          graphDeleted,
          mongoDeleted,
          error: error.message
        });
        
        // If we're here, Graph deletion likely failed
        // Don't attempt MongoDB cleanup if Graph delete failed
        throw error;
      }
    };

    /**
     * Delete an event
     */
    const handleDeleteConfirm = async () => {
      if (!currentEvent?.id) {
        alert('No event selected for deletion');
        return;
      }
      
      try {
        // Dispatch to the appropriate handler based on mode
        if (isDemoMode) {
          await handleDeleteDemoEvent(currentEvent.id);
          
          // Close modal and clear current event
          setIsModalOpen(false);
          setCurrentEvent(null);
          
          showNotification('Event deleted successfully!', 'success');
        } else {
          // For live events, we need to handle potential partial failures
          const result = await handleDeleteApiEvent(currentEvent.id);
          
          // Close modal and clear current event if deletion succeeded
          setIsModalOpen(false);
          setCurrentEvent(null);
          
          // Check if we have specific deletion information in the logs
          // This is a bit of a workaround since handleDeleteApiEvent doesn't return detailed status
          // In a future iteration, we could enhance this by returning deletion details
          showNotification('Event deleted successfully!', 'success');
        }
        
      } catch (error) {
        logger.error('Delete failed:', error);
        
        // Enhanced error messaging
        let errorMessage = 'Delete failed: ';
        
        if (error.message.includes('Graph API delete failed: 404')) {
          // This should not happen anymore since we handle 404s gracefully
          errorMessage += 'Event no longer exists in Microsoft Calendar but failed to clean up internal data.';
        } else if (error.message.includes('Graph API delete failed')) {
          errorMessage += 'Unable to delete event from Microsoft Calendar. You may not have permission to delete it.';
        } else if (error.message.includes('MongoDB')) {
          errorMessage += 'Event was deleted from Microsoft Calendar but failed to clean up internal data. The event should still be removed from your calendar.';
        } else {
          errorMessage += error.message;
        }
        
        // Use showNotification for consistent error display
        showNotification(errorMessage, 'error');
        
        // Also log the detailed error for debugging
        logger.error('Detailed deletion error:', {
          eventId: currentEvent?.id,
          eventSubject: currentEvent?.subject,
          error: error.message,
          stack: error.stack
        });
      }
    };

    //---------------------------------------------------------------------------
    // DEBUGGING FUNCTIONS
    //---------------------------------------------------------------------------
    const debugDemoData = () => {
      if (demoData?.events) {
        logger.debug('=== DEMO DATA DEBUG ===');
        logger.debug('Total events:', demoData.events.length);
        logger.debug('Date range of demo data:', demoData.searchCriteria?.dateRange);
        logger.debug('Current calendar view:', {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString()
        });
        
        // Show first few events
        const sampleEvents = demoData.events.slice(0, 5);
        logger.debug('Sample events:');
        sampleEvents.forEach((event, i) => {
          logger.debug(`${i + 1}. ${event.subject}`);
          logger.debug(`   Start: ${event.startDateTime}`);
          logger.debug(`   End: ${event.endDateTime}`);
          logger.debug(`   Location: ${event.locationDisplayNames}`);
          logger.debug(`   Categories: ${JSON.stringify(event.categories)}`);
        });
        
        // Check if any events fall in current date range
        const eventsInRange = demoData.events.filter(event => {
          const eventDate = new Date(event.startDateTime);
          return eventDate >= dateRange.start && eventDate <= dateRange.end;
        });
        logger.debug(`Events in current range (${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}):`, eventsInRange.length);
        
        if (eventsInRange.length === 0) {
          const eventDates = demoData.events.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          logger.debug('Event date range in data:');
          logger.debug(`  Earliest: ${earliestEvent.toLocaleDateString()}`);
          logger.debug(`  Latest: ${latestEvent.toLocaleDateString()}`);
          logger.debug('SUGGESTION: Navigate calendar to these dates to see events');
        }
        logger.debug('======================');
      }
    };

    //---------------------------------------------------------------------------
    // MAIN INITIALIZATION FUNCTION
    //---------------------------------------------------------------------------
    useEffect(() => {
      // Check if tokens are available for initialization
      if (graphToken && apiToken && initializing) {
        logger.debug("Tokens available, starting initialization");
        initializeApp();
      }
    }, [graphToken, apiToken, initializing, initializeApp]);

    useEffect(() => {
      if (apiToken) {
        eventDataService.setApiToken(apiToken);
      }
    }, [apiToken]);

    const dateRangeString = useMemo(() => 
      `${dateRange.start.toISOString()}-${dateRange.end.toISOString()}`, 
      [dateRange.start, dateRange.end]
    );

    // Consolidated event loading effect to prevent duplicate API calls
    useEffect(() => {

      if (graphToken && !initializing && selectedCalendarId && availableCalendars.length > 0) {
        calendarDebug.logEventLoading(selectedCalendarId, dateRange, 'useEffect trigger');
        window._calendarLoadStart = Date.now();
        const startTime = Date.now();

        // Set a timeout to ensure changingCalendar is reset even if loading hangs
        const timeoutId = setTimeout(() => {
          logger.error('[Calendar useEffect] TIMEOUT - Forcing changingCalendar to false');
          calendarDebug.logError('Calendar loading timeout', new Error('Loading took too long'), { selectedCalendarId });
          setChangingCalendar(false);
        }, 30000); // 30 second timeout

        // Load events with force refresh to get fresh body content
        loadEvents(true)  // true = forceRefresh to bypass stale cache
          .then((result) => {
            const duration = Date.now() - startTime;
            calendarDebug.logEventLoadingComplete(selectedCalendarId, allEvents.length, duration);
          })
          .catch((error) => {
            logger.error('Event loading failed:', error);
            calendarDebug.logError('loadEvents in useEffect', error, { selectedCalendarId });
          })
          .finally(() => {
            clearTimeout(timeoutId);
            calendarDebug.logStateChange('changingCalendar', true, false);
            setChangingCalendar(false);
          });
      }
      // Skipping event loading if requirements not met
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRangeString, selectedCalendarId, graphToken, initializing, availableCalendars.length]);

    // Set user time zone from user permissions
    useEffect(() => {
    // Only set timezone from user permissions if we haven't set one yet
    // and if the user permissions actually have a timezone preference
    if (userPermissions.preferredTimeZone && 
        userPermissions.preferredTimeZone !== userTimezone &&
        !hasUserManuallyChangedTimezone.current) {
      // Setting initial timezone from userPermissions
      setUserTimezone(userPermissions.preferredTimeZone);
    }
  }, [userPermissions.preferredTimeZone, userTimezone]); 

    // Update selected locations when dynamic locations change - smart merging
    useEffect(() => {
      console.log('[Location Selection] useEffect triggered');
      console.log('[Location Selection] dynamicLocations:', dynamicLocations);
      console.log('[Location Selection] selectedLocations before:', selectedLocations);

      if (dynamicLocations.length > 0) {
        if (selectedLocations.length === 0) {
          // Initial selection: select all locations
          console.log('[Location Selection] Initial selection - setting all locations');
          setSelectedLocations(dynamicLocations);
        } else {
          // Smart merging: add new locations to existing selection
          const newLocations = dynamicLocations.filter(loc => !selectedLocations.includes(loc));
          console.log('[Location Selection] Smart merge - new locations:', newLocations);
          if (newLocations.length > 0) {
            setSelectedLocations(prev => {
              const updated = [...prev, ...newLocations];
              console.log('[Location Selection] Updated selection:', updated);
              return updated;
            });
          }
        }
      }
    }, [dynamicLocations]);

    // Update selected categories when dynamic categories change - smart merging
    useEffect(() => {
      if (dynamicCategories.length > 0) {
        if (selectedCategories.length === 0) {
          // Initial selection: select all categories
          setSelectedCategories(dynamicCategories);
          // Initial category selection: all categories
        } else {
          // Smart merging: add new categories to existing selection
          const newCategories = dynamicCategories.filter(cat => !selectedCategories.includes(cat));
          if (newCategories.length > 0) {
            setSelectedCategories(prev => [...prev, ...newCategories]);
            // Added new categories to selection
          } else {
            // No new categories to add
          }
        }
      }
    }, [dynamicCategories]);

    

    // Initialize filter for month view
    useEffect(() => {
      // Set default filter based on the groupBy setting
      if (groupBy === 'categories' && dynamicCategories.length > 0) {
        setSelectedFilter('Uncategorized');
      } else if (groupBy === 'locations') {
        setSelectedFilter('Unspecified');
      }
    }, [groupBy, dynamicCategories]);


    // Location debugging removed for performance

    useEffect(() => {
      const handleKeyPress = (e) => {
        // Press 'G' to focus the date picker (like Google Calendar)
        if (e.key === 'g' || e.key === 'G') {
          // Don't trigger if user is typing in an input, textarea, or contenteditable element
          const activeElement = document.activeElement;
          const isTyping = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true'
          );
          
          if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTyping) {
            e.preventDefault();
            // Focus the date picker
            const datePicker = document.querySelector('.date-picker-input');
            if (datePicker) {
              datePicker.click();
            }
          }
        }
      };
    
      document.addEventListener('keydown', handleKeyPress);
      return () => document.removeEventListener('keydown', handleKeyPress);
    }, []);

    /*
    // Debugging
    useEffect(() => {
      if (isDemoMode && demoData) {
        debugDemoData();
      }
    }, [isDemoMode, demoData, dateRange, debugDemoData]);
    */

    //---------------------------------------------------------------------------
    // LOADING SCREEN
    //---------------------------------------------------------------------------
    const LoadingOverlay = () => {
      // Get loading status text
      const loadingText = (() => {
        if (loadingState.user) return "Loading user profile...";
        if (loadingState.categories) return "Loading categories...";
        if (loadingState.extensions) return "Loading extensions...";
        if (loadingState.events) return "Loading calendar events...";
        return "Loading your calendar...";
      })();
    
      return (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <p>{loadingText}</p>
          </div>
        </div>
      );
    };
    
    const locationGroups = useMemo(() => {
      if (groupBy === 'locations') {
        const groups = getLocationGroups();
        console.log('[UI Rendering] Location groups to render:');
        Object.keys(groups).forEach(groupName => {
          console.log(`  - ${groupName}: ${groups[groupName].length} events`);
        });
        return groups;
      }
      return {};
    }, [groupBy, getLocationGroups]);

    //---------------------------------------------------------------------------
    // RENDERING
    //---------------------------------------------------------------------------
    return (
      <div className="calendar-container">
        {(loading || initializing) && <LoadingOverlay/>}
        
        {/* Calendar Header */}
        <CalendarHeader
          viewType={viewType}
          currentDate={currentDate}
          dateRange={dateRange}
          onViewChange={(newView) => {
            handleViewChange(newView);
            updateUserProfilePreferences({ defaultView: newView });
          }}
          onDateChange={handleDatePickerChange}
          onNavigate={(action) => {
            if (action === 'previous') handlePrevious();
            else if (action === 'next') handleNext();
            else if (action === 'today') handleToday();
          }}
          timezone={userTimezone}
          weekStart={userPermissions.startOfWeek}
          onTimezoneChange={(newTz) => {
            logger.debug('Timezone dropdown changed to:', newTz);
            hasUserManuallyChangedTimezone.current = true;
            setUserTimezone(newTz);
          }}
          onWeekStartChange={(e) => {
            const newValue = e.target.value;

            setUserPermissions(prev => ({
              ...prev,
              startOfWeek: newValue
            }));
            updateUserProfilePreferences({ startOfWeek: newValue });

            if (viewType === 'week') {
              const currentStartDate = new Date(dateRange.start);
              let newStart;

              if (newValue === 'Monday' && userPermissions.startOfWeek === 'Sunday') {
                newStart = new Date(currentStartDate);
                newStart.setDate(currentStartDate.getDate() + 1);
              }
              else if (newValue === 'Sunday' && userPermissions.startOfWeek === 'Monday') {
                newStart = new Date(currentStartDate);
                newStart.setDate(currentStartDate.getDate() - 1);
              }
              else {
                newStart = currentStartDate;
              }

              const newEnd = calculateEndDate(newStart, 'week');

              setDateRange({
                start: newStart,
                end: newEnd
              });
            }
          }}
          groupBy={groupBy}
          onGroupByChange={async (mode) => {
            setLoading(true);
            setGroupBy(mode);
            await updateUserProfilePreferences({ defaultGroupBy: mode });
            setLoading(false);
          }}
          selectedCalendarId={selectedCalendarId}
          availableCalendars={availableCalendars}
          onCalendarChange={setSelectedCalendarId}
          changingCalendar={changingCalendar}
          updateUserProfilePreferences={updateUserProfilePreferences}
        />

        {/* Mode Toggle with Action Buttons */}
        {renderModeToggle()}

        {/* MAIN LAYOUT CONTAINER */}
        <div className="calendar-layout-container">
          {/* Calendar Main Content */}
          <div className="calendar-main-content">
            {/* Calendar grid section */}
            <div className="calendar-grid-container">
                  {viewType === 'month' ? (
                    <div className="calendar-content-wrapper">
                      <div 
                        className="calendar-grid month-view"
                        style={{ 
                          transform: `scale(${zoomLevel / 100})`, 
                          transformOrigin: 'top left',
                          width: '100%',
                          flex: 1
                        }}
                      >
                        <MonthView
                          getMonthWeeks={getMonthWeeks}
                          getWeekdayHeaders={getWeekdayHeaders}
                          selectedFilter={selectedFilter}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          getEventContentStyle={getEventContentStyle}
                          formatEventTime={formatEventTime}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          groupBy={groupBy}
                          filteredEvents={filteredEvents}
                          outlookCategories={outlookCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          getFilteredMonthEvents={getFilteredMonthEvents}
                          getMonthDayEventPosition={getMonthDayEventPosition}
                          allEvents={allEvents}
                          handleMonthFilterChange={handleMonthFilterChange}
                          selectedCategories={selectedCategories}
                          selectedLocations={selectedLocations}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          dynamicCategories={dynamicCategories}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          showRegistrationTimes={showRegistrationTimes}
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                      className={`calendar-grid ${viewType}-view`}
                      style={{ 
                        transform: `scale(${zoomLevel / 100})`, 
                        transformOrigin: 'top left',
                        width: '100%'
                      }}
                    >
                      {viewType === 'week' ? (
                        <WeekView
                          groupBy={groupBy}
                          outlookCategories={outlookCategories}
                          selectedCategories={selectedCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          selectedLocations={selectedLocations}
                          getDaysInRange={getDaysInRange}
                          formatDateHeader={formatDateHeader}
                          getEventPosition={getEventPosition}
                          filteredEvents={filteredEvents}
                          locationGroups={locationGroups}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          renderEventContent={renderEventContent}
                          viewType={viewType}
                          dynamicCategories={dynamicCategories}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          showRegistrationTimes={showRegistrationTimes}
                          handleLocationRowClick={handleLocationRowClick}
                        />
                      ) : (
                        <DayView
                          groupBy={groupBy}
                          outlookCategories={outlookCategories}
                          selectedCategories={selectedCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          selectedLocations={selectedLocations}
                          formatDateHeader={formatDateHeader}
                          getEventPosition={getEventPosition}
                          filteredEvents={filteredEvents}
                          locationGroups={locationGroups}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          renderEventContent={renderEventContent}
                          viewType={viewType}
                          dynamicCategories={dynamicCategories}
                          dateRange={dateRange}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          showRegistrationTimes={showRegistrationTimes}
                          handleLocationRowClick={handleLocationRowClick}
                        />
                      )}
                    </div>
                  )}
            </div>
          </div>

          {/* SIDEBAR - Always present for layout stability */}
          {viewType !== 'month' ? (
            <div className="calendar-right-sidebar">
              {(loading || initializing) ? (
                /* Placeholder content during loading */
                <div className="sidebar-loading-placeholder">
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Categories</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Locations</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Filters</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                </div>
              ) : (
                /* Actual sidebar content */
                <>
                  {/* FILTERS CONTAINER */}
                  <div className="filters-container">
                    {/* CATEGORIES FILTER SECTION */}
                    <div className="filter-section">
                      <h3 className="filter-title">Categories</h3>
                      <MultiSelect 
                            options={dynamicCategories}
                            selected={selectedCategories}
                            onChange={val => {
                              setSelectedCategories(val);
                              updateUserProfilePreferences({ selectedCategories: val });
                            }}
                            label="categories"
                            maxHeight={200}
                          />
                        </div>

                        {/* LOCATIONS FILTER SECTION */}
                        <div className="filter-section">
                          <h3 className="filter-title">Locations</h3>
                          <MultiSelect 
                            options={dynamicLocations}
                            selected={selectedLocations}
                            onChange={val => {
                              setSelectedLocations(val);
                              updateUserProfilePreferences({ selectedLocations: val });
                            }}
                            label="locations"
                            maxHeight={200}
                          />
                        </div>
                      </div>

                      {/* FILTER STATUS SECTION */}
                      <div className="filter-status">
                        <div className="status-title">Active Filters:</div>
                        <div className="status-info">Categories ({selectedCategories?.length || 0}), Locations ({selectedLocations?.length || 0})</div>
                        <div className="status-events">Events: {filteredEvents?.length || 0} visible / {allEvents?.length || 0} total</div>
                      </div>

                      {/* GROUPING INFO SECTION */}
                      <div className="grouping-info">
                        <h4 className="grouping-title">Current Grouping</h4>
                        <p className="grouping-description">
                          Events are visually grouped by <strong>{groupBy === 'categories' ? 'Categories' : 'Locations'}</strong>.
                          Use the buttons above to change grouping.
                        </p>
                      </div>
                </>
              )}
            </div>
          ) : (
            /* Month view - no sidebar, but add a placeholder to maintain consistent spacing */
            <div className="calendar-sidebar-spacer"></div>
          )}
        </div>

        {/* Modal for Add/Edit Event */}
        <Modal 
          isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit' || modalType === 'view')} 
          onClose={() => setIsModalOpen(false)}
          title={
            modalType === 'add' ? `Add Event - ${getTargetCalendarName()}` : 
            modalType === 'edit' ? `Edit Event - ${getTargetCalendarName()}` : 
            `View Event - ${getTargetCalendarName()}`
          }
          hideTitle={false}
        >
          <EventForm
            event={currentEvent}
            categories={(() => {
              const targetCalendarId = getTargetCalendarId();
              const calendarSpecificCategories = getCalendarSpecificCategories(targetCalendarId);
              return calendarSpecificCategories;
            })()}
            availableLocations={getFilteredLocationsForMultiSelect()}
            dynamicLocations={dynamicLocations}
            schemaExtensions={schemaExtensions}
            onSave={handleSaveEvent}
            onCancel={() => setIsModalOpen(false)}
            onDelete={userPermissions.deleteEvents ? handleDeleteEvent : null}
            onReview={handleReviewClick}
            readOnly={modalType === 'view'}
            userTimeZone={userTimezone}
            savingEvent={savingEvent}
            apiToken={apiToken}
          />
        </Modal>

        {/* Modal for Delete Confirmation */}
        <Modal
          isOpen={isModalOpen && modalType === 'delete'}
          onClose={() => setIsModalOpen(false)}
          hideTitle={true}
        >
          <div className="delete-confirmation" style={{
            padding: '24px',
            textAlign: 'center'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '500',
              color: '#202124',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Delete Event
            </h2>
            <p style={{
              fontSize: '14px',
              color: '#5f6368',
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              Are you sure you want to delete "{currentEvent?.subject}"?<br />
              This action cannot be undone.
            </p>
            <div className="form-actions" style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              marginTop: '24px'
            }}>
              <button 
                className="cancel-button" 
                onClick={() => setIsModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  background: '#f8f9fa',
                  color: '#5f6368',
                  border: '1px solid #dadce0',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button 
                className="delete-button" 
                onClick={handleDeleteConfirm}
                style={{
                  padding: '10px 24px',
                  background: '#ea4335',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
        
        {showSearch && (
          <EventSearch
            graphToken={graphToken}
            apiToken={apiToken}
            onEventSelect={handleEventSelect}
            onViewInCalendar={handleViewInCalendar}
            onClose={() => setShowSearch(false)}
            outlookCategories={outlookCategories}
            availableLocations={getDatabaseLocationNames()}
            dynamicLocations={dynamicLocations}
            onSaveEvent={handleSaveEvent}
            selectedCalendarId={selectedCalendarId}
            availableCalendars={availableCalendars}
          />
        )}

        {/* Timeline Modals for Location Views */}
        {timelineModal.viewType === 'week' && (
          <WeekTimelineModal
            isOpen={timelineModal.isOpen}
            onClose={() => setTimelineModal(prev => ({ ...prev, isOpen: false }))}
            locationName={timelineModal.locationName}
            locationId={timelineModal.locationId}
            dateRange={timelineModal.dateRange}
            events={timelineModal.events}
            calendarName={availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || ''}
            generalLocations={generalLocations}
          />
        )}

        {timelineModal.viewType === 'day' && (
          <DayTimelineModal
            isOpen={timelineModal.isOpen}
            onClose={() => setTimelineModal(prev => ({ ...prev, isOpen: false }))}
            location={(() => {
              // Find the full location object by locationId if available
              if (timelineModal.locationId) {
                const fullLocation = generalLocations.find(loc =>
                  loc._id && loc._id.toString() === timelineModal.locationId
                );
                return fullLocation || { name: timelineModal.locationName };
              }
              return { name: timelineModal.locationName };
            })()}
            date={timelineModal.dateRange[0]}
            events={timelineModal.events}
            calendarName={availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || ''}
          />
        )}

        {/* Review Modal for Room Reservations and Event Review */}
        <ReviewModal
          isOpen={reviewModal.isOpen}
          title={`${reviewModal.currentItem?.status === 'pending' ? 'Review' : 'Edit'} ${reviewModal.editableData?.eventTitle || 'Event'}`}
          onClose={reviewModal.closeModal}
          onApprove={reviewModal.handleApprove}
          onReject={reviewModal.handleReject}
          onSave={reviewModal.handleSave}
          onDelete={reviewModal.handleDelete}
          mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
          isPending={reviewModal.currentItem?.status === 'pending'}
          hasChanges={reviewModal.hasChanges}
          isSaving={reviewModal.isSaving}
          isDeleting={reviewModal.isDeleting}
          showActionButtons={true}
        >
          {reviewModal.currentItem && (
            <RoomReservationReview
              reservation={reviewModal.editableData}
              apiToken={apiToken}
              graphToken={graphToken}
              onDataChange={reviewModal.updateData}
              readOnly={false}
              isAdmin={userPermissions.isAdmin}
            />
          )}
        </ReviewModal>

        {/* Review Modal for Event Creation */}
        <ReviewModal
          isOpen={eventReviewModal.isOpen}
          title={eventReviewModal.event?.id ? `Edit Event - ${getTargetCalendarName()}` : `Add Event - ${getTargetCalendarName()}`}
          onClose={handleEventReviewModalClose}
          onSave={handleEventReviewModalSave}
          mode="edit"
          isPending={false}
          hasChanges={eventReviewModal.hasChanges}
          isSaving={savingEvent}
          showActionButtons={true}
          showTabs={true}
          saveButtonText={
            !eventReviewModal.event?.id && userPermissions.isAdmin
              ? '✨ Create'
              : null
          }
        >
          {eventReviewModal.isOpen && eventReviewModal.event && (
            <RoomReservationReview
              reservation={eventReviewModal.event}
              apiToken={apiToken}
              graphToken={graphToken}
              onDataChange={(updatedData) => {
                setEventReviewModal(prev => ({
                  ...prev,
                  event: {
                    ...prev.event,  // Preserve original fields like calendarId, calendarName
                    ...updatedData  // Merge in updated form data
                  },
                  hasChanges: true
                }));
              }}
              readOnly={false}
              isAdmin={userPermissions.isAdmin}
            />
          )}
        </ReviewModal>
      </div>
    );
  }

  export default Calendar;
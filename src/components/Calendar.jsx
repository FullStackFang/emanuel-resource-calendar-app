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
  import './Calendar.css';
  import APP_CONFIG from '../config/config';
  import './DayEventPanel.css';
  import DayEventPanel from './DayEventPanel';
  import eventDataService from '../services/eventDataService';
  import DatePicker from 'react-datepicker';
  import "react-datepicker/dist/react-datepicker.css";
  import calendarDataService from '../services/calendarDataService';

  // API endpoint - use the full URL to your API server
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  // const API_BASE_URL = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api'
  // const API_BASE_URL = 'http://localhost:3001/api';

  /*****************************************************************************
   * CONSTANTS AND CONFIGURATION
   *****************************************************************************/
  const categories = [
  ]; 

  const availableLocations = [
    'Unspecified',
    'TPL',
    'CPL',
    'MUS',
    'Nursery School',
    '402',
    '602',
    'Virtual',
    'Microsoft Teams Meeting'
  ];

  /**
   * Calculate the end date based on the view type (day, week, month)
   * @param {Date} startDate - The starting date
   * @param {string} viewType - 'day', 'week', or 'month'
   * @returns {Date} The calculated end date
   */
  function calculateEndDate(startDate, viewType) {
    const endDate = new Date(startDate);
    
    switch(viewType) {
      case 'day':
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'week':
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'month':
        endDate.setMonth(endDate.getMonth() + 1);
        endDate.setDate(0);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
    }
    
    return endDate;
  }

  const DatePickerButton = ({ currentDate, onDateChange, viewType }) => {
    const handleDateChange = (date) => {
      if (date) {
        onDateChange(date);
      }
    };
  
    const formatDisplayDate = () => {
      const options = { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      };
      return currentDate.toLocaleDateString('en-US', options);
    };
  
    return (
      <div className="date-picker-wrapper">
        <DatePicker
          selected={currentDate}
          onChange={handleDateChange}
          dateFormat="MMM d, yyyy"
          customInput={
            <button 
              className="date-picker-input"
              type="button"
              title="Click to select a specific date"
            >
              📅 {formatDisplayDate()}
            </button>
          }
          showPopperArrow={false}
          popperPlacement="bottom-start"
          // Remove or simplify the popperModifiers configuration
          popperModifiers={undefined}
          // Alternative: Remove popperModifiers entirely
          // popperModifiers={undefined}
          
          // Show month/year dropdowns for easier navigation
          showMonthDropdown
          showYearDropdown
          dropdownMode="select"
          yearDropdownItemNumber={10}
          scrollableYearDropdown
          
          // Add these props for better stability
          shouldCloseOnSelect={true}
          disabledKeyboardNavigation={false}
          
          // Optional: Add portal rendering to avoid z-index issues
          withPortal={false}
          
          // Optional: Add custom popper container
          popperContainer={({ children }) => (
            <div className="react-datepicker-popper-container">
              {children}
            </div>
          )}
        />
      </div>
    );
  };

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
    setChangingCalendar
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
    const [loadingState, setLoadingState] = useState({
      user: true,
      categories: true,
      extensions: true,
      events: true
    });
    
    // Core calendar data
    const [allEvents, setAllEvents] = useState([]);
    const [showSearch, setShowSearch] = useState(false);
    const [outlookCategories, setOutlookCategories] = useState([]);
    const [schemaExtensions, setSchemaExtensions] = useState([]);

    // UI state
    const [groupBy, setGroupBy] = useState('categories'); 
    const [viewType, setViewType] = useState('week');
    const [zoomLevel, setZoomLevel] = useState(100);
    const [selectedFilter, setSelectedFilter] = useState(''); 
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [dateRange, setDateRange] = useState({
      start: new Date(),
      end: calculateEndDate(new Date(), 'week')
    });
    
    // Separate filters for month view
    const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
    const [selectedLocationFilter, setSelectedLocationFilter] = useState('');

    // Profile states
    const [userTimeZone, setUserTimeZone] = useState('America/New_York');
    const [, setUserProfile] = useState(null);
    const [userPermissions, setUserPermissions] = useState({
      startOfWeek: 'Monday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100,
      preferredTimeZone: 'America/New_York',
      createEvents: false,
      editEvents: false,
      deleteEvents: false,
      isAdmin: false,
    });

    // Modal and context menu state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalType, setModalType] = useState('add'); // 'add', 'edit', 'view', 'delete'
    const [currentEvent, setCurrentEvent] = useState(null);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [, setNotification] = useState({ show: false, message: '', type: 'info' });

    //---------------------------------------------------------------------------
    // SIMPLE UTILITY FUNCTIONS (no dependencies on other functions)
    //---------------------------------------------------------------------------
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
        
        console.log('Raw uploaded JSON:', rawJsonData);
        
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
            
            // Your location field is a simple string, not an object
            const location = event.location || '';
            
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
        
        console.log('Processed demo data:', processedData);
        
        // Set demo data
        setDemoData(processedData);
        
        // Configure service for demo mode
        calendarDataService.setDemoMode(processedData);
        setIsDemoMode(true);
        
        console.log('Demo mode activated, loading events...');
        
        // Test loading events for current date range
        const events = await calendarDataService.getEvents(dateRange);
        console.log('Loaded demo events for current range:', events);
        
        if (events.length === 0) {
          console.warn('No events in current date range. Navigating to events...');
          
          // Find the date range of your events and navigate there
          const eventDates = transformedEvents.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          
          console.log('Event date range:', {
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
          
          alert(`Successfully loaded ${transformedEvents.length} events. Calendar navigated to show events starting from ${earliestEvent.toLocaleDateString()}`);
        } else {
          setAllEvents(events);
          alert(`Successfully loaded ${transformedEvents.length} events for demo mode`);
        }
        
      } catch (error) {
        console.error('Error uploading demo data:', error);
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
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #dee2e6'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: '500' }}>Mode:</span>
              <button
                onClick={handleModeToggle}
                style={{
                  padding: '6px 12px',
                  backgroundColor: isDemoMode ? '#28a745' : '#0078d4',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                {isDemoMode ? '📊 Demo Mode' : '🌐 API Mode'}
              </button>
            </div>
            
            {!isDemoMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label htmlFor="demo-upload" style={{
                  padding: '6px 12px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
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
        </div>
      );
    };

    /**
     * Consistently format date range for API queries
     * @param {Date} startDate - Range start date
     * @param {Date} endDate - Range end date
     * @returns {Object} Formatted start and end dates
     */
      const formatDateRangeForAPI = useCallback((startDate, endDate) => {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        
        return {
          start: start.toISOString(),
          end: end.toISOString()
        };
      }, []);
        
      /**
       * TBD
       */
      const isUnspecifiedLocation = useCallback((event) => {
        const locationText = event.location?.displayName?.trim() || '';
        return !locationText;
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
          !isVirtualLocation(location) && location === targetLocation
        );
      }, [isVirtualLocation]);

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
          // Create date objects from the event's start time
          const eventDate = new Date(event.start.dateTime);
          
          // Make copies of both dates and reset to midnight for comparison
          const eventDay = new Date(eventDate);
          eventDay.setHours(0, 0, 0, 0);
          
          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);
          
          // Compare the dates (ignoring time)
          return eventDay.getTime() === compareDay.getTime();
        } catch (err) {
          console.error('Error comparing event date:', err, event);
          return false;
        }
      }, []);
  
      /**
       * Check if an event occurs on a specific day
       * @param {Object} event - The event object
       * @param {Date} day - The day to check
       * @returns {boolean} True if the event occurs on the day
       */
      const getEventPosition = useCallback((event, day) => {
        try {
          // Create date objects from the event's start time
          const utcDateString = event.start.dateTime.endsWith('Z') ? 
            event.start.dateTime : `${event.start.dateTime}Z`;
          const eventDate = new Date(utcDateString);
          
          // Convert to the same timezone for comparison
          const eventDay = new Date(eventDate.toLocaleString('en-US', {timeZone: userTimeZone}));
          eventDay.setHours(0, 0, 0, 0);
          
          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);
          
          // Compare the dates (ignoring time)
          return eventDay.getTime() === compareDay.getTime();
        } catch (err) {
          console.error('Error comparing event date:', err, event);
          return false;
        }
      }, [userTimeZone]);

      
    //---------------------------------------------------------------------------
    // DATA FUNCTIONS
    //---------------------------------------------------------------------------
    const updateUserProfilePreferences = async (updates) => {
      if (!apiToken) {
        console.log("No API token available for updating preferences");
        return false;
      }
      
      try {
        console.log("Updating user preferences:", updates);
        
        const response = await fetch(`${API_BASE_URL}/users/current/preferences`, {
          method: 'PATCH',  // Or whatever method your API expects
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });
        
        if (!response.ok) {
          console.error("Failed to update user preferences:", response.status);
          return false;
        }
        
        // Also update local state to match
        setUserPermissions(prev => ({
          ...prev,
          ...updates
        }));
        
        console.log("User preferences updated successfully");
        return true;
      } catch (error) {
        console.error("Error updating user preferences:", error);
        return false;
      }
    };

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
          console.error('Failed to load schema extensions');
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
        console.error('Error loading schema extensions:', err);
        return [];
      }
    }, [graphToken]);

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
          console.error('Failed to fetch Outlook categories:', errorData);
          return [];
        }
        
        const data = await response.json();
        console.log('[Calendar.loadOutlookCategories]: Fetched Outlook categories:', data.value);
        
        // Extract category names
        const outlookCategories = data.value.map(cat => ({
          id: cat.id,
          name: cat.displayName,
          color: cat.color
        }));
        
        return outlookCategories;
      } catch (err) {
        console.error('Error fetching Outlook categories:', err);
        return [];
      }
    }, [graphToken]);

    // Loads the current user's available calendars
    const loadAvailableCalendars = useCallback(async () => {
      if (!graphToken) return [];
      
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
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
          owner: calendar.owner?.name || 'Unknown',
          canEdit: calendar.canEdit || false,
          isDefault: calendar.isDefaultCalendar || false
        }));
        
        // Update parent state with calendars
        setAvailableCalendars(calendars);
        
        return calendars;
      } catch (error) {
        console.error('Error fetching calendars:', error);
        return [];
      }
    }, [graphToken, setAvailableCalendars]);

    /**
     * TBD
     */
    const loadDemoEvents = useCallback(async () => {
      if (!isDemoMode || !demoData) {
        console.log("Not in demo mode or no demo data available");
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
        
        console.log(`[loadDemoEvents] Loaded ${events.length} demo events for date range:`, {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString()
        });
        
        setAllEvents(events);
        return true;
        
      } catch (error) {
        console.error('loadDemoEvents failed:', error);
        showNotification('Failed to load demo events: ' + error.message);
        return false;
      } finally {
        setLoading(false);
      }
    }, [isDemoMode, demoData, graphToken, apiToken, selectedCalendarId, schemaExtensions, dateRange, formatDateRangeForAPI]);

    
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
        
        if (extIds.length === 0) {
          console.log("No schema extensions registered; skipping extension expand.");
        } else {
          console.log("Found schema extensions:", extIds);
        }
    
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
          (extFilter
            ? `&$expand=extensions($filter=${encodeURIComponent(extFilter)})`
            : "");
        
        while (nextLink) {
          const resp = await fetch(nextLink, {
            headers: { Authorization: `Bearer ${graphToken}` }
          });
          if (!resp.ok) {
            console.error("Graph error paging events:", await resp.json());
            break;
          }
          const js = await resp.json();
          all = all.concat(js.value || []);
          nextLink = js["@odata.nextLink"] || null;
        }
    
        // 5. Normalize into your UI model
        const converted = all.map(evt => {
          // Extract extension data
          const extData = {};
          if (evt.extensions && evt.extensions.length > 0) {
            console.log(`Processing extensions for event ${evt.id}:`, evt.extensions);
            
            // Flatten out any extension props
            evt.extensions.forEach(x =>
              Object.entries(x).forEach(([k, v]) => {
                if (!k.startsWith("@") && k !== "id" && k !== "extensionName") {
                  extData[k] = v;
                  console.log(`  Extracted property: ${k} = ${v}`);
                }
              })
            );
          }
        
          return {
            id: evt.id,
            subject: evt.subject,
            // Always store ISO strings with Z to indicate UTC
            start: { dateTime: evt.start.dateTime.endsWith('Z') ? 
                    evt.start.dateTime : `${evt.start.dateTime}Z` },
            end: { dateTime: evt.end.dateTime.endsWith('Z') ? 
                  evt.end.dateTime : `${evt.end.dateTime}Z` },
            location: { displayName: evt.location?.displayName || "" },
            category: evt.categories?.[0] || "Uncategorized",
            extensions: evt.extensions || [],
            calendarId: selectedCalendarId,
            calendarName: availableCalendars.find(c => c.id === selectedCalendarId)?.name,
            ...extData
          };
        });

        // Enrich with internal data if API token is available
        let enrichedEvents = converted;
        if (apiToken) {
          try {
            enrichedEvents = await eventDataService.enrichEventsWithInternalData(converted);
            console.log(`Enriched ${enrichedEvents.filter(e => e._hasInternalData).length} events with internal data`);
          } catch (error) {
            console.error('Failed to enrich events, using Graph data only:', error);
            // Continue with non-enriched events
          }
        }
        
        console.log("[loadGraphEvents] events:", enrichedEvents);
        setAllEvents(enrichedEvents);

        return true;
      } catch (err) {
        console.error("loadGraphEvents failed:", err);
      } finally {
        setLoading(false);
      }
    }, [graphToken, dateRange, selectedCalendarId, availableCalendars, apiToken, formatDateRangeForAPI, schemaExtensions]);

    /**
     * TBD
     */
    const loadEvents = useCallback(async () => {
      if (isDemoMode) {
        return await loadDemoEvents();
      } else {
        return await loadGraphEvents();
      }
    }, [isDemoMode, loadDemoEvents, loadGraphEvents]);

    /**
     * Sync events to internal database 
     * @param {Date} startDate - Start date of the range to sync
     * @param {Date} endDate - End date of the range to sync
     * @returns {Promise<Object>} Success indicator and result  
     */
    const syncEventsToInternal = useCallback(async (startDate, endDate) => {
      if (!graphToken || !apiToken) {
        console.error('Missing tokens for sync');
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
        console.error('Sync failed:', error);
        return { success: false, error: error.message };
      }
    }, [graphToken, apiToken, selectedCalendarId, formatDateRangeForAPI, loadGraphEvents]);


    /**
     * Load user profile and permissions
     * @returns {Promise<boolean>} Success indicator
     */
    const loadUserProfile = useCallback(async () => {
      if (!apiToken) {
        console.log("No API token available");
        return false;
      }
      
      try {
        console.log("API token length:", apiToken.length);
        console.log("Fetching user profile for calendar permissions from:", `${API_BASE_URL}/users/current`);
        
        const response = await fetch(`${API_BASE_URL}/users/current`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });
        
        console.log("User profile response status:", response.status);
        
        if (response.status === 404) {
          console.log("User profile not found - permissions will use defaults");
          return false;
        }
        
        if (response.status === 401) {
          console.log("Unauthorized - authentication issue with API token");
          // For testing purposes, set temporary permissions
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
          return true;
        }
        
        if (response.ok) {
          const data = await response.json();
          setUserProfile(data);
          
          const permissions = {
            startOfWeek: data.preferences?.startOfWeek || 'Monday',
            defaultView: data.preferences?.defaultView || 'week',
            defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
            preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
            preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York',
            createEvents: data.preferences?.createEvents ?? false,
            editEvents: data.preferences?.editEvents ?? false,
            deleteEvents: data.preferences?.deleteEvents ?? false,  
            isAdmin: data.isAdmin || false,
          };
          
          setUserPermissions(permissions);
          if (data.preferences?.preferredTimeZone) {
            console.log("Setting timezone directly from profile:", data.preferences?.preferredTimeZone);
            setUserTimeZone(data.preferences.preferredTimeZone);
          }
          console.log("User permissions loaded:", permissions);
          return true;
        }
        return false;
      } catch (error) {
        console.error("Error fetching user permissions:", error);
        // Set fallback permissions for testing
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
        return true;
      }
    }, [apiToken, API_BASE_URL]);  

    // Add this function to your component to coordinate the loading sequence
    const initializeApp = useCallback(async () => {
      console.log("initializeApp function called");

      // Check if initialization has already started
      if (initializationStarted.current) {
        console.log("Initialization already in progress, skipping");
        return;
      }

      // Mark initialization as started immediately
      initializationStarted.current = true;

      if (!graphToken || !apiToken) {
        console.log("Cannot initialize: Missing authentication tokens");
        return;
      }

      console.log("Starting application initialization...");
      try {
        // Load user profile and permissions first
        console.log("Step: Loading user profile...");
        const userLoaded = await loadUserProfile();
        setLoadingState(prev => ({ ...prev, user: false }));
        
        if (!userLoaded) {
          console.log("Could not load user profile, but continuing with defaults");
        }

        // Load available calendars
        console.log("Step: Loading available calendars...");
        const calendars = await loadAvailableCalendars();
        setAvailableCalendars(calendars);
        
        // Set default calendar
        const defaultCalendar = calendars.find(cal => cal.isDefault);
        if (defaultCalendar) {
          setSelectedCalendarId(defaultCalendar.id);
        }
        
        // Load Outlook categories
        console.log("Step: Loading Outlook categories...");
        const categories = await loadOutlookCategories();
        setOutlookCategories(categories);
        setLoadingState(prev => ({ ...prev, categories: false }));
        
        // Create default categories if needed (optional)
        if (categories.length === 0) {
          console.log("No categories found, creating defaults");
          await createDefaultCategories();
        }
        
        // Step 3: Load schema extensions
        console.log("Step: Loading schema extensions...");
        await loadSchemaExtensions();
        setLoadingState(prev => ({ ...prev, extensions: false }));
        
        // Step 4: Finally load events
        console.log("Step: Loading calendar events...");
        await loadGraphEvents();
        setLoadingState(prev => ({ ...prev, events: false }));
        
        console.log("Application initialized successfully");
        setInitializing(false);

      } catch (error) {
        console.error("Error during initialization:", error);
        // Ensure we exit loading state even on error
        setLoadingState({
          user: false,
          categories: false,
          extensions: false,
          events: false
        });
        setInitializing(false);
      }
    }, [graphToken, apiToken, loadUserProfile, loadOutlookCategories, loadSchemaExtensions, loadGraphEvents]);

    //---------------------------------------------------------------------------
    // UTILITY/HELPER FUNCTIONS
    //---------------------------------------------------------------------------
    const showNotification = (message, type = 'error') => {
      setNotification({ show: true, message, type });
      console.log(`[Notification] ${type}: ${message}`);
      // Auto-hide after 3 seconds
      setTimeout(() => setNotification({ show: false, message: '', type: 'info' }), 3000);
    };

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

    const patchEventBatch = async (eventId, coreBody, extPayload, calendarId) => {
      const targetCalendarId = calendarId || selectedCalendarId;
      const batchBody = makeBatchBody(eventId, coreBody, extPayload, targetCalendarId);
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
        throw new Error(err.error?.message || `Batch call failed: ${resp.status}`);
      }
    };

    //---------------------------------------------------------------------------
    // DEPENDENT UTILITY FUNCTIONS - functions that depend on state or other functions
    //---------------------------------------------------------------------------
    /** 
     * Get dynamic locations from events, grouping virtual meetings
     */
    const getDynamicLocations = useCallback(() => {
      const locationsSet = new Set();
      
      allEvents.forEach(event => {
        const locationText = event.location?.displayName?.trim() || '';
        
        if (!locationText) {
          // Empty or null location
          locationsSet.add('Unspecified');
          return;
        }
        
        // Split multiple locations by semicolon or comma
        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);
        
        if (eventLocations.length === 0) {
          locationsSet.add('Unspecified');
          return;
        }
        
        // Check if ANY location is virtual - if so, add Virtual
        const hasVirtualLocation = eventLocations.some(location => isVirtualLocation(location));
        if (hasVirtualLocation) {
          locationsSet.add('Virtual');
        }
        
        // Add physical locations
        eventLocations.forEach(location => {
          if (!isVirtualLocation(location)) {
            // Add physical location as-is
            locationsSet.add(location);
          }
        });
      });
      
      // Convert to sorted array
      const locationsArray = Array.from(locationsSet).sort((a, b) => {
        // Sort with Virtual first, then Unspecified last
        if (a === 'Virtual' && b !== 'Virtual') return -1;
        if (b === 'Virtual' && a !== 'Virtual') return 1;
        if (a === 'Unspecified' && b !== 'Unspecified') return 1;
        if (b === 'Unspecified' && a !== 'Unspecified') return -1;
        return a.localeCompare(b);
      });
      
      // Return just the actual locations found in events
      return locationsArray;
    }, [allEvents, isVirtualLocation]);

    /**
     * TBD
     */ 
    const getDynamicCategories = useCallback(() => {
      // Get unique categories from all events
      const categoriesSet = new Set();
      
      allEvents.forEach(event => {
        if (event.category && event.category.trim() !== '') {
          categoriesSet.add(event.category);
        } else {
          categoriesSet.add('Uncategorized');
        }
      });
      
      // Convert to array and sort
      const categoriesArray = Array.from(categoriesSet).sort();
      
      // Add special options
      const finalCategories = [
        'Uncategorized',
        ...categoriesArray.filter(cat => cat !== 'Uncategorized'),
        'Show All Categories'
      ];
      
      return finalCategories;
    }, [allEvents]);
    
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
     * Format time for event display
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted time string
     */
    const formatEventTime = useCallback((dateString, eventSubject = 'Unknown') => {
      if (!dateString) return '';
      
      try {
        // Time formatting logic...
        const utcDateString = dateString.endsWith('Z') ? dateString : `${dateString}Z`;
        const date = new Date(utcDateString);
        
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: userTimeZone,
        });
      } catch (err) {
        console.error(`Error formatting event time for "${eventSubject}":`, err);
        return '';
      }
    }, [userTimeZone]);

    /**
    * Format date for display in the calendar header
    * @param {Date} date - The date to format
    * @returns {string} Formatted date string
    */
    const formatDateHeader = useCallback((date) => {
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'numeric', 
        day: 'numeric',
        timeZone: userTimeZone
      });
    }, [userTimeZone]);

    /**
     * TBD
     */
    const renderEventContent = useCallback((event, viewType) => {
      const styles = getEventContentStyle(viewType);
      return (
        <>
          <div className="event-time" style={styles}>
            {formatEventTime(event.start.dateTime, event.subject)}
            {viewType !== 'month' && ` - ${formatEventTime(event.end.dateTime, event.subject)}`}
          </div>
          
          <div className="event-title" style={styles}>
            {event.subject}
          </div>
          
          {/* Only show location in day and week views */}
          {viewType !== 'month' && event.location?.displayName && (
            <div className="event-location" style={styles}>
              {event.location.displayName}
            </div>
          )}
          
          {/* Only show extension properties in day view */}
          {viewType === 'day' && 
            Object.entries(event).filter(([key, value]) => 
              key !== 'id' && 
              key !== 'subject' && 
              key !== 'start' && 
              key !== 'end' && 
              key !== 'location' && 
              key !== 'category' &&
              key !== 'extensions' &&
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
    }, [getEventContentStyle, formatEventTime]);

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
     * TBD
     */
    const getFilteredLocationsForMultiSelect = useCallback(() => {
      return dynamicLocations;
    }, [dynamicLocations]);
    
    /**
     * TBD
     */
    const filteredEvents = useMemo(() => {
      console.log('Filtering events with:', { 
        groupBy, 
        selectedCategories, 
        selectedLocations,
        allEventsCount: allEvents.length 
      });
      
      const filtered = allEvents.filter(event => {
        // Month view has separate filter logic - keep existing
        if (viewType === 'month') {
          let categoryMatch = true;
          let locationMatch = true;
    
          // Check category filter
          if (selectedCategoryFilter) {
            if (selectedCategoryFilter === 'Show All Categories') {
              const knownCategories = dynamicCategories.filter(cat => 
                cat !== 'Uncategorized' && cat !== 'Show All Categories'
              );
              categoryMatch = !knownCategories.includes(event.category) && !isUncategorizedEvent(event);
            } else {
              categoryMatch = event.category === selectedCategoryFilter;
            }
          }
    
          // Check location filter
          if (selectedLocationFilter) {
            if (selectedLocationFilter === 'Show All Locations') {
              const knownLocations = dynamicLocations.filter(loc => 
                loc !== 'Unspecified' && loc !== 'Show All Locations' && loc !== 'Virtual'
              );
              // Show events that don't match any known location and aren't virtual or unspecified
              locationMatch = !isUnspecifiedLocation(event) && 
                            !isEventVirtual(event) && 
                            !knownLocations.some(loc => hasPhysicalLocation(event, loc));
            } else if (selectedLocationFilter === 'Unspecified') {
              locationMatch = isUnspecifiedLocation(event);
            } else if (selectedLocationFilter === 'Virtual') {
              locationMatch = isEventVirtual(event);
            } else {
              locationMatch = hasPhysicalLocation(event, selectedLocationFilter);
            }
          }
    
          return categoryMatch && locationMatch;
        }
    
        // Day/Week view filtering
        if (groupBy === 'categories') {
          // Category filtering logic (keep existing)
          if (isUncategorizedEvent(event)) {
            return selectedCategories.includes('Uncategorized');
          } else if (dynamicCategories.includes(event.category)) {
            return selectedCategories.includes(event.category);
          } else {
            return selectedCategories.includes('Show All Categories');
          }
        } else {
          // FIXED LOCATION FILTERING LOGIC
          console.log('Filtering event by location:', {
            eventSubject: event.subject,
            eventLocation: event.location?.displayName,
            selectedLocations,
            isVirtual: isEventVirtual(event),
            isUnspecified: isUnspecifiedLocation(event)
          });
          
          // Handle unspecified locations
          if (isUnspecifiedLocation(event)) {
            const result = selectedLocations.includes('Unspecified');
            console.log('Unspecified location result:', result);
            return result;
          }
          
          // Handle virtual events - THIS IS THE KEY FIX
          if (isEventVirtual(event)) {
            const result = selectedLocations.includes('Virtual');
            console.log('Virtual location result:', result);
            return result;
          }
          
          // Handle physical locations
          const locationText = event.location?.displayName?.trim() || '';
          const eventLocations = locationText
            .split(/[;,]/)
            .map(loc => loc.trim())
            .filter(loc => loc.length > 0 && !isVirtualLocation(loc)); // Filter out virtual locations
          
          console.log('Physical locations for event:', eventLocations);
          
          // If no physical locations remain (all were virtual), this should have been caught above
          if (eventLocations.length === 0) {
            // This means all locations were virtual, which should have been handled above
            console.log('No physical locations found, but event not marked as virtual - check logic');
            return false;
          }
          
          // Check if any physical location matches selected locations
          const hasMatchingLocation = eventLocations.some(location => {
            const inKnownLocations = dynamicLocations
              .filter(loc => loc !== 'Unspecified' && loc !== 'Show All Locations' && loc !== 'Virtual')
              .includes(location);
            
            if (inKnownLocations) {
              return selectedLocations.includes(location);
            } else {
              // Unknown location - show if "Show All Locations" is selected
              return selectedLocations.includes('Show All Locations');
            }
          });
          
          console.log('Has matching physical location:', hasMatchingLocation);
          return hasMatchingLocation;
        }
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
      
      console.log('Filtered events result:', sorted.length);
      setLoading(false);
      
      return sorted;
    }, [
      allEvents, 
      selectedCategories, 
      selectedLocations, 
      groupBy, 
      dynamicCategories,
      dynamicLocations,
      isUncategorizedEvent,
      isUnspecifiedLocation,
      isEventVirtual,
      isVirtualLocation,
      hasPhysicalLocation,
      viewType, 
      selectedCategoryFilter, 
      selectedLocationFilter
    ]);

    /**
     * TBD
     */
    const getLocationGroups = useCallback(() => {
      if (groupBy !== 'locations') return {};
      
      const groups = {};
      
      // Initialize groups for all selected locations
      selectedLocations.forEach(location => {
        groups[location] = [];
      });
      
      console.log('=== LOCATION GROUPING DEBUG ===');
      console.log('selectedLocations:', selectedLocations);
      console.log('filteredEvents count:', filteredEvents.length);
      console.log('groupBy:', groupBy);
      
      // Group filtered events by their actual location
      filteredEvents.forEach((event, index) => {
        console.log(`\n--- Processing Event ${index + 1}: "${event.subject}" ---`);
        console.log('Event location displayName:', event.location?.displayName);
        console.log('isUnspecified:', isUnspecifiedLocation(event));
        console.log('isVirtual:', isEventVirtual(event));
        
        if (isUnspecifiedLocation(event)) {
          if (groups['Unspecified']) {
            groups['Unspecified'].push(event);
            console.log('✅ Added to Unspecified group');
          } else {
            console.log('❌ Unspecified group not found in selectedLocations');
          }
        } else if (isEventVirtual(event)) {
          if (groups['Virtual']) {
            groups['Virtual'].push(event);
            console.log('✅ Added to Virtual group');
          } else {
            console.log('❌ Virtual group not found in selectedLocations');
            console.log('Available groups:', Object.keys(groups));
          }
        } else {
          // Handle physical locations
          const locationText = event.location?.displayName?.trim() || '';
          const eventLocations = locationText
            .split(/[;,]/)
            .map(loc => loc.trim())
            .filter(loc => loc.length > 0 && !isVirtualLocation(loc));
          
          console.log('Physical locations found:', eventLocations);
          
          eventLocations.forEach(location => {
            if (groups[location]) {
              groups[location].push(event);
              console.log(`✅ Added to ${location} group`);
            } else {
              console.log(`❌ Group "${location}" not found in selectedLocations`);
            }
          });
        }
      });
      
      console.log('\n=== FINAL GROUPS ===');
      Object.entries(groups).forEach(([groupName, events]) => {
        console.log(`${groupName}: ${events.length} events`);
        events.forEach(event => {
          console.log(`  - ${event.subject}`);
        });
      });
      console.log('=== END GROUPING DEBUG ===\n');
      
      return groups;
    }, [groupBy, selectedLocations, filteredEvents, isUnspecifiedLocation, isEventVirtual, isVirtualLocation]);
    

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
          if (selectedFilter === 'Show All Categories') {
            return !isKnownCategory(event.category) && !isUncategorizedEvent(event);
          } else if (isUncategorizedEvent(event)) {
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
            console.error(`Failed to create category ${cat.displayName}`);
          }
        }
        
        setOutlookCategories(createdCategories);
        return createdCategories;
      } catch (err) {
        console.error('Error creating default categories:', err);
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
          console.error(`Failed to create category ${categoryName}:`, errorData);
          return null;
        }
        
        const data = await response.json();
        console.log(`Created new Outlook category: ${categoryName}`, data);
        
        // Add the new category to the local state
        const newCategory = {
          id: data.id,
          name: data.displayName,
          color: data.color
        };
        
        setOutlookCategories(prev => [...prev, newCategory]);
        
        return newCategory;
      } catch (err) {
        console.error(`Error creating category ${categoryName}:`, err);
        return null;
      }
    }, [graphToken]);

    /**
     * TBD
     */
    const snapToStartOfWeek = useCallback((date) => {
      const newDate = new Date(date);
      const day = newDate.getDay(); // 0 = Sunday, 1 = Monday, ...
      
      // Determine how many days to go back
      let daysToSubtract;
      if (userPermissions.startOfWeek === 'Sunday') {
        daysToSubtract = day; // If Sunday start, just subtract the current day
      } else {
        // For Monday start, subtract (day - 1), unless it's Sunday (0) then subtract 6
        daysToSubtract = day === 0 ? 6 : day - 1;
      }
      
      newDate.setDate(newDate.getDate() - daysToSubtract);
      return newDate;
    },[userPermissions.startOfWeek]);
    
    //---------------------------------------------------------------------------
    // EVENT HANDLERS
    //---------------------------------------------------------------------------
    const handleDatePickerChange = useCallback((selectedDate) => {
      let newStart;
      
      if (viewType === 'week') {
        // For week view, snap to start of the week containing the selected date
        newStart = snapToStartOfWeek(selectedDate);
      } else if (viewType === 'month') {
        // For month view, go to first day of the selected month
        newStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      } else {
        // For day view, use the exact selected date
        newStart = new Date(selectedDate);
      }
      
      const newEnd = calculateEndDate(newStart, viewType);
      setDateRange({
        start: newStart,
        end: newEnd
      });
    }, [viewType, snapToStartOfWeek]);

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
      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
  
      if (!userPermissions.createEvents || (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit)) {
        showNotification("You don't have permission to create events in this calendar");
        return;
      }
      
      setModalType('add');
      setIsModalOpen(true);
    }, [availableCalendars, userPermissions.createEvents, selectedCalendarId, showNotification]);

    /**
     * Handle changing the calendar view type (day/week/month)
     * @param {string} newView - The new view type
     */
    // 
    const handleViewChange = useCallback((newView) => {
      const newEnd = calculateEndDate(dateRange.start, newView);
      const formattedRange = formatDateRangeForAPI(dateRange.start, newEnd);
      console.log(`View changed to ${newView}, date range: ${formattedRange.start} - ${formattedRange.end}`);
      
      setViewType(newView);
      setDateRange({
        start: dateRange.start,
        end: newEnd
      });
    }, [dateRange.start, formatDateRangeForAPI]);

    /**
     * Handle viewing an event in the calendar
     * @param {Object} event - The event object
     * @param {Date} eventDate - The date of the event
     */
    const handleViewInCalendar = (event) => {
      console.log("View in calendar clicked", event); // Add debugging
      
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
      let newStart;
      
      if (viewType === 'week') {
        // For week view, snap to start of the week based on preference
        newStart = snapToStartOfWeek(new Date());
      } else {
        newStart = new Date();
      }
      
      const newEnd = calculateEndDate(newStart, viewType);
      setDateRange({
        start: newStart,
        end: newEnd
      });
    },[viewType,snapToStartOfWeek]);

    /**
     * Navigate to the next time period
     */
    const handleNext = useCallback(() => {
      let newStart = new Date(dateRange.start);
      
      switch(viewType) {
        case 'day':
          newStart.setDate(newStart.getDate() + 1);
          break;
        case 'week':
          newStart.setDate(newStart.getDate() + 7);
          break;
        case 'month':
          newStart.setMonth(newStart.getMonth() + 1);
          newStart.setDate(1);
          break;
      }
      
      let newEnd = calculateEndDate(newStart, viewType);

      setDateRange({
        start: newStart,
        end: newEnd
      });
    },[viewType,dateRange.start]);

    /**
     * Navigate to the previous time period
     */
    const handlePrevious = useCallback(() => {
      let newStart = new Date(dateRange.start);
      
      switch(viewType) {
        case 'day':
          newStart.setDate(newStart.getDate() - 1);
          break;
        case 'week':
          newStart.setDate(newStart.getDate() - 7);
          break;
        case 'month':
          newStart.setMonth(newStart.getMonth() - 1);
          newStart.setDate(1);
          break;
      }
      
      let newEnd = calculateEndDate(newStart, viewType);
      
      // Keep using Date objects in state, not strings
      setDateRange({
        start: newStart,
        end: newEnd
      });
    }, [viewType, dateRange.start]);

    const handleDayCellClick = useCallback(async (day, category = null, location = null) => {
      if(!userPermissions.createEvents) {
        showNotification("User don't have permission to create events");
        return;
      }
      // Close context menu if open
      setShowContextMenu(false);
      
      // Set up start and end times (1 hour duration)
      const startTime = new Date(day);
      startTime.setHours(9, 0, 0, 0); // Default to 9 AM
      
      const endTime = new Date(startTime);
      endTime.setHours(startTime.getHours() + 1);
      
      // Set the category based on what view we're in
      let eventCategory = 'Uncategorized';
      let eventLocation = 'Unspecified';

      if (groupBy === 'categories' && category) {
        eventCategory = category;
        
        // Check if this category exists in Outlook categories
        if (category !== 'Uncategorized') {
          const categoryExists = outlookCategories.some(cat => cat.name === category);
          
          if (!categoryExists) {
            console.log(`Category ${category} doesn't exist in Outlook categories, creating it...`);
            await createOutlookCategory(category);
          }
        }
      } else if (groupBy === 'locations' && location && location !== 'Unspecified') {
        eventLocation = location;
      }
      
      // Create a new event template
      const newEvent = {
        subject: '',
        start: { dateTime: standardizeDate(startTime) },
        end: { dateTime: standardizeDate(endTime) },
        location: { displayName: eventLocation },
        category: eventCategory,
        calendarId: selectedCalendarId,
        calendarName: availableCalendars.find(cal => cal.id === selectedCalendarId)?.name
      };
      
      setCurrentEvent(newEvent);
      setModalType('add');
      setIsModalOpen(true);
    }, [userPermissions.createEvents, showNotification, groupBy, selectedCalendarId, availableCalendars, outlookCategories, createOutlookCategory, standardizeDate, viewType]);

    /**
     * Handle clicking on an event to open the context menu
     * @param {Object} event - The event that was clicked
     * @param {Object} e - The click event
     */
    const handleEventClick = useCallback((event, e) => {
      e.stopPropagation();
      console.log('Event clicked:', event);
      // Rest of your handler
      setCurrentEvent(event);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    }, []);

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
      
      setShowContextMenu(false);
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
        
        console.log(`[handleSaveDemoEvent] ${isNew ? 'Created' : 'Updated'} demo event:`, data.subject);
        return true;
        
      } catch (error) {
        console.error('Demo save failed:', error);
        throw error;
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
          categories: data.categories
        };
        
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
        
        // Batch update - pass the selected calendar ID
        await patchEventBatch(data.id, core, ext, selectedCalendarId);
        
        // Refresh API events
        await loadGraphEvents();
        
        console.log(`[handleSaveApiEvent] ${data.id ? 'Updated' : 'Created'} API event:`, data.subject);
        return true;
        
      } catch (error) {
        console.error('API save failed:', error);
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
        console.error('Save failed:', error);
        alert('Save failed: ' + error.message);
        return false;
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
        
        console.log(`[handleDeleteDemoEvent] Deleted demo event:`, eventId);
        return true;
        
      } catch (error) {
        console.error('Demo delete failed:', error);
        throw error;
      }
    };

    /**
     * TBD
     */
    const handleDeleteApiEvent = async (eventId) => {
      try {
        // Determine the API URL based on whether a calendar is selected
        const apiUrl = selectedCalendarId
          ? `https://graph.microsoft.com/v1.0/me/calendars/${selectedCalendarId}/events/${eventId}`
          : `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
            
        const response = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
    
        if (!response.ok) {
          const error = await response.json();
          console.error('Failed to delete event from Graph:', error);
          throw new Error(`API delete failed: ${response.status}`);
        } else {
          console.log('Event deleted from Microsoft Calendar');
        }
        
        // Update local state immediately
        setAllEvents(allEvents.filter(event => event.id !== eventId));
        
        // Reload API events to ensure consistency
        await loadGraphEvents();
        
        console.log(`[handleDeleteApiEvent] Deleted API event:`, eventId);
        return true;
        
      } catch (error) {
        console.error('API delete failed:', error);
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
        } else {
          await handleDeleteApiEvent(currentEvent.id);
        }
        
        // Close modal and clear current event (common to both modes)
        setIsModalOpen(false);
        setCurrentEvent(null);
        
        showNotification('Event deleted successfully!', 'success');
        
      } catch (error) {
        console.error('Delete failed:', error);
        alert('Delete failed: ' + error.message);
      }
    };

    //---------------------------------------------------------------------------
    // DEBUGGING FUNCTIONS
    //---------------------------------------------------------------------------
    const debugDemoData = () => {
      if (demoData?.events) {
        console.log('=== DEMO DATA DEBUG ===');
        console.log('Total events:', demoData.events.length);
        console.log('Date range of demo data:', demoData.searchCriteria?.dateRange);
        console.log('Current calendar view:', {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString()
        });
        
        // Show first few events
        const sampleEvents = demoData.events.slice(0, 5);
        console.log('Sample events:');
        sampleEvents.forEach((event, i) => {
          console.log(`${i + 1}. ${event.subject}`);
          console.log(`   Start: ${event.startDateTime}`);
          console.log(`   End: ${event.endDateTime}`);
          console.log(`   Location: ${event.location}`);
          console.log(`   Categories: ${JSON.stringify(event.categories)}`);
        });
        
        // Check if any events fall in current date range
        const eventsInRange = demoData.events.filter(event => {
          const eventDate = new Date(event.startDateTime);
          return eventDate >= dateRange.start && eventDate <= dateRange.end;
        });
        console.log(`Events in current range (${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}):`, eventsInRange.length);
        
        if (eventsInRange.length === 0) {
          const eventDates = demoData.events.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          console.log('Event date range in data:');
          console.log(`  Earliest: ${earliestEvent.toLocaleDateString()}`);
          console.log(`  Latest: ${latestEvent.toLocaleDateString()}`);
          console.log('SUGGESTION: Navigate calendar to these dates to see events');
        }
        console.log('======================');
      }
    };

    //---------------------------------------------------------------------------
    // MAIN INITIALIZATION FUNCTION
    //---------------------------------------------------------------------------
    useEffect(() => {
      // Only run initialization once when tokens become available
      if (graphToken && apiToken && initializing) {
        console.log("Tokens available, starting initialization");
        initializeApp();
      }
    }, [graphToken, apiToken, initializing, initializeApp]);

    useEffect(() => {
      if (apiToken) {
        eventDataService.setApiToken(apiToken);
      }
    }, [apiToken]);

    useEffect(() => {
      // This will run whenever dateRange changes
      if (graphToken && !initializing) {
        console.log("Date range changed, loading events for:", {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString()
        });
        
        // Call the existing loadGraphEvents function
        loadEvents();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRange, graphToken, initializing]);

    useEffect(() => {
      if (selectedCalendarId && !initializing && graphToken && !changingCalendar) {
        console.log(`Loading events for calendar: ${selectedCalendarId}`);
        loadEvents().finally(() => {
          if (changingCalendar) setChangingCalendar(false);
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCalendarId, initializing, graphToken, changingCalendar]);

    // Set user time zone from user permissions
    useEffect(() => {
      if (userPermissions.preferredTimeZone && userPermissions.preferredTimeZone !== userTimeZone) {
        console.log("Setting userTimeZone from userPermissions:", userPermissions.preferredTimeZone);
        setUserTimeZone(userPermissions.preferredTimeZone);
      }
    }, [userPermissions.preferredTimeZone, userTimeZone]);

    // Update selected locations when dynamic locations change
    useEffect(() => {
      if (dynamicLocations.length > 0) {
        // Select all locations by default
        setSelectedLocations(dynamicLocations);
        console.log("Updated selected locations based on dynamic locations from events");
      }
    }, [dynamicLocations]);

    // Update selected categories when Outlook categories change
    useEffect(() => {
      if (dynamicCategories.length > 0) {
        // Select all categories by default
        setSelectedCategories(dynamicCategories);
        console.log("Updated selected categories based on dynamic categories from events");
      }
    }, [dynamicCategories]);

    // Initialize date range for month view
    useEffect(() => {
      if (viewType === 'month') {
        // Reset date to first day of month
        const firstDayOfMonth = new Date(dateRange.start);
        firstDayOfMonth.setDate(1);
        
        const endOfMonth = calculateEndDate(firstDayOfMonth, 'month');
        
        setDateRange({
          start: firstDayOfMonth,
          end: endOfMonth
        });
      }
    }, [viewType]);

    useEffect(() => {
      if (viewType === 'week') {
        const weekStart = snapToStartOfWeek(dateRange.start);
        const weekEnd = calculateEndDate(weekStart, 'week');
        
        // Only update if it's different to avoid infinite loop
        if (weekStart.getDate() !== dateRange.start.getDate()) {
          setDateRange({
            start: weekStart,
            end: weekEnd
          });
        }
      }
    }, [viewType, userPermissions.startOfWeek, dateRange.start, snapToStartOfWeek]);

    // Initialize filter for month view
    useEffect(() => {
      // Set default filter based on the groupBy setting
      if (groupBy === 'categories' && dynamicCategories.length > 0) {
        setSelectedFilter('Uncategorized');
      } else if (groupBy === 'locations') {
        setSelectedFilter('Unspecified');
      }
    }, [groupBy, dynamicCategories]);

    // Close context menu when clicking outside
    useEffect(() => {      
      const handleClickOutside = () => {
        setShowContextMenu(false);
      };
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }, []);

    // Debugging 
    useEffect(() => {
      if (allEvents.length > 0) {
        console.log('All events locations:', allEvents.map(event => ({
          subject: event.subject,
          location: event.location?.displayName,
          isVirtual: isEventVirtual(event),
          isUnspecified: isUnspecifiedLocation(event)
        })));
        
        console.log('Dynamic locations:', dynamicLocations);
      }
    }, [allEvents, isEventVirtual, isUnspecifiedLocation, dynamicLocations]);

    useEffect(() => {
      const handleKeyPress = (e) => {
        // Press 'G' to focus the date picker (like Google Calendar)
        if (e.key === 'g' || e.key === 'G') {
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
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
        return getLocationGroups();
      }
      return {};
    }, [groupBy, getLocationGroups]);

    //---------------------------------------------------------------------------
    // RENDERING
    //---------------------------------------------------------------------------
    return (
      <div className="calendar-container">
        {(initializing || loading) && <LoadingOverlay/>}
        <div className="calendar-header">
          <div className="calendar-controls">
            
            <div className="view-selector">
              <button 
                className={viewType === 'day' ? 'active' : ''} 
                onClick={() => {
                    handleViewChange('day');
                    updateUserProfilePreferences({ defaultView: 'day' });
                  }
                }
              >
                Day
              </button>
              <button 
                className={viewType === 'week' ? 'active' : ''} 
                onClick={() => {
                    handleViewChange('week');
                    updateUserProfilePreferences({ defaultView: 'week' });
                  }
                }
              >
                Week
              </button>
              <button 
                className={viewType === 'month' ? 'active' : ''} 
                onClick={() => {
                    handleViewChange('month');
                    updateUserProfilePreferences({ defaultView: 'month' });
                  }
                }
              >
                Month
              </button>
            </div>
    
            <div className="selector-group" style={{ display: 'flex', gap: '2px' }}>
              <div className="time-zone-selector">
                <select
                  key={`timezone-select-${userTimeZone}`}
                  value={userTimeZone}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setUserTimeZone(newValue);
                    setUserPermissions(prev => ({
                      ...prev,
                      preferredTimeZone: newValue
                    }));
                    updateUserProfilePreferences({ preferredTimeZone: newValue });
                  }}
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              
              {/* Week Start Selector - NEW */}
              <div className="week-start-selector">
                <select
                  value={userPermissions.startOfWeek}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    
                    // Update user preferences
                    setUserPermissions(prev => ({
                      ...prev,
                      startOfWeek: newValue
                    }));
                    updateUserProfilePreferences({ startOfWeek: newValue });
                    
                    // Only adjust date range if in week view
                    if (viewType === 'week') {
                      // Get the current start date
                      const currentStartDate = new Date(dateRange.start);
                      let newStart;
                      
                      // If switching from Sunday to Monday, add 1 day to the current start
                      if (newValue === 'Monday' && userPermissions.startOfWeek === 'Sunday') {
                        newStart = new Date(currentStartDate);
                        newStart.setDate(currentStartDate.getDate() + 1);
                      } 
                      // If switching from Monday to Sunday, subtract 1 day from current start
                      else if (newValue === 'Sunday' && userPermissions.startOfWeek === 'Monday') {
                        newStart = new Date(currentStartDate);
                        newStart.setDate(currentStartDate.getDate() - 1);
                      }
                      // Otherwise use current start
                      else {
                        newStart = currentStartDate;
                      }
                      
                      // Calculate the new end date based on the new start
                      const newEnd = calculateEndDate(newStart, 'week');
                      
                      // Update date range
                      setDateRange({
                        start: newStart,
                        end: newEnd
                      });
                    }
                  }}
                >
                  <option value="Sunday">Sunday start of Week</option>
                  <option value="Monday">Monday start of Week</option>
                </select>
              </div>
            </div>
    
            {/* View mode selectors - Hide in month view */}
            {viewType !== 'month' && (
              <div className="view-mode-selector">
                <button 
                  className={groupBy === 'categories' ? 'active' : ''} 
                  onClick={() => {
                      setGroupBy('categories');
                      updateUserProfilePreferences({ defaultGroupBy: 'categories' });
                    }
                  }
                >
                  Group by Category
                </button>
                <button 
                  className={groupBy === 'locations' ? 'active' : ''} 
                  onClick={() => {
                      setGroupBy('locations');
                      updateUserProfilePreferences({ defaultGroupBy: 'locations' });
                    }
                  }
                >
                  Group by Location
                </button>
              </div>
            )}
            
            <div className="navigation">
              <button onClick={handlePrevious}>Previous</button>
              <button onClick={handleToday}>Today</button>
              
              {/* NEW: Add the date picker between Today and Next */}
              <DatePickerButton 
                currentDate={dateRange.start}
                onDateChange={handleDatePickerChange}
                viewType={viewType}
              />
              
              <button onClick={handleNext}>Next</button>
            </div>
            
            <div className="current-range">
              {viewType === 'day' 
                ? dateRange.start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : viewType === 'month'
                  ? dateRange.start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) 
                  : `${dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              }
            </div>
    
            {/* Add zoom controls here */}
            <div className="zoom-controls">
              <button onClick={() => {
                  handleZoom('out');
                  const newZoom = zoomLevel - 10;
                  updateUserProfilePreferences({ preferredZoomLevel: newZoom });
                }
              } title="Zoom Out">−</button>
              <span>{zoomLevel}%</span>
              <button onClick={() => {
                  handleZoom('in');
                  updateUserProfilePreferences({ preferredZoomLevel: zoomLevel + 10 });
                }
              } title="Zoom In">+</button>
            </div>
            
            <div className="calendar-action-buttons">
              <button className="search-button" onClick={() => setShowSearch(true)}>
                🔍 Search & Export
              </button>
              {userPermissions.createEvents && (
                <button className="add-event-button" onClick={handleAddEvent}>
                  + Add Event
                </button>
              )}
              <ExportToPdfButton 
                events={filteredEvents} 
                dateRange={dateRange} 
              />
            </div>
          </div>
        </div>
    
        {/* Toggle Between ApiMode & DemoMode */}
        {renderModeToggle()}

        {initializing ? (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '400px', 
            width: '100%', 
            fontSize: '18px' 
          }}>
            Loading your calendar data...
          </div>
        ) : (
          <>
            <div className="calendar-main-content">
              {loading}
              
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
                        availableLocations={availableLocations}
                        dynamicLocations={dynamicLocations}
                        getFilteredMonthEvents={getFilteredMonthEvents}
                        getMonthDayEventPosition={getMonthDayEventPosition}
                        allEvents={allEvents}
                        userTimeZone={userTimeZone}
                        handleMonthFilterChange={handleMonthFilterChange}
                        selectedCategoryFilter={selectedCategoryFilter}
                        selectedLocationFilter={selectedLocationFilter}
                        handleCategoryFilterChange={handleCategoryFilterChange}
                        handleLocationFilterChange={handleLocationFilterChange}
                        dynamicCategories={dynamicCategories}
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
                        availableLocations={availableLocations}
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
                      />
                    ) : (
                      <DayView
                        groupBy={groupBy}
                        outlookCategories={outlookCategories}
                        selectedCategories={selectedCategories}
                        availableLocations={availableLocations}
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
                      />
                    )}
                  </div>
                )}
              </div>
    
              {/* Right sidebar for filters */}
              {viewType !== 'month' && (
                <div className="calendar-right-sidebar">
                  {groupBy === 'categories' ? (
                    <>
                      <h3>Categories</h3>
                      {/* Selection controls */}
                      <div className="selection-controls" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '10px',
                        gap: '10px'
                      }}>
                        <button 
                          onClick={() => {
                            setSelectedCategories(dynamicCategories); // Use dynamic categories instead of static
                            updateUserProfilePreferences({ selectedCategories: dynamicCategories });
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--white)',
                            color: 'var(--primary-color)',
                            border: '1px solid var(--primary-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            flex: '1',
                            whiteSpace: 'nowrap',
                            fontSize: '13px'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          All
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedCategories([]);
                            updateUserProfilePreferences({ selectedCategories: [] });
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--white)',
                            color: 'var(--primary-color)',
                            border: '1px solid var(--primary-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            flex: '1',
                            whiteSpace: 'nowrap',
                            fontSize: '13px'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          None
                        </button>
                      </div>
                      <MultiSelect 
                        options={dynamicCategories.filter(cat => cat !== 'Show All Categories')} // Remove special option for filter
                        selected={selectedCategories}
                        onChange={val => {
                            setSelectedCategories(val);
                            updateUserProfilePreferences({ selectedCategories: val });
                          }
                        }
                        label="Filter by categories"
                      />
                    </>
                  ) : (
                    <>
                      <h3>Locations</h3>
                      {/* Selection controls */}
                      <div className="select-controls" style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '10px',
                        gap: '10px'
                      }}>
                        <button 
                          onClick={() => {
                            setSelectedLocations(dynamicLocations); // CHANGED: Use dynamicLocations instead of availableLocations
                            updateUserProfilePreferences({ selectedLocations: dynamicLocations });
                          }}
                          style={{ 
                            padding: '6px 12px',
                            backgroundColor: 'var(--white)',
                            color: 'var(--primary-color)',
                            border: '1px solid var(--primary-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            flex: '1',
                            whiteSpace: 'nowrap',
                            fontSize: '13px'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          All
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedLocations([]);
                            updateUserProfilePreferences({ selectedLocations: [] });
                          }}
                          style={{ 
                            padding: '6px 12px',
                            backgroundColor: 'var(--white)',
                            color: 'var(--primary-color)',
                            border: '1px solid var(--primary-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            flex: '1',
                            whiteSpace: 'nowrap',
                            fontSize: '13px'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          None
                        </button>
                      </div>
                      <MultiSelect 
                        options={dynamicLocations.filter(loc => loc !== 'Show All Locations')} // CHANGED: Use dynamicLocations instead of availableLocations
                        selected={selectedLocations}
                        onChange={val => {
                          setSelectedLocations(val);
                          updateUserProfilePreferences({ selectedLocations: val });
                        }}
                        label="Filter by locations"
                      />
                    </>
                  )}
                </div>
              )}
            </div>
    
            {/* Context Menu */}
            {showContextMenu && currentEvent && (
              <div 
                className="context-menu"
                style={{ 
                  top: `${contextMenuPosition.y}px`, 
                  left: `${contextMenuPosition.x}px` 
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="context-menu-item" onClick={() => {
                  setModalType(userPermissions.editEvents ? 'edit' : 'view');
                  setShowContextMenu(false);
                  setIsModalOpen(true);
                }}>
                  {userPermissions.editEvents ? 'Edit Event' : 'View Event'}
                </div>
                {userPermissions.deleteEvents && (
                  <div className="context-menu-item delete" onClick={handleDeleteEvent}>
                    Delete Event
                  </div>
                )}
              </div>
            )}
          </>
        )}
    
        {/* Modal for Add/Edit Event */}
        <Modal 
          isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit' || modalType === 'view')} 
          onClose={() => setIsModalOpen(false)}
          title={
            modalType === 'add' ? 'Add Event' : 
            modalType === 'edit' ? 'Edit Event' : 'View Event'
          }
        >
          <EventForm 
            event={currentEvent}
            categories={dynamicCategories.filter(cat => cat !== 'Show All Categories')} // Remove the special "Show All" option for form
            availableLocations={getFilteredLocationsForMultiSelect()}
            dynamicLocations={dynamicLocations}
            schemaExtensions={schemaExtensions}
            onSave={handleSaveEvent}
            onCancel={() => setIsModalOpen(false)}
            readOnly={modalType === 'view'}
            userTimeZone={userTimeZone}
          />
        </Modal>
    
        {/* Modal for Delete Confirmation */}
        <Modal
          isOpen={isModalOpen && modalType === 'delete'}
          onClose={() => setIsModalOpen(false)}
          title="Delete Event"
        >
          <div className="delete-confirmation">
            <p>Are you sure you want to delete "{currentEvent?.subject}"?</p>
            <div className="form-actions">
              <button 
                className="cancel-button" 
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </button>
              <button 
                className="delete-button" 
                onClick={handleDeleteConfirm}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
        {showSearch && (
          <EventSearch 
            graphToken={graphToken}
            onEventSelect={handleEventSelect}
            onViewInCalendar={handleViewInCalendar}
            onClose={() => setShowSearch(false)}
            outlookCategories={outlookCategories}
            availableLocations={availableLocations}
            dynamicLocations={dynamicLocations}
            onSaveEvent={handleSaveEvent}
            selectedCalendarId={selectedCalendarId}
            availableCalendars={availableCalendars}
          />
        )}
      </div>
    );
  }

  export default Calendar;
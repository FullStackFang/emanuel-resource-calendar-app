// src/components/Calendar.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from './Modal';
import EventForm from './EventForm';
import MultiSelect from './MultiSelect';
import { msalConfig } from '../config/authConfig';
import ExportToPdfButton from './CalendarExport';
import { useUserPreferences } from '../hooks/useUserPreferences';
import EventSearch from './EventSearch';
import './Calendar.css';
import APP_CONFIG from '../config/config';

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

const getFilteredLocationsForMultiSelect = () => {
  return availableLocations.filter(location => location !== 'Unspecified');
};

/*****************************************************************************
 * MAIN CALENDAR COMPONENT
 *****************************************************************************/
function Calendar({ graphToken, apiToken }) {
  //---------------------------------------------------------------------------
  // STATE MANAGEMENT
  //---------------------------------------------------------------------------
  // Loading state
  const [initializing, setInitializing] = useState(true);
  const [initState, setInitState] = useState('idle');
  const [loading, setLoading] = useState(false);
  
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
  const [selectedLocations, setSelectedLocations] = useState(availableLocations);
  const [dateRange, setDateRange] = useState({
    start: new Date(),
    end: calculateEndDate(new Date(), 'week')
  });
  

  // Profile states
  const { prefs, loading: prefsLoading, updatePrefs } = useUserPreferences();
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
  // DATA FUNCTIONS
  //---------------------------------------------------------------------------
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

  /**
   * Load events from Microsoft Graph API
   *
  */
  const loadGraphEvents = useCallback(async () => {
    // 0. Don't even start until we have a token
    if (!graphToken) { return; }
    setLoading(true);
    try {
      // 1. Format your dates
      const { start, end } = formatDateRangeForAPI(dateRange.start, dateRange.end);
  
      // 2. Pull down your registered schema‑extension IDs
      const available = await loadSchemaExtensions();
      const extIds = available.map(e => e.id);
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
        `https://graph.microsoft.com/v1.0/me/events` +
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
      console.log(`Fetched ${all.length} events.`);
  
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
          start:  { dateTime: evt.start.dateTime },
          end:    { dateTime: evt.end.dateTime },
          location: { displayName: evt.location?.displayName || "" },
          category: evt.categories?.[0] || "Uncategorized",
          extensions: evt.extensions || [],
          ...extData
        };
      });
  
      if (converted.length > 0) {
        console.log("[loadGraphEvents] Sample converted event with extensions:", JSON.stringify(converted[0], null, 2));
      }

      console.log("[loadGraphEvents] events:", converted);
      
      setAllEvents(converted);
      setInitializing(false);
    } catch (err) {
      console.error("loadGraphEvents failed:", err);
    } finally {
      setLoading(false);
    }
  }, [graphToken, dateRange, loadSchemaExtensions]);

  /**
   * Fetch user profile and permissions for calendar
   */
  const fetchUserProfile = useCallback(async () => {
    if (!apiToken) return null;
    
    try {
      const response = await fetch(`${API_BASE_URL}/users/current`, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      });
      
      if (response.status === 404) {
        console.log("User profile not found - permissions will use defaults");
        return null;
      }
      
      if (response.status === 401) {
        console.log("Unauthorized - authentication issue with API token");
        
        // Set default permissions
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
        
        return null;
      }
      
      if (response.ok) {
        const data = await response.json();
        setUserProfile(data);
        
        const permissions = {
          startOfWeek: data.preferences?.startOfWeek || 'Monday',
          defaultView: data.preferences?.defaultView || 'week',
          defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
          preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
          createEvents: data.preferences?.createEvents ?? false,
          editEvents: data.preferences?.editEvents ?? false,
          deleteEvents: data.preferences?.deleteEvents ?? false,  
          isAdmin: data.isAdmin || false,
          preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York'
        };
        
        setUserPermissions(permissions);
        
        return data;
      }
      
      return null;
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      
      // Set fallback permissions
      setUserPermissions({
        startOfWeek: 'Monday',
        defaultView: 'week',
        defaultGroupBy: 'categories',
        preferredZoomLevel: 100,
        createEvents: false,
        editEvents: false,
        deleteEvents: false,
        isAdmin: false
      });
      
      return null;
    }
  }, [apiToken, API_BASE_URL]);

  //---------------------------------------------------------------------------
  // UTILITY/HELPER FUNCTIONS
  //---------------------------------------------------------------------------
  const isUncategorizedEvent = (event) => {
    return !event.category || 
           event.category.trim() === '' || 
           event.category === 'Uncategorized';
  };

  const showNotification = (message, type = 'error') => {
    setNotification({ show: true, message, type });
    console.log(`[Notification] ${type}: ${message}`);
    // Auto-hide after 3 seconds
    setTimeout(() => setNotification({ show: false, message: '', type: 'info' }), 3000);
  };

  const makeBatchBody = (eventId, coreBody, extPayload) => ({
    requests: [
      {
        id: '1', method: eventId ? 'PATCH' : 'POST',
        url: eventId ? `/me/events/${eventId}` : '/me/events',
        headers: { 'Content-Type': 'application/json' },
        body: coreBody
      },
      ...(
        Object.keys(extPayload).length
          ? [{ id: '2', method: 'PATCH', url: `/me/events/${eventId}`, headers: { 'Content-Type': 'application/json' }, body: extPayload }]
          : []
      )
    ]
  });

  const patchEventBatch = async (eventId, coreBody, extPayload) => {
    const batchBody = makeBatchBody(eventId, coreBody, extPayload);
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

  // Add this helper function to filter events for month view
  const getFilteredMonthEvents = (day) => {
    if (!selectedFilter) return [];
    
    return filteredEvents.filter(event => {
      // Check if event occurs on this day
      if (!getMonthDayEventPosition(event, day)) return false;
      
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
  };

  // Generate the weeks for the calendar view
  function getMonthWeeks() {
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
  }

  // Add this function to generate weekday headers based on start of week preference
  const getWeekdayHeaders = () => {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Monday start
    
    if (userPermissions.startOfWeek === 'Sunday') {
      // Rearrange for Sunday start: move Sunday from end to beginning
      weekdays.unshift(weekdays.pop());
    }
    
    return weekdays;
  };
  
  function getMonthDayEventPosition(event, day) {
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
  }

  // Add this function to your Calendar component
  const getEventContentStyle = (viewType) => {
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
      case 'week':
        return {
          fontSize: '12px',
          lineHeight: '1.3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        };
      case 'month':
        return {
          fontSize: '11px',
          lineHeight: '1.2',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        };
      default:
        return {};
    }
  };

  // Use this function to conditionally render event content
  const renderEventContent = (event, viewType) => {
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
  };

  /**
   * Standardize date for API operations, ensuring consistent time zone handling
   * @param {Date} date - Local date to standardize
   * @returns {string} ISO date string in UTC
   */
    const standardizeDate = (date) => {
      if (!date) return '';
      
      // Convert to UTC ISO string
      return date.toISOString();
    };

  /**
   * Consistently format date range for API queries
   * @param {Date} startDate - Range start date
   * @param {Date} endDate - Range end date
   * @returns {Object} Formatted start and end dates
   */
    const formatDateRangeForAPI = (startDate, endDate) => {
      // Set startDate to beginning of day in UTC
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      // Set endDate to end of day in UTC
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      return {
        start: start.toISOString(),
        end: end.toISOString()
      };
    };

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
        // For week view, always add 6 days to include entire week
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

  /**
   * Get the color associated with a category from Outlook
   * @param {string} categoryName - The name of the category
   * @returns {string} The hex color code
   */
  const getCategoryColor = (categoryName) => {
    const category = outlookCategories.find(cat => cat.name === categoryName);
    
    if (!category) return '#cccccc'; // Default gray for uncategorized
    
    // Map Outlook preset colors to actual CSS colors
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
  };

  /**
   * Get the color associated with a location
   * @param {string} locationName - The name of the location
   * @returns {string} The hex color code
   */
  const getLocationColor = (locationName) => {
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
    
    return locationColorMap[locationName] || '#9E9E9E'; // Default to gray
  };

  /**
   * Get all days within the current date range for the calendar view
   * @returns {Array} Array of Date objects for each day in the range
   */
  const getDaysInRange = () => {
    const days = [];
    const currentDate = new Date(dateRange.start);
    
    while (currentDate <= dateRange.end) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  };

  /**
  * Format date for display in the calendar header
  * @param {Date} date - The date to format
  * @returns {string} Formatted date string
  */
  const formatDateHeader = (date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'numeric', 
      day: 'numeric',
      timeZone: userTimeZone
    });
  };

  /**
   * Format time for event display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted time string
   */
  const formatEventTime = (dateString, eventSubject = 'Unknown') => {
    if (!dateString) return '';
    
    try {
      // Add 'Z' to indicate this is UTC time if it doesn't already have a timezone indicator
      const utcDateString = dateString.endsWith('Z') ? dateString : `${dateString}Z`;
      
      // For debugging
      const isTargetEvent = eventSubject.includes("TESTING");
      if (isTargetEvent) {
        console.log(`⏰ TIME DEBUG FOR EVENT: "${eventSubject}" ⏰`);
        console.log("Original time string:", dateString);
        console.log("Modified time string with UTC indicator:", utcDateString);
        console.log("Current userTimeZone:", userTimeZone);
      }
      
      // Create date object with explicit UTC time
      const date = new Date(utcDateString);
      
      // Format with user's timezone
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
  };

  /**
   * Check if an event occurs on a specific day
   * @param {Object} event - The event object
   * @param {Date} day - The day to check
   * @returns {boolean} True if the event occurs on the day
   */
  const getEventPosition = (event, day) => {
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
  };

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

  //---------------------------------------------------------------------------
  // EVENT HANDLERS
  //---------------------------------------------------------------------------
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

  // Add this new handler for the month filter dropdown
  const handleMonthFilterChange = (value) => {
    setSelectedFilter(value);
  };

  /**
   * Handle calendar zoom in and zoom out
   * @param {string} direction - The new direction
   */
  // 
  const handleZoom = (direction) => {
    if (direction === 'in' && zoomLevel < 150) {
      setZoomLevel(zoomLevel + 10);
    } else if (direction === 'out' && zoomLevel > 70) {
      setZoomLevel(zoomLevel - 10);
    }
  };

  /**
   * Handle changing the calendar view type (day/week/month)
   * @param {string} newView - The new view type
   */
  // 
  const handleViewChange = (newView) => {
    const newEnd = calculateEndDate(dateRange.start, newView);
    
    const formattedRange = formatDateRangeForAPI(dateRange.start, newEnd);
    console.log(`View changed to ${newView}, date range: ${formattedRange.start} - ${formattedRange.end}`);
    
    setViewType(newView);
    setDateRange({
      start: dateRange.start,
      end: newEnd
    });
  };

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
   * Navigate to the previous time period
   */
  // Navigation handlers
  const handlePrevious = () => {
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
  };

  /**
   * Navigate to the next time period
   */
  const handleNext = () => {
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
  };

  const snapToStartOfWeek = (date) => {
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
  };

  /**
   * Navigate to today
   */
  const handleToday = () => {
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
  };

  /**
   * Handle clicking on a day cell to add a new event
   * @param {Date} day - The day that was clicked
   * @param {string} category - The category row that was clicked
   */
  const handleDayCellClick = async (day, category = null, location = null) => {
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
      category: eventCategory
    };
    
    setCurrentEvent(newEvent);
    setModalType('add');
    setIsModalOpen(true);
  };

  /**
   * Handle clicking on an event to open the context menu
   * @param {Object} event - The event that was clicked
   * @param {Object} e - The click event
   */
  const handleEventClick = (event, e) => {
    e.stopPropagation();

    console.log('Event clicked:', event);
    console.log('Extension data in clicked event:', Object.keys(event).filter(key => 
      key !== 'id' && key !== 'subject' && key !== 'start' && 
      key !== 'end' && key !== 'location' && key !== 'category'
    ).reduce((obj, key) => {
      obj[key] = event[key];
      return obj;
    }, {}));
    
    setCurrentEvent(event);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  /**
   * Open the Add, Edit, Delete, Save modal
   */
  const handleAddEvent = () => {
    if(!userPermissions.createEvents) {
      console.log("User does not have permission to create events");
      return;
    }
    setModalType('add');
    setIsModalOpen(true);
  };

  const handleEditEvent = () => {
    if(!userPermissions.editEvents) {
      console.log("User does not have permission to edit events");
      return;
    }
    setShowContextMenu(false);
    setModalType('edit');
    setIsModalOpen(true);
  };

  const handleDeleteEvent = () => {
    if(!userPermissions.deleteEvents) {
      console.log("User does not have permission to delete events");
      return;
    }
    setShowContextMenu(false);
    setModalType('delete');
    setIsModalOpen(true);
  };

  /**
   * Called by EventForm or EventSearch when the user hits "Save"
   * @param {Object} data - The payload from EventForm.handleSubmit
   * @returns {boolean} Success indicator
   */
  const handleSaveEvent = async (data) => {
    // Add permission check
    const isNew = !data.id || data.id.includes('event_');
    if (isNew && !userPermissions.createEvents) {
      alert("You don't have permission to create events");
      return false;
    }
    if (!isNew && !userPermissions.editEvents) {
      alert("You don't have permission to edit events");
      return false;
    }

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
      
      // Batch update
      await patchEventBatch(data.id, core, ext);
      
      // Refresh
      await loadGraphEvents();
      
      // Only close modal if it's open (not when called from search)
      if (isModalOpen) {
        setIsModalOpen(false);
      }
      
      return true; // Success indicator
    } catch (e) {
      console.error(e);
      alert('Save failed: ' + e.message);
      return false;
    }
  };
  
  /**
   * Delete an event
   */
  const handleDeleteConfirm = async () => {
    if (graphToken && currentEvent?.id) {
      try {
        const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${currentEvent.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
  
        if (!response.ok) {
          const error = await response.json();
          console.error('Failed to delete event from Graph:', error);
        } else {
          console.log('Event deleted from Microsoft Calendar');
        }
      } catch (err) {
        console.error('Error deleting from Graph:', err);
      }
    }
  
    setAllEvents(allEvents.filter(event => event.id !== currentEvent?.id));
    setIsModalOpen(false);
    setCurrentEvent(null);
    
    // Add this line to reload all events after deleting
    loadGraphEvents();
  };

  //---------------------------------------------------------------------------
  // MAIN INITIALIZATION FUNCTION
  //---------------------------------------------------------------------------
  useEffect(() => {
    // This will run whenever dateRange changes
    if (graphToken && !initializing) {
      console.log("Date range changed, loading events for:", {
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString()
      });
      
      // Call the existing loadGraphEvents function
      loadGraphEvents();
    }
  }, [dateRange, graphToken, initializing, loadGraphEvents]);

  useEffect(() => {
    const initializeCalendar = async () => {
      if (!graphToken || !apiToken || prefsLoading) {
        return;
      }
      
      try {
        // Wait for user profile/permissions to load first
        // You can keep your existing user profile loading logic here
        
        // Load categories
        const categories = await loadOutlookCategories();
        setOutlookCategories(categories);
        
        // Load schema extensions
        await loadSchemaExtensions();
        
        // Load events
        await loadGraphEvents();
        
        // All data is loaded, set initializing to false
        setInitializing(false);
      } catch (error) {
        console.error("Failed to initialize calendar:", error);
      }
    };
    
    initializeCalendar();
  }, [graphToken, apiToken, prefsLoading]);

  // Loads user profile and permissions for calendar
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!apiToken) {
        console.log("No API token available");
        return;
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
          return;
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
          return;
        }
        
        if (response.ok) {
          const data = await response.json();
          setUserProfile(data);
          
          const permissions = {
            startOfWeek: data.preferences?.startOfWeek || 'Monday',
            defaultView: data.preferences?.defaultView || 'week',
            defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
            preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
            createEvents: data.preferences?.createEvents ?? false,
            editEvents: data.preferences?.editEvents ?? false,
            deleteEvents: data.preferences?.deleteEvents ?? false,  
            isAdmin: data.isAdmin || false,
            preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York'
          };
          
          setUserPermissions(permissions);
          console.log("User permissions loaded:", permissions);
        }
      } catch (error) {
        console.error("Error fetching user permissions:", error);
        // Set fallback permissions for testing
        setUserPermissions({
          startOfWeek: 'Monday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100,
          createEvents: false,
          editEvents: false,
          deleteEvents: false,
          isAdmin: false
        });
      }
    };
    
    fetchUserProfile();
  }, [apiToken, API_BASE_URL]);

  // Set user time zone from user permissions
  useEffect(() => {
    if (userPermissions.preferredTimeZone) {
      console.log("Setting userTimeZone from userPermissions:", userPermissions.preferredTimeZone);
      setUserTimeZone(userPermissions.preferredTimeZone);
    }
  }, [userPermissions.preferredTimeZone]);

  // Initialize selectedLocations when availableLocations changes
  useEffect(() => {
    setSelectedLocations(availableLocations);
  }, []);

  // Initialize user preferences from office roam settings
  useEffect(() => {
    if (prefsLoading) return;

    // console.log("Loading preferences:", prefs);
    // console.log("TimeZone in prefs:", prefs.preferredTimeZone);
  
    // once roamingSettings are ready, push them into state
    setUserTimeZone(prefs.preferredTimeZone || 'America/New_York');
    setViewType(prefs.defaultView);
    setGroupBy(prefs.defaultGroupBy);
    setZoomLevel(prefs.preferredZoomLevel);
    setSelectedCategories(prefs.selectedCategories || selectedCategories);

    if (prefs.selectedLocations?.length) {
      setSelectedLocations(prefs.selectedLocations);
    }

    // adjust your date range to match the loaded view
    const newEnd = calculateEndDate(dateRange.start, prefs.defaultView);
    setDateRange({ start: dateRange.start, end: newEnd });
  }, [prefsLoading, prefs, dateRange.start, selectedCategories, selectedLocations]);  

  // Update selected categories when Outlook categories change
  useEffect(() => {
    if (outlookCategories.length > 0) {
      // Get all unique category names, including Uncategorized
      const allCategories = ['Uncategorized', 
        ...outlookCategories.map(cat => cat.name)
      ];

      // Remove duplicates
      const uniqueCategories = [...new Set(allCategories)];
      
      // Select all categories by default
      setSelectedCategories(allCategories);
    }
  }, [outlookCategories]);

  // Filter events based on date range and categories/locations
  const filteredEvents = useMemo(() => {
    // Set loading state at the beginning of calculation
    // setLoading(true);
    
    const filtered = allEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      
      // Check date range
      const inDateRange = eventDate >= dateRange.start && eventDate <= dateRange.end;
      
      // Check category or location depending on groupBy
      let inSelectedGroup = true;
      if (groupBy === 'categories') {
        // Use the helper function for consistent handling
        if (isUncategorizedEvent(event)) {
          inSelectedGroup = selectedCategories.includes('Uncategorized');
        } else {
          inSelectedGroup = selectedCategories.includes(event.category);
        }
      } else {
        // Check location if we're grouping by locations
        const eventLocations = event.location?.displayName 
          ? event.location.displayName.split('; ').map(loc => loc.trim())
          : [];
        
        // Handle events with no location
        if (eventLocations.length === 0 || eventLocations.every(loc => loc === '')) {
          return selectedLocations.includes('Unspecified');
        }
        
        const visibleLocations = selectedLocations.filter(loc => loc !== 'Unspecified');
        inSelectedGroup = eventLocations.some(loc => visibleLocations.includes(loc));
      }
      
      return inDateRange && inSelectedGroup;
    });
    
    // Set loading state to false after calculation is complete
    setLoading(false);
    
    return filtered;
  }, [allEvents, dateRange, selectedCategories, selectedLocations, groupBy]);

  // Load Categories when graph token is available
  useEffect(() => {
    if (graphToken) {
      const fetchCategories = async () => {
        const categories = await loadOutlookCategories();
        setOutlookCategories(categories);
        
        // If no categories exist yet, you might want to create default ones
        if (categories.length === 0) {
          console.log('No Outlook categories found, creating defaults...');
          await createDefaultCategories();
        }
      };
      
      fetchCategories();
    }
  }, [graphToken, loadOutlookCategories]);

  // Load Schema Extensions when graph token is available
  useEffect(() => {
    if (graphToken) {
      loadSchemaExtensions();
    }
  }, [graphToken, loadSchemaExtensions]);

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
  }, [viewType, userPermissions.startOfWeek]);

  // Initialize filter for month view
  useEffect(() => {
    // Set default filter based on the groupBy setting
    if (groupBy === 'categories' && outlookCategories.length > 0) {
      setSelectedFilter('Uncategorized');
    } else if (groupBy === 'locations') {
      setSelectedFilter('Unspecified');
    }
  }, [groupBy, outlookCategories]);

  // Close context menu when clicking outside
  useEffect(() => {
    console.log('graphToken:', graphToken);
    
    const handleClickOutside = () => {
      setShowContextMenu(false);
    };
    
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  //---------------------------------------------------------------------------
  // LOADING SCREEN
  //---------------------------------------------------------------------------
  const LoadingOverlay = () => (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner"></div>
        <p>Loading your calendar...</p>
      </div>
    </div>
  );
  
  //---------------------------------------------------------------------------
  // RENDER
  //---------------------------------------------------------------------------
  return (
    <div className="calendar-container">
      {initializing && <LoadingOverlay/>}
      <div className="calendar-header">
        <div className="calendar-controls">
          <div className="view-selector">
            <button 
              className={viewType === 'day' ? 'active' : ''} 
              onClick={() => {
                  handleViewChange('day');
                  updatePrefs({ defaultView: 'day' });
                }
              }
            >
              Day
            </button>
            <button 
              className={viewType === 'week' ? 'active' : ''} 
              onClick={() => {
                  handleViewChange('week');
                  updatePrefs({ defaultView: 'week' });
                }
              }
            >
              Week
            </button>
            <button 
              className={viewType === 'month' ? 'active' : ''} 
              onClick={() => {
                  handleViewChange('month');
                  updatePrefs({ defaultView: 'month' });
                }
              }
            >
              Month
            </button>
          </div>

          <div className="selector-group" style={{ display: 'flex', gap: '2px' }}>
            <div className="time-zone-selector">
              <select
                value={userTimeZone}
                onChange={(e) => {
                  setUserTimeZone(e.target.value);
                  updatePrefs({ preferredTimeZone: e.target.value });
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
                  updatePrefs({ startOfWeek: newValue });
                  
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
  
          {/* View mode selectors */}
          <div className="view-mode-selector">
            <button 
              className={groupBy === 'categories' ? 'active' : ''} 
              onClick={() => {
                  setGroupBy('categories');
                  updatePrefs({ defaultGroupBy: 'categories' });
                }
              }
            >
              Group by Category
            </button>
            <button 
              className={groupBy === 'locations' ? 'active' : ''} 
              onClick={() => {
                  setGroupBy('locations');
                  updatePrefs({ defaultGroupBy: 'locations' });
                }
              }
            >
              Group by Location
            </button>
          </div>
          
          <div className="navigation">
            <button onClick={handlePrevious}>Previous</button>
            <button onClick={handleToday}>Today</button>
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
                updatePrefs({ preferredZoomLevel: newZoom });
              }
            } title="Zoom Out">−</button>
            <span>{zoomLevel}%</span>
            <button onClick={() => {
                handleZoom('in');
                updatePrefs({ preferredZoomLevel: zoomLevel + 10 });
              }
             } title="Zoom In">+</button>
          </div>
          
          <div className="calendar-action-buttons">
            <button className="search-button" onClick={() => setShowSearch(true)}>
              🔍 Search Events
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
          <div className="calendar-layout">
            <div className="calendar-sidebar">
              {viewType === 'month' ? (
                <>
                  <h3>{groupBy === 'categories' ? 'Filter by Category' : 'Filter by Location'}</h3>
                  <select 
                    value={selectedFilter}
                    onChange={(e) => handleMonthFilterChange(e.target.value)}
                    className="month-filter-select"
                  >
                    <option value="">-- Select {groupBy === 'categories' ? 'Category' : 'Location'} --</option>
                    {groupBy === 'categories' ? (
                      // Show categories
                      outlookCategories.length > 0 
                        ? ['Uncategorized', ...outlookCategories.map(cat => cat.name)
                            .filter(name => name !== 'Uncategorized')] // Filter out duplicate "Uncategorized"
                          .map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))
                        : null
                    ) : (
                      // Show locations
                      availableLocations.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))
                    )}
                  </select>
                </>
              ) : (
                groupBy === 'categories' ? (
                  <>
                    <h3>Categories</h3>
                    <MultiSelect 
                      options={outlookCategories.length > 0 
                        ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
                        : categories
                      }
                      selected={selectedCategories}
                      onChange={val => {
                          setSelectedCategories(val);
                          updatePrefs({ selectedCategories: val });
                        }
                      }
                      label="Filter by categories"
                    />
                  </>
                ) : (
                  <>
                    <h3>Locations</h3>
                    <MultiSelect 
                      options={availableLocations}
                      selected={selectedLocations}
                      onChange={val => {
                        setSelectedLocations(val);
                        updatePrefs({ selectedLocations: val });
                      }}
                      label="Filter by locations"
                    />
                  </>
                )
              )}
            </div>
  
            {loading}
            <div 
              className={`calendar-grid ${viewType}-view`}
              style={{ 
                transform: `scale(${zoomLevel / 100})`, 
                transformOrigin: 'top left',
                width: '100%'
              }}
            >
              {viewType === 'month' ? (
                // Month View
                <div className="month-view-container">
                    <div className="month-header">
                      <div className="weekday-header">
                        {getWeekdayHeaders().map((day, index) => (
                          <div key={index} className="weekday">{day}</div>
                        ))}
                      </div>
                    </div>
                  <div className="month-days">
                    {getMonthWeeks().map((week, weekIndex) => (
                      <div key={weekIndex} className="week-row">
                        {week.map((day, dayIndex) => (
                          <div 
                            key={dayIndex}
                            className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''}`}
                            onClick={() => handleDayCellClick(day.date)}
                          >
                            <div className="day-number">{day.date.getDate()}</div>
                            
                            {/* Events for this day */}
                            <div className="day-events">
                              {/* CHANGE: Added conditional rendering based on selectedFilter */}
                              {!selectedFilter ? (
                                // No filter selected - show summary by category/location
                                groupBy === 'categories' ? (
                                  // Group by categories
                                  (outlookCategories.length > 0 
                                    ? ['Uncategorized', ...outlookCategories.map(cat => cat.name)]
                                    : categories)
                                    .map(category => {
                                      const categoryEvents = filteredEvents.filter(event => 
                                        event.category === category && 
                                        getMonthDayEventPosition(event, day.date)
                                      );
                                      
                                      return categoryEvents.length > 0 ? (
                                        <div key={category} className="day-category-group">
                                          <div className="category-label">
                                            <div 
                                              className="category-color"
                                              style={{ 
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                marginRight: '4px',
                                                backgroundColor: getCategoryColor(category)
                                              }}
                                            />
                                            <span>{category}</span>
                                          </div>
                                          <div className="events-count">{categoryEvents.length}</div>
                                        </div>
                                      ) : null;
                                    })
                                ) : (
                                  // Group by locations
                                  availableLocations
                                    .map(location => {
                                      const locationEvents = filteredEvents.filter(event => {
                                        if (!getMonthDayEventPosition(event, day.date)) return false;
                                        
                                        const eventLocations = event.location?.displayName 
                                          ? event.location.displayName.split('; ').map(loc => loc.trim())
                                          : [];
                                        
                                        if (location === 'Unspecified') {
                                          if (eventLocations.length === 0 || eventLocations.every(loc => loc === '')) {
                                            return true;
                                          }
                                          
                                          const validLocations = availableLocations.filter(loc => loc !== 'Unspecified');
                                          return !eventLocations.some(loc => validLocations.includes(loc));
                                        } else {
                                          return eventLocations.includes(location);
                                        }
                                      });
                                      
                                      return locationEvents.length > 0 ? (
                                        <div key={location} className="day-location-group">
                                          <div className="location-label">
                                            <div 
                                              className="location-color"
                                              style={{ 
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                marginRight: '4px',
                                                backgroundColor: getLocationColor(location)
                                              }}
                                            />
                                            <span>{location}</span>
                                          </div>
                                          <div className="events-count">{locationEvents.length}</div>
                                        </div>
                                      ) : null;
                                    })
                                )
                              ) : (
                                // CHANGE: Filter is selected - show actual events
                                getFilteredMonthEvents(day.date).map(event => (
                                  <div 
                                    key={event.id} 
                                    className="event-item"
                                    style={{
                                      borderLeft: `4px solid ${groupBy === 'categories' 
                                        ? getCategoryColor(event.category) 
                                        : getLocationColor(event.location?.displayName || 'Unspecified')}`,
                                      padding: '2px 4px',
                                      margin: '1px 0'
                                    }}
                                    onClick={(e) => handleEventClick(event, e)}
                                  >
                                    <div className="event-title" style={getEventContentStyle('month')}>
                                      {formatEventTime(event.start.dateTime, event.subject)} {event.subject}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* Grid Header (Days) */}
                  <div className="grid-header">
                    <div className="grid-cell header-cell category-header">
                      {groupBy === 'categories' ? 'Categories' : 'Locations'}
                    </div>
                    {getDaysInRange().map((day, index) => (
                      <div key={index} className="grid-cell header-cell">
                        {formatDateHeader(day)}
                      </div>
                    ))}
                  </div>

                  {/* Grid Rows (Categories or Locations) */}
                  {groupBy === 'categories' ? (
                    // Categories View
                    (outlookCategories.length > 0 
                      ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
                      : categories // Fall back to predefined categories if Outlook categories aren't loaded yet
                    ).filter(category => selectedCategories.includes(category))
                      .map(category => (
                        <div key={category} className="grid-row">
                          <div className="grid-cell category-cell">
                            {/* Add color indicator if it's an Outlook category */}
                            {outlookCategories.find(cat => cat.name === category) && (
                              <div 
                                className="category-color" 
                                style={{ 
                                  display: 'inline-block',
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  marginRight: '5px',
                                  backgroundColor: getCategoryColor(category)
                                }}
                              />
                            )}
                            {category}
                          </div>
                          
                          {/* Days */}
                          {getDaysInRange().map((day, dayIndex) => (
                            <div 
                              key={dayIndex} 
                              className="grid-cell day-cell"
                              onClick={() => handleDayCellClick(day, category)}
                            >
                              {/* Events for this category and day */}
                              {filteredEvents
                                .filter(event => 
                                  event.category === category && 
                                  getEventPosition(event, day)
                                )
                                .map(event => (
                                  <div 
                                    key={event.id} 
                                    className="event-item"
                                    style={{
                                      borderLeft: `4px solid ${groupBy === 'locations' 
                                        ? getLocationColor(event.location?.displayName) 
                                        : getCategoryColor(event.category)}`,
                                      padding: viewType === 'month' ? '2px 4px' : '4px 8px',
                                      margin: viewType === 'month' ? '1px 0' : '2px 0'
                                    }}
                                    onClick={(e) => handleEventClick(event, e)}
                                  >
                                    {renderEventContent(event, viewType)}
                                  </div>
                                ))
                              }
                            </div>
                          ))}
                        </div>
                      ))
                  ) : (
                    <>
                      {/* Regular location rows */}
                      {availableLocations
                        .filter(location => 
                          selectedLocations.includes(location))
                        .map(location => (
                          <div key={location} className="grid-row">
                            {/* Add color indicator for locations */}
                            <div className="grid-cell location-cell">
                            <div 
                                className="location-color" 
                                style={{ 
                                  display: 'inline-block',
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  marginRight: '5px',
                                  backgroundColor: getLocationColor(location)
                                }}
                              />
                              {location}
                            </div>
                            
                            {/* Days */}
                            {getDaysInRange().map((day, dayIndex) => (
                              <div 
                                key={dayIndex} 
                                className="grid-cell day-cell"
                                onClick={() => handleDayCellClick(day, null, location)}
                              >
                                {filteredEvents
                                  .filter(event => {
                                    // Check if event is for this day
                                    if (!getEventPosition(event, day)) return false;
                                    
                                    // Get event locations
                                    const eventLocations = event.location?.displayName 
                                      ? event.location.displayName.split('; ').map(loc => loc.trim())
                                      : [];
                                    
                                    if (location === 'Unspecified') {
                                      // For Unspecified, show events with:
                                      // 1. No location/empty location, OR
                                      // 2. Locations not in availableLocations
                                      
                                      // Check for empty locations
                                      if (eventLocations.length === 0 || eventLocations.every(loc => loc === '')) {
                                        return true;
                                      }
                                      
                                      // Check if NONE of the locations are in availableLocations
                                      // (excluding 'Unspecified' itself)
                                      const validLocations = availableLocations.filter(loc => loc !== 'Unspecified');
                                      return !eventLocations.some(loc => validLocations.includes(loc));
                                    } else {
                                      // For regular locations, check if this specific location is included
                                      return eventLocations.includes(location);
                                    }
                                  })
                                  .map(event => (
                                    <div 
                                      key={event.id} 
                                      className="event-item"
                                      style={{
                                        borderLeft: `4px solid ${groupBy === 'locations' 
                                          ? getLocationColor(event.location?.displayName) 
                                          : getCategoryColor(event.category)}`,
                                        padding: viewType === 'month' ? '2px 4px' : '4px 8px',
                                        margin: viewType === 'month' ? '1px 0' : '2px 0'
                                      }}
                                      onClick={(e) => handleEventClick(event, e)}
                                    >
                                      {renderEventContent(event, viewType)}
                                    </div>
                                  ))
                                }
                              </div>
                            ))}
                          </div>
                        ))
                      }
                    </>
                  )}
                </>
              )}
            </div>
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
        {console.log('Current event passed to form:', currentEvent)}
        <EventForm 
          event={currentEvent}
          categories={outlookCategories.length > 0 
            ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
            : categories}
          availableLocations={getFilteredLocationsForMultiSelect()}
          schemaExtensions={schemaExtensions}
          onSave={handleSaveEvent}
          onCancel={() => setIsModalOpen(false)}
          readOnly={modalType === 'view'}
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
          onSaveEvent={handleSaveEvent}
        />
      )}
    </div>
  );
}

export default Calendar;
// src/components/Calendar.jsx
import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import EventForm from './EventForm';
import MultiSelect from './MultiSelect';
import { msalConfig } from '../config/authConfig';
import ExportToPdfButton from './CalendarExport';


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

/*****************************************************************************
 * MAIN CALENDAR COMPONENT
 *****************************************************************************/
function Calendar({ accessToken }) {
  //---------------------------------------------------------------------------
  // STATE MANAGEMENT
  //---------------------------------------------------------------------------
  
  // Core calendar data
  const [allEvents, setAllEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [outlookCategories, setOutlookCategories] = useState([]);

  // UI state
  const [groupBy, setGroupBy] = useState('categories'); // default categories
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [isFullyLoaded, setIsFullyLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [schemaExtensions, setSchemaExtensions] = useState([]);
  const [viewType, setViewType] = useState('week');
  const [dateRange, setDateRange] = useState({
    start: new Date(),
    end: calculateEndDate(new Date(), 'week')
  });

  // Calendar View States
  const [monthViewTab, setMonthViewTab] = useState(groupBy);

  // Toggle states
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState(availableLocations);

  // Modal and context menu state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('add'); // 'add', 'edit', 'delete'
  const [currentEvent, setCurrentEvent] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showContextMenu, setShowContextMenu] = useState(false);

  //---------------------------------------------------------------------------
  // UTILITY/HELPER FUNCTIONS
  //---------------------------------------------------------------------------

  function getMonthWeeks() {
    const days = [];
    const year = dateRange.start.getFullYear();
    const month = dateRange.start.getMonth();
    
    // Get first day of month and last day of month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // Get days from previous month to fill first week
    const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
    // Adjust for week starting on Monday (0 = Monday, 6 = Sunday)
    const prevMonthDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; 
    
    for (let i = prevMonthDays; i > 0; i--) {
      const day = new Date(year, month, 1 - i);
      days.push({ date: day, isCurrentMonth: false });
    }
    
    // Add all days from current month
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
          {formatEventTime(event.start.dateTime)}
          {viewType !== 'month' && ` - ${formatEventTime(event.end.dateTime)}`}
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
      day: 'numeric'
    });
  };

  /**
   * Format time for event display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted time string
   */
  const formatEventTime = (dateString) => {
    if (!dateString) return '';
    
    try {
      // Create a date object from the ISO string
      // This will handle the UTC to local conversion automatically
      const date = new Date(dateString);
      
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (err) {
      console.error('Error formatting event time:', err);
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
          Authorization: `Bearer ${accessToken}`
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
  }, [accessToken]);

  /**
   * Load categories from Outlook
   * @returns {Array} Array of category objects
   */
  const loadOutlookCategories = useCallback(async () => {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
        headers: {
          Authorization: `Bearer ${accessToken}`
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
  }, [accessToken]);

  /**
   * Load events from Microsoft Graph API
   *
  */

  const loadGraphEvents = useCallback(async () => {
    // 0. Don't even start until we have a token
    if (!accessToken) {
      console.warn("loadGraphEvents: no access token yet");
      return;
    }
  
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
          headers: { Authorization: `Bearer ${accessToken}` }
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
      setInitialLoadComplete(true);
    } catch (err) {
      console.error("loadGraphEvents failed:", err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dateRange, loadSchemaExtensions]);

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
            Authorization: `Bearer ${accessToken}`,
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
          Authorization: `Bearer ${accessToken}`,
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
  }, [accessToken]);

  /**
   * Save an event to Microsoft Graph
   * @param {Object} event - The event to save
   * @returns {Object} The saved event with updated data
   * Note: On update, Event & Schema Extensions need to be saved on separate calls
   */
  const saveToGraph = async (eventData) => {
    if (!accessToken) {
      throw new Error('No Graph token available');
    }
  
    const { id, ...body } = eventData;
    const isNew = !id || id.includes('event_');
    const url = isNew
      ? `https://graph.microsoft.com/v1.0/me/events`
      : `https://graph.microsoft.com/v1.0/me/events/${id}`;
  
    // 1) CREATE: POST everything at once
    if (isNew) {
      console.log("CREATING NEW EVENT with data:", JSON.stringify(body, null, 2));
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Graph error ${response.status}`);
      }
      const created = await response.json();
      console.log("CREATED EVENT response:", JSON.stringify(created, null, 2));
      // return with the new id plus all your props
      return { id: created.id, ...body };
    }
  
    // 2) UPDATE core fields
    const corePayload = {
      subject:    body.subject,
      start:      body.start,
      end:        body.end,
      location:   body.location,
      categories: body.categories
    };
    
    console.log("UPDATING CORE FIELDS with:", JSON.stringify(corePayload, null, 2));
    {
      const r = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(corePayload)
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Graph error ${r.status}`);
      }
      console.log("CORE UPDATE successful");
    }
  
    // 3) UPDATE each schema extension separately
    console.log("CHECKING FOR SCHEMA EXTENSIONS in:", Object.keys(body).filter(k => k.includes('.')));
    for (const extension of schemaExtensions) {
      const extId = extension.id;
      const extValue = body[extId];
      
      if (extValue && Object.keys(extValue).length) {
        console.log(`UPDATING EXTENSION ${extId} with:`, JSON.stringify(extValue, null, 2));
        const patchBody = { [extId]: extValue };
        const r = await fetch(url, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(patchBody)
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error(`Extension update failed:`, err);
          throw new Error(`Ext ${extId} error: ${err.error?.message||r.status}`);
        }
        console.log(`EXTENSION ${extId} UPDATE successful`);
      } else {
        console.log(`No update needed for extension ${extId}`);
      }
    }
  
    // 4) Verify the updated event by fetching it again
    console.log("VERIFYING updated event by fetching it...");
    try {
      const verifyResponse = await fetch(`https://graph.microsoft.com/v1.0/me/events/${id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (verifyResponse.ok) {
        const verifiedEvent = await verifyResponse.json();
        console.log("VERIFIED EVENT after update:", JSON.stringify(verifiedEvent, null, 2));
        
        // Return a properly structured event with extensions integrated
        const result = {
          id: verifiedEvent.id,
          subject: verifiedEvent.subject,
          start: verifiedEvent.start,
          end: verifiedEvent.end,
          location: verifiedEvent.location,
          category: verifiedEvent.categories?.[0] || "Uncategorized",
          extensions: verifiedEvent.extensions || []
        };
        
        // Also include any extension properties directly on the event
        // from our original eventData object
        return { ...result, ...eventData };
      } else {
        console.warn("Could not verify updated event:", await verifyResponse.text());
      }
    } catch (err) {
      console.warn("Error verifying updated event:", err);
    }

    // If verification fails, we still want to return success using our original data
    console.log("Using original event data due to verification failure");
    return eventData;
  };

  //---------------------------------------------------------------------------
  // EVENT HANDLERS
  //---------------------------------------------------------------------------
  
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

  /**
   * Navigate to today
   */
  const handleToday = () => {
    const newStart = new Date();
    const newEnd = calculateEndDate(newStart, viewType)
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
    setModalType('add');
    setIsModalOpen(true);
  };

  const handleEditEvent = () => {
    setShowContextMenu(false);
    setModalType('edit');
    setIsModalOpen(true);
  };

  const handleDeleteEvent = () => {
    setShowContextMenu(false);
    setModalType('delete');
    setIsModalOpen(true);
  };

  /**
   * Called by EventForm when the user hits “Save”
   * @param {Object} eventData - The payload from EventForm.handleSubmit
   */
  const handleSaveEvent = async (eventData) => {
    try {
      console.log("BEFORE SAVE - Event data with extensions:", JSON.stringify(eventData, null, 2));
      const saved = await saveToGraph(eventData);
      console.log("AFTER SAVE - Returned event data:", JSON.stringify(saved, null, 2));

      if (modalType === 'add') {
        setAllEvents(prev => [...prev, saved]);
      } else {
        setAllEvents(prev =>
          prev.map(ev => (ev.id === saved.id ? saved : ev))
        );
      }

      setIsModalOpen(false);
      setCurrentEvent(null);
      await loadGraphEvents();
    } catch (err) {
      console.error('Failed to save event:', err);
      alert('There was an error saving the event:\n' + err.message);
    }
  };
  
  /**
   * Delete an event
   */
  const handleDeleteConfirm = async () => {
    if (accessToken && currentEvent?.id) {
      try {
        const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${currentEvent.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`
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
  // USE EFFECTS
  //---------------------------------------------------------------------------

  // Then add this useEffect to handle the loading state
  useEffect(() => {
    if (initialLoadComplete && !loading) {
      setIsFullyLoaded(true);
    } else {
      setIsFullyLoaded(false);
    }
  }, [initialLoadComplete, loading]);

  // Initialize selectedLocations when availableLocations changes
  useEffect(() => {
    setSelectedLocations(availableLocations);
  }, []);

  // Update selected categories when Outlook categories change
  useEffect(() => {
    if (outlookCategories.length > 0) {
      // Get all unique category names, including Uncategorized
      const allCategories = ['Uncategorized', 
        ...outlookCategories
          .map(cat => cat.name)
          .filter(name => name !== 'Uncategorized')
      ];
      
      // Select all categories by default
      setSelectedCategories(allCategories);
    }
  }, [outlookCategories]);

  // Filter events based on date range and categories/locations
  useEffect(() => {
    setLoading(true);
    
    console.log('Filtering with date range:', dateRange.start.toISOString(), 'to', dateRange.end.toISOString());
    
    const filtered = allEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      
      // Check date range
      const inDateRange = eventDate >= dateRange.start && eventDate <= dateRange.end;
      
      // Check category or location depending on groupBy
      let inSelectedGroup = true;
      if (groupBy === 'categories') {
        const hasCategory = event.category && event.category.trim() !== '';
        
        if (hasCategory) {
          inSelectedGroup = selectedCategories.includes(event.category);
        } else {
          inSelectedGroup = selectedCategories.includes('Uncategorized');
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
        
        // Event should be included if it contains ANY of the selected locations
        inSelectedGroup = eventLocations.some(loc => selectedLocations.includes(loc));
      }
      
      return inDateRange && inSelectedGroup;
    });
    
    setFilteredEvents(filtered);
    setLoading(false);
  }, [allEvents, dateRange, selectedCategories, selectedLocations, groupBy]);

  // Load Categories when access token is available
  useEffect(() => {
    if (accessToken) {
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
  }, [accessToken, loadOutlookCategories]);

  // Load Events when access token is available
  useEffect(() => {
    if (accessToken) {
      setLoading(true);
      loadGraphEvents();
    }
  }, [accessToken, loadGraphEvents]);

  // Load Schema Extensions when access token is available
  useEffect(() => {
    if (accessToken) {
      loadSchemaExtensions();
    }
  }, [accessToken, loadSchemaExtensions]);

  // Close context menu when clicking outside
  useEffect(() => {
    console.log('accessToken:', accessToken);
    
    const handleClickOutside = () => {
      setShowContextMenu(false);
    };
    
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // Set the initial Month view type based on groupBy
  useEffect(() => {
    setMonthViewTab(groupBy);
  }, [groupBy]);

  //---------------------------------------------------------------------------
  // RENDER
  //---------------------------------------------------------------------------
  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <div className="calendar-controls">
          <div className="view-selector">
            <button 
              className={viewType === 'day' ? 'active' : ''} 
              onClick={() => handleViewChange('day')}
            >
              Day
            </button>
            <button 
              className={viewType === 'week' ? 'active' : ''} 
              onClick={() => handleViewChange('week')}
            >
              Week
            </button>
            <button 
              className={viewType === 'month' ? 'active' : ''} 
              onClick={() => handleViewChange('month')}
            >
              Month
            </button>
          </div>

          {/* View mode selectors */}
          <div className="view-mode-selector">
            <button 
              className={groupBy === 'categories' ? 'active' : ''} 
              onClick={() => setGroupBy('categories')}
            >
              Group by Category
            </button>
            <button 
              className={groupBy === 'locations' ? 'active' : ''} 
              onClick={() => setGroupBy('locations')}
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
              : `${dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            }
          </div>

          {/* Add zoom controls here */}
          <div className="zoom-controls">
            <button onClick={() => handleZoom('out')} title="Zoom Out">−</button>
            <span>{zoomLevel}%</span>
            <button onClick={() => handleZoom('in')} title="Zoom In">+</button>
          </div>
          
          <button className="add-event-button" onClick={handleAddEvent}>
            + Add Event
          </button>
          <ExportToPdfButton 
            events={filteredEvents} 
            dateRange={dateRange} 
          />
        </div>
      </div>

      {!isFullyLoaded ? (
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
              {groupBy === 'categories' ? (
                <>
                  <h3>Categories</h3>
                  <MultiSelect 
                    options={outlookCategories.length > 0 
                      ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
                      : categories
                    }
                    selected={selectedCategories}
                    onChange={setSelectedCategories}
                    label="Filter by categories"
                  />
                </>
              ) : (
                <>
                  <h3>Locations</h3>
                  <MultiSelect 
                    options={availableLocations}
                    selected={selectedLocations}
                    onChange={setSelectedLocations}
                    label="Filter by locations"
                  />
                </>
              )}
            </div>

            {loading ? (
              <div className="loading">Updating calendar...</div>
            ) : (
              <div 
                className={`calendar-grid ${viewType}-view`}
                style={{ 
                  transform: `scale(${zoomLevel / 100})`, 
                  transformOrigin: 'top left',
                  width: '100%'
                }}
              >
                {viewType === 'month' ? (
                  <>
                    <div className="month-header">
                      <div className="weekday-header">
                        <div className="weekday">Mon</div>
                        <div className="weekday">Tue</div>
                        <div className="weekday">Wed</div>
                        <div className="weekday">Thu</div>
                        <div className="weekday">Fri</div>
                        <div className="weekday">Sat</div>
                        <div className="weekday">Sun</div>
                      </div>
                    </div>
                    
                    <div className="month-days">
                      {getMonthWeeks().map((week, weekIndex) => (
                        <div key={weekIndex} className="week-row">
                          {week.map((day, dayIndex) => (
                            <div 
                              key={dayIndex}
                              className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''}`}
                              onClick={() => handleDayCellClick(day.date, null, null)}
                            >
                              <div className="day-number">{day.date.getDate()}</div>
                              <div className="day-events">
                                {groupBy === 'categories' ? (
                                  <>
                                    {(outlookCategories.length > 0 
                                      ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
                                      : categories)
                                      .filter(category => selectedCategories.includes(category))
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
                                    }
                                  </>
                                ) : (
                                  <>
                                    {availableLocations
                                      .filter(location => selectedLocations.includes(location))
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
                                    }
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
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
              <div className="context-menu-item" onClick={handleEditEvent}>
                Edit Event
              </div>
              <div className="context-menu-item delete" onClick={handleDeleteEvent}>
                Delete Event
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal for Add/Edit Event */}
      <Modal 
        isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit')} 
        onClose={() => setIsModalOpen(false)}
        title={modalType === 'add' ? 'Add Event' : 'Edit Event'}
      >
        {console.log('Current event passed to form:', currentEvent)}
        <EventForm 
          event={currentEvent}
          categories={outlookCategories.length > 0 
            ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
            : categories}
          availableLocations={availableLocations}
          schemaExtensions={schemaExtensions}
          onSave={handleSaveEvent}
          onCancel={() => setIsModalOpen(false)}
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
    </div>
  );
}

export default Calendar;
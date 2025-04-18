// src/components/Calendar.jsx
import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import EventForm from './EventForm';
import MultiSelect from './MultiSelect';

// Mock categories
const categories = [
]; 

const eventCodes = [
  'Board of Trustees',
  'Communications',
  'Membership'
];

function Calendar({ accessToken }) {
  const [allEvents, setAllEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewType, setViewType] = useState('week');
  const [dateRange, setDateRange] = useState({
    start: new Date(),
    end: calculateEndDate(new Date(), 'week')
  });

  // State for modal and event operations
  const [selectedCategories, setSelectedCategories] = useState(categories);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [outlookCategories, setOutlookCategories] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('add'); // 'add', 'edit', 'delete'
  const [currentEvent, setCurrentEvent] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Calculate end date based on view type
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

  /* HELPER FUNCTIONS */
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

  // Get days for current view
  const getDaysInRange = () => {
    const days = [];
    const currentDate = new Date(dateRange.start);
    
    while (currentDate <= dateRange.end) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  };

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
      console.log('Updated selected categories to include all Outlook categories:', allCategories);
    }
  }, [outlookCategories]);

  // Filter events based on date range and categories
  useEffect(() => {
    setLoading(true);
    
    console.log('Filtering with date range:', dateRange.start.toISOString(), 'to', dateRange.end.toISOString());
    console.log('All events before filtering:', allEvents.length);
    console.log('Selected categories:', selectedCategories);
    
    const filtered = allEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      // console.log('Event date:', event.subject, eventDate.toISOString());
      
      // Check date range
      const inDateRange = eventDate >= dateRange.start && eventDate <= dateRange.end;
      
      // Check category
      const hasCategory = event.category && event.category.trim() !== '';
      let inSelectedCategory;
      
      if (hasCategory) {
        inSelectedCategory = selectedCategories.includes(event.category);
      } else {
        inSelectedCategory = selectedCategories.includes('Uncategorized');
      }
      
      /*
      console.log(
        `Event: ${event.subject}, ` +
        `Category: ${event.category || 'Uncategorized'}, ` +
        `In date range: ${inDateRange}, ` +
        `Category selected: ${inSelectedCategory}`
      );
      */
     
      return inDateRange && inSelectedCategory;
    });
    
    console.log('Filtered events count:', filtered.length);
    setFilteredEvents(filtered);
    setLoading(false);
  }, [allEvents, dateRange, selectedCategories]);

  // Handle view type change
  const handleViewChange = (newView) => {
    setViewType(newView);
    setDateRange({
      start: dateRange.start,
      end: calculateEndDate(dateRange.start, newView)
    });
  };

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
    
    setDateRange({
      start: newStart,
      end: calculateEndDate(newStart, viewType)
    });
  };

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
    
    setDateRange({
      start: newStart,
      end: calculateEndDate(newStart, viewType)
    });
  };

  const handleToday = () => {
    const today = new Date();
    setDateRange({
      start: today,
      end: calculateEndDate(today, viewType)
    });
  };

  // Format date for grid header
  const formatDateHeader = (date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'numeric', 
      day: 'numeric'
    });
  };

  // Format time for events
  const formatEventTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Get position and duration for event in grid
  const getEventPosition = (event, day) => {
    const eventDay = new Date(event.start.dateTime).getDate();
    const currentDay = day.getDate();
    
    return eventDay === currentDay;
  };

  // Day cell click handler (for adding events)
  const handleDayCellClick = async (day, category) => {
    // Close context menu if open
    setShowContextMenu(false);
    
    // Set up start and end times (1 hour duration)
    const startTime = new Date(day);
    startTime.setHours(9, 0, 0, 0); // Default to 9 AM
    
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1);
    
    // Check if this category exists in Outlook categories
    if (category !== 'Uncategorized') {
      const categoryExists = outlookCategories.some(cat => cat.name === category);
      
      if (!categoryExists) {
        console.log(`Category ${category} doesn't exist in Outlook categories, creating it...`);
        await createOutlookCategory(category);
      }
    }
    
    // Create a new event template without an ID
    const newEvent = {
      // Remove the id field entirely for new events
      subject: '',
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      location: { displayName: '' },
      category: category,
      eventCode: '' 
    };
    
    setCurrentEvent(newEvent);
    setModalType('add');
    setIsModalOpen(true);
  };

  // Event click handler
  const handleEventClick = (event, e) => {
    e.stopPropagation();
    setCurrentEvent(event);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const loadOutlookCategories = useCallback(async () => {
    try {
      console.log('Fetching Outlook categories...');
      
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
      console.log('Fetched Outlook categories:', data.value);
      
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

  const loadGraphEvents = useCallback(async () => {
    try {
      // Calculate date range (±1 year from today)
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(now.getFullYear() - 1);
      
      const oneYearFromNow = new Date(now);
      oneYearFromNow.setFullYear(now.getFullYear() + 1);
      
      // Format dates for the API query
      const startDateTime = oneYearAgo.toISOString();
      const endDateTime = oneYearFromNow.toISOString();
      
      console.log('Fetching events from Graph API between', startDateTime, 'and', endDateTime);
      
      let allFetchedEvents = [];
      let nextLink = `https://graph.microsoft.com/v1.0/me/events?$top=50&$orderby=start/dateTime desc&$filter=start/dateTime ge '${startDateTime}' and start/dateTime le '${endDateTime}'`;
      
      // Loop through all pages
      while (nextLink) {
        // Fetch the current page
        const response = await fetch(nextLink, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
      
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Graph API error:', errorData);
          break;
        }
        
        const data = await response.json();
        console.log(`Fetched page with ${data.value?.length} events`);
        
        // Add the events from this page to our collection
        if (data.value && data.value.length > 0) {
          allFetchedEvents = [...allFetchedEvents, ...data.value];
        }
        
        // Check if there's another page
        nextLink = data['@odata.nextLink'] || null;
      }
      
      console.log(`Total events fetched: ${allFetchedEvents.length}`);
  
      if (allFetchedEvents.length > 0) {
        console.log('Debug: Inspecting first event raw data from Graph:');
        console.log(JSON.stringify(allFetchedEvents[0], null, 2));
        
        // Specifically check the body content format
        if (allFetchedEvents[0].body) {
          console.log('Event body content type:', allFetchedEvents[0].body.contentType);
          console.log('Event body content:', allFetchedEvents[0].body.content);
          
          try {
            const parsedBody = JSON.parse(allFetchedEvents[0].body.content);
            console.log('Successfully parsed body content as JSON:', parsedBody);
          } catch (e) {
            console.warn('Body content is not valid JSON:', e.message);
          }
        }
      }

      // Process all fetched events
      const converted = allFetchedEvents.map((event) => {
        let eventCode = '';
        
        // Extract event code from body content
        if (event.body?.content) {
          try {
            const bodyContent = event.body.content.trim();
            
            // Skip HTML content
            if (!bodyContent.startsWith('<')) {
              try {
                const parsed = JSON.parse(bodyContent);
                eventCode = parsed.eventCode || '';
              } catch (jsonError) {
                console.warn(`Could not parse body content as JSON for event: ${event.subject}`, jsonError);
                // Try to extract eventCode with regex if JSON parsing fails
                const codeMatch = bodyContent.match(/eventCode["']?\s*:\s*["']?([^"',}\s]+)/);
                if (codeMatch && codeMatch[1]) {
                  eventCode = codeMatch[1];
                }
              }
            }
          } catch (e) {
            console.warn(`Error processing body content for event: ${event.subject}`, e);
          }
        }
        
        // Get category from Outlook categories
        let category = 'Uncategorized';
        if (event.categories && event.categories.length > 0) {
          // Use the first category assigned to the event
          category = event.categories[0];
          console.log(`Found Outlook category for event "${event.subject}": ${category}`);
        }
        
        return {
          id: event.id,
          subject: event.subject,
          start: { dateTime: event.start.dateTime },
          end: { dateTime: event.end.dateTime },
          location: { displayName: event.location?.displayName || '' },
          eventCode,
          category
        };
      });
      
      console.log('Converted events:', converted);
      setAllEvents(converted);
      setInitialLoadComplete(true);
      setLoading(false); // Add this to ensure loading state is updated after fetching
    } catch (err) {
      console.error('Failed to load events from Graph:', err);
      setLoading(false); // Make sure to set loading to false even on error
    }
  }, [accessToken]);

  // Load Categories
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

  useEffect(() => {
    if (accessToken) {
      setLoading(true);
      loadGraphEvents();
    }
  }, [accessToken, loadGraphEvents]);

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

  // Event operations
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

  const saveToGraph = async (event) => {
    try {
      // Check if it's a new event by looking for Graph API ID format
      // Graph API IDs typically start with "AAMkA" and don't contain underscores
      const isNewEvent = !event.id || event.id.includes('event_');
      
      const method = isNewEvent ? 'POST' : 'PATCH';
      const url = isNewEvent
        ? `https://graph.microsoft.com/v1.0/me/events`
        : `https://graph.microsoft.com/v1.0/me/events/${event.id}`;
          
      console.log(`${isNewEvent ? 'Creating' : 'Updating'} event with method ${method} to ${url}`);
      
      // Create the JSON content for the body
      const bodyContent = JSON.stringify({
        eventCode: event.eventCode || '',
        category: event.category || ''
      });
      
      console.log(`Saving category "${event.category}" in event body content: ${bodyContent}`);
      
      const eventBody = {
        subject: event.subject,
        start: {
          dateTime: event.start.dateTime,
          timeZone: 'Eastern Standard Time'
        },
        end: {
          dateTime: event.end.dateTime,
          timeZone: 'Eastern Standard Time'
        },
        location: {
          displayName: event.location?.displayName || ''
        },
        body: {
          contentType: 'text', // Changed from 'Text' to lowercase 'text'
          content: bodyContent
        }
      };
      
      console.log('Event data being sent to Graph:', JSON.stringify(eventBody));
      
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventBody)
      });
    
      const responseText = await response.text();
      let responseData = null;
      
      try {
        if (responseText.trim()) {
          responseData = JSON.parse(responseText);
        }
      } catch (e) {
        console.log('Response is not JSON:', responseText, e);
      }
    
      if (!response.ok) {
        console.error('Graph API error:', response.status, responseData);
        throw new Error(`Graph API error (${response.status}): ${responseData?.error?.message || 'Unknown error'}`);
      } 
      
      console.log('Event saved successfully to Microsoft Calendar:', responseData);
      
      // For new events, ensure we have a proper return value even if responseData is undefined
      if (isNewEvent) {
        if (responseData) {
          // We have a response with an ID, use it
          return {
            ...responseData,
            category: event.category || 'Uncategorized', // Ensure category is preserved
            eventCode: event.eventCode || '' // Ensure eventCode is preserved
          };
        } else {
          // No responseData, just return the event with a note
          console.warn('No response data received from Graph API, using original event data');
          return {
            ...event,
            id: `local_${Date.now()}`, // Generate a temporary ID
            category: event.category || 'Uncategorized'
          };
        }
      } else {
        // For updates, return the original event with category preserved
        return {
          ...event,
          category: event.category || 'Uncategorized'
        };
      }
    } catch (err) {
      console.error('Error saving event to Graph:', err);
      throw err;
    }
  };

  const handleSaveEvent = async (eventData) => {
    try {
      let updatedEvent = eventData;
      
      if (accessToken) {
        // Save to Graph and get the updated data
        updatedEvent = await saveToGraph(eventData);
      }
      
      if (modalType === 'add') {
        // Add new event with possibly updated ID from Graph
        setAllEvents([...allEvents, updatedEvent]);
      } else if (modalType === 'edit') {
        // Update existing event
        setAllEvents(allEvents.map(event => 
          event.id === eventData.id ? updatedEvent : event
        ));
      }
      
      setIsModalOpen(false);
      setCurrentEvent(null);
      
      // Add this line to reload all events after saving
      loadGraphEvents();
    } catch (err) {
      console.error('Failed to save event:', err);
      alert('There was an error saving the event. Please try again.');
    }
  };

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

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <h2>Add-in: In Development</h2>
        
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
          
          <button className="add-event-button" onClick={handleAddEvent}>
            + Add Event
          </button>
        </div>
      </div>
  

      {!initialLoadComplete ? (
        <div className="loading">Loading your calendar data...</div>
      ) : (
        <div className="calendar-layout">
          <div className="calendar-sidebar">
            <h3>Categories</h3>
            <MultiSelect 
              options={outlookCategories.length > 0 
                ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
                : categories // Fall back to predefined categories if Outlook categories aren't loaded yet
              }
              selected={selectedCategories}
              onChange={setSelectedCategories}
              label="Filter by categories"
            />
          </div>
  
          {loading ? (
            <div className="loading">Loading calendar...</div>
          ) : (
            <div className={`calendar-grid ${viewType}-view`}>
              {/* Grid Header (Days) */}
              <div className="grid-header">
                <div className="grid-cell header-cell category-header">
                  Categories
                </div>
                {getDaysInRange().map((day, index) => (
                  <div key={index} className="grid-cell header-cell">
                    {formatDateHeader(day)}
                  </div>
                ))}
              </div>
  
              {/* Grid Rows (Categories) */}
              {(outlookCategories.length > 0 
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
                                borderLeft: `4px solid ${getCategoryColor(event.category)}`
                              }}
                              onClick={(e) => handleEventClick(event, e)}
                            >
                              <div className="event-time">
                                {formatEventTime(event.start.dateTime)} - {formatEventTime(event.end.dateTime)}
                              </div>
                              <div className="event-title">{event.subject}</div>
                              {event.eventCode && (
                                <div className="event-code">Code: {event.eventCode}</div>
                              )}
                              {event.location?.displayName && (
                                <div className="event-location">{event.location.displayName}</div>
                              )}
                            </div>
                          ))
                        }
                      </div>
                    ))}
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
  
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
  
      {/* Modal for Add/Edit Event */}
      <Modal 
        isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit')} 
        onClose={() => setIsModalOpen(false)}
        title={modalType === 'add' ? 'Add Event' : 'Edit Event'}
      >
        <EventForm 
          event={currentEvent}
          categories={outlookCategories.length > 0 
            ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
            : categories // Fall back to predefined categories if Outlook categories aren't loaded yet
          }
          eventCodes={eventCodes}
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
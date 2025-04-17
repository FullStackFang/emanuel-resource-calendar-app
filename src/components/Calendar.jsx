// src/components/Calendar.jsx
import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import EventForm from './EventForm';
import MultiSelect from './MultiSelect';

// Mock categories
const categories = [
  'Uncategorized', 'TMPL', 'CPL', 'MUS', '402', '402A', '405', '602',
  'IMW', 'GWH', 'R/S', 'LOW', 'SKIR', 'GLB', 'Note1',
  '4th FL Conf', '424'
]; 

const eventCodes = [
  'Board of Trustees',
  'Communications',
  'Membership'
];


// Initial mock events
const initialMockEvents = [
  {
    id: '1',
    subject: 'Weekly Team Meeting',
    start: { dateTime: new Date(new Date().setHours(10, 0, 0, 0)).toISOString() },
    end: { dateTime: new Date(new Date().setHours(11, 0, 0, 0)).toISOString() },
    location: { displayName: 'Conference Room A' },
    eventCode: 'Board of Trustees',
    category: 'TPL'
  },
  {
    id: '2',
    subject: 'Lunch with Sarah',
    start: { dateTime: new Date(new Date().setHours(12, 30, 0, 0)).toISOString() },
    end: { dateTime: new Date(new Date().setHours(13, 30, 0, 0)).toISOString() },
    location: { displayName: 'Cafe Nero' },
    eventCode: 'Communications',
    category: 'CPL'
  },
  {
    id: '3',
    subject: 'Project Review',
    start: { dateTime: new Date(new Date().setHours(14, 0, 0, 0)).toISOString() },
    end: { dateTime: new Date(new Date().setHours(15, 30, 0, 0)).toISOString() },
    location: { displayName: 'Online Meeting' },
    eventCode: 'Membership',
    category: 'MUS'
  },
  {
    id: '4',
    subject: 'Client Call',
    start: { dateTime: new Date(new Date().setDate(new Date().getDate() + 1)).setHours(9, 0, 0, 0) },
    end: { dateTime: new Date(new Date().setDate(new Date().getDate() + 1)).setHours(10, 0, 0, 0) },
    location: { displayName: 'Phone' },
    eventCode: 'Communications',
    category: '402'
  }
];

function Calendar({ accessToken }) {
  const [allEvents, setAllEvents] = useState(initialMockEvents);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewType, setViewType] = useState('week');
  const [dateRange, setDateRange] = useState({
    start: new Date(),
    end: calculateEndDate(new Date(), 'week')
  });
  const [selectedCategories, setSelectedCategories] = useState(categories);
  
  // State for modal and event operations
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

  // Toggle category selection
  const toggleCategory = (category) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories(selectedCategories.filter(cat => cat !== category));
    } else {
      setSelectedCategories([...selectedCategories, category]);
    }
  };

  // Filter events based on date range and categories
  useEffect(() => {
    setLoading(true);
    
    setTimeout(() => {
      console.log('Filtering with date range:', dateRange.start.toISOString(), 'to', dateRange.end.toISOString());
    console.log('All events before filtering:', allEvents.length);
    console.log('Selected categories:', selectedCategories);
    
    const filtered = allEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      console.log('Event date:', event.subject, eventDate.toISOString());
      
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
      
      console.log(
        `Event: ${event.subject}, ` +
        `Category: ${event.category || 'Uncategorized'}, ` +
        `In date range: ${inDateRange}, ` +
        `Category selected: ${inSelectedCategory}`
      );
      
      return inDateRange && inSelectedCategory;
    });
    
    console.log('Filtered events count:', filtered.length);
    setFilteredEvents(filtered);
    setLoading(false);
  }, 500);
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
  const handleDayCellClick = (day, category) => {
    // Close context menu if open
    setShowContextMenu(false);
    
    // Set up start and end times (1 hour duration)
    const startTime = new Date(day);
    startTime.setHours(9, 0, 0, 0); // Default to 9 AM
    
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1);
    
    // Create a new event template
    const newEvent = {
      id: '',
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

  const loadGraphEvents = async () => {
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
  
      // Process all fetched events
      const converted = allFetchedEvents.map((event) => {
        let eventCode = '';
        let category = '';
      
        try {
          const parsed = JSON.parse(event.body?.content || '{}');
          eventCode = parsed.eventCode || '';
          category = parsed.category || '';
        } catch (e) {
          console.warn('Failed to parse custom event body content:', event.body?.content, e);
        }
      
        return {
          id: event.id,
          subject: event.subject,
          start: { dateTime: event.start.dateTime },
          end: { dateTime: event.end.dateTime },
          location: { displayName: event.location?.displayName || '' },
          eventCode,
          category: category || 'Uncategorized' // Default to Uncategorized if no category
        };
      });
      
      console.log('Converted events:', converted);
      setAllEvents(converted);
    } catch (err) {
      console.error('Failed to load events from Graph:', err);
    }
  };

  useEffect(() => {
    if (accessToken) {
      loadGraphEvents();
    }
  }, [accessToken]);

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

  const saveToGraph = async (event) => {
    try {
      const isNewEvent = !event.id;
      const method = isNewEvent ? 'POST' : 'PATCH';
      const url = isNewEvent
        ? `https://graph.microsoft.com/v1.0/me/events`
        : `https://graph.microsoft.com/v1.0/me/events/${event.id}`;
        
      console.log(`${isNewEvent ? 'Creating' : 'Updating'} event with method ${method} to ${url}`);
      
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
          contentType: 'Text',
          content: JSON.stringify({
            eventCode: event.eventCode || '',
            category: event.category || ''
          })
        }
      };
      
      console.log('Event data to send:', eventBody);
      
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventBody)
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Graph API error:', errorData);
        console.error('Error details:', errorData.error);
        throw new Error(`Graph API error: ${errorData.error?.message || 'Unknown error'}`);
      } else {
        const data = await response.json();
        console.log('Event saved to Microsoft Calendar, response:', data);
        
        // For new events, we need to update our local event with the new ID
        if (isNewEvent && data.id) {
          return data;
        }
        return event;
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

      <div className="calendar-layout">
        <div className="calendar-sidebar">
          <h3>Categories</h3>
          <MultiSelect 
            options={categories}
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
            {selectedCategories.map(category => (
              <div key={category} className="grid-row">
                <div className="grid-cell category-cell">
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
            ))}
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

      {/* Modal for Add/Edit Event */}
      <Modal 
        isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit')} 
        onClose={() => setIsModalOpen(false)}
        title={modalType === 'add' ? 'Add Event' : 'Edit Event'}
      >
        <EventForm 
          event={currentEvent}
          categories={categories}
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
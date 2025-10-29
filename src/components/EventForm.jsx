// src/components/EventForm.jsx
import React, { useState, useEffect, useRef } from 'react';
import MultiSelect from './MultiSelect';
import SingleSelect from './SingleSelect';
import EventPreviewModal from './EventPreviewModal';
import EventAuditHistory from './EventAuditHistory';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './EventForm.css';

// ===== ADD THESE FUNCTIONS AT THE TOP OF EventForm.jsx (outside the component) =====

/**
 * Extract plain text from HTML content for clean display in form fields
 * @param {string} htmlContent - HTML content from Microsoft Graph API
 * @returns {string} - Clean plain text
 */
const extractTextFromHtml = (htmlContent) => {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return '';
  }

  let content = htmlContent;

  // First, decode HTML entities to restore actual HTML tags
  content = content
    .replace(/&lt;/g, '<')   // Decode HTML entities first
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Now remove HTML tags and clean up
  content = content
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with spaces
    .replace(/\s+/g, ' ')    // Replace multiple whitespace with single space
    .trim();                 // Remove leading/trailing whitespace

  // If we still have HTML-like content, it might be double-encoded
  if (content.includes('&lt;') || content.includes('&gt;')) {
    // Try decoding again for double-encoded content
    content = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return content || '';
};

/**
 * Convert UTC time to display time based on user's timezone
 * @param {string} utcDateString - ISO date string in UTC
 * @param {string} userTz - User's preferred timezone
 * @returns {object} Object with date and time strings formatted for form inputs
 */
const utcToDisplayTime = (utcDateString, userTz) => {
  if (!utcDateString) return { date: '', time: '' };
  
  // Ensure UTC indicator
  const utcString = utcDateString.endsWith('Z') ? utcDateString : `${utcDateString}Z`;
  const date = new Date(utcString);
  
  // Format date in YYYY-MM-DD format
  const dateStr = date.toLocaleDateString('en-CA', { // en-CA gives YYYY-MM-DD format
    timeZone: userTz
  });
  
  // Format time in 24-hour format for input fields
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: userTz
  });
  
  return { date: dateStr, time: timeStr };
};

/**
 * Convert display time back to UTC for API
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {string} ISO date string in UTC
 */
const displayToUtcTime = (dateStr, timeStr) => {
  if (!dateStr) return '';
  
  // Create a date in the user's local timezone
  const localDate = new Date(`${dateStr}T${timeStr || '00:00'}`);
  
  // Convert to UTC ISO string
  return localDate.toISOString();
};

/**
 * Parse location string to array and filter to only include values from availableLocations
 * @param {string|object} location - Location data from event
 * @param {array} availableOptions - Available location options from MultiSelect
 * @returns {array} Array of valid location strings
 */
const parseLocationsFromEvent = (location, availableOptions) => {
  if (!location) return [];
  
  // The delimiter used for locations (make sure this is consistent)
  const LOCATION_DELIMITER = '; ';
  
  // Parse the locations from the event
  let parsedLocations = [];
  if (typeof location === 'object' && location.displayName) {
    parsedLocations = location.displayName.split(LOCATION_DELIMITER).map(loc => loc.trim());
  } else if (typeof location === 'string') {
    parsedLocations = location.split(LOCATION_DELIMITER).map(loc => loc.trim());
  }
  
  // Filter to only include values that exist in availableOptions
  return parsedLocations.filter(loc => availableOptions.includes(loc));
};

// Helper functions for time conversion
const minutesToTimeString = (minutes) => {
  if (!minutes || minutes === 0) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

const timeStringToMinutes = (timeString) => {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return (hours * 60) + minutes;
};

function EventForm({
  event,
  categories,
  availableLocations = [],
  schemaExtensions = [],
  onSave,
  onCancel,
  onDelete,
  onReview, // New prop for review button handler
  readOnly = false,
  userTimeZone = 'America/New_York', // Default fallback
  savingEvent = false,
  apiToken = null // For audit history
}) {
  // Add this time zone mapping
  const timeZoneOptions = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
  ];

  // Helper function to get the label for the current time zone
  const getTimeZoneLabel = (tzValue) => {
    const option = timeZoneOptions.find(opt => opt.value === tzValue);
    return option ? option.label : tzValue;
  };

  // Track the previous event to avoid unnecessary updates
  const prevEventRef = useRef(null);
  
  const [formData, setFormData] = useState({
    id: '',
    subject: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    locations: [], 
    category: ''
  });
  
  const [isAllDay, setIsAllDay] = useState(false);
  
  // Add state for MEC Categories
  const [selectedMecCategories, setSelectedMecCategories] = useState([]);
  
  // Add state for registration event creation
  const [createRegistrationEvent, setCreateRegistrationEvent] = useState(true); // Default to ON
  const [setupMinutes, setSetupMinutes] = useState(30); // Default to 30 minutes
  const [teardownMinutes, setTeardownMinutes] = useState(15); // Default to 15 minutes
  const [eventDescription, setEventDescription] = useState(''); // Main event description
  const [registrationNotes, setRegistrationNotes] = useState(''); // Setup/teardown notes
  const [assignedTo, setAssignedTo] = useState('');
  const [useTimeInputs, setUseTimeInputs] = useState(true); // Toggle between minutes and time inputs - default to time
  const [setupTime, setSetupTime] = useState(''); // Setup time in HH:MM format
  const [teardownTime, setTeardownTime] = useState(''); // Teardown time in HH:MM format
  
  // Preview modal state
  const [showPreview, setShowPreview] = useState(false);
  const [pendingEventData, setPendingEventData] = useState(null);

  // File attachment state
  const [attachments, setAttachments] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Tab state management
  const [activeTab, setActiveTab] = useState('event');
  const [auditHistoryCount, setAuditHistoryCount] = useState(0);
  const availableMecCategories = [
    'Community',
    'Membership',
    'Bernard Museum of Judaica',
    'Club One East',
    'Community As Family',
    'Daily Worship Service',
    'Downtown Class',
    'Emanu-El Cares',
    'Emanu-El Downtown',
    'Families with Young Children',
    'Holiday',
    'Interfaith Dialogue',
    'Israel',
    'Learning',
    'Men\'s Club',
    'Nursery School',
    'Religious School',
    'Shabbat Worship Service',
    'Skirball Academy',
    'Stettenheim Library',
    'Streicker Cultural Center',
    'Streicker Outreach Center',
    'Teens',
    'Tikkun Olam',
    'Women of Emanu-El',
    'Worship',
    'Young Families of Emanu-El',
    'Young Families Uptown',
    'Young Members',
    'Young Professionals'
  ];
    
  // Initialize form with event data - only run when event changes
  useEffect(() => {
    // Check if event has actually changed (by ID)
    if (event && prevEventRef.current && event.id === prevEventRef.current.id) {
      return;
    }
    
    // Update the previous event ref
    prevEventRef.current = event;
    
    if (event) {
      logger.debug("OPENING EVENT FORM:");
      logger.debug(`  Raw start: ${event.start?.dateTime}`);
      logger.debug(`  Raw end: ${event.end?.dateTime}`);
      
      // Set event ID and subject
      const newFormData = {
        id: event.id || '',
        subject: event.subject || '',
        locations: parseLocationsFromEvent(event.location, availableLocations),
        category: event.category || ''
      };
      
      if (event.start?.dateTime) {
        const startDisplay = utcToDisplayTime(event.start.dateTime, userTimeZone);
        newFormData.startDate = startDisplay.date;
        newFormData.startTime = startDisplay.time;
      }

      if (event.end?.dateTime) {
        const endDisplay = utcToDisplayTime(event.end.dateTime, userTimeZone);
        newFormData.endDate = endDisplay.date;
        newFormData.endTime = endDisplay.time;
      }

      // Check if this is an all-day event
      const isAllDayEvent = event.isAllDay || (
        event.start?.dateTime && event.end?.dateTime &&
        event.start.dateTime.includes('T00:00:00') && 
        (event.end.dateTime.includes('T00:00:00') || event.end.dateTime.includes('T23:59:59'))
      );

      setIsAllDay(isAllDayEvent);
      if (isAllDayEvent) {
        newFormData.startTime = '';
        newFormData.endTime = '';
      }
      
      logger.debug(`  Display values: startDate=${newFormData.startDate}, startTime=${newFormData.startTime}`);
    
      // Apply the form data update
      setFormData(newFormData);
      
      // Reset MEC Categories for now (will be populated from event data later)
      setSelectedMecCategories([]);
      
      // Load registration event data if they exist (from the enriched event data)
      const hasRegistrationData = event.hasRegistrationEvent || 
                                 (event.setupMinutes && event.setupMinutes > 0) || 
                                 (event.teardownMinutes && event.teardownMinutes > 0) ||
                                 event.registrationNotes || event.assignedTo;
      
      // For existing events, use the actual createRegistrationEvent flag or determine from data
      // For CSV imports, respect the setupMinutes/teardownMinutes = 0 to disable registration
      const shouldCreateRegistration = event.createRegistrationEvent !== undefined ? 
                                      event.createRegistrationEvent : 
                                      hasRegistrationData;
      setCreateRegistrationEvent(shouldCreateRegistration);
      
      // Use the registration data from the enriched event (populated during loadGraphEvents)
      const setupMins = event.setupMinutes || 30;
      const teardownMins = event.teardownMinutes || 15;
      setSetupMinutes(setupMins);
      setTeardownMinutes(teardownMins);
      
      // Calculate actual setup and teardown times based on main event times
      if (newFormData.startDate && newFormData.startTime && newFormData.endDate && newFormData.endTime) {
        const eventStart = new Date(`${newFormData.startDate}T${newFormData.startTime}`);
        const eventEnd = new Date(`${newFormData.endDate}T${newFormData.endTime}`);
        
        // Calculate setup start time (event start - setup minutes)
        const setupStart = new Date(eventStart);
        setupStart.setMinutes(setupStart.getMinutes() - setupMins);
        
        // Calculate teardown end time (event end + teardown minutes)
        const teardownEnd = new Date(eventEnd);
        teardownEnd.setMinutes(teardownEnd.getMinutes() + teardownMins);
        
        // Convert to HH:MM format for the time inputs
        const setupTimeStr = setupStart.toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        const teardownTimeStr = teardownEnd.toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        setSetupTime(setupTimeStr);
        setTeardownTime(teardownTimeStr);
        
        logger.debug('Calculated setup/teardown times from event:', {
          eventStart: eventStart.toISOString(),
          eventEnd: eventEnd.toISOString(),
          setupMins,
          teardownMins,
          setupStart: setupStart.toISOString(),
          teardownEnd: teardownEnd.toISOString(),
          setupTimeStr,
          teardownTimeStr
        });
      } else {
        // Fallback to converting minutes directly
        setSetupTime(minutesToTimeString(setupMins));
        setTeardownTime(minutesToTimeString(teardownMins));
      }
      console.log('EventForm DEBUG - event object:', event);
      console.log('EventForm DEBUG - event.body:', event.body);
      console.log('EventForm DEBUG - event.body type:', typeof event.body);
      console.log('EventForm DEBUG - event.description:', event.description);

      // Handle both string and object formats for body field
      let description = '';
      if (typeof event.body === 'string') {
        // Body is a plain string (from backend/cache issue)
        description = extractTextFromHtml(event.body);
        console.log('EventForm DEBUG - body is string, using directly:', description);
      } else if (event.body?.content) {
        // Body is proper object format from Graph API
        description = extractTextFromHtml(event.body.content);
        console.log('EventForm DEBUG - body is object, using content:', description);
      } else if (event.description) {
        // Fallback to description field
        description = extractTextFromHtml(event.description);
        console.log('EventForm DEBUG - using description field:', description);
      }

      console.log('EventForm DEBUG - final description:', description);
      setEventDescription(description);
      setRegistrationNotes(event.registrationNotes || '');
      setAssignedTo(event.assignedTo || '');
      
      logger.debug('Loaded registration data from event:', {
        hasRegistrationEvent: event.hasRegistrationEvent,
        setupMinutes: setupMins,
        teardownMinutes: teardownMins,
        registrationNotes: event.registrationNotes,
        assignedTo: event.assignedTo
      });
    } else {
      // Handle new event creation - initialize with defaults
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      const defaultStartTime = '09:00';
      const defaultEndTime = '10:00';
      
      setFormData({
        id: '',
        subject: '',
        startDate: today.toISOString().split('T')[0],
        startTime: defaultStartTime,
        endDate: today.toISOString().split('T')[0],
        endTime: defaultEndTime,
        locations: [],
        category: ''
      });
      
      setIsAllDay(false);
      setSelectedMecCategories([]);
      setCreateRegistrationEvent(true); // Default to true for new events
      setSetupMinutes(30);
      setTeardownMinutes(15);
      setSetupTime(minutesToTimeString(30));
      setTeardownTime(minutesToTimeString(15));
      setEventDescription('');
      setRegistrationNotes('');
      setAssignedTo('');
    }
  }, [event, categories, availableLocations, userTimeZone]); 

  // Inside the EventForm component, after the previous useEffect
  useEffect(() => {
    // Skip if no event data is loaded or if this is the initial render
    if (!event?.start?.dateTime || !prevEventRef.current) return;
    
    logger.info(`TIMEZONE CHANGED TO: ${userTimeZone}`);
    
    // Convert the UTC times to display times in the new timezone
    const startDisplay = utcToDisplayTime(event.start.dateTime, userTimeZone);
    const endDisplay = utcToDisplayTime(event.end.dateTime, userTimeZone);
    
    // Update just the time fields with the new timezone values
    setFormData(prev => ({
      ...prev,
      startDate: startDisplay.date,
      startTime: isAllDay ? '' : startDisplay.time,
      endDate: endDisplay.date,
      endTime: isAllDay ? '' : endDisplay.time
    }));
    
  }, [userTimeZone]); // This effect runs only when userTimeZone changes

  // Fetch audit history count for existing events
  useEffect(() => {
    const fetchAuditHistoryCount = async () => {
      if (!event?.id || !apiToken) {
        setAuditHistoryCount(0);
        return;
      }

      try {
        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${event.id}/audit-history`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setAuditHistoryCount(data.auditHistory?.length || 0);
        } else {
          setAuditHistoryCount(0);
        }
      } catch (error) {
        logger.debug('Failed to fetch audit history count:', error);
        setAuditHistoryCount(0);
      }
    };

    fetchAuditHistoryCount();
  }, [event?.id, apiToken]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Update setup/teardown times when event times change
    if (name === 'startTime' && setupMinutes > 0) {
      const eventStartMinutes = timeStringToMinutes(value);
      const setupStartMinutes = eventStartMinutes - setupMinutes;
      setSetupTime(minutesToTimeString(Math.max(0, setupStartMinutes)));
    }
    
    if (name === 'endTime' && teardownMinutes > 0) {
      const eventEndMinutes = timeStringToMinutes(value);
      const teardownEndMinutes = eventEndMinutes + teardownMinutes;
      setTeardownTime(minutesToTimeString(teardownEndMinutes));
    }
  };

  const handleAllDayToggle = () => {
    const newIsAllDay = !isAllDay;
    setIsAllDay(newIsAllDay);
    
    // If switching FROM all-day TO timed, set smart default times
    if (!newIsAllDay && isAllDay) {
      const now = new Date();
      const nextHour = new Date(now);
      
      // Round up to next hour
      nextHour.setHours(now.getHours() + (now.getMinutes() > 0 ? 1 : 0));
      nextHour.setMinutes(0);
      nextHour.setSeconds(0);
      
      // End time is 1 hour later
      const endTime = new Date(nextHour);
      endTime.setHours(nextHour.getHours() + 1);
      
      // Format times for form inputs (HH:MM)
      const startTimeStr = nextHour.toTimeString().slice(0, 5);
      const endTimeStr = endTime.toTimeString().slice(0, 5);
      
      // Update form data
      setFormData(prev => ({
        ...prev,
        startTime: startTimeStr,
        endTime: endTimeStr,
        // Handle date change if crossing midnight
        endDate: endTime.getDate() !== nextHour.getDate() 
          ? endTime.toISOString().split('T')[0] 
          : prev.endDate
      }));
    }
  };

  const handleTimeInputToggle = () => {
    setUseTimeInputs(!useTimeInputs);
  };

  const handleSetupMinutesChange = (newMinutes) => {
    // Cap at maximum 8 hours (480 minutes)
    const clampedMinutes = Math.min(Math.max(0, newMinutes), 480);
    setSetupMinutes(clampedMinutes);
    setSetupTime(minutesToTimeString(clampedMinutes));
  };

  const handleTeardownMinutesChange = (newMinutes) => {
    // Cap at maximum 8 hours (480 minutes)
    const clampedMinutes = Math.min(Math.max(0, newMinutes), 480);
    setTeardownMinutes(clampedMinutes);
    setTeardownTime(minutesToTimeString(clampedMinutes));
  };

  const handleSetupTimeChange = (timeString) => {
    setSetupTime(timeString);
    
    // Calculate setup duration based on event start time
    if (timeString && formData.startTime) {
      const eventStartMinutes = timeStringToMinutes(formData.startTime);
      const setupStartMinutes = timeStringToMinutes(timeString);
      const duration = eventStartMinutes - setupStartMinutes;
      setSetupMinutes(Math.max(0, duration)); // Ensure positive duration
    } else {
      setSetupMinutes(0);
    }
  };

  const handleTeardownTimeChange = (timeString) => {
    setTeardownTime(timeString);
    
    // Calculate teardown duration based on event end time
    if (timeString && formData.endTime) {
      const eventEndMinutes = timeStringToMinutes(formData.endTime);
      const teardownEndMinutes = timeStringToMinutes(timeString);
      const duration = teardownEndMinutes - eventEndMinutes;
      setTeardownMinutes(Math.max(0, duration)); // Ensure positive duration
    } else {
      setTeardownMinutes(0);
    }
  };

  const handleLocationChange = (selectedLocations) => {
    // Filter locations to ensure they only contain values from availableLocations
    const validLocations = selectedLocations.filter(loc => availableLocations.includes(loc));
    
    setFormData(prev => ({
      ...prev,
      locations: validLocations
    }));
  };

  // Validation function for setup/teardown times
  const validateSetupTeardown = () => {
    if (!formData.startDate || !formData.startTime || !formData.endDate || !formData.endTime) {
      return null; // Skip validation if event times aren't set
    }
    
    if (!useTimeInputs) {
      // Skip validation for minutes input mode - just use the simple duration limits
      return null;
    }
    
    // For time input mode, validate that times are in correct order
    const eventStart = new Date(`${formData.startDate}T${formData.startTime}`);
    const eventEnd = new Date(`${formData.endDate}T${formData.endTime}`);
    
    // Parse setup and teardown times
    if (setupTime) {
      const setupDateTime = new Date(`${formData.startDate}T${setupTime}`);
      if (setupDateTime >= eventStart) {
        return `Setup time (${setupTime}) must be before event start time (${formData.startTime}).`;
      }
    }
    
    if (teardownTime) {
      const teardownDateTime = new Date(`${formData.endDate}T${teardownTime}`);
      if (teardownDateTime < eventEnd) {
        return `Teardown time (${teardownTime}) must be on or after event end time (${formData.endTime}).`;
      }
    }
    
    return null;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!formData.subject || !formData.startDate || !formData.endDate) {
      alert('Please fill out all required fields');
      return;
    }
    
    // Validate setup/teardown times
    const validationError = validateSetupTeardown();
    if (validationError) {
      alert(validationError);
      return;
    }
    
    logger.debug("PREPARING EVENT DATA FOR PREVIEW:");
    logger.debug(`  Form values: startDate=${formData.startDate}, startTime=${formData.startTime}`);
    
    // Convert display times to UTC for API
    const startUtc = displayToUtcTime(
      formData.startDate, 
      isAllDay ? '00:00' : formData.startTime
    );
    
    const endUtc = displayToUtcTime(
      formData.endDate, 
      isAllDay ? '23:59:59' : formData.endTime
    );
    
    logger.debug(`  Converted to UTC: start=${startUtc}, end=${endUtc}`);
    
    // For all-day events, end time is set to 23:59:59 on the same day
    const adjustedEndUtc = endUtc;
    if (isAllDay) {
      logger.debug(`  All-day event: ${formData.startDate} 00:00:00 to ${formData.endDate} 23:59:59`);
    }
    
    // Build the payload for Graph API
    const eventData = {
      id: formData.id,
      subject: formData.subject,
      start: { 
        dateTime: startUtc, 
        timeZone: 'UTC' 
      },
      end: { 
        dateTime: adjustedEndUtc, 
        timeZone: 'UTC' 
      },
      location: { 
        displayName: formData.locations.length > 0 
          ? formData.locations.join('; ') 
          : 'Unspecified'
      },
      categories: formData.category ? [formData.category] : ['Uncategorized'],
      isAllDay,
      // Main event description (for TempleEvents calendar)
      body: {
        content: eventDescription || '',
        contentType: 'text'
      },
      // Registration event data (for TempleRegistration calendar when enabled)
      setupMinutes: createRegistrationEvent ? setupMinutes : 0,
      teardownMinutes: createRegistrationEvent ? teardownMinutes : 0,
      registrationNotes: createRegistrationEvent ? registrationNotes : '',
      assignedTo: createRegistrationEvent ? assignedTo : '',
      createRegistrationEvent
    };

    logger.debug("Final event data prepared for save:", eventData);
    // Category debugging removed

    // Save directly without preview modal
    onSave(eventData);
  };
  
  // Handler for confirming save from preview modal
  const handleConfirmSave = () => {
    logger.log("SAVING EVENT after preview confirmation:", pendingEventData);
    setShowPreview(false);
    onSave(pendingEventData);
  };
  
  // Handler for canceling save from preview modal
  const handleCancelSave = () => {
    setShowPreview(false);
    setPendingEventData(null);
  };

  // File attachment functions
  const loadAttachments = async () => {
    if (!event?.id || !apiToken) return;

    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${event.id}/attachments`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAttachments(data.attachments || []);
      }
    } catch (error) {
      console.error('Failed to load attachments:', error);
    }
  };

  const handleFileSelect = (files) => {
    const fileArray = Array.from(files);
    uploadFiles(fileArray);
  };

  const uploadFiles = async (files) => {
    if (!event?.id || !apiToken) {
      alert('Please save the event first before uploading files');
      return;
    }

    for (const file of files) {
      setUploadingFiles(prev => [...prev, { name: file.name, progress: 0 }]);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${event.id}/attachments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          },
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          setAttachments(prev => [...prev, data.attachment]);
        } else {
          const errorData = await response.json();
          alert(`Failed to upload ${file.name}: ${errorData.error}`);
        }
      } catch (error) {
        console.error('Upload error:', error);
        alert(`Failed to upload ${file.name}`);
      } finally {
        setUploadingFiles(prev => prev.filter(f => f.name !== file.name));
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const removeAttachment = async (attachmentId, fileName) => {
    if (!apiToken) return;

    if (!confirm(`Delete ${fileName}?`)) return;

    try {
      // Note: We'll need to add a DELETE endpoint later
      // For now, just remove from local state
      setAttachments(prev => prev.filter(att => att.id !== attachmentId));
    } catch (error) {
      console.error('Failed to delete attachment:', error);
    }
  };

  const getFileIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.includes('word')) return '📝';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
    return '📎';
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isPreviewable = (mimeType) => {
    return (
      mimeType.startsWith('image/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown'
    );
  };

  const handlePreviewFile = async (attachment) => {
    try {
      // Fetch the file with proper authentication
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${attachment.downloadUrl}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      setPreviewFile({
        ...attachment,
        blobUrl: blobUrl
      });
      setShowPreviewModal(true);
    } catch (error) {
      console.error('Preview failed:', error);
      alert('Failed to load file preview. Please try downloading the file instead.');
    }
  };

  const closePreview = () => {
    // Clean up blob URL to prevent memory leaks
    if (previewFile?.blobUrl) {
      URL.revokeObjectURL(previewFile.blobUrl);
    }
    setShowPreviewModal(false);
    setPreviewFile(null);
  };

  const handleDownloadFile = async (attachment) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${attachment.downloadUrl}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file. Please try again.');
    }
  };

  // Load attachments when event changes
  useEffect(() => {
    loadAttachments();
  }, [event?.id, apiToken]);

  return (
    <form className="event-form-google" onSubmit={handleSubmit}>
      {/* Event Title */}
      <div className="google-form-group">
        <input
          type="text"
          id="subject"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          placeholder="Add title and time"
          required
          disabled={readOnly}
          className="google-title-input"
        />
      </div>

      {/* Event Types - Multi-tab interface */}
      <div className="event-type-tabs">
        <div
          className={`event-type-tab ${activeTab === 'event' ? 'active' : ''}`}
          onClick={() => setActiveTab('event')}
        >
          Event Details
        </div>

        {/* Show History tab only for existing events */}
        {event && event.id && (
          <div
            className={`event-type-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History {auditHistoryCount > 0 && `(${auditHistoryCount})`}
          </div>
        )}

        {/* Timezone info - inline with tabs */}
        <div className="timezone-link-inline">
          {getTimeZoneLabel(userTimeZone)}
        </div>
        
        {/* Registration Preview - inline with tabs */}
        {!readOnly && formData.startDate && formData.startTime && formData.endDate && formData.endTime && (
          <div className="registration-preview-inline">
            {(() => {
              const eventStart = new Date(`${formData.startDate}T${formData.startTime}`);
              const eventEnd = new Date(`${formData.endDate}T${formData.endTime}`);
              const setupStart = new Date(eventStart);
              setupStart.setMinutes(setupStart.getMinutes() - setupMinutes);
              const teardownEnd = new Date(eventEnd);
              teardownEnd.setMinutes(teardownEnd.getMinutes() + teardownMinutes);
              
              const formatTime = (date) => {
                return date.toLocaleTimeString('en-US', { 
                  hour: 'numeric', 
                  minute: '2-digit',
                  hour12: true 
                });
              };
              
              // Check if setup/teardown is enabled
              const hasSetupTeardown = createRegistrationEvent && ((setupMinutes && setupMinutes > 0) || (teardownMinutes && teardownMinutes > 0));
              
              return (
                <div className="preview-content-inline">
                  {hasSetupTeardown ? (
                    <strong>Reserved: {formatTime(setupStart)} - {formatTime(teardownEnd)}</strong>
                  ) : (
                    <strong>Event: {formatTime(eventStart)} - {formatTime(eventEnd)}</strong>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Conditional content based on active tab */}
      {activeTab === 'event' && (
        <>
          {/* Date, Time and All Day Row */}
      <div className="google-datetime-row">
        <div className="form-icon">🕒</div>
        <div className="datetime-inputs">
          <input
            type="date"
            name="startDate"
            value={formData.startDate}
            onChange={handleChange}
            required
            disabled={readOnly}
            className="google-date-input"
          />
          {!isAllDay && (
            <>
              <input
                type="time"
                name="startTime"
                value={formData.startTime}
                onChange={handleChange}
                required
                disabled={readOnly}
                className="google-time-input"
              />
              <span className="time-separator">–</span>
              <input
                type="time"
                name="endTime"
                value={formData.endTime}
                onChange={handleChange}
                required
                disabled={readOnly}
                className="google-time-input"
              />
            </>
          )}
        </div>
        {/* All Day Toggle */}
        <button
          type="button"
          onClick={handleAllDayToggle}
          disabled={readOnly}
          className="setup-toggle-btn"
        >
          {isAllDay ? 'Set Times' : 'All Day'}
        </button>
      </div>

      {/* Setup/Teardown Time Row */}
      {!readOnly && (
        <>
          <div className="setup-teardown-row">
            <div 
              className="form-icon clickable-icon" 
              onClick={handleTimeInputToggle}
              title={useTimeInputs ? 'Switch to minutes input' : 'Switch to time input'}
            >
              ⏱️
            </div>
            {useTimeInputs ? (
              <div className="datetime-inputs">
                <span className="setup-teardown-label">Setup/Teardown</span>
                {createRegistrationEvent && (
                  <>
                    <input
                      type="time"
                      value={setupTime || ''}
                      onChange={(e) => handleSetupTimeChange(e.target.value)}
                      className="google-time-input"
                      title="Setup time"
                    />
                    <span className="time-separator">–</span>
                    <input
                      type="time"
                      value={teardownTime || ''}
                      onChange={(e) => handleTeardownTimeChange(e.target.value)}
                      className="google-time-input"
                      title="Teardown time"
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="datetime-inputs">
                <span className="setup-teardown-label">Setup/Teardown</span>
                {createRegistrationEvent && (
                  <>
                    <div className="minutes-input-container">
                      <input
                        type="number"
                        value={setupMinutes || 0}
                        onChange={(e) => handleSetupMinutesChange(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        max="480"
                        className="minutes-number-input"
                      />
                      <div className="minutes-spinner-buttons">
                        <button
                          type="button"
                          className="minutes-spinner-btn"
                          onClick={() => handleSetupMinutesChange(Math.min(240, (setupMinutes || 0) + 1))}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="minutes-spinner-btn"
                          onClick={() => handleSetupMinutesChange(Math.max(0, (setupMinutes || 0) - 1))}
                        >
                          ▼
                        </button>
                      </div>
                      <span className="minutes-label">min</span>
                    </div>
                    <span className="time-separator">–</span>
                    <div className="minutes-input-container">
                      <input
                        type="number"
                        value={teardownMinutes || 0}
                        onChange={(e) => handleTeardownMinutesChange(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        max="480"
                        className="minutes-number-input"
                      />
                      <div className="minutes-spinner-buttons">
                        <button
                          type="button"
                          className="minutes-spinner-btn"
                          onClick={() => handleTeardownMinutesChange(Math.min(240, (teardownMinutes || 0) + 1))}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="minutes-spinner-btn"
                          onClick={() => handleTeardownMinutesChange(Math.max(0, (teardownMinutes || 0) - 1))}
                        >
                          ▼
                        </button>
                      </div>
                      <span className="minutes-label">min</span>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (!createRegistrationEvent) {
                  setCreateRegistrationEvent(true);
                  handleSetupMinutesChange(30);
                  handleTeardownMinutesChange(15);
                } else {
                  setCreateRegistrationEvent(false);
                  handleSetupMinutesChange(0);
                  handleTeardownMinutesChange(0);
                }
              }}
              className="setup-toggle-btn"
            >
              {!createRegistrationEvent ? 'Enable' : 'Disable'}
            </button>
          </div>

          {/* Registration Notes Row - directly under setup/teardown */}
          {createRegistrationEvent && (
            <div className="form-row">
              <div className="form-icon">⚙️</div>
              <div className="form-content">
                <textarea
                  value={registrationNotes || ''}
                  onChange={(e) => setRegistrationNotes(e.target.value)}
                  placeholder="Setup/teardown instructions and notes"
                  className="google-textarea"
                  rows="2"
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Location Row */}
      <div className="form-row">
        <div className="form-icon">📍</div>
        <div className="form-content">
          {readOnly ? (
            <span className="readonly-text">
              {formData.locations && formData.locations.length > 0 
                ? formData.locations.join(', ') 
                : 'Add location'}
            </span>
          ) : (
            <div className="location-wrapper">
              <MultiSelect
                options={availableLocations}
                selected={formData.locations || []}
                onChange={handleLocationChange}
                label="Add location"
              />
            </div>
          )}
        </div>
      </div>

      {/* Category and Assignment Row */}
      <div className="form-row">
        <div className="form-icon">👥</div>
        <div className="form-content form-content-split">
          <div className="split-left">
            {readOnly ? (
              <span className="readonly-text">
                {formData.category || 'No category selected'}
              </span>
            ) : (
              <SingleSelect
                options={categories}
                selected={formData.category}
                onChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                placeholder="Add categories"
              />
            )}
          </div>
          {!readOnly && (
            <div className="split-right">
              <input
                type="text"
                value={assignedTo || ''}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Assigned to"
                className="google-input-small"
              />
            </div>
          )}
        </div>
      </div>

      {/* Event Description Row */}
      <div className="form-row">
        <div className="form-icon">📝</div>
        <div className="form-content">
          <textarea
            value={eventDescription || ''}
            onChange={(e) => setEventDescription(e.target.value)}
            placeholder="Add event description"
            className="google-textarea"
            rows="2"
            disabled={readOnly}
          />
        </div>
      </div>

      {/* File Attachments Row - only show for existing events */}
      {event && event.id && !readOnly && (
        <div className="form-row">
          <div className="form-icon">📎</div>
          <div className="form-content">
            <div className="file-upload-section">
              {/* Drag and Drop Zone */}
              <div
                className={`file-drop-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                <div className="drop-zone-content">
                  <div className="drop-zone-icon">📁</div>
                  <div className="drop-zone-text">
                    <strong>Drop files here</strong> or <span className="link-text">browse</span>
                  </div>
                  <div className="drop-zone-hint">
                    PNG, JPG, PDF, DOC, XLS, TXT (max 25MB each)
                  </div>
                </div>
              </div>

              {/* Hidden File Input */}
              <input
                id="file-input"
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md"
                onChange={(e) => handleFileSelect(e.target.files)}
                style={{ display: 'none' }}
              />

              {/* Uploading Files */}
              {uploadingFiles.length > 0 && (
                <div className="uploading-files">
                  {uploadingFiles.map((file, index) => (
                    <div key={index} className="uploading-file">
                      <span>📤 Uploading {file.name}...</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Attachment List */}
              {attachments.length > 0 && (
                <div className="attachments-list">
                  <div className="attachments-header">
                    <strong>Attached Files ({attachments.length})</strong>
                  </div>
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attachment-item">
                      <div className="attachment-info">
                        {isPreviewable(attachment.mimeType) ? (
                          <button
                            type="button"
                            className="file-icon clickable"
                            onClick={() => handlePreviewFile(attachment)}
                            title="Click to preview file"
                          >
                            {getFileIcon(attachment.mimeType)}
                          </button>
                        ) : (
                          <span className="file-icon">{getFileIcon(attachment.mimeType)}</span>
                        )}
                        <div className="file-details">
                          <div className="file-name">{attachment.fileName}</div>
                          <div className="file-meta">
                            {formatFileSize(attachment.fileSize)} •
                            Uploaded {new Date(attachment.uploadedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="attachment-actions">
                        <button
                          type="button"
                          className="download-button"
                          onClick={() => handleDownloadFile(attachment)}
                          title="Download file"
                        >
                          ⬇️
                        </button>
                        <button
                          type="button"
                          className="remove-button"
                          onClick={() => removeAttachment(attachment.id, attachment.fileName)}
                          title="Remove file"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* rsId Row - only show for CSV imported events */}
      {event && (event.rsId !== undefined && event.rsId !== null) && (
        <div className="form-row">
          <div className="form-icon">🏷️</div>
          <div className="form-content">
            <input
              type="text"
              value={event.rsId || ''}
              readOnly
              className="google-input-small"
              style={{ 
                backgroundColor: '#f5f5f5',
                color: '#666',
                fontFamily: 'monospace',
                fontSize: '12px'
              }}
              title="Resource Scheduler ID (from CSV import)"
            />
            <span style={{ 
              marginLeft: '8px', 
              fontSize: '12px', 
              color: '#666' 
            }}>
              rsId
            </span>
          </div>
        </div>
      )}



      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {onReview && event && event.id && (
          <button
            type="button"
            className="review-button"
            onClick={() => onReview(event)}
          >
            Review
          </button>
        )}
        {!readOnly && (
          <button type="submit" className="save-button" disabled={savingEvent}>
            {savingEvent ? (
              <>
                <span className="spinner"></span>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        )}
        {!readOnly && event && event.id && onDelete && (
          <button 
            type="button" 
            className="delete-button" 
            onClick={onDelete}
            style={{
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Delete Event
          </button>
        )}
      </div>
        </>
      )}

      {/* History tab content */}
      {activeTab === 'history' && event && event.id && apiToken && (
        <div className="history-tab-content">
          <EventAuditHistory eventId={event.id} apiToken={apiToken} />
        </div>
      )}

      {/* File Preview Modal */}
      {showPreviewModal && previewFile && (
        <div className="file-preview-modal-overlay" onClick={closePreview}>
          <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-header">
              <h3>{previewFile.fileName}</h3>
              <button
                type="button"
                className="close-preview-button"
                onClick={closePreview}
                title="Close preview"
              >
                ✕
              </button>
            </div>
            <div className="file-preview-content">
              {previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewFile.blobUrl}
                  alt={previewFile.fileName}
                  className="preview-image"
                />
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewFile.blobUrl}
                  className="preview-pdf"
                  title={previewFile.fileName}
                />
              ) : (
                <div className="preview-text">
                  <p>Preview not available for this file type.</p>
                  <p>
                    <button
                      type="button"
                      className="download-link"
                      onClick={() => handleDownloadFile(previewFile)}
                    >
                      Download {previewFile.fileName}
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Event Preview Modal */}
      <EventPreviewModal
        isOpen={showPreview}
        onClose={handleCancelSave}
        onConfirm={handleConfirmSave}
        eventData={pendingEventData}
      />
    </form>
  );
}

export default EventForm;
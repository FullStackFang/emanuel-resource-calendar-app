import React from 'react';

// Default timezone - simple UTC fallback
export const DEFAULT_TIMEZONE = 'UTC';

// Available timezones for the dropdown
export const AVAILABLE_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)', outlook: 'Eastern Standard Time' },
  { value: 'America/Chicago', label: 'Central Time (CT)', outlook: 'Central Standard Time' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', outlook: 'Mountain Standard Time' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', outlook: 'Pacific Standard Time' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)', outlook: 'US Mountain Standard Time' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKST)', outlook: 'Alaskan Standard Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)', outlook: 'Hawaiian Standard Time' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', outlook: 'UTC' },
  { value: 'Europe/London', label: 'London Time (GMT/BST)', outlook: 'GMT Standard Time' },
  { value: 'Europe/Paris', label: 'Central European Time', outlook: 'W. Europe Standard Time' },
  { value: 'Asia/Tokyo', label: 'Japan Time (JST)', outlook: 'Tokyo Standard Time' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time', outlook: 'AUS Eastern Standard Time' }
];

/**
 * Get Outlook timezone string from IANA timezone
 * @param {string} ianaTimezone - IANA timezone identifier
 * @returns {string} Outlook timezone string
 */
export const getOutlookTimezone = (ianaTimezone) => {
  const timezone = AVAILABLE_TIMEZONES.find(tz => tz.value === ianaTimezone);
  return timezone ? timezone.outlook : 'UTC';
};

/**
 * Get timezone label from IANA timezone
 * @param {string} ianaTimezone - IANA timezone identifier
 * @returns {string} Human-readable timezone label
 */
export const getTimezoneLabel = (ianaTimezone) => {
  const timezone = AVAILABLE_TIMEZONES.find(tz => tz.value === ianaTimezone);
  return timezone ? timezone.label : ianaTimezone;
};

/**
 * Validate if timezone is supported
 * @param {string} timezone - Timezone to validate
 * @returns {boolean} True if timezone is supported
 */
export const isValidTimezone = (timezone) => {
  return AVAILABLE_TIMEZONES.some(tz => tz.value === timezone);
};

/**
 * Get safe timezone (fallback to default if invalid)
 * @param {string} timezone - Timezone to validate
 * @returns {string} Valid timezone or default
 */
export const getSafeTimezone = (timezone) => {
  return isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
};

/**
 * Ensure date string is in proper UTC format
 * @param {string} dateString - Date string to format
 * @returns {string} UTC formatted date string
 */
export const ensureUTCFormat = (dateString) => {
  if (!dateString) return '';
  return dateString.endsWith('Z') ? dateString : `${dateString}Z`;
};

/**
 * Convert date to UTC ISO string
 * @param {Date|string} date - Date to convert
 * @returns {string} UTC ISO string
 */
export const toUTCISOString = (date) => {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toISOString();
};

/**
 * Format date range for API queries (always in UTC)
 * @param {Date} startDate - Range start date
 * @param {Date} endDate - Range end date
 * @returns {Object} Formatted start and end dates in UTC
 */
export const formatDateRangeForAPI = (startDate, endDate) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
};

/**
 * Format time for event display in specified timezone
 * @param {string} dateString - ISO date string (UTC)
 * @param {string} timezone - Target timezone for display
 * @param {string} eventSubject - Event subject for error logging
 * @returns {string} Formatted time string
 */
export const formatEventTime = (dateString, timezone = DEFAULT_TIMEZONE, eventSubject = 'Unknown') => {
  if (!dateString) return '';
  
  try {
    const utcDateString = ensureUTCFormat(dateString);
    const utcDate = new Date(utcDateString);
    
    if (isNaN(utcDate.getTime())) {
      console.error(`Invalid date format for "${eventSubject}":`, dateString);
      return '';
    }
    
    return utcDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: getSafeTimezone(timezone),
    });
  } catch (err) {
    console.error(`Error formatting event time for "${eventSubject}":`, err);
    return '';
  }
};

/**
 * Format date for calendar header display
 * @param {Date} date - Date to format
 * @param {string} timezone - Target timezone for display
 * @returns {string} Formatted date string
 */
export const formatDateHeader = (date, timezone = DEFAULT_TIMEZONE) => {
  if (!date) return '';
  
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'numeric', 
    day: 'numeric',
    timeZone: getSafeTimezone(timezone)
  });
};

/**
 * Format date and time with timezone for search results and detailed displays
 * @param {string} dateTimeString - ISO date string
 * @param {string} timezone - Target timezone for display
 * @returns {string} Formatted date and time string
 */
export const formatDateTimeWithTimezone = (dateTimeString, timezone = DEFAULT_TIMEZONE) => {
  if (!dateTimeString) return '';
  
  try {
    const date = new Date(ensureUTCFormat(dateTimeString));
    
    if (isNaN(date.getTime())) {
      console.error('Invalid date for formatting:', dateTimeString);
      return new Date(dateTimeString).toLocaleString();
    }
    
    const safeTimezone = getSafeTimezone(timezone);
    
    const dateOptions = {
      timeZone: safeTimezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    const timeOptions = {
      timeZone: safeTimezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };
    
    const formattedDate = date.toLocaleDateString('en-US', dateOptions);
    const formattedTime = date.toLocaleTimeString('en-US', timeOptions);
    
    return `${formattedDate} ${formattedTime}`;
  } catch (error) {
    console.error('Error formatting date with timezone:', error);
    return new Date(dateTimeString).toLocaleString();
  }
};

/**
 * Check if an event occurs on a specific day in the given timezone
 * @param {Object} event - Event object with start.dateTime
 * @param {Date} day - Day to check against
 * @param {string} timezone - Timezone for comparison
 * @returns {boolean} True if event occurs on the specified day
 */
export const isEventOnDay = (event, day, timezone = DEFAULT_TIMEZONE) => {
  if (!event?.start?.dateTime || !day) return false;
  
  try {
    const utcDateString = ensureUTCFormat(event.start.dateTime);
    const eventDateUTC = new Date(utcDateString);
    
    if (isNaN(eventDateUTC.getTime())) {
      console.error('Invalid event date:', event.start.dateTime, event);
      return false;
    }
    
    const safeTimezone = getSafeTimezone(timezone);
    
    // Convert event time to specified timezone for date comparison
    const eventInTimezone = new Date(eventDateUTC.toLocaleString('en-US', {
      timeZone: safeTimezone
    }));
    
    // Reset time to midnight for date-only comparison
    const eventDay = new Date(eventInTimezone);
    eventDay.setHours(0, 0, 0, 0);
    
    const compareDay = new Date(day);
    compareDay.setHours(0, 0, 0, 0);
    
    return eventDay.getTime() === compareDay.getTime();
  } catch (err) {
    console.error('Error comparing event date:', err, event);
    return false;
  }
};

/**
 * Snap date to start of week based on preference
 * @param {Date} date - Date to snap
 * @param {string} startOfWeek - 'Sunday' or 'Monday'
 * @returns {Date} Date snapped to start of week
 */
export const snapToStartOfWeek = (date, startOfWeek = 'Monday') => {
  const newDate = new Date(date);
  const day = newDate.getDay(); // 0 = Sunday, 1 = Monday, ...
  
  let daysToSubtract;
  if (startOfWeek === 'Sunday') {
    daysToSubtract = day;
  } else {
    // For Monday start
    daysToSubtract = day === 0 ? 6 : day - 1;
  }
  
  newDate.setDate(newDate.getDate() - daysToSubtract);
  return newDate;
};

/**
 * Calculate end date based on view type
 * @param {Date} startDate - Starting date
 * @param {string} viewType - 'day', 'week', or 'month'
 * @returns {Date} Calculated end date
 */
export const calculateEndDate = (startDate, viewType) => {
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
};

/**
 * Reusable timezone selector component
 * @param {Object} props - Component props
 * @returns {JSX.Element} Timezone selector
 */
export const TimezoneSelector = ({ 
  value, 
  onChange, 
  label = 'Timezone:', 
  className = 'timezone-select',
  disabled = false,
  showLabel = true,
  style = {}
}) => {
  const handleChange = (e) => {
    const newTimezone = e.target.value;
    if (isValidTimezone(newTimezone)) {
      onChange(newTimezone);
    }
  };

  const selectElement = (
    <select
      value={getSafeTimezone(value)}
      onChange={handleChange}
      className={className}
      disabled={disabled}
      style={style}
    >
      {AVAILABLE_TIMEZONES.map(tz => (
        <option key={tz.value} value={tz.value}>
          {tz.label}
        </option>
      ))}
    </select>
  );

  if (!showLabel) {
    return selectElement;
  }

  return (
    <div className="timezone-selector">
      <div className="form-group">
        <label>{label}</label>
        {selectElement}
      </div>
    </div>
  );
};
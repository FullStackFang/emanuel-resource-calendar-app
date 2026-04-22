import React from 'react';
import { logger } from './logger';

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
 * Format date range for API queries (always in UTC)
 * @param {Date} startDate - Range start date
 * @param {Date} endDate - Range end date
 * @returns {Object} Formatted start and end dates in UTC
 */
export const formatDateRangeForAPI = (startDate, endDate) => {
  const start = new Date(startDate);
  // Set to midnight UTC, not local timezone
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(endDate);
  // Set to end of day UTC
  end.setUTCHours(23, 59, 59, 999);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
};

/**
 * Format date and time strings for Microsoft Graph API
 * Creates datetime string WITHOUT timezone indicator (no 'Z' suffix)
 * Graph API expects format: "YYYY-MM-DDTHH:MM:SS"
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} timeStr - Time in HH:MM or HH:MM:SS format
 * @returns {string} Datetime string in format "YYYY-MM-DDTHH:MM:SS"
 */
export const formatDateTimeForGraph = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) {
    throw new Error('Both date and time are required for Graph API format');
  }

  // Ensure time has seconds
  const timeWithSeconds = timeStr.includes(':') && timeStr.split(':').length === 2
    ? `${timeStr}:00`
    : timeStr;

  // Simple concatenation - no timezone conversion, no 'Z' suffix
  return `${dateStr}T${timeWithSeconds}`;
};

/**
 * Format Date object for Graph API (extract local datetime without UTC conversion)
 * @param {Date} date - JavaScript Date object
 * @returns {string} Datetime string in format "YYYY-MM-DDTHH:MM:SS"
 */
export const formatDateObjectForGraph = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Valid Date object required for Graph API format');
  }

  // Extract components in local time (no UTC conversion)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
};

/**
 * Create Graph API datetime structure with timezone
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} timeStr - Time in HH:MM or HH:MM:SS format
 * @param {string} timezone - IANA timezone identifier
 * @returns {Object} Graph API datetime structure { dateTime, timeZone }
 */
export const createGraphDateTime = (dateStr, timeStr, timezone) => {
  return {
    dateTime: formatDateTimeForGraph(dateStr, timeStr),
    timeZone: getOutlookTimezone(timezone)
  };
};

/**
 * Format time for event display in specified timezone
 * @param {string} dateString - ISO date string from Graph API (timezone-aware)
 * @param {string} displayTimezone - Target timezone for display
 * @param {string} eventSubject - Event subject for error logging
 * @param {string} sourceTimezone - Original timezone of the datetime (from event.start.timeZone)
 * @returns {string} Formatted time string
 */
export const formatEventTime = (dateString, displayTimezone = DEFAULT_TIMEZONE, eventSubject = 'Unknown', sourceTimezone = null) => {
  if (!dateString) return '';

  try {
    // All stored datetimes are local-time strings in America/New_York.
    // Default sourceTimezone accordingly when callers don't provide it.
    const effectiveSourceTz = getSafeTimezone(sourceTimezone || 'America/New_York');
    const effectiveDisplayTz = getSafeTimezone(displayTimezone);

    // Strip any Z suffix — stored times are local, not UTC
    const localTimeString = String(dateString).replace(/Z$/, '').replace(/\.0+Z?$/, '');

    // FAST PATH: source timezone matches display timezone.
    // Extract time directly from the string — no Date object needed.
    if (effectiveSourceTz === effectiveDisplayTz) {
      const timeMatch = localTimeString.match(/T(\d{2}):(\d{2})/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2];
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
        return `${displayHours}:${minutes} ${period}`;
      }
    }

    // CROSS-TIMEZONE PATH: source timezone differs from display timezone.
    // We need to find the UTC instant that corresponds to localTimeString in
    // sourceTimezone, then format that instant in displayTimezone.
    //
    // Technique: new Date(str) interprets Z-less strings as browser-local time.
    // We compute the offset between browser-local and sourceTimezone, then adjust.
    const browserDate = new Date(localTimeString);
    if (isNaN(browserDate.getTime())) {
      logger.error(`Invalid date format for "${eventSubject}":`, dateString);
      return '';
    }

    // What wall-clock time does browserDate show in the source timezone?
    const inSourceTz = new Date(browserDate.toLocaleString('en-US', { timeZone: effectiveSourceTz }));
    // The difference tells us how far off browser-local is from source timezone
    const offsetMs = browserDate.getTime() - inSourceTz.getTime();
    // Corrected Date represents the true UTC instant for "localTimeString in sourceTimezone"
    const correctedDate = new Date(browserDate.getTime() + offsetMs);

    return correctedDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: effectiveDisplayTz,
    });
  } catch (err) {
    logger.error(`Error formatting event time for "${eventSubject}":`, err);
    return '';
  }
};

/**
 * Convert HH:MM time string to compact 12-hour format without AM/PM.
 * "08:00" → "8", "13:00" → "1", "08:30" → "8:30", "00:00" → "12", "12:00" → "12"
 */
export const formatCompactHour = (timeHHMM) => {
  if (!timeHHMM) return null;
  const [h, m] = timeHHMM.split(':').map(Number);
  if (isNaN(h)) return null;
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}` : `${hour12}:${String(m).padStart(2, '0')}`;
};

/**
 * Build a multi-segment time display for calendar event cards.
 * Shows reservation boundaries flanking the main event times:
 *   "8–9 · 9:00 AM – 11:00 AM · 11–12"
 *
 * Side segments are only shown when reservation times differ from event times.
 * Returns JSX with styled segments (muted sides, bold center).
 */
// Module-level style constants — avoids re-creating objects per render call.
const MUTED_SEGMENT_STYLE = { color: 'var(--text-tertiary, #999)', fontWeight: 'normal' };
const DOT_STYLE = { margin: '0 1px' };
const BOLD_SEGMENT_STYLE = { fontWeight: 700 };

export const buildReservationTimeDisplay = ({
  startTimeStr,
  endTimeStr,
  reservationStartTime,
  reservationEndTime,
  eventStartTime,
  eventEndTime,
}) => {
  const hasPreSegment = reservationStartTime && eventStartTime && reservationStartTime !== eventStartTime;
  const hasPostSegment = reservationEndTime && eventEndTime && reservationEndTime !== eventEndTime;

  // Fast path: no reservation flanking segments — return plain string (avoids JSX allocation)
  if (!hasPreSegment && !hasPostSegment) {
    return `${startTimeStr} \u2013 ${endTimeStr}`;
  }

  const preSegment = hasPreSegment
    ? `${formatCompactHour(reservationStartTime)}\u2013${formatCompactHour(eventStartTime)}`
    : null;
  const postSegment = hasPostSegment
    ? `${formatCompactHour(eventEndTime)}\u2013${formatCompactHour(reservationEndTime)}`
    : null;

  return (
    <>
      {preSegment && (
        <span style={MUTED_SEGMENT_STYLE}>
          {preSegment}{' '}<span style={DOT_STYLE}>&middot;</span>{' '}
        </span>
      )}
      <span style={BOLD_SEGMENT_STYLE}>
        {startTimeStr} &ndash; {endTimeStr}
      </span>
      {postSegment && (
        <span style={MUTED_SEGMENT_STYLE}>
          {' '}<span style={DOT_STYLE}>&middot;</span>{' '}{postSegment}
        </span>
      )}
    </>
  );
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
export const formatDateTimeWithTimezone = (dateTimeString, timezone = DEFAULT_TIMEZONE, sourceTimezone = null) => {
  if (!dateTimeString) return '';

  try {
    // Stored datetimes are local-time strings in America/New_York (no Z suffix).
    // We must interpret them in the source timezone, not as UTC.
    const effectiveSourceTz = getSafeTimezone(sourceTimezone || 'America/New_York');
    const effectiveDisplayTz = getSafeTimezone(timezone);
    const localTimeString = String(dateTimeString).replace(/Z$/, '').replace(/\.0+Z?$/, '');

    // Parse as browser-local, then correct to source timezone
    const browserDate = new Date(localTimeString);
    if (isNaN(browserDate.getTime())) {
      logger.error('Invalid date for formatting:', dateTimeString);
      return '';
    }

    // Compute offset between browser-local and source timezone
    const inSourceTz = new Date(browserDate.toLocaleString('en-US', { timeZone: effectiveSourceTz }));
    const offsetMs = browserDate.getTime() - inSourceTz.getTime();
    const correctedDate = new Date(browserDate.getTime() + offsetMs);

    const dateOptions = {
      timeZone: effectiveDisplayTz,
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };

    const timeOptions = {
      timeZone: effectiveDisplayTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };

    const formattedDate = correctedDate.toLocaleDateString('en-US', dateOptions);
    const formattedTime = correctedDate.toLocaleTimeString('en-US', timeOptions);

    return `${formattedDate} ${formattedTime}`;
  } catch (error) {
    logger.error('Error formatting date with timezone:', error);
    return '';
  }
};

/**
 * Snap date to start of week based on preference
 * @param {Date} date - Date to snap
 * @param {string} startOfWeek - 'Sunday' or 'Monday'
 * @returns {Date} Date snapped to start of week
 */
export const snapToStartOfWeek = (date, startOfWeek = 'Monday') => {
  // Create a clean Date object and reset to midnight to avoid time-based issues
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);

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
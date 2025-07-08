// CSV Import Utilities
// Handles conversion of Excel serial dates and other CSV-specific data transformations

/**
 * Convert Excel serial date to JavaScript Date
 * Excel uses 1900 as base year, with serial number 1 = January 1, 1900
 * Note: Excel incorrectly treats 1900 as a leap year, so we account for that
 * @param {number} serial - Excel serial date number
 * @returns {Date} JavaScript Date object
 */
function excelSerialToDate(serial) {
  // Excel epoch starts at 1900-01-01, but Excel incorrectly treats 1900 as leap year
  // So dates after Feb 28, 1900 are off by 1 day
  const excelEpoch = new Date(1899, 11, 30); // December 30, 1899 (day 0 in Excel)
  
  // Convert serial to milliseconds and add to epoch
  const milliseconds = serial * 24 * 60 * 60 * 1000;
  const date = new Date(excelEpoch.getTime() + milliseconds);
  
  return date;
}

/**
 * Convert Excel time decimal to hours and minutes
 * Excel stores time as decimal fraction of a day
 * Example: 0.4375 = 10.5 hours = 10:30 AM
 * @param {number} timeDecimal - Time as decimal fraction (0.0 to 1.0)
 * @returns {object} Object with hours and minutes
 */
function excelTimeToHoursMinutes(timeDecimal) {
  const totalMinutes = Math.round(timeDecimal * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  return { hours, minutes };
}

/**
 * Convert Excel serial date + time decimal to ISO DateTime string
 * @param {number} dateSerial - Excel serial date number
 * @param {number} timeDecimal - Time as decimal fraction
 * @returns {string} ISO DateTime string
 */
function excelToISODateTime(dateSerial, timeDecimal) {
  const date = excelSerialToDate(dateSerial);
  const { hours, minutes } = excelTimeToHoursMinutes(timeDecimal);
  
  date.setHours(hours, minutes, 0, 0);
  
  return date.toISOString();
}

/**
 * Parse boolean from CSV (handles 0/1, true/false, yes/no)
 * @param {string|number} value - Value to parse
 * @returns {boolean} Boolean value
 */
function parseCSVBoolean(value) {
  if (typeof value === 'number') {
    return value !== 0;
  }
  
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === '1';
  }
  
  return Boolean(value);
}

/**
 * Clean and normalize CSV text fields
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function cleanCSVText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text.trim()
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Handle old Mac line endings
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Parse categories from CSV (handles comma-separated values)
 * @param {string} categoriesText - Categories as text
 * @returns {Array<string>} Array of category strings
 */
function parseCSVCategories(categoriesText) {
  if (!categoriesText || typeof categoriesText !== 'string') {
    return [];
  }
  
  return categoriesText.split(',')
    .map(cat => cat.trim())
    .filter(cat => cat.length > 0);
}

/**
 * Transform CSV row to unified event format
 * @param {object} csvRow - Raw CSV row object
 * @param {string} userId - User ID for the event
 * @returns {object} Unified event object
 */
function csvRowToUnifiedEvent(csvRow, userId) {
  // Import logger for proper debug output
  const logger = require('./logger');
  
  // DEBUG: Log raw CSV row for rsId debugging
  logger.debug('=== CSV ROW DEBUG ===');
  logger.debug('Raw csvRow keys:', Object.keys(csvRow));
  logger.debug('Raw csvRow.rsId:', csvRow.rsId, '(type:', typeof csvRow.rsId, ')');
  logger.debug('Raw csvRow values:', JSON.stringify(csvRow, null, 2));
  
  // Enhanced rsId column detection - check multiple possible column names
  const possibleRsIdColumns = ['rsId', 'RS_ID', 'RsId', 'RSID', 'rs_id', 'ResourceScheduleId', 'resourcescheduleid'];
  let rawRsId = null;
  let foundRsIdColumn = null;
  
  // Find the actual rsId column name (exact match first)
  for (const colName of possibleRsIdColumns) {
    if (csvRow[colName] !== undefined) {
      rawRsId = csvRow[colName];
      foundRsIdColumn = colName;
      logger.debug(`Found rsId column: "${colName}" with value:`, rawRsId);
      break;
    }
  }
  
  // If not found by exact match, try case-insensitive and pattern matching
  if (rawRsId === null) {
    const csvKeys = Object.keys(csvRow);
    for (const key of csvKeys) {
      const lowerKey = key.toLowerCase().replace(/\s+/g, ''); // Remove spaces for comparison
      if (lowerKey.includes('rsid') || lowerKey.includes('rs_id') || lowerKey.includes('resourceschedule') || 
          lowerKey === 'rsid' || lowerKey === 'resourcescheduleid') {
        rawRsId = csvRow[key];
        foundRsIdColumn = key;
        logger.debug(`Found rsId column (pattern match): "${key}" with value:`, rawRsId);
        break;
      }
    }
  }
  
  if (foundRsIdColumn === null) {
    logger.debug('No rsId column found in CSV. Available columns:', Object.keys(csvRow));
  }
  
  const {
    Subject,
    StartDate,
    StartTime,
    StartDateTime,
    EndDate,
    EndTime,
    EndDateTime,
    AllDayEvent,
    Location,
    Description,
    Categories,
    Deleted,
    // Setup/teardown fields (if present in CSV)
    SetupMinutes,
    TeardownMinutes,
    SetupTime,
    TeardownTime
  } = csvRow;
  
  // Clean and process rsId - enhanced processing for negative numbers
  logger.debug('Raw rsId before processing:', rawRsId, '(type:', typeof rawRsId, ')');
  
  let trimmedRsId = rawRsId;
  if (typeof rawRsId === 'string') {
    trimmedRsId = rawRsId.trim();
    logger.debug('Trimmed string rsId:', trimmedRsId);
  }
  
  let rsId = null;
  
  // Check if we have a valid value to process
  if (trimmedRsId !== undefined && trimmedRsId !== '' && trimmedRsId !== null) {
    logger.debug('Processing rsId value:', trimmedRsId, '(type:', typeof trimmedRsId, ')');
    
    // Handle different data types
    if (typeof trimmedRsId === 'number') {
      // Already a number, use directly
      rsId = trimmedRsId;
      logger.debug('rsId is already a number:', rsId);
    } else if (typeof trimmedRsId === 'string') {
      // String - parse as integer
      
      // Remove any non-numeric characters except minus sign and digits
      const cleanedRsId = trimmedRsId.replace(/[^\d-]/g, '');
      logger.debug('Cleaned rsId string:', cleanedRsId);
      
      if (cleanedRsId !== '') {
        const parsedRsId = parseInt(cleanedRsId, 10);
        if (!isNaN(parsedRsId)) {
          rsId = parsedRsId;
          logger.debug('Successfully parsed rsId as integer:', rsId);
        } else {
          logger.error('Failed to parse cleaned rsId as integer:', cleanedRsId, 'from original:', trimmedRsId);
        }
      } else {
        logger.debug('Cleaned rsId is empty after removing non-numeric characters');
      }
    } else {
      // Other types - try to convert to number
      const numberValue = Number(trimmedRsId);
      if (!isNaN(numberValue) && isFinite(numberValue)) {
        rsId = Math.floor(numberValue); // Ensure it's an integer
        logger.debug('Converted rsId to number:', rsId);
      } else {
        logger.error('Failed to convert rsId to number:', trimmedRsId);
      }
    }
  } else {
    logger.debug('rsId is empty, null, or undefined:', trimmedRsId);
  }
  
  logger.debug('Final processed rsId:', rsId, '(type:', typeof rsId, ')');

  // Handle different date/time formats
  let startISO, endISO;
  
  // If we have StartDateTime/EndDateTime in ISO format, use those
  if (StartDateTime && EndDateTime) {
    startISO = new Date(StartDateTime).toISOString();
    endISO = new Date(EndDateTime).toISOString();
  } 
  // Otherwise, convert from Excel serial dates and times
  else if (StartDate && StartTime && EndDate && EndTime) {
    startISO = excelToISODateTime(parseFloat(StartDate), parseFloat(StartTime));
    endISO = excelToISODateTime(parseFloat(EndDate), parseFloat(EndTime));
  }
  else {
    throw new Error(`Invalid date/time format in row: ${JSON.stringify(csvRow)}`);
  }

  const isAllDay = parseCSVBoolean(AllDayEvent);
  const isDeleted = parseCSVBoolean(Deleted);
  const categories = parseCSVCategories(Categories);
  const subject = cleanCSVText(Subject) || 'Untitled Event';
  const location = cleanCSVText(Location);
  const description = cleanCSVText(Description);

  // Handle setup/teardown times
  const setupMinutes = (SetupMinutes !== undefined && SetupMinutes !== '') ? parseInt(SetupMinutes) : 
                      (SetupTime !== undefined && SetupTime !== '') ? parseInt(SetupTime) : 0;
  const teardownMinutes = (TeardownMinutes !== undefined && TeardownMinutes !== '') ? parseInt(TeardownMinutes) : 
                         (TeardownTime !== undefined && TeardownTime !== '') ? parseInt(TeardownTime) : 0;
  
  // Determine if registration event should be created (following UI pattern)
  const createRegistrationEvent = setupMinutes > 0 || teardownMinutes > 0;

  // Generate event ID
  const eventId = rsId ? `csv_import_${rsId}` : `csv_import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create unified event structure
  const unifiedEvent = {
    userId: userId,
    calendarId: 'csv_import_calendar',
    eventId: eventId,
    
    // Store original data in graphData format (mimicking Microsoft Graph structure)
    graphData: {
      id: eventId,
      subject: subject,
      start: {
        dateTime: startISO,
        timeZone: 'UTC'
      },
      end: {
        dateTime: endISO,
        timeZone: 'UTC'
      },
      location: {
        displayName: location
      },
      categories: categories,
      bodyPreview: description.substring(0, 255),
      body: {
        contentType: 'text',
        content: description
      },
      isAllDay: isAllDay,
      importance: 'normal',
      showAs: 'busy',
      organizer: {
        emailAddress: {
          name: 'CSV Import',
          address: 'csv-import@system'
        }
      },
      attendees: [],
      createdDateTime: new Date().toISOString(),
      lastModifiedDateTime: new Date().toISOString(),
      type: 'singleInstance'
    },
    
    // Internal data for enrichment (consistent with UI pattern)
    internalData: {
      mecCategories: categories,
      setupMinutes: setupMinutes,
      teardownMinutes: teardownMinutes,
      createRegistrationEvent: createRegistrationEvent,
      registrationNotes: description, // Use description as registration notes
      assignedTo: '', // Empty by default, can be filled later
      isCSVImport: true,
      rsId: rsId, // Store rsId as integer (or null if invalid/empty)
      importedAt: new Date().toISOString()
    },
    
    // Metadata
    sourceCalendars: [{
      calendarId: 'csv_import_calendar',
      calendarName: 'CSV Import',
      role: 'import'
    }],
    
    // Timestamps and flags
    lastSyncedAt: new Date(),
    lastAccessedAt: new Date(),
    isDeleted: isDeleted,
    isCSVImport: true
  };
  
  // DEBUG: Log final unified event
  logger.debug('Final unified event rsId:', unifiedEvent.internalData.rsId, '(type:', typeof unifiedEvent.internalData.rsId, ')');
  logger.debug('=== END CSV ROW DEBUG ===\n');
  
  return unifiedEvent;
}

/**
 * Validate CSV headers to ensure required columns are present
 * @param {Array<string>} headers - CSV headers
 * @returns {object} Validation result with isValid and missing fields
 */
function validateCSVHeaders(headers) {
  const requiredHeaders = ['Subject'];
  const recommendedHeaders = ['StartDate', 'EndDate', 'Location', 'Categories'];
  const optionalHeaders = ['SetupMinutes', 'TeardownMinutes', 'SetupTime', 'TeardownTime'];
  
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  const missingRecommended = recommendedHeaders.filter(header => !headers.includes(header));
  
  return {
    isValid: missing.length === 0,
    missing: missing,
    missingRecommended: missingRecommended,
    optional: optionalHeaders,
    headers: headers
  };
}

module.exports = {
  excelSerialToDate,
  excelTimeToHoursMinutes,
  excelToISODateTime,
  parseCSVBoolean,
  cleanCSVText,
  parseCSVCategories,
  csvRowToUnifiedEvent,
  validateCSVHeaders
};
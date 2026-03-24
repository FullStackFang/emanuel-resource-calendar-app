// src/components/EventSearchExport.jsx
import React, { useState } from 'react';
import { useNotification } from '../context/NotificationContext';
import { logger } from '../utils/logger';
import { generateCalendarPdf } from '../utils/calendarPdfGenerator';

const EventSearchExport = ({
  searchResults,
  searchTerm,
  categories = [],
  locations = [],
  apiToken = null,
  dateRange,
  apiBaseUrl = 'http://localhost:3001',
  graphToken,
  selectedCalendarId,
  calendarOwner = null,
  timezone = 'UTC',
  allCategoryOptions = [],
  allLocationOptions = []
}) => {
  const { showError } = useNotification();
  const [sortBy, setSortBy] = useState('date');
  const [exportState, setExportState] = useState({ phase: 'idle', message: '' });
  const isExporting = exportState.phase !== 'idle';
  const [showMaintenanceTimes, setShowMaintenanceTimes] = useState(false);
  const [showSecurityTimes, setShowSecurityTimes] = useState(false);
  
  // Function to fetch ALL events matching the search criteria from unified backend
  // Uses limit=0 to get all results (no pagination) for export
  const fetchAllMatchingEvents = async () => {
    try {
      // Normalize: all selected = no filter (avoids expensive $or queries on Cosmos DB)
      const effectiveCategories = categories.length >= allCategoryOptions.length && allCategoryOptions.length > 0
        ? [] : categories;
      const effectiveLocations = locations.length >= allLocationOptions.length && allLocationOptions.length > 0
        ? [] : locations;

      // Build query params for unified backend API
      const params = new URLSearchParams({
        limit: '0', // Backend caps to EXPORT_MAX_EVENTS (2000)
        status: 'active'
      });

      // Add search term if provided
      if (searchTerm) {
        params.append('search', searchTerm);
      }

      // Add calendar owner filter (email address)
      if (calendarOwner) {
        params.append('calendarOwner', calendarOwner);
      }

      // Add date range filters
      if (dateRange?.start) {
        params.append('startDate', dateRange.start);
      }
      if (dateRange?.end) {
        params.append('endDate', dateRange.end);
      }

      // Add category filters (with count for backend all-selected detection)
      if (effectiveCategories && effectiveCategories.length > 0) {
        params.append('categories', effectiveCategories.join(','));
        if (allCategoryOptions.length > 0) {
          params.append('categoryCount', allCategoryOptions.length.toString());
        }
      }

      // Add location filters (with count for backend all-selected detection)
      if (effectiveLocations && effectiveLocations.length > 0) {
        params.append('locations', effectiveLocations.join(','));
        if (allLocationOptions.length > 0) {
          params.append('locationCount', allLocationOptions.length.toString());
        }
      }

      logger.log('Export: Fetching all events from unified backend with params:', params.toString());

      const response = await fetch(
        `${apiBaseUrl}/events/list?view=admin-browse&${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      logger.log(`Export: Fetched ${data.events?.length || 0} events for export`);

      // Warn if export was capped
      if (data.exportCapped) {
        showError('Export limited to 2,000 events. Narrow your date range or filters for complete results.');
      }

      // Transform unified events to match expected format for export
      const events = (data.events || []).map(event => {
        return {
          id: event.eventId,
          subject: event.calendarData?.eventTitle || event.eventTitle || event.subject || event.graphData?.subject || 'Untitled',
          start: {
            dateTime: event.calendarData?.startDateTime || event.startDateTime || event.graphData?.start?.dateTime
          },
          end: {
            dateTime: event.calendarData?.endDateTime || event.endDateTime || event.graphData?.end?.dateTime
          },
          location: {
            displayName: event.calendarData?.locationDisplayNames || event.locationDisplayName || event.location || event.graphData?.location?.displayName || ''
          },
          categories: event.calendarData?.categories || event.categories || event.graphData?.categories || [],
          body: {
            content: event.calendarData?.eventDescription || event.eventDescription || event.graphData?.bodyPreview || ''
          },
          bodyPreview: event.calendarData?.eventDescription || event.eventDescription || event.graphData?.bodyPreview || '',
          attendees: event.graphData?.attendees || [],
          isAllDay: event.calendarData?.isAllDayEvent || event.isAllDayEvent || event.graphData?.isAllDay || false,
          importance: event.graphData?.importance || 'normal',
          showAs: event.graphData?.showAs || 'busy',
          recurrence: event.graphData?.recurrence || null,
          organizer: event.graphData?.organizer || null,
          webLink: event.graphData?.webLink || '',
          createdDateTime: event.graphData?.createdDateTime,
          lastModifiedDateTime: event.lastSyncedAt || event.graphData?.lastModifiedDateTime,
          // Maintenance times (setup/teardown)
          setupTime: event.calendarData?.setupTime || event.setupTime || '',
          teardownTime: event.calendarData?.teardownTime || event.teardownTime || '',
          reservationStartTime: event.calendarData?.reservationStartTime || event.reservationStartTime || '',
          reservationEndTime: event.calendarData?.reservationEndTime || event.reservationEndTime || '',
          // Security times (door open/close)
          doorOpenTime: event.calendarData?.doorOpenTime || event.doorOpenTime || '',
          doorCloseTime: event.calendarData?.doorCloseTime || event.doorCloseTime || '',
          // Internal notes
          setupNotes: event.calendarData?.setupNotes || event.roomReservationData?.internalNotes?.setupNotes || event.setupNotes || '',
          doorNotes: event.calendarData?.doorNotes || event.roomReservationData?.internalNotes?.doorNotes || event.doorNotes || ''
        };
      });

      // Sort results by start date (latest first)
      return events.sort((a, b) => {
        const aStartTime = new Date(a.start?.dateTime || 0);
        const bStartTime = new Date(b.start?.dateTime || 0);
        return bStartTime - aStartTime;
      });

    } catch (error) {
      console.error('Error fetching all matching events for export:', error);
      throw error;
    }
  };
  
  // Fetch internal events from MongoDB
  const fetchInternalEvents = async () => {
    try {
      // Format dates for API
      const startDate = dateRange?.start ? new Date(dateRange.start).toISOString() : new Date().toISOString();
      const endDate = dateRange?.end ? new Date(dateRange.end).toISOString() : new Date().toISOString();
      
      // Use the public endpoint - no authentication required
      const response = await fetch(`${apiBaseUrl}/public/internal-events?includeDeleted=false`);

      if (!response.ok) {
        throw new Error('Failed to fetch internal events');
      }

      const events = await response.json();
      
      // Filter by date range
      return events.filter(event => {
        const eventStart = new Date(event.externalData?.start?.dateTime);
        return eventStart >= new Date(startDate) && eventStart <= new Date(endDate);
      });
    } catch (error) {
      console.error('Error fetching internal events:', error);
      showError(error, { context: 'EventSearchExport.fetchAllMatchingEvents', userMessage: 'Failed to fetch internal events. Please try again.' });
      return null;
    }
  };

  // Helper function to format date in UTC for export consistency
  const formatDateForExport = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString(); // Always export in UTC
  };

  // Helper function to format date for display in export
  const formatDateForDisplay = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      timeZone: timezone, // Use display timezone
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Helper function to format time for display in export
  const formatTimeForDisplay = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone, // Use display timezone
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Export to JSON - always in UTC for consistency
  const handleExportJSON = async () => {
    setExportState({ phase: 'fetching', message: 'Fetching events...' });
    try {
      const allMatchingEvents = await fetchAllMatchingEvents();
      setExportState({ phase: 'building', message: 'Building JSON...' });

      // Create a formatted JSON object with UTC timestamps
      const exportData = {
        exportDate: new Date().toISOString(), // UTC timestamp
        exportTimezone: 'UTC', // Always export in UTC
        displayTimezone: timezone, // Record what timezone was used for display
        searchCriteria: {
          searchTerm: searchTerm || '',
          categories: categories || [],
          locations: locations || [],
          dateRange: {
            start: dateRange?.start,
            end: dateRange?.end
          }
        },
        totalEvents: allMatchingEvents.length,
        events: allMatchingEvents.map(event => ({
          id: event.id,
          subject: event.subject,
          startDateTime: formatDateForExport(event.start?.dateTime), // UTC format
          endDateTime: formatDateForExport(event.end?.dateTime), // UTC format
          location: event.location?.displayName || '',
          categories: event.categories || [],
          body: event.body?.content || '',
          attendees: event.attendees || [],
          isAllDay: event.isAllDay || false,
          importance: event.importance || 'normal',
          showAs: event.showAs || 'busy',
          recurrence: event.recurrence || null,
          organizer: event.organizer || null,
          webLink: event.webLink || '',
          createdDateTime: formatDateForExport(event.createdDateTime),
          lastModifiedDateTime: formatDateForExport(event.lastModifiedDateTime)
        }))
      };

      // Create and download JSON file
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `calendar-search-results-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting to JSON:', error);
      showError(error, { context: 'EventSearchExport.exportToJson', userMessage: 'Failed to export to JSON. Please try again.' });
    } finally {
      setExportState({ phase: 'idle', message: '' });
    }
  };

  // Export to CSV - display times in selected timezone, store metadata in UTC
  const handleExportCSV = async () => {
    setExportState({ phase: 'fetching', message: 'Fetching events...' });
    try {
      const allMatchingEvents = await fetchAllMatchingEvents();
      setExportState({ phase: 'building', message: 'Building CSV...' });

      // Define CSV headers
      const headers = [
        'Event ID',
        'Subject',
        'Start Date',
        'Start Time',
        'End Date',
        'End Time',
        'Start DateTime (UTC)', // Add UTC columns for reference
        'End DateTime (UTC)',
        'Location',
        'Categories',
        'All Day',
        'Importance',
        'Show As',
        'Organizer',
        'Attendee Count',
        'Body Preview',
        'Created Date',
        'Last Modified'
      ];

      // Convert events to CSV rows
      const rows = allMatchingEvents.map(event => {
        const startDateTime = event.start?.dateTime;
        const endDateTime = event.end?.dateTime;
        
        return [
          event.id || '',
          event.subject || '',
          formatDateForDisplay(startDateTime), // Display timezone
          formatTimeForDisplay(startDateTime), // Display timezone
          formatDateForDisplay(endDateTime), // Display timezone
          formatTimeForDisplay(endDateTime), // Display timezone
          formatDateForExport(startDateTime), // UTC for reference
          formatDateForExport(endDateTime), // UTC for reference
          event.location?.displayName || '',
          (event.categories || []).join('; '),
          event.isAllDay ? 'Yes' : 'No',
          event.importance || 'normal',
          event.showAs || 'busy',
          event.organizer?.emailAddress?.name || '',
          (event.attendees || []).length,
          (event.body?.content || '').replace(/[\n\r]/g, ' ').substring(0, 100), // Remove line breaks and limit length
          formatDateForDisplay(event.createdDateTime),
          formatDateForDisplay(event.lastModifiedDateTime)
        ];
      });

      // Create header comment with timezone info
      const headerComment = `# Calendar Export - Display Timezone: ${timezone}, Data stored in UTC\n# Export Date: ${new Date().toISOString()}\n`;

      // Combine headers and rows
      const csvContent = headerComment + [
        headers,
        ...rows
      ].map(row => 
        row.map(cell => {
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const cellStr = String(cell);
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        }).join(',')
      ).join('\n');

      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `calendar-search-results-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      showError(error, { context: 'EventSearchExport.exportToCsv', userMessage: 'Failed to export to CSV. Please try again.' });
    } finally {
      setExportState({ phase: 'idle', message: '' });
    }
  };

  const handleExport = async () => {
    setExportState({ phase: 'fetching', message: 'Fetching events...' });
    try {
      const allMatchingEvents = await fetchAllMatchingEvents();
      setExportState({ phase: 'building', message: 'Building PDF...' });
      logger.log(`PDF Export: Fetched ${allMatchingEvents.length} events for export`);

      const { blobUrl, fileName } = generateCalendarPdf({
        events: allMatchingEvents,
        sortBy,
        showMaintenanceTimes,
        showSecurityTimes,
        timezone,
        searchCriteria: { searchTerm, categories, locations }
      });

      // Auto-download the PDF
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Error generating PDF:', error);
      showError(error, { context: 'EventSearchExport.exportToPdf', userMessage: 'There was an error generating the PDF. Please try again.' });
    } finally {
      setExportState({ phase: 'idle', message: '' });
    }
  };

  return (
    <div className="export-toolbar">
      {/* Sort control */}
      <div className="export-sort-group">
        <svg className="export-sort-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 3.5h10M2 7h7M2 10.5h4" />
        </svg>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="export-sort-select"
        >
          <option value="date">Date</option>
          <option value="category">Category</option>
          <option value="location">Location</option>
        </select>
      </div>

      {/* Divider */}
      <span className="export-divider" />

      {/* Include toggles */}
      <div className="export-toggles">
        <button
          onClick={() => setShowMaintenanceTimes(!showMaintenanceTimes)}
          className={`export-chip ${showMaintenanceTimes ? 'active maintenance' : ''}`}
          title="Include setup/teardown times in export"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 1.5l3 3-8 8H.5v-3z" />
          </svg>
          Maintenance
        </button>

        <button
          onClick={() => setShowSecurityTimes(!showSecurityTimes)}
          className={`export-chip ${showSecurityTimes ? 'active security' : ''}`}
          title="Include door open/close times in export"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="9" height="6" rx="1" />
            <path d="M4 6V4a2.5 2.5 0 015 0v2" />
          </svg>
          Security
        </button>
      </div>

      {/* Divider */}
      <span className="export-divider" />

      {/* Export format button group */}
      <div className="export-btn-group">
        <button onClick={handleExport} disabled={isExporting} className="export-fmt-btn pdf">
          {isExporting ? (
            <span className="btn-spinner" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 1H3.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V4L8.5 1z" />
              <path d="M8.5 1v3h3" />
            </svg>
          )}
          PDF
        </button>
        <button onClick={handleExportJSON} disabled={isExporting} className="export-fmt-btn json">
          {isExporting ? (
            <span className="btn-spinner" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2C3 2 2 2.5 2 4v1.5C2 6.5 1 7 1 7s1 .5 1 1.5V10c0 1.5 1 2 2 2" />
              <path d="M10 2c1 0 2 .5 2 2v1.5C12 6.5 13 7 13 7s-1 .5-1 1.5V10c0 1.5-1 2-2 2" />
            </svg>
          )}
          JSON
        </button>
        <button onClick={handleExportCSV} disabled={isExporting} className="export-fmt-btn csv">
          {isExporting ? (
            <span className="btn-spinner" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="1.5" width="11" height="11" rx="1" />
              <line x1="1.5" y1="5" x2="12.5" y2="5" />
              <line x1="1.5" y1="8.5" x2="12.5" y2="8.5" />
              <line x1="5" y1="1.5" x2="5" y2="12.5" />
              <line x1="9" y1="1.5" x2="9" y2="12.5" />
            </svg>
          )}
          CSV
        </button>
      </div>
    </div>
  );
};

export default EventSearchExport;
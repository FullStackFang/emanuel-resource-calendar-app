// src/components/EventSearchExport.jsx
import React, { useState } from 'react';
import { useNotification } from '../context/NotificationContext';
import { jsPDF } from 'jspdf';

const EventSearchExport = ({
  searchResults,
  searchTerm,
  categories = [],
  locations = [],
  apiToken = null,
  dateRange,
  apiBaseUrl = 'http://localhost:3001',
  graphToken, // Add this prop to access the Microsoft Graph token
  selectedCalendarId, // Add this prop to know which calendar to search
  calendarOwner = null, // Calendar owner email for unified backend filtering
  timezone = 'UTC' // Display timezone passed from parent
}) => {
  const { showError } = useNotification();
  const [sortBy, setSortBy] = useState('date'); // Default sort by date
  const [isExporting, setIsExporting] = useState(false);
  const [showMaintenanceTimes, setShowMaintenanceTimes] = useState(false); // Setup/Teardown times
  const [showSecurityTimes, setShowSecurityTimes] = useState(false); // Door Open/Close times
  
  // Function to fetch ALL events matching the search criteria from unified backend
  // Uses limit=0 to get all results (no pagination) for export
  const fetchAllMatchingEvents = async () => {
    try {
      // Build query params for unified backend API
      const params = new URLSearchParams({
        limit: '0', // No limit - get all matching results for export
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

      // Add category filters
      if (categories && categories.length > 0) {
        params.append('categories', categories.join(','));
      }

      // Add location filters
      if (locations && locations.length > 0) {
        params.append('locations', locations.join(','));
      }

      console.log('Export: Fetching all events from unified backend with params:', params.toString());

      const response = await fetch(
        `${apiBaseUrl}/admin/unified/events?${params.toString()}`,
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
      console.log(`Export: Fetched ${data.events?.length || 0} events for export`);

      // Transform unified events to match expected format for export
      const events = (data.events || []).map(event => {
        // Extract timing data from multiple possible sources
        const timingSource = event.roomReservationData?.timing || event.internalData || {};

        return {
          id: event.eventId,
          subject: event.eventTitle || event.subject || event.graphData?.subject || 'Untitled',
          start: {
            dateTime: event.startDateTime || event.graphData?.start?.dateTime
          },
          end: {
            dateTime: event.endDateTime || event.graphData?.end?.dateTime
          },
          location: {
            displayName: event.locationDisplayName || event.location || event.graphData?.location?.displayName || ''
          },
          categories: event.categories || event.graphData?.categories || [],
          body: {
            content: event.eventDescription || event.graphData?.bodyPreview || ''
          },
          bodyPreview: event.eventDescription || event.graphData?.bodyPreview || '',
          attendees: event.graphData?.attendees || [],
          isAllDay: event.isAllDayEvent || event.graphData?.isAllDay || false,
          importance: event.graphData?.importance || 'normal',
          showAs: event.graphData?.showAs || 'busy',
          recurrence: event.graphData?.recurrence || null,
          organizer: event.graphData?.organizer || null,
          webLink: event.graphData?.webLink || '',
          createdDateTime: event.graphData?.createdDateTime,
          lastModifiedDateTime: event.lastSyncedAt || event.graphData?.lastModifiedDateTime,
          // Maintenance times (setup/teardown)
          setupTime: event.setupTime || timingSource.setupTime || '',
          teardownTime: event.teardownTime || timingSource.teardownTime || '',
          // Security times (door open/close)
          doorOpenTime: event.doorOpenTime || timingSource.doorOpenTime || '',
          doorCloseTime: event.doorCloseTime || timingSource.doorCloseTime || ''
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
    setIsExporting(true);
    try {
      // Fetch ALL matching events from Microsoft Graph instead of just paginated results
      const allMatchingEvents = await fetchAllMatchingEvents();

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
      setIsExporting(false);
    }
  };

  // Export to CSV - display times in selected timezone, store metadata in UTC
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      // Fetch ALL matching events from Microsoft Graph instead of just paginated results
      const allMatchingEvents = await fetchAllMatchingEvents();

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
      setIsExporting(false);
    }
  };
  
  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Fetch ALL matching events (not just the loaded batch of 100)
      const allMatchingEvents = await fetchAllMatchingEvents();
      console.log(`PDF Export: Fetched ${allMatchingEvents.length} events for export`);
      // Create new PDF document
      const doc = new jsPDF();

      // ========================================
      // DESIGN SYSTEM: Institutional Elegance
      // ========================================
      // Color palette
      const colors = {
        primary: [45, 52, 64],        // Deep charcoal
        secondary: [107, 114, 128],   // Warm gray
        accent: [180, 142, 73],       // Antique gold
        light: [249, 250, 251],       // Off-white
        border: [229, 231, 235],      // Light border
        muted: [156, 163, 175],       // Muted text
        success: [34, 87, 75],        // Deep teal for security
        warning: [120, 90, 60],       // Bronze for maintenance
      };

      // Typography sizes
      const fontSize = {
        title: 18,
        subtitle: 11,
        sectionHeader: 10,
        body: 8.5,
        small: 7.5,
        tiny: 6.5,
      };

      // Spacing
      const spacing = {
        margin: 15,
        gutter: 8,
        lineHeight: 4.5,
      };

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const contentWidth = pageWidth - (spacing.margin * 2);

      // Set document properties
      doc.setProperties({
        title: 'Calendar Search Results - Congregation Emanu-El',
        subject: 'Calendar Search Export',
        author: 'Congregation Emanu-El of the City of New York'
      });

      // Format date for display using selected timezone
      const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      };

      // Format date compact (for table)
      const formatDateCompact = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
          timeZone: timezone,
          month: 'numeric',
          day: 'numeric'
        });
      };

      // Format time for display using selected timezone
      const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }).replace(' ', '');
      };

      const currentDate = new Date();

      // ========================================
      // HEADER DESIGN
      // ========================================
      const drawHeader = () => {
        let y = spacing.margin;

        // Top accent line
        doc.setDrawColor(...colors.accent);
        doc.setLineWidth(2);
        doc.line(spacing.margin, y, pageWidth - spacing.margin, y);
        y += 8;

        // Institution name
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize.title);
        doc.setTextColor(...colors.primary);
        doc.text('CONGREGATION EMANU-EL', pageWidth / 2, y, { align: 'center' });
        y += 6;

        // Subtitle
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSize.subtitle);
        doc.setTextColor(...colors.secondary);
        doc.text('Calendar Events Report', pageWidth / 2, y, { align: 'center' });
        y += 8;

        // Thin separator
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.3);
        doc.line(spacing.margin + 40, y, pageWidth - spacing.margin - 40, y);
        y += 6;

        // Meta info row
        doc.setFontSize(fontSize.small);
        doc.setTextColor(...colors.muted);
        const metaLeft = `Generated ${formatDate(currentDate.toISOString())}`;
        const metaRight = `Timezone: ${timezone.replace('_', ' ')}`;
        doc.text(metaLeft, spacing.margin, y);
        doc.text(metaRight, pageWidth - spacing.margin, y, { align: 'right' });
        y += 10;

        return y;
      };

      // ========================================
      // SEARCH CRITERIA BOX (First page only)
      // ========================================
      const drawSearchCriteria = (startY) => {
        let y = startY;

        // Build criteria items
        const criteria = [];
        if (searchTerm) criteria.push({ label: 'Search', value: searchTerm });
        if (categories?.length > 0) criteria.push({ label: 'Categories', value: categories.join(', ') });
        if (locations?.length > 0) criteria.push({ label: 'Locations', value: locations.join(', ') });
        criteria.push({ label: 'Sort', value: sortBy.charAt(0).toUpperCase() + sortBy.slice(1) });
        if (showMaintenanceTimes) criteria.push({ label: 'Options', value: 'Maintenance Times' });
        if (showSecurityTimes) criteria.push({ label: 'Options', value: 'Security Times' });

        // Only draw if there are criteria
        if (criteria.length > 0) {
          // Light background box
          const boxHeight = Math.ceil(criteria.length / 2) * 5 + 12;
          doc.setFillColor(...colors.light);
          doc.setDrawColor(...colors.border);
          doc.setLineWidth(0.3);
          doc.roundedRect(spacing.margin, y, contentWidth, boxHeight, 2, 2, 'FD');
          y += 6;

          // Section title
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(fontSize.small);
          doc.setTextColor(...colors.primary);
          doc.text('SEARCH CRITERIA', spacing.margin + 4, y);
          y += 5;

          // Criteria items in two columns
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(fontSize.tiny);
          const colWidth = contentWidth / 2 - 8;
          let col = 0;
          let rowY = y;

          criteria.forEach((item) => {
            const x = spacing.margin + 4 + (col * (colWidth + 8));
            doc.setTextColor(...colors.muted);
            doc.text(`${item.label}:`, x, rowY);
            doc.setTextColor(...colors.primary);
            const valueText = doc.splitTextToSize(item.value, colWidth - 25);
            doc.text(valueText[0], x + 22, rowY);

            col++;
            if (col > 1) {
              col = 0;
              rowY += 4;
            }
          });

          y = startY + boxHeight + 6;
        }

        return y;
      };

      // ========================================
      // TABLE DESIGN
      // ========================================
      const hasExtraTimes = showMaintenanceTimes || showSecurityTimes;

      // Column configuration with proportional widths
      const colConfig = [
        { name: 'DATE', width: 0.11 },
        { name: 'DAY', width: 0.06 },
        { name: 'TIME', width: hasExtraTimes ? 0.14 : 0.11 },
        { name: 'LOCATION', width: 0.17 },
        { name: 'CATEGORY', width: 0.14 },
        { name: 'EVENT', width: hasExtraTimes ? 0.38 : 0.41 },
      ];

      // Calculate actual column positions
      const colPositions = [];
      const colWidths = [];
      let currentX = spacing.margin;
      colConfig.forEach(col => {
        colPositions.push(currentX);
        const width = col.width * contentWidth;
        colWidths.push(width);
        currentX += width;
      });

      // Draw table header
      const drawTableHeader = (y) => {
        // Header background
        doc.setFillColor(...colors.primary);
        doc.rect(spacing.margin, y - 4, contentWidth, 7, 'F');

        // Header text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(255, 255, 255);

        colConfig.forEach((col, idx) => {
          doc.text(col.name, colPositions[idx] + 2, y);
        });

        return y + 6;
      };

      // Draw date separator
      const drawDateSeparator = (y, dateStr, dayOfWeek) => {
        // Date pill background
        const pillWidth = 50;
        doc.setFillColor(...colors.accent);
        doc.roundedRect(spacing.margin, y - 3, pillWidth, 5, 1, 1, 'F');

        // Date text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(255, 255, 255);
        doc.text(`${dayOfWeek}, ${dateStr}`, spacing.margin + 2, y);

        // Line extending from pill
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.3);
        doc.line(spacing.margin + pillWidth + 2, y - 0.5, pageWidth - spacing.margin, y - 0.5);

        return y + 5;
      };

      // ========================================
      // FOOTER DESIGN
      // ========================================
      const drawFooter = (pageNum, totalPages) => {
        const y = pageHeight - 10;

        // Bottom accent line
        doc.setDrawColor(...colors.accent);
        doc.setLineWidth(0.5);
        doc.line(spacing.margin, y - 4, pageWidth - spacing.margin, y - 4);

        // Footer text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSize.tiny);
        doc.setTextColor(...colors.muted);
        doc.text('Congregation Emanu-El of the City of New York', spacing.margin, y);
        doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - spacing.margin, y, { align: 'right' });
      };

      // ========================================
      // BUILD DOCUMENT
      // ========================================

      // First page header
      let y = drawHeader(true);
      y = drawSearchCriteria(y);
      y = drawTableHeader(y);

      // Sort events
      const sortedEvents = [...allMatchingEvents].sort((a, b) => {
        if (sortBy === 'date') {
          return new Date(a.start.dateTime) - new Date(b.start.dateTime);
        } else if (sortBy === 'category') {
          const catA = a.categories?.[0]?.toLowerCase() || 'zzz';
          const catB = b.categories?.[0]?.toLowerCase() || 'zzz';
          if (catA === catB) return new Date(a.start.dateTime) - new Date(b.start.dateTime);
          return catA.localeCompare(catB);
        } else if (sortBy === 'location') {
          const locA = a.location?.displayName?.toLowerCase() || 'zzz';
          const locB = b.location?.displayName?.toLowerCase() || 'zzz';
          if (locA === locB) return new Date(a.start.dateTime) - new Date(b.start.dateTime);
          return locA.localeCompare(locB);
        }
        return 0;
      });

      // Group tracking
      let currentGroup = '';
      let previousDateStr = '';

      // Helper to format time strings
      const formatTimeString = (timeStr) => {
        if (!timeStr) return null;
        try {
          if (timeStr.includes(':') && !timeStr.includes('T')) {
            const [hours, minutes] = timeStr.split(':');
            const h = parseInt(hours);
            const ampm = h >= 12 ? 'p' : 'a';
            const h12 = h % 12 || 12;
            return `${h12}:${minutes}${ampm}`;
          }
          return timeStr;
        } catch {
          return null;
        }
      };

      // Draw events
      for (let i = 0; i < sortedEvents.length; i++) {
        const event = sortedEvents[i];
        const startDate = new Date(event.start.dateTime);
        const dateStr = formatDateCompact(event.start.dateTime);
        const fullDateStr = formatDate(event.start.dateTime);
        const dayOfWeek = startDate.toLocaleDateString('en-US', {
          timeZone: timezone,
          weekday: 'short'
        });

        // Calculate row height
        let rowHeight = 8;
        const eventTitle = event.subject || 'Untitled Event';
        const wrappedTitle = doc.splitTextToSize(eventTitle, colWidths[5] - 4);
        rowHeight = Math.max(rowHeight, wrappedTitle.length * 3.5 + 4);

        // Add extra height for stacked times
        if (showMaintenanceTimes || showSecurityTimes) {
          let extraLines = 0;
          if (showMaintenanceTimes && (event.setupTime || event.teardownTime)) extraLines++;
          if (showSecurityTimes && (event.doorOpenTime || event.doorCloseTime)) extraLines++;
          rowHeight = Math.max(rowHeight, 8 + extraLines * 3.5);
        }

        // Check for new page
        if (y + rowHeight > pageHeight - 20) {
          doc.addPage();
          y = drawHeader(false);
          y = drawTableHeader(y);
        }

        // Date separator (when date changes)
        if (sortBy === 'date' && dateStr !== previousDateStr) {
          if (previousDateStr !== '') {
            y += 3;
          }
          y = drawDateSeparator(y, fullDateStr, dayOfWeek);
        }
        previousDateStr = dateStr;

        // Category/Location group headers
        if (sortBy === 'category') {
          const category = event.categories?.[0] || 'Uncategorized';
          if (category !== currentGroup) {
            currentGroup = category;
            y += 4;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fontSize.small);
            doc.setTextColor(...colors.accent);
            doc.text(category.toUpperCase(), spacing.margin, y);
            y += 5;
          }
        } else if (sortBy === 'location') {
          const location = event.location?.displayName || 'Unspecified';
          if (location !== currentGroup) {
            currentGroup = location;
            y += 4;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fontSize.small);
            doc.setTextColor(...colors.accent);
            const wrappedLoc = doc.splitTextToSize(location, contentWidth - 10);
            doc.text(wrappedLoc[0], spacing.margin, y);
            y += 5;
          }
        }

        // Alternating row background
        if (i % 2 === 0) {
          doc.setFillColor(252, 252, 253);
          doc.rect(spacing.margin, y - 3, contentWidth, rowHeight, 'F');
        }

        // Row content
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSize.small);
        doc.setTextColor(...colors.primary);

        // Date column (only show if not using date separators or different from header)
        if (sortBy !== 'date') {
          doc.text(dateStr, colPositions[0] + 2, y);
        }

        // Day column
        doc.setTextColor(...colors.secondary);
        doc.text(dayOfWeek, colPositions[1] + 2, y);

        // Time column with stacked extras
        doc.setTextColor(...colors.primary);
        const timeStr = `${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}`;
        doc.text(timeStr, colPositions[2] + 2, y);

        let timeY = y + 3.5;
        if (showMaintenanceTimes) {
          const setupStr = formatTimeString(event.setupTime);
          const teardownStr = formatTimeString(event.teardownTime);
          if (setupStr || teardownStr) {
            doc.setFontSize(fontSize.tiny);
            doc.setTextColor(...colors.warning);
            const maintStr = setupStr && teardownStr
              ? `Setup ${setupStr} / TD ${teardownStr}`
              : setupStr ? `Setup ${setupStr}` : `TD ${teardownStr}`;
            doc.text(maintStr, colPositions[2] + 2, timeY);
            timeY += 3;
          }
        }
        if (showSecurityTimes) {
          const doorOpenStr = formatTimeString(event.doorOpenTime);
          const doorCloseStr = formatTimeString(event.doorCloseTime);
          if (doorOpenStr || doorCloseStr) {
            doc.setFontSize(fontSize.tiny);
            doc.setTextColor(...colors.success);
            const secStr = doorOpenStr && doorCloseStr
              ? `Doors ${doorOpenStr} - ${doorCloseStr}`
              : doorOpenStr ? `Open ${doorOpenStr}` : `Close ${doorCloseStr}`;
            doc.text(secStr, colPositions[2] + 2, timeY);
          }
        }

        // Location column
        doc.setFontSize(fontSize.small);
        doc.setTextColor(...colors.secondary);
        const locationText = event.location?.displayName || '—';
        const wrappedLocation = doc.splitTextToSize(locationText, colWidths[3] - 4);
        doc.text(wrappedLocation, colPositions[3] + 2, y);

        // Category column
        const categoryText = event.categories?.[0] || '—';
        const wrappedCategory = doc.splitTextToSize(categoryText, colWidths[4] - 4);
        doc.text(wrappedCategory, colPositions[4] + 2, y);

        // Event column
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize.small);
        doc.setTextColor(...colors.primary);
        doc.text(wrappedTitle, colPositions[5] + 2, y);

        // Description preview
        const bodyText = event.bodyPreview || event.body?.content || '';
        if (bodyText.trim()) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(fontSize.tiny);
          doc.setTextColor(...colors.muted);
          const wrappedBody = doc.splitTextToSize(bodyText, colWidths[5] - 4);
          const bodyY = y + wrappedTitle.length * 3.5;
          if (wrappedBody[0]) {
            doc.text(wrappedBody[0] + (wrappedBody.length > 1 ? '...' : ''), colPositions[5] + 2, bodyY);
          }
        }

        y += rowHeight;

        // Light separator line
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.1);
        doc.line(spacing.margin, y - 1, pageWidth - spacing.margin, y - 1);
      }

      // Total results
      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize.body);
      doc.setTextColor(...colors.primary);
      doc.text(`Total: ${sortedEvents.length} events`, pageWidth / 2, y, { align: 'center' });

      // Add footers to all pages
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        drawFooter(i, totalPages);
      }

      // Save the PDF
      const fileName = `emanu-el-calendar-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      showError(error, { context: 'EventSearchExport.exportToPdf', userMessage: 'There was an error generating the PDF. Please try again.' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="export-container" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '10px',
      flexWrap: 'wrap'
    }}>
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: '4px',
          border: '1px solid #ccc',
          fontSize: '0.9rem'
        }}
      >
        <option value="date">Sort by Date</option>
        <option value="category">Sort by Category</option>
        <option value="location">Sort by Location</option>
      </select>

      <button
        onClick={() => setShowMaintenanceTimes(!showMaintenanceTimes)}
        style={{
          padding: '6px 12px',
          backgroundColor: showMaintenanceTimes ? '#6c5ce7' : '#f8f9fa',
          color: showMaintenanceTimes ? '#fff' : '#333',
          border: showMaintenanceTimes ? '1px solid #6c5ce7' : '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s ease'
        }}
        title="Toggle setup/teardown times in PDF export"
      >
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '16px',
          height: '16px',
          border: showMaintenanceTimes ? '2px solid #fff' : '2px solid #999',
          borderRadius: '3px',
          backgroundColor: showMaintenanceTimes ? '#6c5ce7' : '#fff',
          fontSize: '11px',
          fontWeight: 'bold'
        }}>
          {showMaintenanceTimes ? '✓' : ''}
        </span>
        Maintenance Times
      </button>

      <button
        onClick={() => setShowSecurityTimes(!showSecurityTimes)}
        style={{
          padding: '6px 12px',
          backgroundColor: showSecurityTimes ? '#00b894' : '#f8f9fa',
          color: showSecurityTimes ? '#fff' : '#333',
          border: showSecurityTimes ? '1px solid #00b894' : '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s ease'
        }}
        title="Toggle door open/close times in PDF export"
      >
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '16px',
          height: '16px',
          border: showSecurityTimes ? '2px solid #fff' : '2px solid #999',
          borderRadius: '3px',
          backgroundColor: showSecurityTimes ? '#00b894' : '#fff',
          fontSize: '11px',
          fontWeight: 'bold'
        }}>
          {showSecurityTimes ? '✓' : ''}
        </span>
        Security Times
      </button>

      <button
        onClick={handleExport}
        disabled={isExporting}
        className='export-search-pdf-button'
        style={{
          padding: '6px 12px',
          backgroundColor: isExporting ? '#cccccc' : '#0078d4',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span role="img" aria-label="export">📄</span>
        {isExporting ? 'Exporting...' : 'Export Results to PDF'}
      </button>

      <button
        onClick={handleExportJSON}
        disabled={isExporting}
        style={{
          padding: '6px 12px',
          backgroundColor: isExporting ? '#cccccc' : '#28a745',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span role="img" aria-label="json">📋</span> 
        {isExporting ? 'Exporting...' : 'Export to JSON'}
      </button>

      <button
        onClick={handleExportCSV}
        disabled={isExporting}
        style={{
          padding: '6px 12px',
          backgroundColor: isExporting ? '#cccccc' : '#17a2b8',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span role="img" aria-label="csv">📊</span> 
        {isExporting ? 'Exporting...' : 'Export to CSV'}
      </button>
      
      {/* Timezone info for user reference 
      <div style={{
        fontSize: '0.8rem',
        color: '#666',
        fontStyle: 'italic'
      }}>
        Display: {timezone} | Export: UTC
      </div>
      */}
    </div>
  );
};

export default EventSearchExport;
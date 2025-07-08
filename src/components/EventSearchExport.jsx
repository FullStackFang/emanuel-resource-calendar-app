// src/components/EventSearchExport.jsx
import React, { useState } from 'react';
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
  timezone = 'UTC' // Display timezone passed from parent
}) => {
  const [sortBy, setSortBy] = useState('date'); // Default sort by date
  const [isExporting, setIsExporting] = useState(false);
  
  // Function to fetch ALL events matching the search criteria (not paginated)
  const fetchAllMatchingEvents = async () => {
    try {
      let allEvents = [];
      let nextLink = null;
      let baseUrl;
      
      if (selectedCalendarId) {
        baseUrl = `https://graph.microsoft.com/v1.0/me/calendars/${selectedCalendarId}/events`;
      } else {
        baseUrl = 'https://graph.microsoft.com/v1.0/me/events';
      }

      // Build the initial URL with search filters
      let url = `${baseUrl}?$top=250&$orderby=start/dateTime desc&$count=true`;
      let filters = [];
      
      // Add simple subject search if provided
      if (searchTerm) {
        filters.push(`contains(subject,'${searchTerm.replace(/'/g, "''")}')`);
      }
      
      // Add date filters if provided
      if (dateRange.start) {
        const startDate = new Date(dateRange.start).toISOString();
        filters.push(`start/dateTime ge '${startDate}'`);
      }
      
      if (dateRange.end) {
        const endDate = new Date(dateRange.end).toISOString();
        filters.push(`end/dateTime le '${endDate}'`);
      }
      
      // Add filters to the URL
      if (filters.length > 0) {
        url += `&$filter=${encodeURIComponent(filters.join(' and '))}`;
      }

      // Keep fetching until we have all events
      do {
        const headers = {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'outlook.timezone="UTC"' // Always fetch in UTC for consistency
        };
        
        if (!nextLink) {
          headers['ConsistencyLevel'] = 'eventual';
        }
        
        const response = await fetch(nextLink || url, { headers });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
        }
        
        const data = await response.json();
        let results = data.value || [];
        
        // Apply client-side filtering for categories and locations
        if (categories && categories.length > 0) {
          results = results.filter(event => {
            // Handle "Uncategorized" special case
            if (categories.includes('Uncategorized')) {
              if (!event.categories || event.categories.length === 0) {
                return true;
              }
            }
            
            // Check if any of the event's categories match our filter
            return event.categories && 
                   event.categories.some(cat => categories.includes(cat));
          });
        }
        
        // Filter by locations client-side
        if (locations && locations.length > 0) {
          results = results.filter(event => {
            const eventLocation = event.location?.displayName || '';
            
            // Check if any of our location filters match
            return locations.some(loc => eventLocation.includes(loc));
          });
        }
        
        allEvents = [...allEvents, ...results];
        nextLink = data['@odata.nextLink'] || null;
        
      } while (nextLink);
      
      // Sort results by start date (latest first)
      return allEvents.sort((a, b) => {
        const aStartTime = new Date(a.start.dateTime);
        const bStartTime = new Date(b.start.dateTime);
        return bStartTime - aStartTime;
      });
      
    } catch (error) {
      console.error('Error fetching all matching events:', error);
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
      alert('Failed to fetch internal events. Please try again.');
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
      alert('Failed to export to JSON. Please try again.');
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
      alert('Failed to export to CSV. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleExport = () => {
    try {
      // Create new PDF document
      const doc = new jsPDF();
      
      // Set document properties
      doc.setProperties({
        title: 'Calendar Search Results',
        subject: 'Calendar Search Export',
        author: 'Microsoft Outlook'
      });
      
      // Format date for display using selected timezone
      const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
          timeZone: timezone,
          month: 'numeric', 
          day: 'numeric', 
          year: 'numeric'
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
        });
      };
      
      // Add header
      doc.setFontSize(16);
      doc.text('Congregation Emanu-El of the City of New York', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
      doc.setFontSize(14);
      doc.text('Calendar Search Results', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
      
      // Add search info with timezone information
      doc.setFontSize(10);
      const currentDate = new Date();
      doc.text(`Search performed: ${formatDate(currentDate.toISOString())}`, 20, 35);
      doc.text(`Times displayed in: ${timezone}`, 20, 42);
      
      // Add search criteria - ONLY ON FIRST PAGE
      let searchCriteriaY = 52;
      doc.setFont('helvetica', 'bold');
      doc.text("Search Criteria:", 20, searchCriteriaY);
      doc.setFont('helvetica', 'normal');
      
      searchCriteriaY += 7;
      if (searchTerm) {
        doc.text(`Search Term: ${searchTerm}`, 25, searchCriteriaY);
        searchCriteriaY += 7;
      }
      
      if (categories && categories.length > 0) {
        doc.text(`Categories: ${categories.join(', ')}`, 25, searchCriteriaY);
        searchCriteriaY += 7;
      }
      
      if (locations && locations.length > 0) {
        doc.text(`Locations: ${locations.join(', ')}`, 25, searchCriteriaY);
        searchCriteriaY += 7;
      }
      
      // Add sort information
      doc.text(`Sorted by: ${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}`, 25, searchCriteriaY);
      searchCriteriaY += 7;
      
      doc.setDrawColor(0);
      doc.line(20, searchCriteriaY, 190, searchCriteriaY);
      searchCriteriaY += 10;
      
      // Define column widths and positions (now including Category column)
      const startY = searchCriteriaY;
      // Updated column widths to include Category column
      const colWidths = [25, 20, 30, 25, 20, 20, 50];
      const colPositions = [];
      let currentX = 10;
      
      for (let width of colWidths) {
        colPositions.push(currentX);
        currentX += width;
      }
      
      // Function to add column headers to any page
      const addColumnHeaders = (yPosition) => {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Date', colPositions[0], yPosition);
        doc.text('Day', colPositions[1], yPosition);
        doc.text('Location', colPositions[2], yPosition);
        doc.text('Category', colPositions[3], yPosition); // Added Category column
        doc.text('Start', colPositions[4], yPosition);
        doc.text('End', colPositions[5], yPosition);
        doc.text('Event', colPositions[6], yPosition);
        
        // Draw line under header
        doc.setDrawColor(0);
        doc.line(10, yPosition + 2, 200, yPosition + 2);
        
        doc.setFont('helvetica', 'normal');
        return yPosition + 10;
      };
      
      // Add header row to first page
      let y = addColumnHeaders(startY);
      
      // Sort events based on the selected sort option
      const sortedEvents = [...searchResults].sort((a, b) => {
        if (sortBy === 'date') {
          // Sort by date ascending (oldest to newest)
          return new Date(a.start.dateTime) - new Date(b.start.dateTime);
        } else if (sortBy === 'category') {
          // Sort by category
          const catA = a.categories && a.categories.length > 0 ? a.categories[0].toLowerCase() : 'uncategorized';
          const catB = b.categories && b.categories.length > 0 ? b.categories[0].toLowerCase() : 'uncategorized';
          
          if (catA === catB) {
            // If categories are the same, sort by date
            return new Date(a.start.dateTime) - new Date(b.start.dateTime);
          }
          return catA.localeCompare(catB);
        } else if (sortBy === 'location') {
          // Sort by location
          const locA = a.location?.displayName?.toLowerCase() || 'unspecified';
          const locB = b.location?.displayName?.toLowerCase() || 'unspecified';
          
          if (locA === locB) {
            // If locations are the same, sort by date
            return new Date(a.start.dateTime) - new Date(b.start.dateTime);
          }
          return locA.localeCompare(locB);
        }
        return 0;
      });
      
      // Group events by category or location if sorting by those fields
      let currentGroup = '';
      let isFirstInGroup = true;
      let previousDateStr = ''; // Track previous date for adding separators
      
      // Draw events
      for (let i = 0; i < sortedEvents.length; i++) {
        const event = sortedEvents[i];
        const startDate = new Date(event.start.dateTime);
        const dateStr = formatDate(event.start.dateTime);
        const dayOfWeek = startDate.toLocaleDateString('en-US', { 
          timeZone: timezone,
          weekday: 'short' 
        });
        
        // Add separator line when date changes (for date sorting)
        if (sortBy === 'date' && previousDateStr && dateStr !== previousDateStr) {
          // Add a black separator line between different days
          doc.setDrawColor(0, 0, 0); // Black color
          doc.setLineWidth(0.5); // Slightly thicker line
          doc.line(10, y - 5, 200, y - 5);
          doc.setLineWidth(0.2); // Reset line width
          doc.setDrawColor(200, 200, 200); // Reset to light gray for normal row lines
          y += 10; // Add some extra space after the separator
        }
        previousDateStr = dateStr;
        
        // Check if we're starting a new group (for category or location sort)
        if (sortBy === 'category') {
          const category = event.categories && event.categories.length > 0 ? event.categories[0] : 'Uncategorized';
          if (category !== currentGroup) {
            currentGroup = category;
            isFirstInGroup = true;
          }
        } else if (sortBy === 'location') {
          const location = event.location?.displayName || 'Unspecified';
          if (location !== currentGroup) {
            currentGroup = location;
            isFirstInGroup = true;
          }
        }
        
        // Dynamically adjust font size for category/location headers based on length
        if ((sortBy === 'category' || sortBy === 'location') && isFirstInGroup) {
          // Check if we need a new page for the group header
          if (y > 260) {
            doc.addPage();
            
            // Add header to new page - BUT NOT THE SEARCH CRITERIA
            doc.setFontSize(16);
            doc.text('Congregation Emanu-El of the City of New York', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
            doc.setFontSize(14);
            doc.text('Calendar Search Results', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
            
            // Add date info with timezone
            doc.setFontSize(10);
            doc.text(`Search performed: ${formatDate(currentDate.toISOString())}`, 20, 35);
            doc.text(`Times displayed in: ${timezone}`, 20, 42);
            
            // Add column headers to the new page
            y = addColumnHeaders(45);
          }
          
          // Add the group header - just the group name without prefix
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          
          // For very long group names, adjust font size and wrap if needed
          if (currentGroup.length > 50) {
            doc.setFontSize(8);
          } else if (currentGroup.length > 30) {
            doc.setFontSize(10);
          }
          
          // For very long headers, we might need to wrap them
          if (currentGroup.length > 70) {
            const wrappedHeader = doc.splitTextToSize(currentGroup, 180);
            doc.text(wrappedHeader, 10, y);
            y += (wrappedHeader.length * (doc.getFontSize() / 2)) + 2;
          } else {
            doc.text(currentGroup, 10, y);
            y += 8;
          }
          
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          isFirstInGroup = false;
        }
        
        // Check if we need a new page
        if (y > 270) {
          doc.addPage();
          
          // Add header to new page - BUT NOT THE SEARCH CRITERIA
          doc.setFontSize(16);
          doc.text('Congregation Emanu-El of the City of New York', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
          doc.setFontSize(14);
          doc.text('Calendar Search Results', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
          
          // Add date info with timezone
          doc.setFontSize(10);
          doc.text(`Search performed: ${formatDate(currentDate.toISOString())}`, 20, 35);
          doc.text(`Times displayed in: ${timezone}`, 20, 42);
          
          // Add column headers to the new page
          y = addColumnHeaders(45);
          
          // If we were in the middle of a group, re-add the group header
          if ((sortBy === 'category' || sortBy === 'location') && currentGroup !== '') {
            // Determine font size for continued group header based on length
            if (currentGroup.length > 50) {
              doc.setFontSize(8);
            } else if (currentGroup.length > 30) {
              doc.setFontSize(10);
            } else {
              doc.setFontSize(12);
            }
            
            doc.setFont('helvetica', 'bold');
            const headerText = `${currentGroup} (continued)`;
            
            // For very long headers, we might need to wrap them
            if (currentGroup.length > 70) {
              const wrappedHeader = doc.splitTextToSize(headerText, 180);
              doc.text(wrappedHeader, 10, y);
              y += (wrappedHeader.length * (doc.getFontSize() / 2)) + 2;
            } else {
              doc.text(headerText, 10, y);
              y += 8;
            }
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
          }
        }
        
        // Starting position for this row
        let maxHeight = 0;
        
        // Draw date and day (using selected timezone)
        doc.text(dateStr, colPositions[0], y);
        doc.text(dayOfWeek, colPositions[1], y);
        
        // Wrap text for location field
        const locationText = event.location?.displayName || 'Unspecified';
        let locationFontSize = 10; // Default font size
        
        // Reduce font size for very long locations (like Zoom links)
        if (locationText.length > 40) {
          locationFontSize = 8;
        } else if (locationText.length > 25) {
          locationFontSize = 9;
        }
        
        doc.setFontSize(locationFontSize);
        const wrappedLocation = doc.splitTextToSize(locationText, colWidths[2] - 2);
        doc.text(wrappedLocation, colPositions[2], y);
        doc.setFontSize(10); // Reset to default font size
        maxHeight = Math.max(maxHeight, wrappedLocation.length * (locationFontSize / 2));
        
        // Draw category - NEW COLUMN
        const categoryText = event.categories && event.categories.length > 0 
          ? event.categories[0] 
          : 'Uncategorized';
        
        let categoryFontSize = 10; // Default font size
        // Reduce font size for very long category names
        if (categoryText.length > 40) {
          categoryFontSize = 8;
        } else if (categoryText.length > 25) {
          categoryFontSize = 9;
        }
        
        doc.setFontSize(categoryFontSize);
        const wrappedCategory = doc.splitTextToSize(categoryText, colWidths[3] - 2);
        doc.text(wrappedCategory, colPositions[3], y);
        doc.setFontSize(10); // Reset to default font size
        maxHeight = Math.max(maxHeight, wrappedCategory.length * (categoryFontSize / 2));
        
        // Draw time fields (using selected timezone)
        doc.text(formatTime(event.start.dateTime), colPositions[4], y);
        doc.text(formatTime(event.end.dateTime), colPositions[5], y);
        
        // Handle multiline event subject
        const eventTitle = event.subject || 'Untitled Event';
        doc.setFont('helvetica', 'bold'); // Make title bold
        const wrappedTitle = doc.splitTextToSize(eventTitle, colWidths[6] - 2);
        doc.text(wrappedTitle, colPositions[6], y);
        doc.setFont('helvetica', 'normal'); // Reset to normal
        let titleHeight = wrappedTitle.length * 5;
        
        // Add body preview/description in smaller font below title
        const bodyText = event.bodyPreview || event.body?.content || '';
        if (bodyText && bodyText.trim() !== '') {
          doc.setFontSize(8); // Smaller font for description
          doc.setTextColor(100, 100, 100); // Gray color for description
          const wrappedBody = doc.splitTextToSize(bodyText, colWidths[6] - 2);
          const bodyY = y + titleHeight + 2; // Position below title with small gap
          doc.text(wrappedBody, colPositions[6], bodyY);
          const bodyHeight = wrappedBody.length * 4; // Smaller line height for smaller font
          maxHeight = Math.max(maxHeight, titleHeight + bodyHeight + 2);
          // Reset font settings
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0);
        } else {
          maxHeight = Math.max(maxHeight, titleHeight);
        }
        
        // Adjust y position for next row based on the tallest content
        const rowHeight = Math.max(7, maxHeight);
        
        // Just add space for next row (no line)
        y += rowHeight + 8; // Add consistent spacing between rows
      }
      
      // Add search results count
      const resultCountY = Math.min(y + 10, 280);
      doc.setFont('helvetica', 'bold');
      doc.text(`Total Results: ${searchResults.length}`, doc.internal.pageSize.getWidth() / 2, resultCountY, { align: 'center' });
      
      // Calculate the final page count and add page numbers to all pages
      const totalPages = doc.internal.getNumberOfPages();
      
      // Now add the correct page numbers to each page
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Page ${i} of ${totalPages}`, doc.internal.pageSize.getWidth() - 20, 35, { align: 'right' });
      }
      
      // Save the PDF
      const fileName = `calendar-search-results-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('There was an error generating the PDF. Please try again.');
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
        onClick={handleExport}
        className='export-search-pdf-button'
        style={{
          padding: '6px 12px',
          backgroundColor: '#0078d4',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span role="img" aria-label="export">📄</span> Export Results to PDF
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
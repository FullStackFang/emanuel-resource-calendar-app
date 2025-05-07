// src/components/EventSearchExport.jsx
import React, { useState } from 'react';
import { jsPDF } from 'jspdf';

const EventSearchExport = ({ searchResults, searchTerm, categories, locations }) => {
  const [sortBy, setSortBy] = useState('date'); // Default sort by date
  
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
      
      // Format date for display
      const formatDate = (date) => {
        return date.toLocaleDateString('en-US', {
          month: 'numeric', 
          day: 'numeric', 
          year: 'numeric'
        });
      };
      
      // Format time for display
      const formatTime = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
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
      
      // Add search info
      doc.setFontSize(10);
      const currentDate = new Date();
      doc.text(`Search performed: ${formatDate(currentDate)}`, 20, 35);
      
      // Add search criteria - ONLY ON FIRST PAGE
      let searchCriteriaY = 45;
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
          // Sort by date (default)
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
      
      // Draw events
      for (let i = 0; i < sortedEvents.length; i++) {
        const event = sortedEvents[i];
        const startDate = new Date(event.start.dateTime);
        const dateStr = formatDate(startDate);
        const dayOfWeek = startDate.toLocaleDateString('en-US', { weekday: 'short' });
        
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
            
            // Add date info
            doc.setFontSize(10);
            doc.text(`Search performed: ${formatDate(currentDate)}`, 20, 35);
            
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
          
          // Add date info
          doc.setFontSize(10);
          doc.text(`Search performed: ${formatDate(currentDate)}`, 20, 35);
          
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
        
        // Draw date and day
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
        
        // Draw time fields
        doc.text(formatTime(event.start.dateTime), colPositions[4], y);
        doc.text(formatTime(event.end.dateTime), colPositions[5], y);
        
        // Handle multiline event subject
        const eventTitle = event.subject || 'Untitled Event';
        const wrappedTitle = doc.splitTextToSize(eventTitle, colWidths[6] - 2);
        doc.text(wrappedTitle, colPositions[6], y);
        maxHeight = Math.max(maxHeight, wrappedTitle.length * 5);
        
        // Adjust y position for next row based on the tallest content
        const rowHeight = Math.max(7, maxHeight);
        
        // Draw line between rows
        y += rowHeight + 3;
        doc.setDrawColor(200, 200, 200);
        doc.line(10, y - 2, 200, y - 2);
        y += 5;
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
    <div className="export-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
    </div>
  );
};

export default EventSearchExport;
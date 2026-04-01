// CalendarExport.jsx
import React from 'react';
import { useNotification } from '../context/NotificationContext';
import { jsPDF } from 'jspdf';

const ExportToPdfButton = ({ events, dateRange }) => {
  const { showError } = useNotification();
  const handleExport = () => {
    try {
      // Create new PDF document
      const doc = new jsPDF();
      
      // Set document properties
      doc.setProperties({
        title: 'Calendar of Events',
        subject: 'Calendar Events Export',
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
      doc.text('Calendar of Events', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
      
      // Add date information
      doc.setFontSize(10);
      const currentDate = new Date();
      doc.text(`As of\n${formatDate(currentDate)}`, 20, 35);
      doc.text(`Page 1 of 1`, doc.internal.pageSize.getWidth() - 20, 35, { align: 'right' });
      
      // Define column widths and positions
      const startY = 45;
      const colWidths = [20, 15, 35, 20, 20, 70];
      const colPositions = [];
      let currentX = 10;
      
      for (let width of colWidths) {
        colPositions.push(currentX);
        currentX += width;
      }
      
      // Add header row
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Date', colPositions[0], startY);
      doc.text('Day', colPositions[1], startY);
      doc.text('Room', colPositions[2], startY);
      doc.text('Start', colPositions[3], startY);
      doc.text('End', colPositions[4], startY);
      doc.text('Event', colPositions[5], startY);
      
      // Draw line under header
      doc.setDrawColor(0);
      doc.line(10, startY + 2, 200, startY + 2);
      
      // Add event rows
      doc.setFont('helvetica', 'normal');
      let y = startY + 10;
      
      // Sort events by date/time
      const sortedEvents = [...events].sort((a, b) => {
        return new Date(a.start.dateTime) - new Date(b.start.dateTime);
      });
      
      // Group events by date
      const eventsByDate = {};
      sortedEvents.forEach(event => {
        const startDate = new Date(event.start.dateTime);
        const dateKey = formatDate(startDate);
        
        if (!eventsByDate[dateKey]) {
          eventsByDate[dateKey] = [];
        }
        
        eventsByDate[dateKey].push(event);
      });
      
      // Draw events grouped by date
      let pageCount = 1;
      const dateKeys = Object.keys(eventsByDate);
      
      for (let dateIndex = 0; dateIndex < dateKeys.length; dateIndex++) {
        const dateKey = dateKeys[dateIndex];
        const dateEvents = eventsByDate[dateKey];
        let isFirstEventForDate = true;
        
        // For each event on this date
        for (let i = 0; i < dateEvents.length; i++) {
          const event = dateEvents[i];
          const startDate = new Date(event.start.dateTime);
          const dayOfWeek = startDate.toLocaleDateString('en-US', { weekday: 'short' });
          
          // Check if we need a new page
          if (y > 270) {
            doc.addPage();
            pageCount++;
            y = startY;
            
            // Add header to new page
            doc.setFontSize(16);
            doc.text('Congregation Emanu-El of the City of New York', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
            doc.setFontSize(14);
            doc.text('Calendar of Events', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
            
            // Add date and page info
            doc.setFontSize(10);
            doc.text(`As of\n${formatDate(currentDate)}`, 20, 35);
            doc.text(`Page ${pageCount} of ${pageCount}`, doc.internal.pageSize.getWidth() - 20, 35, { align: 'right' });
            
            // Add column headers
            doc.setFont('helvetica', 'bold');
            doc.text('Date', colPositions[0], startY);
            doc.text('Day', colPositions[1], startY);
            doc.text('Room', colPositions[2], startY);
            doc.text('Start', colPositions[3], startY);
            doc.text('End', colPositions[4], startY);
            doc.text('Event', colPositions[5], startY);
            
            // Draw line under header
            doc.line(10, startY + 2, 200, startY + 2);
            
            doc.setFont('helvetica', 'normal');
            y = startY + 10;
            isFirstEventForDate = true;
          }
          
          // Starting position for this row
          // const rowStartY = y;
          let maxHeight = 0;
          
          // Draw date and day only for first event of the date
          if (isFirstEventForDate) {
            doc.text(dateKey, colPositions[0], y);
            doc.text(dayOfWeek, colPositions[1], y);
            isFirstEventForDate = false;
          }
          
          // Wrap text for room field
          const roomText = event.location?.displayName || '';
          const wrappedRoom = doc.splitTextToSize(roomText, colWidths[2] - 2);
          doc.text(wrappedRoom, colPositions[2], y);
          maxHeight = Math.max(maxHeight, wrappedRoom.length * 5);
          
          // Draw time fields
          doc.text(formatTime(event.start.dateTime), colPositions[3], y);
          doc.text(formatTime(event.end.dateTime), colPositions[4], y);
          
          // Handle multiline event subject/description
          const eventTitle = event.subject || 'Untitled Event';
          const wrappedTitle = doc.splitTextToSize(eventTitle, colWidths[5] - 2);
          doc.text(wrappedTitle, colPositions[5], y);
          let titleHeight = wrappedTitle.length * 5;
          
          // Add body preview/description in smaller font below title
          const bodyText = event.bodyPreview || event.body?.content || '';
          if (bodyText && bodyText.trim() !== '') {
            doc.setFontSize(8); // Smaller font for description
            doc.setTextColor(100, 100, 100); // Gray color for description
            const wrappedBody = doc.splitTextToSize(bodyText, colWidths[5] - 2);
            const bodyY = y + titleHeight + 2; // Position below title with small gap
            doc.text(wrappedBody, colPositions[5], bodyY);
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
          
          // Draw line between rows
          y += rowHeight + 3;
          doc.setDrawColor(200, 200, 200);
          doc.line(10, y - 2, 200, y - 2);
          y += 5;
        }
      }
      
      // Update all page numbers to reflect total
      for (let i = 0; i < pageCount; i++) {
        doc.setPage(i + 1);
        doc.setFontSize(10);
        doc.text(`Page ${i + 1} of ${pageCount}`, doc.internal.pageSize.getWidth() - 20, 35, { align: 'right' });
      }
      
      // Save the PDF
      const fileName = `calendar-events-${dateRange.start.toISOString().split('T')[0]}-to-${dateRange.end.toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      showError(error, { context: 'CalendarExport.handleExport', userMessage: 'There was an error generating the PDF. Please try again.' });
    }
  };

  /*
  return (
    <button
      onClick={handleExport}
      className='export-pdf-button'
      style={{
        padding: '10px 15px',
        backgroundColor: '#0078d4',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        marginLeft: '10px'
      }}
    >
      Export to PDF
    </button>
  );
  */
};

export default ExportToPdfButton;
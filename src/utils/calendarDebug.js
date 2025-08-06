// Calendar Debug Logging Utility
// This utility provides toggleable debug logging for calendar operations

class CalendarDebugLogger {
  constructor() {
    this.isEnabled = this.loadDebugState();
  }

  // Load debug state from localStorage
  loadDebugState() {
    try {
      return localStorage.getItem('calendarDebugMode') === 'true';
    } catch (error) {
      return false;
    }
  }

  // Enable debug mode
  enable() {
    this.isEnabled = true;
    try {
      localStorage.setItem('calendarDebugMode', 'true');
      console.log('🔍 Calendar debug mode ENABLED');
    } catch (error) {
      console.error('Failed to save debug state:', error);
    }
  }

  // Disable debug mode
  disable() {
    this.isEnabled = false;
    try {
      localStorage.setItem('calendarDebugMode', 'false');
      console.log('🔍 Calendar debug mode DISABLED');
    } catch (error) {
      console.error('Failed to save debug state:', error);
    }
  }

  // Toggle debug mode
  toggle() {
    if (this.isEnabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.isEnabled;
  }

  // Log calendar selection changes
  logCalendarChange(from, to, availableCalendars) {
    if (!this.isEnabled) return;
    
    const fromCalendar = availableCalendars?.find(c => c.id === from);
    const toCalendar = availableCalendars?.find(c => c.id === to);
    
    console.group('📅 Calendar Change');
    console.log('From:', fromCalendar?.name || from || 'none');
    console.log('To:', toCalendar?.name || to || 'none');
    console.log('Available calendars:', availableCalendars?.map(c => ({ name: c.name, id: c.id })));
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
    
    // Also log with a clear, visible message
    console.log(`🔄 SWITCHING TO CALENDAR: ${toCalendar?.name || to} (ID: ${to?.substring(0, 20)}...)`);
  }

  // Log calendar events loaded
  logEventsLoaded(calendarId, calendarName, events) {
    if (!this.isEnabled) return;
    
    console.group('📄 Events Loaded');
    console.log('Calendar:', calendarName || calendarId);
    console.log('Event count:', events?.length || 0);
    console.log('Events:', events?.map(e => ({ subject: e.subject, start: e.start, calendarId: e.calendarId })));
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
    
    // Also log with a clear, visible message
    console.log(`📊 LOADED EVENTS FROM: ${calendarName || calendarId} - Count: ${events?.length || 0} events`);
  }

  // Log event loading
  logEventLoading(calendarId, dateRange, method) {
    if (!this.isEnabled) return;
    
    console.group('📥 Loading Events');
    console.log('Calendar ID:', calendarId);
    console.log('Date range:', dateRange);
    console.log('Method:', method);
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log event loading completion
  logEventLoadingComplete(calendarId, eventCount, duration) {
    if (!this.isEnabled) return;
    
    console.group('✅ Events Loaded');
    console.log('Calendar ID:', calendarId);
    console.log('Event count:', eventCount);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log errors
  logError(operation, error, context = {}) {
    if (!this.isEnabled) return;
    
    console.group('❌ Calendar Error');
    console.log('Operation:', operation);
    console.log('Error:', error);
    console.log('Context:', context);
    console.log('Timestamp:', new Date().toISOString());
    console.trace();
    console.groupEnd();
  }

  // Log state changes
  logStateChange(stateName, oldValue, newValue) {
    if (!this.isEnabled) return;
    
    console.group('🔄 State Change');
    console.log('State:', stateName);
    console.log('Old value:', oldValue);
    console.log('New value:', newValue);
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log API calls
  logApiCall(endpoint, method, params) {
    if (!this.isEnabled) return;
    
    console.group('🌐 API Call');
    console.log('Endpoint:', endpoint);
    console.log('Method:', method);
    console.log('Parameters:', params);
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log cache operations
  logCacheOperation(operation, calendarId, result) {
    if (!this.isEnabled) return;
    
    console.group('💾 Cache Operation');
    console.log('Operation:', operation);
    console.log('Calendar ID:', calendarId);
    console.log('Result:', result);
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }
}

// Create singleton instance
const calendarDebug = new CalendarDebugLogger();

// Add global functions for debug mode
if (typeof window !== 'undefined') {
  window.toggleCalendarDebug = () => {
    const isEnabled = calendarDebug.toggle();
    return isEnabled ? 'Calendar debug mode enabled' : 'Calendar debug mode disabled';
  };
  
  window.enableCalendarDebug = () => {
    calendarDebug.enable();
    return 'Calendar debug mode enabled - You will now see detailed logs when switching calendars';
  };
  
  window.disableCalendarDebug = () => {
    calendarDebug.disable();
    return 'Calendar debug mode disabled';
  };
  
  // Show help
  window.calendarDebugHelp = () => {
    console.log(`
🔍 Calendar Debug Commands:
- window.enableCalendarDebug()  - Enable detailed calendar switching logs
- window.disableCalendarDebug() - Disable detailed logs
- window.toggleCalendarDebug()  - Toggle debug mode on/off

When enabled, you'll see clear messages showing:
- Which calendar you're switching to
- Which events are loaded
- How events are filtered
- Any issues with the calendar switching process
    `);
  };
}

export default calendarDebug;
// Calendar Debug Logging Utility
// This utility provides toggleable debug logging for calendar operations
import { logger } from './logger';

class CalendarDebugLogger {
  constructor() {
    this.isEnabled = this.loadDebugState();
    this.loadTimings = {}; // Track phase timings for current load operation
    this.loadStartTime = null;
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
      logger.log('🔍 Calendar debug mode ENABLED');
    } catch (error) {
      console.error('Failed to save debug state:', error);
    }
  }

  // Disable debug mode
  disable() {
    this.isEnabled = false;
    try {
      localStorage.setItem('calendarDebugMode', 'false');
      logger.log('🔍 Calendar debug mode DISABLED');
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
    logger.log('From:', fromCalendar?.name || from || 'none');
    logger.log('To:', toCalendar?.name || to || 'none');
    logger.log('Available calendars:', availableCalendars?.map(c => ({ name: c.name, id: c.id })));
    logger.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
    
    // Also log with a clear, visible message
    logger.log(`🔄 SWITCHING TO CALENDAR: ${toCalendar?.name || to} (ID: ${to?.substring(0, 20)}...)`);
  }

  // Log calendar events loaded
  logEventsLoaded(calendarId, calendarName, events) {
    if (!this.isEnabled) return;
    
    console.group('📄 Events Loaded');
    logger.log('Calendar:', calendarName || calendarId);
    logger.log('Event count:', events?.length || 0);
    logger.log('Events:', events?.map(e => ({ subject: e.subject, start: e.start, calendarId: e.calendarId })));
    logger.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
    
    // Also log with a clear, visible message
    logger.log(`📊 LOADED EVENTS FROM: ${calendarName || calendarId} - Count: ${events?.length || 0} events`);
  }

  // Log event loading
  logEventLoading(calendarId, dateRange, method) {
    if (!this.isEnabled) return;
    // Logging disabled to reduce console spam
  }

  // Log event loading completion
  logEventLoadingComplete(calendarId, eventCount, duration) {
    if (!this.isEnabled) return;

    console.group('✅ Events Loaded');
    logger.log('Calendar ID:', calendarId);
    logger.log('Event count:', eventCount);
    logger.log('Duration:', duration, 'ms');
    logger.log('Timestamp:', new Date().toISOString());

    // Log detailed timing breakdown if available
    if (Object.keys(this.loadTimings).length > 0) {
      console.group('⏱️ Timing Breakdown');
      for (const [phase, timing] of Object.entries(this.loadTimings)) {
        logger.log(`${phase}: ${timing.duration}ms`);
      }
      console.groupEnd();
    }

    console.groupEnd();

    // Reset timings for next load
    this.loadTimings = {};
    this.loadStartTime = null;
  }

  // Start timing a load operation
  startLoadTiming() {
    this.loadStartTime = performance.now();
    this.loadTimings = {};
  }

  // Start timing a specific phase
  startPhase(phaseName) {
    this.loadTimings[phaseName] = {
      startTime: performance.now(),
      duration: 0
    };
  }

  // End timing a specific phase
  endPhase(phaseName, metadata = {}) {
    if (this.loadTimings[phaseName]) {
      const endTime = performance.now();
      this.loadTimings[phaseName].duration = Math.round(endTime - this.loadTimings[phaseName].startTime);
      this.loadTimings[phaseName].metadata = metadata;
    }
  }

  // Get timing summary
  getTimingSummary() {
    const totalDuration = this.loadStartTime ? Math.round(performance.now() - this.loadStartTime) : 0;

    const phases = {};
    for (const [name, data] of Object.entries(this.loadTimings)) {
      phases[name] = {
        duration: data.duration,
        metadata: data.metadata || {}
      };
    }

    return {
      totalDuration,
      phases
    };
  }

  // Log timing summary (can be called anytime)
  logTimingSummary() {
    if (!this.isEnabled) return;

    const summary = this.getTimingSummary();

    console.group('⏱️ Load Performance Summary');
    logger.log(`Total: ${summary.totalDuration}ms`);

    for (const [phase, data] of Object.entries(summary.phases)) {
      const metaStr = Object.keys(data.metadata).length > 0
        ? ` (${JSON.stringify(data.metadata)})`
        : '';
      logger.log(`  ${phase}: ${data.duration}ms${metaStr}`);
    }

    console.groupEnd();
  }

  // Log errors
  logError(operation, error, context = {}) {
    if (!this.isEnabled) return;
    
    console.group('❌ Calendar Error');
    logger.log('Operation:', operation);
    logger.log('Error:', error);
    logger.log('Context:', context);
    logger.log('Timestamp:', new Date().toISOString());
    console.trace();
    console.groupEnd();
  }

  // Log state changes
  logStateChange(stateName, oldValue, newValue) {
    if (!this.isEnabled) return;
    
    console.group('🔄 State Change');
    logger.log('State:', stateName);
    logger.log('Old value:', oldValue);
    logger.log('New value:', newValue);
    logger.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log API calls
  logApiCall(endpoint, method, params) {
    if (!this.isEnabled) return;
    
    console.group('🌐 API Call');
    logger.log('Endpoint:', endpoint);
    logger.log('Method:', method);
    logger.log('Parameters:', params);
    logger.log('Timestamp:', new Date().toISOString());
    console.groupEnd();
  }

  // Log cache operations
  logCacheOperation(operation, calendarId, result) {
    if (!this.isEnabled) return;
    
    console.group('💾 Cache Operation');
    logger.log('Operation:', operation);
    logger.log('Calendar ID:', calendarId);
    logger.log('Result:', result);
    logger.log('Timestamp:', new Date().toISOString());
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
    logger.log(`
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
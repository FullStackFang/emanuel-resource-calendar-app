# Logger Usage Guide

This guide explains how to use the new logger utilities to manage debug statements in the Emanuel Resource Calendar application.

## Overview

The logger utilities automatically disable debug logs in production while keeping errors and warnings visible. This helps reduce console noise in production and improves performance.

## Frontend Logger (`src/utils/logger.js`)

### Basic Usage

```javascript
import { logger } from '../utils/logger';

// Replace console.log with logger.log
logger.log('Regular log message');

// Use logger.debug for debug-specific messages
logger.debug('Debug information:', data);

// Errors and warnings are always visible
logger.error('Error occurred:', error);
logger.warn('Warning message');
```

### Available Methods

- `logger.log()` - General logging (hidden in production)
- `logger.debug()` - Debug messages with [DEBUG] prefix (hidden in production)
- `logger.info()` - Info messages (hidden in production)
- `logger.warn()` - Warnings (always visible)
- `logger.error()` - Errors (always visible)
- `logger.group()` / `logger.groupEnd()` - Grouped logging
- `logger.table()` - Table formatting
- `logger.time()` / `logger.timeEnd()` - Performance timing
- `logger.isDebugEnabled()` - Check if debug mode is active
- `logger.getEnvironment()` - Get current environment

### Environment Control

The frontend logger uses Vite's environment detection:
- Development: All logs are visible
- Production: Only errors and warnings are visible
- Override: Set `VITE_DEBUG=true` to enable debug logs in any environment

## Backend Logger (`backend/utils/logger.js`)

### Basic Usage

```javascript
const logger = require('./utils/logger');

// Replace console.log with logger.log
logger.log('Server started on port', port);

// Special methods for backend
logger.request('GET', '/api/events', 'User:', userId);
logger.db('INSERT', 'events', { id: eventId });
```

### Additional Backend Methods

- `logger.request()` - Log API requests
- `logger.db()` - Log database operations

### Environment Control

The backend logger uses Node.js environment detection:
- Development: All logs are visible (default)
- Production: Only errors and warnings (set `NODE_ENV=production`)
- Override: Set `DEBUG=true` to enable debug logs in any environment

## Migration Examples

### Before
```javascript
console.log('Event clicked:', event);
console.log(`Processing ${events.length} events`);
console.error('Failed to load:', error);
```

### After
```javascript
import { logger } from '../utils/logger';

logger.log('Event clicked:', event);
logger.log(`Processing ${events.length} events`);
logger.error('Failed to load:', error);
```

## Production Build

The Vite configuration has been updated to remove all console statements during production builds as an additional safety measure:

```javascript
// vite.config.js
build: {
  terserOptions: {
    compress: {
      drop_console: true,
      drop_debugger: true
    }
  }
}
```

## Testing Logger Behavior

1. **Development Mode**: 
   ```bash
   npm run dev
   # All logs visible
   ```

2. **Production Preview**:
   ```bash
   npm run build
   npm run preview
   # Only errors/warnings visible
   ```

3. **Force Debug in Production**:
   ```bash
   VITE_DEBUG=true npm run build
   ```

## Progress Status

### Completed:
- ✅ Frontend logger utility created
- ✅ Backend logger utility created
- ✅ Vite configuration updated
- ✅ EventForm.jsx migrated (13 console statements)

### Pending:
- ⏳ Calendar.jsx (177 console statements)
- ⏳ api-server.js (61 console statements)
- ⏳ MonthView.jsx (31 console statements)
- ⏳ Other files

## Best Practices

1. Use `logger.debug()` for detailed debugging information
2. Use `logger.log()` for general application flow
3. Use `logger.error()` for actual errors (always visible)
4. Use `logger.warn()` for warnings that developers should see
5. Remove temporary debugging logs before committing
6. Use descriptive messages that provide context

## Notes

- The logger checks the environment at import time, so it has minimal performance impact
- Error and warning logs are intentionally always visible to help with production debugging
- The demo file `src/utils/logger-demo.js` can be used to test logger functionality
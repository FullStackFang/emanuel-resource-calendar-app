# Emanuel Resource Calendar App - Refactoring Plan

## Executive Summary

This document outlines a phased approach to refactoring the Emanuel Resource Calendar application based on a comprehensive code review. The refactoring is organized into 5 phases, prioritized by security impact and architectural importance. Each task includes clear acceptance criteria and can be implemented incrementally without breaking existing functionality.

### Goals
- **Security**: Eliminate critical vulnerabilities and secure authentication patterns
- **Maintainability**: Break down monolithic files into modular, testable components
- **Performance**: Implement lazy loading, pagination, and reduce unnecessary re-renders
- **Accessibility**: Add ARIA support and keyboard navigation for all users
- **Code Quality**: Standardize patterns and eliminate code smells

### Current State
- **Frontend**: React 19 + Vite with 68 components and 50+ CSS files
- **Backend**: Node.js/Express with a 20,375-line monolithic API server
- **Database**: MongoDB (Azure Cosmos DB)

---

## Phase 1: Critical Security Fixes

**Priority**: CRITICAL
**Estimated Effort**: 1-2 days
**Dependencies**: None

### Task 1.1: Fix Insecure Admin Check
- [x] **Status**: Completed (2026-01-28)

**Description**: Replace email string matching with database-stored admin flag. Currently, `userEmail.includes('admin')` allows any email containing "admin" (e.g., `attacker@admin.com`) to pass as admin.

**Files Affected**:
- `backend/api-server.js` (line ~18005)

**Complexity**: Low

**Current Code** (INSECURE):
```javascript
const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
```

**Acceptance Criteria**:
- [ ] Admin check uses ONLY `user?.isAdmin` from database
- [ ] Domain check uses strict equality: `userEmail.endsWith('@emanuelnyc.org')` with additional validation
- [ ] Remove `userEmail.includes('admin')` check entirely
- [ ] Add unit tests for admin authorization
- [ ] Document admin role management process

---

### Task 1.2: Remove Token Logging
- [x] **Status**: Completed (2026-01-28)

**Description**: Remove all token logging from production code. Even partial tokens should not be logged as they can be used for replay attacks.

**Files Affected**:
- `backend/api-server.js` (lines ~1772-1780)
- `backend/services/graphApiService.js`

**Complexity**: Low

**Current Code** (INSECURE):
```javascript
logger.log('Token received (first 20 chars):', token.substring(0, 20) + '...');
```

**Acceptance Criteria**:
- [ ] Remove ALL token logging statements
- [ ] If debugging is needed, log only token length or presence (boolean)
- [ ] Review all files for similar patterns using grep
- [ ] Add ESLint rule to prevent token logging

---

### Task 1.3: Remove Global Token Exposure
- [x] **Status**: Completed (2026-01-28)

**Description**: Remove `window.__apiToken` which exposes the API token to any JavaScript running on the page, including potential XSS attacks.

**Files Affected**:
- `src/App.jsx` (lines ~79-82)

**Complexity**: Low

**Current Code** (INSECURE):
```javascript
window.__apiToken = apiToken;
```

**Acceptance Criteria**:
- [ ] Remove `window.__apiToken` assignment
- [ ] Identify any code that depends on this global and refactor
- [ ] Use React Context or props for token access
- [ ] Verify no other sensitive data is exposed on window object

---

### Task 1.4: Implement Rate Limiting
- [x] **Status**: Completed (2026-01-28)

**Description**: Add rate limiting to protect public and authenticated endpoints from abuse.

**Files Affected**:
- `backend/api-server.js`
- New file: `backend/middleware/rateLimiter.js`

**Complexity**: Medium

**Acceptance Criteria**:
- [ ] Install and configure `express-rate-limit`
- [ ] Apply stricter limits to `/api/public/*` endpoints (e.g., 100 req/15min)
- [ ] Apply standard limits to authenticated endpoints (e.g., 1000 req/15min)
- [ ] Add custom response for rate-limited requests
- [ ] Log rate limit hits for monitoring
- [ ] Document rate limits in API documentation

---

## Phase 2: Backend Architecture

**Priority**: HIGH
**Estimated Effort**: 3-5 days
**Dependencies**: Phase 1 complete (security fixes should be in place first)

### Task 2.1: Split api-server.js into Route Modules
- [ ] **Status**: Not Started

**Description**: Break down the 20,375-line monolithic api-server.js into logical route modules.

**Files Affected**:
- `backend/api-server.js` (source)
- New files:
  - `backend/routes/index.js`
  - `backend/routes/events.js`
  - `backend/routes/reservations.js`
  - `backend/routes/admin.js`
  - `backend/routes/users.js`
  - `backend/routes/locations.js`
  - `backend/routes/graph.js`
  - `backend/routes/public.js`

**Complexity**: High

**Acceptance Criteria**:
- [ ] Each route module handles a single domain (events, reservations, etc.)
- [ ] api-server.js becomes a thin orchestration layer (<500 lines)
- [ ] Shared middleware extracted to `backend/middleware/`
- [ ] Database connections managed centrally
- [ ] All existing endpoints continue to work (no breaking changes)
- [ ] Add route-level tests for each module

---

### Task 2.2: Add Input Validation Middleware
- [ ] **Status**: Not Started

**Description**: Implement request validation using express-validator or Joi to prevent injection attacks and ensure data integrity.

**Files Affected**:
- `backend/api-server.js` (all endpoint handlers)
- New file: `backend/middleware/validation.js`
- New file: `backend/validators/eventValidators.js`
- New file: `backend/validators/reservationValidators.js`

**Complexity**: High

**Dependencies**: Task 2.1 (easier to add validation to modular routes)

**Acceptance Criteria**:
- [ ] All POST/PUT endpoints validate request body
- [ ] All query parameters are validated and sanitized
- [ ] Validation errors return consistent 400 responses with field-level errors
- [ ] Add validation schemas for all data models
- [ ] Document validation rules

---

### Task 2.3: Standardize Error Handling
- [x] **Status**: Completed (2026-01-28)

**Description**: Create consistent error response format across all endpoints.

**Files Affected**:
- `backend/api-server.js` (all error responses)
- New file: `backend/middleware/errorHandler.js`
- New file: `backend/utils/ApiError.js`

**Complexity**: Medium

**Acceptance Criteria**:
- [ ] All errors return same structure: `{ error: string, code: string, details?: any }`
- [ ] Internal error details logged but not returned to client
- [ ] 500 errors return generic "Internal Server Error" message
- [ ] Create custom ApiError class for known error types
- [ ] Global error handler catches unhandled exceptions

---

### Task 2.4: Remove Deprecated MongoDB Options
- [x] **Status**: Completed (2026-01-28)

**Description**: Remove deprecated MongoDB connection options that are now default behavior.

**Files Affected**:
- `backend/api-server.js` (lines ~169-174)

**Complexity**: Low

**Current Code**:
```javascript
const client = new MongoClient(connectionString, {
  useNewUrlParser: true,      // Deprecated
  useUnifiedTopology: true,   // Deprecated
});
```

**Acceptance Criteria**:
- [ ] Remove `useNewUrlParser` option
- [ ] Remove `useUnifiedTopology` option
- [ ] Test connection works correctly
- [ ] Update any documentation referencing these options

---

## Phase 3: Frontend Architecture

**Priority**: HIGH
**Estimated Effort**: 3-5 days
**Dependencies**: None (can run parallel to Phase 2)

### Task 3.1: Extract App.jsx Modal Logic into Hooks
- [ ] **Status**: Not Started

**Description**: App.jsx has 867 lines with 30+ state variables. Extract modal-related logic into custom hooks.

**Files Affected**:
- `src/App.jsx`
- New files:
  - `src/hooks/useDraftModal.js`
  - `src/hooks/useReservationModal.js`
  - `src/hooks/useErrorModal.js`

**Complexity**: Medium

**Acceptance Criteria**:
- [ ] Create `useDraftModal()` hook managing draft state and actions
- [ ] Create `useReservationModal()` hook managing reservation review state
- [ ] Create `useErrorModal()` hook managing error display
- [ ] App.jsx reduced to <500 lines
- [ ] All modal functionality preserved
- [ ] Add tests for each hook

---

### Task 3.2: Consolidate Calendar.jsx State with useReducer
- [ ] **Status**: Not Started

**Description**: Calendar.jsx has 100+ state variables in the first 300 lines. Consolidate related state using useReducer.

**Files Affected**:
- `src/components/Calendar.jsx`
- New file: `src/reducers/calendarReducer.js`

**Complexity**: High

**Acceptance Criteria**:
- [ ] Group related state into reducer (view state, filter state, selection state)
- [ ] Create typed actions for state changes
- [ ] Reduce individual useState calls by 50%+
- [ ] Maintain all existing functionality
- [ ] Add unit tests for reducer

---

### Task 3.3: Replace Window Events with Context
- [ ] **Status**: Not Started

**Description**: Replace global window event listeners with React Context for cross-component communication.

**Files Affected**:
- `src/App.jsx` (lines ~129-151)
- `src/components/AIChat.jsx`
- New file: `src/context/EventBusContext.jsx`

**Complexity**: Medium

**Current Code**:
```javascript
window.addEventListener('ai-chat-open-reservation-modal', handleOpenReservationModal);
```

**Acceptance Criteria**:
- [ ] Create EventBusContext for cross-component communication
- [ ] Remove all `window.addEventListener` for custom events
- [ ] Remove all `window.dispatchEvent` calls
- [ ] Components use context methods instead of window events
- [ ] No breaking changes to AI chat functionality

---

### Task 3.4: Replace console.log with Logger
- [x] **Status**: Completed (2026-01-28)

**Description**: Replace all console.log statements with the existing logger utility that respects environment settings.

**Files Affected**:
- `src/App.jsx` (lines ~219-225, 551-598)
- `src/components/Calendar.jsx`
- Multiple other component files

**Complexity**: Low

**Acceptance Criteria**:
- [ ] Run codebase search for `console.log` in src/
- [ ] Replace with appropriate `logger.debug()`, `logger.info()`, or `logger.error()`
- [ ] Remove emoji prefixes from log messages (or standardize)
- [ ] Verify no logs appear in production build
- [ ] Add ESLint rule `no-console` with exceptions

---

## Phase 4: CSS & Styling

**Priority**: MEDIUM
**Estimated Effort**: 2-3 days
**Dependencies**: None (can run parallel to other phases)

### Task 4.1: Implement CSS Namespacing (BEM)
- [ ] **Status**: Not Started

**Description**: Add component-specific prefixes to all CSS classes to prevent global conflicts.

**Files Affected**:
- All 50+ CSS files in `src/components/`
- Corresponding JSX files

**Complexity**: High

**Acceptance Criteria**:
- [ ] Adopt BEM naming: `.component-name__element--modifier`
- [ ] Each CSS file uses unique component prefix
- [ ] Remove generic class names like `.btn`, `.container`, `.button`
- [ ] Create CSS naming convention documentation
- [ ] No visual regressions (verify with screenshots)

---

### Task 4.2: Remove Inline Styles
- [x] **Status**: Partially Completed (2026-01-28)

**Description**: Move inline styles to CSS classes for better maintainability.

**Files Affected**:
- `src/App.jsx` (lines ~453, 517) - ✅ Fixed
- `src/components/AttachmentsSection.jsx` - ✅ Fixed
- `src/components/CSVImportWithCalendar.jsx` - ✅ Fixed
- `src/components/EventForm.jsx` - ✅ Fixed
- `src/components/CSVImport.jsx` - ✅ Partially fixed
- Multiple other component files - Remaining (~290 occurrences)

**Complexity**: HIGH (revised from Low - found 302 inline styles, many dynamic)

**What Was Done**:
- Created utility CSS classes in `App.css`: `.scale-80`, `.hidden-input`, margin/padding/flex utilities
- Moved `zoom: 0.8` wrapper divs to use `.scale-80` class (2 occurrences)
- Moved hidden file input styles to use `.hidden-input` class (4 occurrences)

**Remaining Work**:
Most remaining inline styles fall into categories that require careful handling:
1. **Dynamic styles** (~60%): Styles computed from state/variables that must remain inline
2. **Component-specific styles** (~30%): Would require creating new CSS files
3. **Position-based styles** (~10%): Calendar event positioning that must stay inline

**Acceptance Criteria**:
- [x] Search for all `style={{` in JSX (found 302 occurrences)
- [x] Create utility CSS classes for common patterns
- [x] Move static patterns (zoom, hidden inputs) to CSS
- [ ] ~~Create corresponding CSS classes for all inline styles~~ (Not practical - many are dynamic)
- [x] No visual regressions

---

### Task 4.3: Evaluate CSS Modules Migration
- [ ] **Status**: Not Started

**Description**: Evaluate and potentially implement CSS Modules for automatic scoping.

**Files Affected**:
- All CSS files
- Vite configuration

**Complexity**: High (if implemented)

**Acceptance Criteria**:
- [ ] Create proof-of-concept with 2-3 components
- [ ] Document migration steps
- [ ] Assess effort vs. benefit
- [ ] Make go/no-go decision
- [ ] If approved, create migration plan for remaining components

---

## Phase 5: Performance & Accessibility

**Priority**: MEDIUM
**Estimated Effort**: 3-4 days
**Dependencies**: Phase 3 (frontend architecture should be cleaner first)

### Task 5.1: Implement Code Splitting
- [x] **Status**: Completed (2026-01-28)

**Description**: Use React.lazy and Suspense for route-based code splitting to reduce initial bundle size.

**Files Affected**:
- `src/App.jsx`

**Complexity**: Medium

**What Was Done**:
- Admin components already lazy-loaded: UserAdmin, CategoryManagement, CalendarConfigAdmin, LocationReview, ReservationRequests, FeatureManagement, EmailTestAdmin, ErrorLogAdmin, AIChat
- Added lazy loading for: MySettings, MyReservations
- Improved Suspense fallback to use LoadingSpinner component
- Kept Calendar and UnifiedEventForm eager-loaded (Calendar is main page, UnifiedEventForm used in modals)

**Acceptance Criteria**:
- [x] Lazy load admin components (already done)
- [x] Lazy load settings/preferences components (MySettings, MyReservations)
- [x] Add loading fallbacks for lazy components (LoadingSpinner)
- [ ] ~~Reduce initial bundle size by 20%+~~ (would need production build to measure)
- [ ] ~~Measure and document bundle size before/after~~ (deferred)

---

### Task 5.2: Add Pagination to List Endpoints
- [x] **Status**: Completed (2026-01-28)

**Description**: Replace limit=1000 queries with proper pagination for large datasets.

**Files Affected**:
- `backend/api-server.js` (event listing endpoints)
- `src/components/ReservationRequests.jsx`
- `src/components/Navigation.jsx`

**Complexity**: Medium

**What Was Done**:

Backend (`api-server.js`):
- Enhanced `/api/room-reservation-events` endpoint with `status` filter parameter
- Added input validation (max limit: 100, page >= 1)
- Added server-side sorting by `_id` descending (newest first)
- Standardized pagination metadata: `{ page, limit, totalCount, totalPages, hasMore }`
- Updated `/api/room-reservations` to use same pagination format

Frontend:
- `ReservationRequests.jsx`: Converted from client-side to server-side pagination
  - Added `loadReservations(page, status)` function with server-side filtering
  - Updated tab changes to trigger server reload with status filter
  - Added `handlePageChange` for pagination navigation
  - Shows total count in pagination UI
- `Navigation.jsx`: Optimized pending count fetch
  - Changed from `limit=1000` to `limit=1&status=pending`
  - Uses `totalCount` from pagination metadata instead of counting array

**Acceptance Criteria**:
- [x] Add `page` and `pageSize` query parameters
- [x] Return total count and pagination metadata (`totalCount`, `totalPages`, `hasMore`)
- [x] Implement pagination UI (Previous/Next with page info and total count)
- [x] Default page size of 20 items (changed from 50 for better UX)
- [x] Backend validates pagination parameters (max 100, min 1)

---

### Task 5.3: Add ARIA Attributes
- [ ] **Status**: Not Started

**Description**: Add accessibility attributes to all interactive elements.

**Files Affected**:
- All component files in `src/components/`

**Complexity**: Medium

**Acceptance Criteria**:
- [ ] Add `aria-label` to all icon-only buttons
- [ ] Add `role` attributes to custom widgets (calendar, modals)
- [ ] Add `aria-live` regions for dynamic content
- [ ] Add skip links for screen reader navigation
- [ ] Add landmark roles (`main`, `navigation`, `complementary`)
- [ ] Test with screen reader (NVDA or VoiceOver)

---

### Task 5.4: Implement Keyboard Navigation
- [ ] **Status**: Not Started

**Description**: Add full keyboard support for custom components.

**Files Affected**:
- `src/components/Calendar.jsx`
- `src/components/MonthView.jsx`
- `src/components/WeekView.jsx`
- `src/components/DayView.jsx`
- All modal components

**Complexity**: High

**Acceptance Criteria**:
- [ ] Calendar navigation with arrow keys
- [ ] Modal focus trap (Tab cycles within modal)
- [ ] Escape key closes modals
- [ ] Enter/Space activates buttons
- [ ] Focus visible on all interactive elements
- [ ] Document keyboard shortcuts

---

## Progress Summary

### Phase 1: Critical Security Fixes
| Task | Status | Complexity |
|------|--------|------------|
| 1.1 Fix Insecure Admin Check | **Completed** | Low |
| 1.2 Remove Token Logging | **Completed** | Low |
| 1.3 Remove Global Token Exposure | **Completed** | Low |
| 1.4 Implement Rate Limiting | **Completed** | Medium |

### Phase 2: Backend Architecture
| Task | Status | Complexity |
|------|--------|------------|
| 2.1 Split api-server.js | Not Started | High |
| 2.2 Add Input Validation | Not Started | High |
| 2.3 Standardize Error Handling | **Completed** | Medium |
| 2.4 Remove Deprecated MongoDB Options | **Completed** | Low |

### Phase 3: Frontend Architecture
| Task | Status | Complexity |
|------|--------|------------|
| 3.1 Extract App.jsx Modal Logic | Not Started | Medium |
| 3.2 Consolidate Calendar.jsx State | Not Started | High |
| 3.3 Replace Window Events with Context | Not Started | Medium |
| 3.4 Replace console.log with Logger | **Completed** | Low |

### Phase 4: CSS & Styling
| Task | Status | Complexity |
|------|--------|------------|
| 4.1 Implement CSS Namespacing | Not Started | High |
| 4.2 Remove Inline Styles | **Partial** | High (revised) |
| 4.3 Evaluate CSS Modules Migration | Not Started | High |

### Phase 5: Performance & Accessibility
| Task | Status | Complexity |
|------|--------|------------|
| 5.1 Implement Code Splitting | **Completed** | Medium |
| 5.2 Add Pagination to List Endpoints | **Completed** | Medium |
| 5.3 Add ARIA Attributes | Not Started | Medium |
| 5.4 Implement Keyboard Navigation | Not Started | High |

---

## Implementation Notes

### Recommended Order
1. **Phase 1** - Security fixes are critical and should be done first
2. **Phase 2 + Phase 3** - Can be done in parallel by different team members
3. **Phase 4** - CSS changes are lower risk and can be done incrementally
4. **Phase 5** - Performance and accessibility improvements

### Testing Strategy
- Each task should include tests before merging
- Create feature branches for each task
- Use PR reviews to catch regressions
- Maintain existing test coverage

### Rollback Plan
- Each phase should be deployable independently
- Keep git tags at each phase completion
- Document any database migrations needed

---

## Appendix

### Code Review Reference
This plan is based on the comprehensive code review conducted on 2026-01-27, which identified:
- 4 Critical security issues
- 8 High-priority architectural issues
- 6 Medium-priority improvements
- Multiple accessibility gaps

### Related Documentation
- `CLAUDE.md` - Project architecture and development commands
- `architecture-notes.md` - Detailed system architecture
- `DATABASE.md` - MongoDB collection documentation

---
name: emanu-frontend
description: Frontend development patterns for React with Fluent UI, MSAL auth, centralized event transforms, unified review modals, and permission-gated UI
---

# Emanuel Frontend Development Guide

## Purpose

Quick-reference patterns and checklists for frontend work in this codebase. Covers the centralized transform layer, modal architecture, permission system, and UI conventions.

## When This Skill Activates

- Creating/modifying React components in `src/`
- Working with event data transforms
- Building forms or modals
- Implementing permission-gated UI
- Adding calendar view features
- Working with the review modal system

---

## Adding a New Field to Events - Only 2 Places!

This is the most common task. The centralized transform layer means you only touch 2 files:

### Step 1: Frontend Transform (`src/utils/eventTransformers.js`)

Add field extraction in `transformEventToFlatStructure()`:

```javascript
return {
  // ... existing fields
  newField: event.newField || event.roomReservationData?.newField || defaultValue,
};
```

### Step 2: Backend API (`backend/api-server.js`)

Add field handling in the relevant endpoint:
- Destructure from request body
- Include in MongoDB insert/update operation

### Common Pitfalls

| Symptom | Cause |
|---|---|
| Field in DB but not in form | Missing from `eventTransformers.js` |
| Field saves but doesn't load | Missing from `transformEventToFlatStructure()` |
| ObjectId comparison fails | Must use `String(id)` for comparisons |
| Times display wrong | Datetime strings MUST have `Z` suffix for UTC |

---

## Component Architecture

### EventReviewExperience (Unified Modal Layer)

`src/components/shared/EventReviewExperience.jsx` is THE single shared component for all event review. Every entry point uses it:

```
Calendar.jsx ──────────┐
MyReservations.jsx ────┼──> EventReviewExperience ──> ReviewModal + RoomReservationReview
ReservationRequests.jsx┘
```

**Adding a new permission-gated action:**

```javascript
// CORRECT: Add to EventReviewExperience, NOT to individual callers
// Inside EventReviewExperience:
const effectiveCanDoThing = canDoThing || (isOwner && someCondition);

// Pass down to ReviewModal:
<ReviewModal onDoThing={effectiveCanDoThing ? handleDoThing : null} />
```

```javascript
// NEVER: Add permission logic in each caller independently
// Calendar.jsx: if (canDoThing) ...
// MyReservations.jsx: if (canDoThing) ...  ← inconsistent behavior guaranteed
```

### Caller Responsibilities

Callers pass:
- Raw permissions from `usePermissions()`
- Handler functions (for actions they support)
- Context-specific state (loading indicators, etc.)

EventReviewExperience computes derived flags (like `effectiveCanDelete`) internally.

---

## Permission System

### usePermissions Hook

```javascript
const { role, canEditEvents, canDeleteEvents, canApproveReservations } = usePermissions();
// role: 'viewer' | 'requester' | 'approver' | 'admin'
```

### Key Permission Patterns

```javascript
// CORRECT: Check role directly
if (permissions.role === 'admin' || permissions.role === 'approver') { ... }

// NEVER: Check non-existent flags
if (permissions.isApprover) { ... } // Does NOT exist - use permissions.role
```

### Requester-Only Actions

```javascript
// Owner check uses roomReservationData.requestedBy.email
const isOwner = event.roomReservationData?.requestedBy?.email === currentUserEmail;
const effectiveCanDelete = canDeleteEvents || (isOwner && event.status === 'pending');
```

---

## UI Patterns

### In-Button Confirmation (ALL Significant Actions)

Every destructive/significant action uses this pattern. NO `window.confirm()`.

```javascript
// State pattern
const [actionId, setActionId] = useState(null);       // Loading state
const [confirmActionId, setConfirmActionId] = useState(null); // Confirm state

// First click -> confirm state
const handleFirstClick = (id) => setConfirmActionId(id);

// Second click -> execute
const handleConfirm = async (id) => {
  setActionId(id);
  setConfirmActionId(null);
  try {
    await performAction(id);
    showSuccess('Action completed');
  } catch (e) {
    showError('Action failed');
  } finally {
    setActionId(null);
  }
};
```

**Color mapping:**
- Destructive (delete, cancel): `var(--color-error-500)` (red)
- Constructive (restore, publish): `var(--color-success-500)` (green)
- Neutral (reject, update): `var(--color-warning-500)` or `var(--color-info-500)`

**Confirmation persists** until user acts — no auto-reset timeout.

### Toast Notifications

```javascript
const { showSuccess, showError, showWarning } = useNotification();

showSuccess('Event published successfully');
showError('Failed to save changes');
showWarning('This event has scheduling conflicts');
```

---

## React Hook Gotchas (Specific to This Codebase)

### 1. Unstable useCallback Dependencies

If a `useCallback` depends on a prop passed as an inline arrow from the parent, it recreates every render:

```javascript
// PROBLEM: Parent passes inline arrow
<SchedulingAssistant onConflictChange={(conflicts) => setConflicts(conflicts)} />

// FIX: Use ref pattern to break the chain
const onConflictChangeRef = useRef(onConflictChange);
useLayoutEffect(() => { onConflictChangeRef.current = onConflictChange; }, [onConflictChange]);

const stableCallback = useCallback(() => {
  onConflictChangeRef.current?.(data);
}, []); // Stable - never recreates
```

### 2. Ref-Stored Closures Go Stale

```javascript
// PROBLEM: Ref captures mount-time closure
const fnRef = useRef(() => processFormData(formData)); // formData is stale!

// FIX: Keep ref in sync
useEffect(() => {
  fnRef.current = () => processFormData(formData);
}, [formData]);
```

### 3. setState Bailout Semantics

```javascript
// Primitives: setState(0) when state is already 0 = BAIL OUT (no re-render)
setState(0); // Object.is(0, 0) = true → skipped

// Functions: setState(() => fn) NEVER bails out
setState(() => myFn); // Object.is(fn1, fn2) = always false → always re-renders
```

---

## Event Data Access Rules

### What to Read (Top-Level Fields)

```javascript
// CORRECT: Read from flat structure after transform
const { eventTitle, startDateTime, endDateTime, locations, status } = transformEventToFlatStructure(event);
```

### What NOT to Read

```javascript
// NEVER: Read from graphData for display
event.graphData.subject;           // Raw Graph cache - not authoritative
event.graphData.start.dateTime;    // May not match edited values

// NEVER: Read requester from top level
event.requestedBy;                 // Does not exist at top level
// CORRECT:
event.roomReservationData.requestedBy.email;
```

---

## Form Patterns

### RoomReservationFormBase

The shared form base handles all room reservation fields. Key integration point:

```javascript
// getProcessedFormData() collects all form values
// Used by: save draft, submit, pending edit, rejected edit
const formData = getProcessedFormData({ skipValidation: false });
// skipValidation: true for draft saves (times optional for drafts)
```

### SchedulingAssistant Integration

```javascript
// Conflicts flow up via onConflictChange callback
<SchedulingAssistant
  onConflictChange={handleConflictChange}  // Updates hasSchedulingConflicts
  rooms={selectedRooms}
  startDateTime={formData.startDateTime}
  endDateTime={formData.endDateTime}
/>

// Parent disables publish/save when conflicts detected
<Button disabled={hasSchedulingConflicts}>Publish</Button>
```

---

## Calendar View Patterns

### Event Expansion (Recurring Events)

Calendar views expand recurring series masters into individual occurrences:

```javascript
// For published events: Graph API returns expanded occurrences
// For drafts (no graphData): Build masterForExpansion from top-level fields
const masterForExpansion = {
  eventTitle: event.eventTitle,
  startDateTime: event.startDateTime,
  endDateTime: event.endDateTime,
  recurrence: event.recurrence,
  // ...
};
```

### Draft Badge Styling

```css
/* Drafts: gray, dotted border, reduced opacity */
.event-badge.draft {
  border: 1px dotted var(--color-neutral-400);
  opacity: 0.75;
  background: var(--color-neutral-100);
}
```

Drafts are owner-only visible (filtered in Calendar.jsx by `currentUserEmail`).

---

## Authentication Flow

```
1. MSAL popup login (Azure Entra ID)
2. Acquire two tokens:
   - Graph API token (for frontend Graph calls - mostly deprecated)
   - Custom API token (for backend calls)
3. Frontend: Authorization: Bearer <apiToken>
4. Backend: verifyToken middleware validates via JWKS
5. req.user.oid = user's Azure AD object ID
```

### Auth Config

- `src/config/authConfig.js` - MSAL configuration, scopes, redirect URIs
- `src/config/config.js` - API base URL, calendar config

---

## State Management

### Context Providers

```javascript
// Global state via React Context
<UserPreferencesContext.Provider>   {/* Calendar prefs, view settings */}
<TimezoneContext.Provider>          {/* User timezone for display */}
```

### Avoid Race Conditions

```javascript
// CORRECT: Pass data directly to avoid async state lag
const result = await saveEvent(formData);
handleSuccess(result.data); // Use result directly

// PROBLEM: Set state then immediately read it
setEventData(result.data);
handleSuccess(eventData); // Still has OLD value!
```

---

## Quick Reference: Key Files

| File | Purpose |
|---|---|
| `src/utils/eventTransformers.js` | Centralized event data transform |
| `src/components/shared/EventReviewExperience.jsx` | Unified modal layer |
| `src/hooks/useReviewModal.jsx` | Modal state + action handlers |
| `src/hooks/usePermissions.js` | Role-based permission flags |
| `src/components/RoomReservationFormBase.jsx` | Shared form fields |
| `src/components/RoomReservationReview.jsx` | Form + processing logic |
| `src/components/Calendar.jsx` | Main calendar view |
| `src/components/MyReservations.jsx` | User's own events |
| `src/config/authConfig.js` | MSAL / Azure AD config |

## Quick Reference: CSS Variables

```css
--color-error-500     /* Red - destructive actions */
--color-success-500   /* Green - constructive actions */
--color-warning-500   /* Amber - neutral actions */
--color-info-500      /* Blue - informational */
--color-neutral-400   /* Gray - disabled/draft */
```

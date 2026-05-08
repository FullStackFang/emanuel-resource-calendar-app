## ADDED Requirements

### Requirement: LocationContext value is memoized

`src/context/LocationContext.jsx` SHALL wrap the value passed to `LocationContext.Provider` in `useMemo`, with a dependency array that includes only the underlying state values (rooms, locations, loading flags, error, refetch reference). The provider SHALL NOT pass a fresh object literal as the context value on every render.

#### Scenario: Consumers do not re-render when unrelated parent state changes

- **WHEN** a parent of `RoomProvider` re-renders due to unrelated state
- **THEN** `LocationContext.Provider`'s `value` reference is stable, and consumers (`Calendar`, `RoomReservationFormBase`, `SchedulingAssistant`) do not re-render solely because the context value changed identity

#### Scenario: Consumers re-render only when relevant data changes

- **WHEN** the underlying rooms or locations data updates
- **THEN** the memo recomputes, the provider's value identity changes, and consumers re-render to reflect the new data

### Requirement: Pure utility functions in Calendar.jsx live at module scope

The pure helper functions currently inside `Calendar.jsx` (computing event positions, formatting display fields, normalizing dates, deriving filter predicates — those that close over no component state or props) SHALL be extracted to a module-scope file (`src/utils/calendarEventUtils.js`) and imported into `Calendar.jsx`. They SHALL NOT be wrapped in `useCallback` or `useMemo` once they are module-scope functions.

#### Scenario: Module-scope utilities are imported

- **WHEN** `Calendar.jsx` needs to compute event display positions
- **THEN** it imports the helper from `src/utils/calendarEventUtils.js` and calls it directly — no `useCallback` wrapper

#### Scenario: Memoized child components benefit from stable references

- **WHEN** `WeekView`, `DayView`, or `MonthView` receives one of these helpers as a prop
- **THEN** the prop reference is stable across `Calendar.jsx` re-renders, so the child's `React.memo` wrapper is not bypassed

### Requirement: Inline computed props passed to memoized children are memoized

Where `Calendar.jsx` constructs an inline value (object, array, function call) at render time and passes it to a memoized child component (notably the `getDatabaseLocationNames()` argument passed to `MonthView` near `Calendar.jsx:5516`), the value SHALL be wrapped in `useMemo` so the prop reference is stable across renders.

#### Scenario: MonthView prop is stable

- **WHEN** `Calendar.jsx` re-renders without the location data changing
- **THEN** the value passed to `MonthView` for the location names is the same reference as the previous render, and `MonthView`'s memoization succeeds

### Requirement: Calendar.jsx is decomposed into orchestration plus extracted units

`src/components/Calendar.jsx` SHALL be reduced to an orchestration shell of approximately 1,500 lines or fewer. The following extracted units SHALL exist:

- `src/utils/calendarEventUtils.js` — module-scope pure helpers.
- `src/hooks/useCalendarDataLoader.js` — encapsulates the data-loading effect chain currently around `Calendar.jsx:1418–2238`.
- `src/hooks/useCalendarFilters.js` — encapsulates filter derivation currently around `Calendar.jsx:2852–3555`.
- `src/hooks/useUserProfileSync.js` — encapsulates profile sync currently around `Calendar.jsx:2363–2455` and `5264–5291`.
- `src/components/CalendarModals.jsx` — encapsulates the modal subtree currently around `Calendar.jsx:5640–5878`.

#### Scenario: Calendar.jsx line count target is met

- **WHEN** the change is archive-ready
- **THEN** `wc -l src/components/Calendar.jsx` reports at most 1,500 lines

#### Scenario: Each extracted unit is independently testable

- **WHEN** a developer wants to test calendar filter logic
- **THEN** they import `useCalendarFilters` (or its pure parts) directly and test it without mounting the full Calendar shell

### Requirement: MonthView avoids unnecessary repeated event-list iterations

The `filteredEvents` computation that feeds the calendar views SHALL avoid double-iteration patterns. Where today's code iterates the full event list twice (e.g., once for derivation and once for rendering), the extraction SHALL collapse those into a single pass when the result is identical, or SHALL document why two passes are required.

#### Scenario: Single-pass filtering is the default

- **WHEN** `useCalendarFilters` produces the filtered event list
- **THEN** it does so via one iteration over the source list, not two, unless a comment in the hook explains why two passes are required

### Requirement: Render-hygiene fixes are testable

There SHALL be at least one frontend test asserting that `LocationContext` consumers do not re-render solely due to provider re-creation, and at least one frontend test asserting that `MonthView` skips its render path when its inputs are referentially stable. Decomposition steps SHALL each be accompanied by targeted tests for the extracted hook or utility.

#### Scenario: LocationContext memo regression test

- **WHEN** the LocationContext memo is removed (hypothetical regression)
- **THEN** the dedicated test fails because consumer render counts increase under unchanged underlying data

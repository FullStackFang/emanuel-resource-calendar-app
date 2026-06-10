## 1. Backend — collection, CRUD, read API

- [x] 1.1 Add `templeEvents__CalendarMarkers` collection init in `connectToDatabase()` (`backend/api-server.js`, alongside the other `withRetryCollection(...)` assignments) and create the `{ startDate: 1, endDate: 1, active: 1 }` index in the index-setup block
- [x] 1.2 Add a cached read helper + `invalidateCalendarMarkersCache()` modeled on `getCachedCategories()` / `invalidateCategoryCache()`
- [x] 1.3 Write Jest tests first (`backend/__tests__/calendarMarkers.test.js`) for create/update/delete, validation (type, non-empty name, `endDate >= startDate`), admin-only gating, soft-delete, and the range read — using the existing `testSetup`/`authHelpers` helpers
- [x] 1.4 `GET /api/calendar-markers` — return active markers, optional `start`/`end` window filter using the lexical overlap predicate (`startDate <= end && endDate >= start`)
- [x] 1.5 `POST /api/calendar-markers` — admin-only (`isAdmin` from `utils/authUtils.js`), validate input, persist with audit fields, `active: true`, and an explicit `graphData: null` (so the later full-object `$set` does not no-op through a missing parent in Cosmos). No `_version`/`conditionalUpdate` — markers deliberately opt out of OCC (see design.md Decision 9)
- [x] 1.6 `PUT /api/calendar-markers/:id` — admin-only, validate, update + bump audit fields, invalidate cache
- [x] 1.7 `DELETE /api/calendar-markers/:id` — admin-only soft-delete (`active: false`), invalidate cache
- [x] 1.8 Confirm markers are absent from `/api/events/load`, `/api/events/list`, and counts (separate collection ⇒ no filter changes); add a regression assertion
- [x] 1.9 Run `cd backend && npm test -- calendarMarkers.test.js` until green

## 2. Frontend — ribbon rendering across Month / Week / Day

- [x] 2.1 Add a `keys.calendarMarkers` entry to `src/queries/keys.js` (do not hand-roll ad-hoc string keys), then add a `useQuery` for `GET /api/calendar-markers` and derive a `markersByDate` Map (key `YYYY-MM-DD`) in `Calendar.jsx`; pass it to MonthView/WeekView/DayView
- [x] 2.2 Write Vitest tests first for ribbon rendering: holiday gold / closed red, multi-day span repeats, multiple-markers-per-day, and "today" highlight preserved
- [x] 2.3 `MonthView.jsx` — render the `.marker-ribbon` as the first child of the day cell when the day is in `markersByDate`; truncate long names with ellipsis
- [x] 2.4 `MonthView.css` — add `.marker-ribbon` (transparent wash: holiday `rgba(234,179,8,.16)` + `--color-accent-700`; closed `rgba(220,38,38,.13)` + `--color-error-700`; uppercase, bold, `--text-2xs`) — extracted to shared `CalendarMarkerRibbon.css` so Week/Day views load it too
- [x] 2.5 `WeekView.jsx` / `DayView.jsx` — render the same ribbon in the day-column header for marked days
- [x] 2.6 Run `npm run test:run` for the new render tests until green

## 3. Frontend — admin "Holidays & Closures" management screen

- [x] 3.1 Add a management screen in the admin/settings area (near Categories) listing active markers grouped/sorted by date
- [x] 3.2 Create/edit form: type (Holiday/Office Closed), name, optional note, start/end date, `warnOnReservation`, `pushToOutlook`, optional color override
- [x] 3.3 Delete uses the in-button confirmation pattern (red confirm state, no `window.confirm`); success/error via `useNotification()` toasts
- [x] 3.4 Wire the screen to the CRUD endpoints; invalidate `keys.calendarMarkers` on every mutation (`queryClient.invalidateQueries`) so the calendar ribbon refreshes — same single-tab invalidation contract as Categories (cross-tab/user freshness waits for `staleTime`; see design.md)
- [x] 3.5 Vitest coverage for the form (validation surfacing, create/edit/delete happy paths)

## 4. Backend — Outlook all-day sync

- [x] 4.1 Add a NEW exported `buildGraphMarkerEventData(marker)` in `utils/graphEventBuilder.js` (do NOT extend `buildGraphEventDataFromRecord()` — it reads `event.calendarData` and emits timed start/end, which a flat marker does not have). Emit: `isAllDay: true`, `start.dateTime` = `startDate`, exclusive `end.dateTime` = `endDate` + 1 day via UTC date math, and **omit `timeZone`** on start/end (Graph rejects all-day events that carry one); `showAs` from type (`oof` closed / `free` holiday); subject/body from name/note
- [x] 4.2 Write Jest tests first for the all-day mapping: single-day exclusive end, multi-day span, `showAs` per type, DST-boundary date correctness
- [x] 4.3 On marker create with `pushToOutlook: true` → `graphApiService.createCalendarEvent()` to the TempleEvents calendar; store `graphData` (id + calendar identity) back via a single full-object `$set` (the `graphData: null` parent from 1.5 makes this land). Follow the design.md "Marker → Graph state matrix" for every case
- [x] 4.4 On marker update, branch per the state matrix: `pushToOutlook: true` + existing `graphData.id` → patch; `pushToOutlook: true` + no `graphData.id` → CREATE the Graph event (stage → activate path) and store linkage; `pushToOutlook` toggled off (had `graphData.id`) → delete the Graph event and clear linkage
- [x] 4.5 On marker delete → delete the linked Graph event when `graphData.id` exists
- [x] 4.6 Isolate Graph failures: persist the marker write regardless, log via the error-logging service; add a test for the failure-isolation path
- [x] 4.7 Run the Graph mapping + sync tests until green

## 5. Frontend — soft reservation advisory in booking forms

- [x] 5.1 In the booking/reservation form(s), when the selected date is covered by an active `warnOnReservation` marker, show a dismissible, non-blocking advisory naming the marker (reuse the shared marker query / `markersByDate`)
- [x] 5.2 Ensure the advisory never blocks submission and never raises a 409 (`checkRoomConflicts` untouched)
- [x] 5.3 Vitest: advisory shown for flagged day, hidden without the flag, submission still allowed

## 6. Verification & wrap-up

- [ ] 6.1 Manual end-to-end: create a single-day Holiday and a multi-day Office Closed (with warn + push); confirm ribbons in Month/Week/Day, the booking advisory, and the all-day events landing on the TempleEvents Outlook calendar with correct `showAs`
- [ ] 6.2 Edit and delete a pushed marker; confirm the Outlook event patches and then disappears
- [x] 6.3 Run the targeted backend + frontend test files; update `CLAUDE.md` "Completed Architectural Work" with a one-line entry
- [x] 6.4 `openspec validate add-calendar-markers --strict` passes

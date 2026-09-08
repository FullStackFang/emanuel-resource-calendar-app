# Approved edit displayed on the old date

Investigated 2026-09-08 using read-only queries against the configured `emanuelnyc` database and an app-only Graph GET for the linked production event. No production records were changed.

Event: Dash Greenberg Rehearsal #1

- Event ID: `evt-request-1787067397075-uoi48kedt`
- MongoDB ID: `6a847c0538bf7be912b8c84b`
- Calendar owner: `templeevents@emanuelnyc.org`
- Requester: Rachel Spencer
- Approver: Daniela Guitelman

## Recorded timeline

All action times below are America/New_York (EDT). Event dates are in 2027; actions took place in 2026.

| Action time | Evidence |
| --- | --- |
| Aug 18, 11:36:37 AM | Rachel submitted this event. The creation audit records its title and pending status, but not its initial date. |
| Aug 18, 11:37:58 AM | Daniela published it, according to statusHistory. The publication audit was written at 11:38:01 AM. |
| Aug 24, 11:04:32 AM | Rachel submitted edit request `edit-req-1787583872943-kl58pvchz`. Its baseline was April 26, 6:00-7:00 PM, event version 3. The submission audit proposes reservation times 4:00-5:00 PM and 120-minute buffer values; it does not propose a new date. |
| Aug 24, 12:04:10 PM | An event-updated notification was logged as successfully sent to Rachel. |
| Aug 24, 12:04:50 PM | Daniela approved that request. The surviving request has empty proposedChanges and the approval audit has an empty changes array. The admin-save code prunes addressed fields from pending requests; this is consistent with a direct save preceding approval, but the field-level direct-save audit is absent. |
| Sep 8, 9:19:18 AM | Rachel submitted edit request `edit-req-1788873558716-c9gqqm7yp`. Its baseline was April 26, 4:00-5:00 PM, event version 5. It proposes April 29, 4:30-5:30 PM. |
| Sep 8, 9:20:54 AM | Daniela approved that request. Audit `6aa00bb79c0f73f57041cdbd` explicitly records April 26 -> April 29 and 4:00-5:00 PM -> 4:30-5:30 PM. Approver overrides also explicitly set startDate and endDate to April 29. |
| Sep 8, 9:22:40 AM | The linked Graph event was last modified. Its current start/end are April 29, 20:29-21:30 UTC, equivalent to 4:29-5:30 PM New York time. |
| Sep 8, 9:22:42 AM | The app event was last modified by Daniela and is version 7. calendarData, stored start/end wrappers, and cached graphData all now show April 29, 4:29-5:30 PM. |
| Sep 8, 9:22:43 AM | Another event-updated notification was logged as successfully sent to Rachel. |

There are six matching EventAuditHistory records, two approved EditRequests, and zero matching ReservationAuditHistory records. A same-title search found one earlier deleted request for April 14 and this active request; it did not find another active rehearsal under the searched title.

## Reproduced calendar defect

`PUT /api/edit-requests/:id/approve` applies dates to `calendarData.*`. It does not update previously persisted top-level `start` and `end` wrappers. `getUnifiedEvents()` previously rebuilt those wrappers only if absent. The `/api/events/load` response then preferred the stale wrappers over calendarData.

The regression test uses the real Express app and a test database:

1. Save a published event with April 26 in calendarData and start/end.
2. Approve an edit moving it to April 29.
3. Load the calendar as its requester.
4. Before the fix, calendarData says April 29 while the response's display start says April 26.

The fix rebuilds the display wrappers from calendarData on every read. The existing Hold reservation-time override still runs afterward and has explicit regression coverage. No data migration is required for this display fix.

This provides a concrete mechanism consistent with Rachel's report without an authoritative date reverting. The historical start/end wrappers immediately after approval were not retained, and Rachel's exact screen/time has not been confirmed. No surviving audit entry records April 29 -> April 26. The absence of such an entry is not proof no unlogged write occurred.

## History tab defects and fixes

- The event-history endpoint filtered by eventId AND the caller's userId. That rejected non-owner admins and approvers with 404. It now allows approvers/admins and the current canonical requester, retains legacy ownership for non-reservation events, and continues to hide history from unrelated users.
- EventAuditHistory rendered `changes` as one object, although approval audits use an array. It now renders those arrays as expandable field changes, preserves legacy changeSet/single-object formats, suppresses empty-array artifacts, and displays the recorded actor identifier/email.

## Remaining evidence gaps / separate defects

- Edit-request approval contains no Graph update. The app and Outlook can diverge until another action synchronizes Outlook. The later admin-save path does update Graph, consistent with the live event's 9:22:40 modification. This investigation's fixes do not add Graph synchronization to approval.
- Direct admin saves do not produce the same comprehensive event audit entry as edit approvals. The 9:22 save is evidenced by document metadata, Graph metadata, and the notification log; its exact previous values and the reason for 4:29 rather than 4:30 cannot be recovered from the available audit entries.
- Notification success proves the system logged a successful send, not that Rachel received/read the message or that her browser refreshed.

## Verification

- New focused tests: 9 API history permission/pagination cases, 2 approval/calendar/Hold cases, 4 History component cases.
- The original approval/reload test failed with April 26 returned where April 29 was expected; it passes after the loader fix.
- History tests failed before the corresponding API/UI fixes and pass afterward.
- Broader `calendarLoad.test.js` and `recurringCalendarLoad.test.js` checks: 12 failures and 10 passes, identical against HEAD and the modified implementation. These remain pre-existing issues: the old calendarLoad helper targets a removed route, and two legacy calendarData-only recurrence cases fail.
- No production deployment was performed.

## Follow-up: shared, live History tab

At the user's request, History is now visible to requesters as well as other signed-in roles. Published-event history is readable by any authenticated user. Draft/pending/rejected/deleted histories still follow event ownership and approver/admin access.

The local implementation now:

- Combines EventAuditHistory and legacy ReservationAuditHistory into one paginated timeline used by the review modal and reservation form.
- Refreshes through the existing SSE-to-React-Query invalidation, on focus, and every 30 seconds while visible as a fallback. Older entries remain reachable through Load older changes; expanded entries stay associated with their audit ID when new entries arrive.
- Shows requested changes separately from applied changes and supports both legacy from/to and current oldValue/newValue audit formats.
- Records committed direct admin/approver saves with before/after values, actor email, and event versions. Failed version checks do not generate a success audit. This closes the ordinary admin-save gap prospectively; it does not reconstruct the September 8 9:22 save's missing audit.
- Waits for the approval audit write before broadcasting its live change notification.

Follow-up verification: 35 focused backend tests and 29 frontend tests passed. ESLint reports zero errors on the changed frontend files, with three pre-existing hook-dependency warnings in UnifiedEventForm. The original broader-calendar baseline findings above still apply. Deployment remains pending.

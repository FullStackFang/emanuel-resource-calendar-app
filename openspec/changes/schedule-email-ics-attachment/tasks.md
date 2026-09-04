# Tasks: schedule-email-ics-attachment

## 1. Pure builder: time resolution

- [x] 1.1 Create `backend/utils/icsBuilder.js` with no npm or server imports (same stance as `sheetCells.js` / `concurrencyRules.js`), and `backend/__tests__/unit/icsBuilder.test.js` beside it
- [x] 1.2 Implement `parseCellTime(text)` per D4: 24-hour `HH:MM`, `H`/`H:MM` with optional meridiem (case-insensitive, optional periods, tolerant of surrounding whitespace); returns `{ hour, minute }` or null. Unit-test every scenario in the parsing requirement, including 'after Mincha', 'TBD' and empty returning null
- [x] 1.3 Implement the bare-time ambiguity rule: hour 12 and 1-6 resolve PM, 7-11 resolve AM. Test '5:30' to 17:30, '9:00' to 09:00, '12:00' to 12:00
- [x] 1.4 Implement `zonedWallClockToUtc(dateStr, hour, minute, timeZone)` per D7 using `Intl.DateTimeFormat` offset lookup with a refinement pass. Test one EDT date and one EST date and assert the emitted instants differ by the correct offset
- [x] 1.5 Implement `resolveEventWindow(entry)` per D3: start from effective call time, then Begins, then `linkedSnapshot.startDateTime`; end from Ends, then `linkedSnapshot.endDateTime`, then start + 2h; roll a midnight-crossing end to the next day. Test each fallback rung and the crossing case independently

## 2. Pure builder: iCalendar emission

- [x] 2.1 Implement `escapeText()` and `foldLine()` per D9 — folding MUST measure UTF-8 octets, not string length. Test with an accented name that crosses 75 bytes but not 75 characters (this is the assertion that fails if folding is done on `.length`)
- [x] 2.2 Implement `buildUid(entry, email)` per D6: `<dayId>-<rowId>-<colId>-<sanitized email>@emanuelnyc.org`, email lowercased and reduced to `[a-z0-9-]`. Test determinism across two calls and distinctness for two people in one cell
- [x] 2.3 Implement timed `VEVENT` emission: `UID`, `SEQUENCE` from `entry.sequence`, `DTSTAMP`, `DTSTART`/`DTEND` as `Z` instants, `SUMMARY` naming role and column, `DESCRIPTION` carrying the literal Call Time / Begins / Ends cell text and any note, `LOCATION` from `locationLines` joined
- [x] 2.4 Implement all-day `VEVENT` emission per D5: `DTSTART;VALUE=DATE` with an EXCLUSIVE `DTEND;VALUE=DATE` on the following day. Test the exclusive end explicitly — an inclusive end is the classic all-day off-by-one
- [x] 2.5 Implement `buildAssignmentsCalendar(entries, { dtstamp })` wrapping the components in `VCALENDAR` with `VERSION:2.0`, `CALSCALE:GREGORIAN`, `PRODID`, and `METHOD:PUBLISH`; CRLF throughout including the final line. Test that no `ATTENDEE` and no `METHOD:REQUEST` appear anywhere in the output
- [x] 2.6 Test a mixed file end to end: 4 entries, 2 timed and 2 unparseable, produces 4 `VEVENT` components with the expected shapes

## 3. Endpoint integration

- [x] 3.1 Extend `extractDayAssignments()` per D12 to also return `sequence` (day `_version`) and `linkedSnapshot` (the column's `linkedEvent.snapshot` or null)
- [x] 3.2 Add a regression assertion that `GET /api/my-assignments` response shape and contents are unchanged by 3.1 — measure before and after, do not assume
- [x] 3.3 Read `includeCalendar` from the request body in `POST /api/scheduling-sheets/:id/email`, treating anything other than `true` as opt-out (D11 rollback property)
- [x] 3.4 Build the calendar attachment INSIDE the `Promise.allSettled` per-recipient callback from that recipient's sorted `entries` (D1) — deliberately unlike `pdfAttachment`, which is built once outside the map. Attach as `{ name, contentType: 'text/calendar; charset=utf-8; method=PUBLISH', contentBase64 }` alongside the PDF in the existing `attachments` array
- [x] 3.5 Wrap generation in try/catch per D10: a throw sets `calendarWarning`, omits the attachment, and leaves the send successful with its `emailLog` entry intact
- [x] 3.6 Enforce the size budget shared with the PDF against `MAX_SCHEDULE_ATTACHMENT_BYTES`; oversize drops the calendar file with a warning rather than failing the send
- [x] 3.7 Add `calendarAttached` (and `calendarWarning` when set) to the response body beside the existing `attached` / `attachmentWarning`

## 4. Backend integration tests

- [x] 4.1 Extend `backend/__tests__/integration/schedulingSheetEmail.test.js`: day-scoped send attaches one `.ics` per recipient containing only that recipient's assignments
- [x] 4.2 Whole-workbook send produces one file spanning both dates for a person tagged on two days
- [x] 4.3 `includeCalendar: false` and an absent `includeCalendar` both send with no calendar attachment and `calendarAttached: false`
- [x] 4.4 A generation failure yields `calendarWarning`, a delivered email, a successful result entry, and an `emailLog` append (mutation check: make the builder throw and assert the send still succeeds)
- [x] 4.5 Placeholder chips produce no calendar events and remain reported in `skippedPlaceholders`
- [x] 4.6 Emailing the same day twice with no edits produces identical `UID` values; editing a cell in between produces a strictly higher `SEQUENCE`
- [x] 4.7 Reordering columns by drag between two sends leaves each unchanged assignment's `UID` unchanged

## 5. Send panel toggle

- [x] 5.1 Add `includeCalendar` local state to `EmailSchedulesPanel.jsx`, defaulting to `true`, rendered as a labelled checkbox near the send action; include it in the body passed to `onSend`
- [x] 5.2 Surface `calendarWarning` via `showWarning` in `SchedulingSheets.jsx` `sendSchedules`, alongside the existing `attachmentWarning` handling
- [x] 5.3 Component tests: the control defaults on, the body carries `includeCalendar: true` on an unmodified send, clearing it sends `false`, and a returned `calendarWarning` raises a warning toast

## 6. Verification

- [x] 6.1 Run `cd backend && npm test -- icsBuilder.test.js` and `npm test -- schedulingSheetEmail.test.js` and confirm green
- [x] 6.2 Measure the backend baseline by stash (`git stash push -u`, run, `git stash pop`, run) and confirm this change adds no new failures to the red main
- [x] 6.3 Run the frontend scheduling suites and confirm the documented 10-failure / 3-file baseline is unchanged
- [x] 6.4 Lint every touched file clean
- [x] 6.5 Validate one generated file against an external RFC 5545 validator before trusting hand-written assertions

## 7. Manual verification (live MSAL, real mailbox)

- [ ] 7.1 Send a day-scoped schedule to a test mailbox and open the attachment in Outlook desktop, Outlook on the web, iOS Mail and Gmail — record for each whether all events import, only the first, or a download is required. This is the open question D1 depends on
- [ ] 7.2 Confirm Exchange does not transform the message into a meeting request and that no Accept/Decline chrome appears (D2). If it does, drop the `method=` content-type parameter and retest
- [ ] 7.3 Verify a timed assignment lands at call time, not event start, and that a 'TBD' assignment arrives as an all-day entry on the right date
- [ ] 7.4 Edit a cell, re-send, and record per client whether entries UPDATE in place or duplicate (D6 / the Outlook risk). Document the real behavior in CLAUDE.md
- [ ] 7.5 Send with the toggle cleared and confirm the email arrives with the PDF only
- [ ] 7.6 Verify a DST-boundary date if the workbook spans early November, confirming the emitted instant matches the intended wall-clock time

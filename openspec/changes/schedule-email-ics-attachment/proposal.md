## Why

A scheduling sheet schedule email tells someone they are ushering at 4:30 on Kol Nidre, and then does nothing to get that into the calendar they actually live in. The workbook PDF that rides along is a *document* — a picture of the grid — so every recipient either retypes their shifts by hand or forgets them. The one artifact that would close the gap, an `.ics` file, is a few kilobytes of text and the mail plumbing to carry it already exists: `emailService.sendEmail` takes `attachments: [{ name, contentType, contentBase64 }]` with a per-attachment content type, and the PDF proves the path works end to end.

The data is equally ready. `extractDayAssignments()` already yields exactly the per-person, per-scope entries a calendar file needs — date, effective call time, begins, ends, location, column name, note — grouped by recipient by the send endpoint. What is missing is a translator.

## What Changes

- **New `backend/utils/icsBuilder.js`** — a dependency-free iCalendar generator (same stance as `sheetCells.js`, `concurrencyRules.js`, `conflictDelta.js`: pure, no server, unit-testable). Turns an array of assignment entries into one RFC 5545 `VCALENDAR` string.
- **One `.ics` per recipient, containing every one of their in-scope assignments as a separate `VEVENT`.** A day-scoped send yields a file with that person's shifts for the day; a whole-workbook send yields their entire season in a single file. This is the structural difference from the PDF, which is one identical blob attached to all 31 messages: the calendar file is **built inside the per-recipient fan-out**, because its contents differ per person.
- **A calendar entry spans call time to end** — the person's own `callTimeOverride` beats the column's Call Time row, falling back to Begins when there is no call time. A staff member's calendar should block their commitment, not the public event window. This is why `callTimeOverride` is per-person in the first place.
- **Assignments with unparseable times become all-day events**, never disappear. Begins/Ends are free-text cells; "TBD", "after Mincha", and empty are all legal content. An all-day `VEVENT` naming the assignment keeps the recipient's calendar honest, mirroring the placeholder decision already made on this endpoint: report the gap, never withhold the schedule.
- **`METHOD:PUBLISH`, not `METHOD:REQUEST`.** A request would make Exchange treat the shared mailbox as the organizer of a 31-attendee meeting on every send, with RSVP tracking nobody asked for.
- **Stable `UID` plus a real `SEQUENCE`** so re-sending an edited sheet *updates* the recipient's existing entries instead of duplicating them. The day document's `_version` — already `$inc`'d on every structural and cell write — is the sequence source.
- **A per-send toggle in the email panel**, defaulting on, beside the existing PDF attachment control. Response gains `calendarAttached` and, on failure, `calendarWarning`.
- **Attachment failure is never a send failure.** A calendar file that cannot be built warns and the self-contained email goes out regardless, exactly as `attachmentWarning` already governs the PDF.

Not in scope: retracting calendar entries when an assignment is deleted (`METHOD:CANCEL` only works on entries the recipient added from a matching `UID`, so it is an all-or-nothing commitment worth its own change), and a subscribable `webcal://` assignments feed.

## Capabilities

### New Capabilities
- `schedule-email-calendar-attachment`: generating an RFC 5545 calendar file from a recipient's scheduling-sheet assignments, and attaching it to their schedule email — time resolution from free-text cells, all-day fallback, identity and update semantics, timezone correctness, size and failure isolation, and the send-panel toggle.

### Modified Capabilities
<!-- None. `scheduling-schedule-email` is not yet a baseline spec under openspec/specs/ (it
     lives in the unarchived `scheduling-sheets` change), so the calendar attachment is
     specified as its own capability rather than as a delta against an unpublished one. Its
     requirements deliberately reference that endpoint as the host. -->

## Impact

**Backend**
- `backend/utils/icsBuilder.js` — new, pure, dependency-free.
- `backend/api-server.js` — `POST /api/scheduling-sheets/:id/email`: build a calendar attachment per recipient inside the existing `Promise.allSettled` fan-out; extend the response. `extractDayAssignments()` gains the column's `linkedEvent` snapshot times as a fallback source and the day `_version` for sequencing.
- `backend/services/emailService.js` — **no change required**; `contentType` is already per-attachment.
- Attachment budget: the existing `MAX_SCHEDULE_ATTACHMENT_BYTES` (3MB) guard protects a Graph `sendMail` ceiling near 4MB, and the calendar file now shares that budget with the PDF rather than sitting outside it.

**Frontend**
- `src/components/scheduling/` email panel — one checkbox, default on; surface `calendarWarning` alongside the existing `attachmentWarning`.

**Tests**
- New `backend/__tests__/unit/icsBuilder.test.js` (format conformance, time resolution, all-day fallback, escaping, folding, UID stability).
- `backend/__tests__/integration/schedulingSheetEmail.test.js` — extended for per-recipient content, the toggle, and warning isolation.
- Frontend email-panel component tests for the toggle.

**No change to**: the event data model, `templeEvents__Events`, Graph calendar sync, the approval workflow, or any other email template. Nothing here writes to Outlook.

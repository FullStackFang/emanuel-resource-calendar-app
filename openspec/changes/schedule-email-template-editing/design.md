## Context

- **Templates today.** `backend/services/emailTemplates.js` holds a code
  registry (`DEFAULT_TEMPLATES`); per-template overrides live in
  `templeEvents__SystemSettings` as `_id: 'email-template-<id>'`
  `{subject, body, updatedAt, updatedBy}`. `getTemplate` resolves
  `override?.subject || default.subject` field by field. One override slot per
  template id; no variants.
- **Editor today.** `src/components/EmailTestAdmin.jsx` ("Email Management",
  `/admin/email-test`, admin nav only) has a Settings tab and a Templates tab.
  The Templates tab is a list + subject `<input>` + `ReactQuill` body +
  variables list + iframe preview + Save / two-step Reset. All eight
  `/api/admin/email/*` routes check `isAdmin`.
- **Schedule send today.** `POST /api/scheduling-sheets/:id/email`
  (`requireAssignmentManager`: approver+ or Events department) plans scope,
  groups entries by address, and inside a concurrency-4 fan-out calls
  `generateFromTemplate(ASSIGNMENT_SCHEDULE, vars, { subjectOverride })` per
  recipient. The only per-send customization is the subject (3bcbf1c).
- **Preview today.** `previewTemplate` renders the stored or unsaved template
  against `SAMPLE_ASSIGNMENTS` ("Sarah Levine"). There is no real-recipient
  preview and no "send this template to me".

Stakeholders: approvers (who actually send schedules), admins, and the 30-50
volunteers and staff who receive them.

## Goals / Non-Goals

**Goals:**
- An approver can read, edit and save the schedule email body from the panel
  they send from, and the edit is the one shared template.
- An approver can see the exact email a specific recipient will get, and send
  that exact email to themselves, before sending to everyone.
- Approvers can edit every email template in Email Management; delivery
  settings stay admin-only.

**Non-Goals:**
- Named template variants, per-send body drafts, or per-sheet templates.
- Editing the generated per-person schedule block (`{{assignmentsTable}}`);
  it stays code-rendered.
- Fixing ReactQuill's inline-style stripping (pre-existing, all templates).
- Template version history / undo beyond "Reset to default".
- Letting non-approver Events-department senders edit anything.

## Decisions

### D1. One shared template; the panel edits the same override
The panel saves through the existing `PUT /api/admin/email/templates/assignment-schedule`.
There is no new storage. *Alternatives:* named variants (more flexible, new
collection + picker + permissions per variant); per-send drafts (nothing to
maintain but retyped every time). The user chose one shared template so the
wording in Email Management and in the panel can never disagree.

### D2. `canEditEmailTemplates` is a role permission, approver and above
Added to `ROLE_PERMISSIONS` (viewer/requester false, approver/admin true) and
surfaced through `getPermissions` → frontend `usePermissions`. Server routes
check `hasRole(user, email, 'approver')` after `findUserByIdentity` — the user
is re-fetched, never trusted from JWT claims, same as `requireAssignmentManager`.
A small `requireTemplateEditor(req, res)` helper replaces the five copies of the
inline admin check. It is role-only (no department grant), unlike
`canManageAssignments`, because the user scoped it to approvers.

Gate split:

| Route | Before | After |
|---|---|---|
| `GET /api/admin/email/templates` | admin | template editor |
| `GET /api/admin/email/templates/:id` | admin | template editor |
| `PUT /api/admin/email/templates/:id` | admin | template editor |
| `POST /api/admin/email/templates/:id/preview` | admin | template editor |
| `POST /api/admin/email/templates/:id/reset` | admin | template editor |
| `GET /api/admin/email/config` | admin | admin (unchanged) |
| `PUT /api/admin/email/settings` | admin | admin (unchanged) |
| `POST /api/admin/email/test` | admin | admin (unchanged) |

### D3. Email Management opens to approvers, Templates tab only
`/admin/email-test` is guarded by `canEditEmailTemplates`. For non-admins the
Settings tab is not rendered, `loadConfig` is not called (it would 403), and the
initial tab is `templates`. Nav: admins keep the link in the Admin dropdown;
non-admin approvers get it where they already find approver reports (same
pattern as Sync Health / Conflict Report).

### D4. Extract `EmailTemplateEditor` rather than build a second editor
`src/components/shared/EmailTemplateEditor.jsx` owns: subject input, ReactQuill
body (same toolbar/format whitelist), variables list, dirty tracking, Save,
two-step Reset to default, and "last updated by". Props:
`{ template, readOnly, onSaved, onDirtyChange, renderPreview? }`.
Email Management keeps its list and sample-data preview; the panel supplies
its own real-recipient preview. *Alternative:* a panel-local editor — rejected,
it would drift (variables, reset, sanitization) from the admin one.

The panel's template read uses `GET /api/admin/email/templates/:id` (currently
unused by the UI). Non-editor senders (Events-dept, non-approver) cannot call
it, so the sheet GET already returns `assignmentEmailSubject`; it additionally
returns `assignmentEmailBody` (resolved body HTML) so the read-only view works
for every sender without widening the template API.

### D5. Unsaved template edits block sending
While the panel's editor is dirty, "Email N people" is disabled with
"Save or discard your template changes first." Send always uses the STORED
template. Otherwise the panel would silently become a per-send draft (the
option not chosen), and the preview would show text nobody will receive.
The subject field is NOT part of this: it remains the existing per-send
subject override (3bcbf1c), prefilled from the template subject.

### D6. One per-recipient render, shared by send, preview and test-send
Extract from the send handler a pure-ish
`renderScheduleEmail({ sheet, scopeDays, namesOneDay, scopeLabel, entries, subjectOverride })`
→ `{ subject, html }`. Also extract the scope/grouping step
(`planScope` → `scopeDays` → `byEmail`) into a helper so preview and test-send
compute scope identically. The preview cannot drift from what is sent because
it IS the send's render.

### D7. Preview endpoint
`POST /api/scheduling-sheets/:id/email/preview`, `requireAssignmentManager`.
Body `{ dayIds, subject, recipientEmail }`. 404 if the sheet/days are missing,
400 `RECIPIENT_NOT_IN_SCOPE` if `recipientEmail` (case-insensitive) is not an
assigned, non-placeholder person in the selected days. Returns
`{ subject, html, recipientName }`, where `html` is the full wrapped email
(`wrapEmailTemplate` + CTA), ready for an iframe `srcDoc`. No writes. No
`expectedDayVersions` check — a preview is a read.

### D8. Test-send endpoint: to the caller, never anyone else
`POST /api/scheduling-sheets/:id/email/test-send`, `requireAssignmentManager`.
Body `{ dayIds, subject, recipientEmail, includeCalendar, attachment? }`.
Renders exactly as D7, prefixes the subject with `[Preview] `, and sends via
`withGraphRetry(() => emailService.sendEmail(req.user.email, ...))`.
- The destination is `req.user.email` from the verified token. There is no
  `to` field; any `to` in the body is ignored. This is what makes sending a
  real person's schedule safe.
- Attachments: the `.ics` is built for the PREVIEWED person's entries when
  `includeCalendar === true`; the PDF is the same client-uploaded
  `attachment` the real send accepts, under the same size limit and warnings.
- No `emailLog` append, no `lastModifiedAt`/`_version` change, no sent pill.
- `sendEmail` resolving `{ skipped: true }` (delivery disabled) returns
  `{ sent: false, skipped: true }` so the panel can say "Email delivery is
  turned off" instead of "Sent". System Settings redirect applies as usual.

### D9. Stale-save guard on template PUT
Two approvers can now edit the same shared template from different screens.
`PUT /api/admin/email/templates/:id` accepts optional `expectedUpdatedAt`
(the `updatedAt` the editor loaded, or `null` for "was not customized"). On
mismatch it returns 409 `TEMPLATE_CHANGED` with the current subject/body/
updatedBy, and the editor shows "Someone else saved this template — reload to
see their version" without overwriting. Omitting the field keeps today's
last-write-wins, so any older client still works.
*Alternative:* a `_version` counter — rejected, the override doc has no
version field and `updatedAt` is already written on every save and reset.

## Risks / Trade-offs

- [Approvers can now rewrite every notification template, including
  rejections and cancellations] → The user chose this explicitly. Saves keep
  `updatedBy`/`updatedAt`; "Customized only" filter plus Reset to default
  remain the recovery path. Settings (delivery on/off, redirect) stay admin-only.
- [ReactQuill strips inline styles from the default body on first edit] →
  Pre-existing for all templates; documented, not fixed here. The preview
  makes the effect visible before anything is sent.
- [Template saved by someone else between preview and send changes what
  recipients get] → Send reads the stored template at send time; D9 prevents
  silent overwrites but not a newer save by another approver. Accepted.
- [Test-send consumes one Graph send] → Negligible against the 4-concurrent /
  per-mailbox limits; it runs outside the fan-out.
- [`assignmentEmailBody` on the sheet GET enlarges that response] → One
  template body (a few KB); acceptable, avoids opening the template API to
  non-approver senders.

## Migration Plan

No data migration. Deploy backend first (new routes and widened gates are
additive; `expectedUpdatedAt` is optional), then frontend. Rollback: revert
the frontend; reverting the backend returns the template routes to admin-only
with no data impact, since override documents are unchanged in shape.

## Open Questions

- None blocking. Whether approvers should also get the generic Settings-tab
  test email is deliberately left out (the new test-send covers the schedule).

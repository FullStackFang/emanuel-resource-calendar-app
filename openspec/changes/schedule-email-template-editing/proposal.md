## Why

The people who send scheduling-sheet emails (approvers, via the Email Schedules
panel) cannot see or change the message those emails carry. Only the subject is
editable per send (commit 3bcbf1c); the body comes from the `assignment-schedule`
template, which is editable only by admins on a separate Email Management page.
The default body already carries time-bound rollout text ("first time we are
rolling out... call John O'Hara ext. 338") that will go stale, and a sender
has no way to see what a recipient will actually receive before 30+ emails go
out.

## What Changes

- **Approvers can edit email templates.** A new `canEditEmailTemplates`
  permission (approver and admin) replaces the admin-only gate on the five
  template endpoints (list, get, save, preview, reset). Email Management opens
  to approvers, showing the Templates tab only; the Settings tab (delivery
  on/off, redirect, generic test email) and its three endpoints stay admin-only.
- **The template editor is extracted** from `EmailTestAdmin.jsx` into a shared
  `EmailTemplateEditor` component, used by both Email Management and the
  Email Schedules panel.
- **The Email Schedules panel gains a Message section**: the current shared
  `assignment-schedule` body, read-only by default, editable in place by users
  with `canEditEmailTemplates`. Saving writes the SAME shared template override
  Email Management edits — there is one template, not per-send drafts or named
  variants. Unsaved template edits block sending.
- **Real-recipient preview**: `POST /api/scheduling-sheets/:id/email/preview`
  renders the exact subject and HTML one chosen recipient would receive for the
  selected days, through the same rendering path as the real send.
- **Send a preview to yourself**: `POST /api/scheduling-sheets/:id/email/test-send`
  sends that rendered email (subject prefixed `[Preview]`, same attachments) to
  the signed-in sender's own address ONLY. It writes no `emailLog` entry and
  changes no sent/stale state.

## Capabilities

### New Capabilities
- `email-template-editing`: who may view, edit, preview and reset email
  templates, and the admin-only boundary around email delivery settings.
- `schedule-email-composer`: the Email Schedules panel's message editing,
  real-recipient preview, and send-a-preview-to-me behavior.

### Modified Capabilities
<!-- None: no existing openspec/specs/ capability covers email templates or scheduling-sheet email. -->

## Impact

- **Backend** `backend/api-server.js`: gates on `/api/admin/email/templates*`
  (5 routes) change from `isAdmin` to `canEditEmailTemplates`; two new routes
  under `/api/scheduling-sheets/:id/email/`; the per-recipient render in the
  existing send endpoint is extracted so preview, test-send and send share it.
- **Backend** `backend/utils/permissionUtils.js`: new `canEditEmailTemplates`
  in `ROLE_PERMISSIONS` and `getPermissions`.
- **Frontend**: `EmailTestAdmin.jsx` (tab gating, editor extraction),
  new `src/components/shared/EmailTemplateEditor.jsx`, `EmailSchedulesPanel.jsx`,
  `useSchedulingSheets.js` (preview/test-send mutations), `Navigation.jsx` and
  the `/admin/email-test` route guard, `usePermissions` contract.
- **Security surface widened deliberately**: approvers can now change the text
  of every outbound notification template. Each save already records
  `updatedBy`/`updatedAt`.
- No schema change, no migration: the override store (`templeEvents__SystemSettings`,
  `_id: 'email-template-<id>'`) is unchanged.

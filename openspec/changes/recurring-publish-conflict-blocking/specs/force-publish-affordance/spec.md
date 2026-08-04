# Spec: force-publish-affordance

## ADDED Requirements

### Requirement: Hard-conflict 409s surface via the toast path
Hard-conflict 409s from the approve flow (recurring and single) SHALL surface
through the existing `onError` toast path with the server's `message`. No
`ConflictDialog` mode is added for hard conflicts.

#### Scenario: Recurring hard 409 shows the counted toast
- **WHEN** an approver's publish returns the recurring hard 409
- **THEN** a toast shows the server message naming how many occurrences
  conflict, and the mounted conflict panel in the open modal shows which dates

### Requirement: Admin force-publish via in-button confirmation
When the approve call returns `{ success: false, canForce: true, forceField }`
and the viewer is an admin, the Approve/Publish button in `ReviewModal` SHALL
enter the repo-standard in-button confirmation state ("Publish Anyway?",
warning color, pulse, persistent until acted on or navigation — no browser
dialog, no timeout). A second click SHALL resend the approve request with
`[forceField]: true` (mirroring the stored-retry-closure pattern used for
soft conflicts), showing the in-progress label while disabled. The same
mechanism SHALL apply to single-event hard conflicts (shared approve flow).

#### Scenario: Admin sees and uses the force affordance
- **WHEN** an admin's approve returns 409 with `canForce: true` and clicks
  the button again in its "Publish Anyway?" state
- **THEN** the approve request is resent with `forcePublish: true` and the
  publish succeeds

#### Scenario: Non-admin approver never enters the confirm state
- **WHEN** a non-admin approver's approve returns the hard 409
- **THEN** only the blocking toast appears; the button never offers
  "Publish Anyway?"

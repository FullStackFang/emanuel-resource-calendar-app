# Spec: review-modal-conflict-gate

Client-side use of the SchedulingAssistant's hard-conflict signal in
`ReviewModal`. The assistant reports every hard conflict on the viewed day,
including pre-existing collisions unrelated to the edit in hand, so it is
a valid gate for COMMITMENT actions (approve/publish) and not for saves.

## MODIFIED Requirements

### Requirement: Hard-conflict gate applies to commitment actions only
`ReviewModal` SHALL disable Approve/Publish for non-admins while
`hasSchedulingConflicts` is true (`hardConflictBlocks`). It SHALL NOT disable
Save, or Save & Resubmit, on that signal; those buttons SHALL be governed by
`hasChanges`, `isFormValid`, the in-flight flag, and the confirmation
exclusivity rule only. The server's 409 is the authority for save-time
conflicts and is surfaced by `useReviewModal` as a toast that prefers the
server `message`.

#### Scenario: Approver Save enabled under a pre-existing conflict (shipped 584bc9d)
- **WHEN** a non-admin approver has changes on a pending item and the
  assistant reports a hard conflict
- **THEN** Save is enabled and carries no conflict tooltip; Publish is
  disabled

#### Scenario: Requester Save & Resubmit enabled under a pre-existing conflict
- **WHEN** a requester has changes on their rejected item and the assistant
  reports a hard conflict
- **THEN** Save & Resubmit is enabled (server delta gate decides); it is
  still disabled with the 'make a change first' reason when there are no
  changes

#### Scenario: Save 409 toast is honest for every role
- **WHEN** a save returns a hard `SchedulingConflict` 409
- **THEN** the toast shows the server `message` and does not advertise a
  force override (plain Save arms none)

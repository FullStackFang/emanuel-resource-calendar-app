# additional-info-clergy Specification

## Purpose

Defines a second, deliberately redundant entry point to clergy assignment: the
same `⛪ Clergy` control and summary row that live on the Event Details tab are
also rendered on the Additional Information tab.

The redundancy is the point, and it was requested rather than inferred.
Approvers do clergy housekeeping while reading the Additional Information tab —
that is where submitter information, on-behalf-of, and the review metadata sit,
which is the context in which "who is covering this" gets decided. Forcing a
tab switch back to Event Details to act on that decision breaks the review in
the middle.

The governing constraint is that duplicating a control must not duplicate its
state. Both controls open the single `ClergySelectorModal` instance mounted at
the component root and read and write the same `assignedRabbi` /
`assignedCantor` form arrays, so there is no synchronization step that could
fail and no way for the two tabs to disagree about what is assigned. For the
same reason the disabled state is derived from the form rather than set per
tab. Changes save through the normal form save flow, so this capability adds no
backend surface at all.

## Requirements

### Requirement: Clergy assignment is reachable from the Additional Information tab
The Additional Information tab SHALL render a `⛪ Clergy` button and, when any
clergy are assigned, the same summary row (Rabbi/Cantor names with a Clear
action) as the Event Details tab. Both controls SHALL open the single mounted
`ClergySelectorModal` and read/write the same `assignedRabbi` /
`assignedCantor` form state, so the two tabs can never disagree. Changes save
through the normal form save flow.

#### Scenario: Button opens the shared modal
- **WHEN** a user on the Additional Information tab clicks the Clergy button
- **THEN** the same ClergySelectorModal opens that the Event Details tab uses

#### Scenario: Selections are visible on both tabs
- **WHEN** a rabbi is assigned via the Additional Information tab and the user
  switches to the Event Details tab
- **THEN** the Event Details clergy summary shows the same assignment

#### Scenario: Disabled state follows the form
- **WHEN** the form's fields are disabled (e.g. read-only review context)
- **THEN** the Additional Information clergy button is disabled too

#### Scenario: Clear removes assignments from either tab
- **WHEN** the user clicks Clear on the Additional Information clergy summary
- **THEN** `assignedRabbi` and `assignedCantor` are emptied and the Event
  Details summary disappears as well

# Spec: additional-info-clergy

## ADDED Requirements

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

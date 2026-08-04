# Spec: submitter-clergy-summary

## ADDED Requirements

### Requirement: Clergy assignment is always visible in Submitter Information
The Submitter Information grid SHALL render a Clergy cell unconditionally,
alongside the other read-only facts. When clergy are assigned it SHALL show one
entry per person, each labelled with its role. When neither `assignedRabbi` nor
`assignedCantor` holds anyone, it SHALL show `N/A`.

The cell SHALL be display-only. It SHALL NOT introduce a third editable clergy
control; assignment remains on the Event Details and Additional Information
tabs, which continue to share one modal instance and one pair of form arrays.

#### Scenario: Clergy assigned
- **WHEN** a rabbi and a cantor are assigned
- **THEN** the Clergy cell shows both, each labelled with its role

#### Scenario: Multiple people in one role
- **WHEN** two rabbis are assigned
- **THEN** the Clergy cell shows both as separate labelled entries

#### Scenario: Nobody assigned
- **WHEN** neither a rabbi nor a cantor is assigned
- **THEN** the Clergy cell renders and shows `N/A`

#### Scenario: Only one role assigned
- **WHEN** a rabbi is assigned and no cantor is
- **THEN** the Clergy cell shows the rabbi and does not claim a cantor

#### Scenario: The cell does not edit
- **WHEN** a user interacts with the Clergy cell in Submitter Information
- **THEN** no clergy selector opens and no form state changes

#### Scenario: Display follows the shared form state
- **WHEN** clergy are assigned through either existing control
- **THEN** the Submitter Information cell reflects the change without a
  separate synchronization step

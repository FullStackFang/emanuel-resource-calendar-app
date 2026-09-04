## ADDED Requirements

### Requirement: Offer directory people alongside app users
The system SHALL offer people from the Microsoft Entra ID directory in the scheduling
sheet `@` picker in addition to, and not instead of, people recorded in the app user
collection.

#### Scenario: Staff member who has never used the app is findable
- **WHEN** an assignment manager types a term matching a directory member who has no app
  user record
- **THEN** the picker SHALL offer that person as a match
- **AND** selecting them SHALL store a person chip carrying their display name and their
  directory email

#### Scenario: App users are still offered
- **WHEN** an assignment manager types a term matching a person who has an app user record
- **THEN** the picker SHALL offer that person
- **AND** the stored chip SHALL carry that person's app user id

#### Scenario: A person present in both sources appears once
- **WHEN** the same email address is present in both the app user collection and the
  directory, differing only in letter case
- **THEN** the picker SHALL offer exactly one match for that person
- **AND** that match SHALL carry the app user id rather than a null id

### Requirement: Identify the source of each match
The system SHALL tell the caller which source each match came from, and the picker SHALL
distinguish directory-only people from app users.

#### Scenario: Directory-only person is marked
- **WHEN** the picker lists a person who exists only in the directory
- **THEN** that row SHALL be visually distinguished from app-user rows

### Requirement: Exclude non-person and undeliverable directory entries
The system SHALL exclude directory entries that do not represent a staff member who can
receive a schedule email.

#### Scenario: Room and resource mailboxes are excluded
- **WHEN** the directory contains a mailbox that matches a room or resource in the
  locations collection
- **THEN** that mailbox SHALL NOT be offered as a person in the picker

#### Scenario: Disabled accounts and guests are excluded
- **WHEN** the directory contains a disabled account or a guest account
- **THEN** that account SHALL NOT be offered as a person in the picker

#### Scenario: Entries without a deliverable address are excluded
- **WHEN** a directory entry has no mail address
- **THEN** that entry SHALL NOT be offered as a person in the picker
- **AND** the system SHALL NOT substitute the user principal name as the person's email

### Requirement: Serve the directory from a cached snapshot
The system SHALL read the directory into a server-side cache with a bounded lifetime and
SHALL NOT issue a directory request per keystroke or per picker filter change.

#### Scenario: Repeated lookups within the cache lifetime reuse the snapshot
- **WHEN** the lookup endpoint is called several times within the cache lifetime
- **THEN** the system SHALL issue at most one directory request for that period

#### Scenario: Directory requests participate in retry and circuit breaking
- **WHEN** the system requests the directory
- **THEN** that request SHALL go through the shared Graph retry and circuit-breaker path
  used by other Graph calls

### Requirement: Degrade to app users when the directory is unavailable
The system SHALL continue to serve app users, and SHALL say that it is doing so, when the
directory cannot be read.

#### Scenario: Directory read fails on a cold cache
- **WHEN** the directory request fails and no previously cached snapshot exists
- **THEN** the endpoint SHALL respond successfully with app users only
- **AND** the response SHALL indicate that results are incomplete
- **AND** the picker SHALL tell the user that the directory is unavailable

#### Scenario: Directory read fails with a usable cached snapshot
- **WHEN** the directory request fails but a previously cached snapshot exists
- **THEN** the endpoint SHALL serve the cached snapshot
- **AND** the response SHALL NOT be marked incomplete

#### Scenario: Directory permission has not been consented
- **WHEN** the directory request is rejected for insufficient permission
- **THEN** the endpoint SHALL respond successfully with app users only and mark the
  response incomplete
- **AND** the endpoint SHALL NOT return an error status

### Requirement: Preserve the existing lookup contract
The system SHALL keep the access gate, the stored chip shape, and the client fetch model
of the people lookup unchanged.

#### Scenario: Access gate is unchanged
- **WHEN** a user who is not an assignment manager calls the lookup endpoint
- **THEN** the endpoint SHALL refuse the request exactly as it does before this change

#### Scenario: Stored chips remain compatible
- **WHEN** a person chip is stored from either source
- **THEN** the stored segment SHALL keep the existing person segment shape
- **AND** tagged email extraction, double-booking detection, the assignments view, and
  the schedule email fan-out SHALL continue to key on the chip email

#### Scenario: Picker still filters locally
- **WHEN** an assignment manager types into the picker
- **THEN** the client SHALL filter the already-fetched people list
- **AND** the client SHALL NOT issue a new lookup request per keystroke

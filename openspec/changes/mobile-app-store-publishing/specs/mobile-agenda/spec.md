## ADDED Requirements

### Requirement: Agenda renders in guest mode from public data
The agenda view SHALL support an unauthenticated guest mode that renders published events from the public events endpoint, with the same grouping, cards, and navigation as the authenticated agenda.

#### Scenario: Guest agenda shows published events only
- **WHEN** the agenda renders in guest mode
- **THEN** it SHALL fetch events from the public published-events endpoint for the visible date range
- **AND** only published events SHALL appear (no drafts, pending, rejected, or deleted)

#### Scenario: Guest event detail is public-safe
- **WHEN** a guest taps an event card
- **THEN** the detail view SHALL show only public display fields (title, time, location, category)
- **AND** requester information, review notes, and workflow actions SHALL NOT be shown

#### Scenario: Authenticated agenda unchanged
- **WHEN** the agenda renders for an authenticated user
- **THEN** the existing authenticated data source and behavior SHALL be used unchanged

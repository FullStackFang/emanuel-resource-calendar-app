## ADDED Requirements

### Requirement: An excluded date overrides a live child on that date
When a tracked series master excludes a date, a live (not deleted) `exception` or `addition` child on that date SHALL NOT be counted as an expected app instance. If Outlook still shows an instance for that child, found by the master's Graph ID plus the local date or by the child's own Graph ID, the report SHALL list it under `shouldNotBeInOutlook` with reason `excluded date has a live override child`, ahead of the plain `excluded date still present` check. If Outlook has no instance for that child, the report SHALL emit no finding for it.

#### Scenario: Unlinked exception child, series instance survives
- **WHEN** a master with Graph ID `master1` excludes `2026-09-02`, a live `exception` child on that date has no Graph ID, and Outlook still shows the `master1` instance on that date
- **THEN** the instance is listed under `shouldNotBeInOutlook` with reason `excluded date has a live override child`, nothing is listed under `missingFromOutlook` or `untracked`, and `appExpected` and `matched` are 0

#### Scenario: Addition child linked to a standalone Outlook event
- **WHEN** a live `addition` child on an excluded date carries its own Graph ID and Outlook still shows that standalone event
- **THEN** that event is listed under `shouldNotBeInOutlook` with reason `excluded date has a live override child`

#### Scenario: Outlook already dropped the date
- **WHEN** a live child sits on an excluded date and Outlook has no instance for it
- **THEN** the report lists nothing under `missingFromOutlook` or `shouldNotBeInOutlook` for it, and `appExpected` is 0

#### Scenario: A child on a date that is not excluded is unaffected
- **WHEN** a live `exception` child sits on a date of the same series that is not excluded, and Outlook shows that instance
- **THEN** it is matched normally and produces no finding

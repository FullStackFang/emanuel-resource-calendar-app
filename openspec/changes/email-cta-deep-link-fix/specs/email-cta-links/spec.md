## ADDED Requirements

### Requirement: Email links address the app by query string only

Every URL builder that targets the app from an email SHALL express its destination as a query parameter on `FRONTEND_URL`, and SHALL NOT append a path segment to it.

`FRONTEND_URL` is a vanity redirect, not a mount point: it matches its own exact
path, preserves the query string, and returns 404 for any deeper path.

#### Scenario: My Assignments CTA keeps the base path

- **WHEN** `buildMyAssignmentsUrl()` runs with `FRONTEND_URL` set to `https://emanuelnyc.org/scheduler`
- **THEN** it returns `https://emanuelnyc.org/scheduler?view=my-assignments`
- **AND** the returned URL's pathname is identical to `FRONTEND_URL`'s pathname

#### Scenario: A sub-path base is not extended

- **WHEN** `FRONTEND_URL` carries a sub-path and a trailing slash, such as `https://example.org/app/`
- **THEN** the returned URL's pathname resolves to that same sub-path with no additional segment appended

#### Scenario: A malformed base falls back safely

- **WHEN** `FRONTEND_URL` is not a parseable URL
- **THEN** the builder returns the default frontend URL carrying the same query parameter
- **AND** still appends no path segment

### Requirement: The emailed destination survives the sign-in round trip

The destination carried by an email link SHALL be captured before MSAL initializes and SHALL be honored after authentication completes, so a signed-out recipient who clicks the link still arrives at the intended screen.

MSAL's redirect flow navigates away to Azure AD and returns to
`window.location.origin`, discarding the query string, so a capture that runs
inside the React tree is too late.

#### Scenario: Signed-out recipient clicks the CTA

- **WHEN** a signed-out recipient opens `<FRONTEND_URL>?view=my-assignments` and completes sign-in through the MSAL redirect flow
- **THEN** the app displays My Assignments after authentication resolves

#### Scenario: Already-signed-in recipient clicks the CTA

- **WHEN** a recipient with a live session opens `<FRONTEND_URL>?view=my-assignments`
- **THEN** the app displays My Assignments without first rendering the calendar

#### Scenario: Capture precedes MSAL

- **WHEN** the application bootstrap module is evaluated
- **THEN** the `?view=` value is read and stored before any MSAL initialization runs

### Requirement: A captured destination is consumed exactly once

A destination SHALL be cleared from both the URL and storage before navigation,
so that a later reload or manual navigation does not send the user back to the
emailed screen.

#### Scenario: Reload after arriving

- **WHEN** a recipient has been routed to My Assignments from an email link and then reloads the app root
- **THEN** the app renders its normal default screen rather than My Assignments

#### Scenario: Navigation away is not undone

- **WHEN** a recipient routed from an email link then navigates to another screen in the same session
- **THEN** the app does not navigate them back to My Assignments

### Requirement: Only known destinations are honored

The captured value arrives from an email and SHALL be treated as untrusted
input. It SHALL be resolved through a fixed allow-list of destinations and SHALL
NOT be used as a route path, so that no value can direct a recipient to an
arbitrary in-app or external location.

#### Scenario: Unknown destination is ignored

- **WHEN** the app is opened with a `view` value that is not in the allow-list
- **THEN** the app renders its normal default screen
- **AND** the stored value is cleared so it cannot be honored on a later render

#### Scenario: A path-like value is not navigated to

- **WHEN** the app is opened with a `view` value shaped like a path or an absolute URL
- **THEN** the app does not navigate to it and renders its normal default screen

### Requirement: The redirect constraint is enforced by test

The behavior of `FRONTEND_URL` SHALL be recorded in an automated assertion, not
in a code comment alone, because a comment asserting the opposite is what
produced the broken link.

#### Scenario: Reintroducing a path fails the suite

- **WHEN** a URL builder is changed to append a path segment to `FRONTEND_URL`
- **THEN** the guard test fails

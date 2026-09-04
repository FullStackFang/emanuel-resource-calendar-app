## Context

`FRONTEND_URL` (`https://emanuelnyc.org/scheduler`) is a **vanity 301 redirect**
to the Azure app root, not a sub-path mount. Measured 2026-09-03: it matches
`/scheduler` exactly, preserves the query string, and 404s on any deeper path.
`buildMyAssignmentsUrl()` appends `/my-assignments` to it, so the schedule
email's only CTA is dead.

Two existing mechanisms constrain the fix:

1. **The `?eventId=` precedent works.** Every other transactional email appends a
   query param, survives the 301, and is recovered by a module-scope capture in
   `src/main.jsx` that writes to `sessionStorage` before MSAL initializes.
   `Calendar.jsx` reads it on mount, clears the param with
   `setSearchParams({}, { replace: true })`, removes the sessionStorage key, and
   acts. That round trip is proven in production.
2. **MSAL destroys query params.** `loginRedirect` (and the popup-blocked
   fallback) navigates to Azure AD and returns to `window.location.origin`,
   dropping the query string. Any capture that runs inside a React effect —
   especially one inside a lazily-imported tree — is too late. This is why the
   existing capture is an IIFE at module scope in `main.jsx`.

`/my-assignments` itself needs no work: the route, `MyAssignments.jsx`, and
`GET /api/my-assignments` all return 200 today. The route is deliberately
unguarded so an emailed recipient with no manager role still lands somewhere
sensible.

## Goals / Non-Goals

**Goals:**
- The schedule email CTA opens My Assignments, through the emanuelnyc.org URL
  recipients already trust, with no hosting or DNS change.
- The auth round trip preserves the destination — a recipient who is signed out
  when they click still arrives at My Assignments after signing in.
- The constraint that broke this is encoded in a test, not only in a comment, so
  the next email CTA cannot reintroduce it.

**Non-Goals:**
- Making `/scheduler/*` sub-paths work. That is a host-side redirect rule or a
  `scheduler.emanuelnyc.org` custom domain — outside this repository (see
  proposal). This change deliberately routes *around* the limitation.
- Changing `buildEventDeepLinkUrl()`. It appends only a query param and is
  unaffected.
- Any change to `/my-assignments`, its component, or its endpoint.
- Repairing links in emails **already sent**. Those URLs are in recipients'
  mailboxes and 404 at a host this repo does not control; the remedy is to
  re-send after deploy, which is an operational step, not code.

## Decisions

### D1 — `?view=my-assignments` on FRONTEND_URL, not a path

Chosen over appending a path (broken today), pointing emails at the
`azurewebsites.net` origin (works, but a long random Azure hostname in an email
to staff and outside vendors reads as phishing), and a host-side wildcard
redirect (correct, but not implementable here).

`?view=` is deliberately generic rather than `?myAssignments=1`: it is a
destination selector, so a second emailed destination later becomes another
value, not another capture. Values must be an allow-list, never a raw path — see
D5.

### D2 — Capture in `main.jsx` at module scope, beside the `?eventId=` capture

Not a hook, not an effect, not a route element. It must run before MSAL touches
the URL, and everything in the React tree runs after. Same file, same IIFE
style, adjacent so the two are read together.

Stored under its own key (`deepLinkView`) rather than overloading
`deepLinkEventId`: the two are independent, and a single email could plausibly
carry both one day.

### D3 — Consume the captured value at the router level, not in `Calendar.jsx`

`Calendar.jsx` owns `?eventId=` because the destination *is* the calendar. Here
the destination is a different route, so consuming it inside Calendar would mean
"render the calendar, then bounce" — a visible flash of the wrong screen on
every emailed visit.

The consumer therefore sits in `App.jsx`, inside `<Router>`, and navigates once
the app is ready to render a route. It reads `?view=` from the live URL first and
falls back to `sessionStorage` (mirroring Calendar's order, which covers both the
"never signed out" and "went through MSAL" paths), then clears both before
navigating so a later manual reload does not bounce the user again.

**Idempotence** uses the same `useRef` latch as the eventId path. A ref, not
state: the latch must not itself trigger a re-render, and it must survive
StrictMode's double-invoke.

### D4 — Navigate after auth resolves, not before

The route is unguarded, so an unauthenticated visitor can technically render it —
but they would see an empty list rather than their schedule, which reads as "you
have no assignments" and is exactly the dishonest empty state this codebase's
loading conventions exist to prevent. The navigation therefore waits for the
same `apiToken` gate the rest of the app waits on. The captured value lives in
`sessionStorage`, so it survives however long that takes, including a full MSAL
redirect to Azure AD and back.

### D5 — The stored value is an allow-list, never a path

`?view=` is attacker-supplied text arriving from an email. Navigating to its raw
value would be an open-redirect / arbitrary-route primitive. It is mapped through
a fixed `{ 'my-assignments': '/my-assignments' }` table; anything unrecognized is
ignored and cleared. Adding a destination later means adding a table entry.

### D6 — The regression guard is a test, not a comment

The comment that said "mounted at the /scheduler sub-path" is precisely what
caused this bug, so a corrected comment is not sufficient protection. A unit test
asserts that `buildMyAssignmentsUrl()` produces a URL whose **pathname is
identical to `FRONTEND_URL`'s** — i.e. that it added a query param and no path
segment. That test fails the moment someone appends a path again, which is the
exact mistake being guarded.

The comment is corrected too, and records the measured 301/404 behavior so the
next reader has the evidence rather than the assumption.

## Risks / Trade-offs

- **Recipients still land on `…azurewebsites.net` after the 301** → Unavoidable
  with a redirect rather than a proxy, and already true of every existing email
  link. Only the follow-up (host wildcard or custom domain) changes it. The URL
  *in the email* — what recipients see before clicking — stays emanuelnyc.org.

- **`?view=my-assignments` is uglier than a real path** → Accepted. It is the
  only shape proven to survive the redirect, and it is consistent with the
  `?eventId=` convention already used by every other email in the system.

- **The workaround could outlive its cause.** If the host later gains a wildcard
  redirect, `?view=` becomes unnecessary but harmless → Mitigated by keeping the
  capture table tiny and documenting the follow-up in the proposal, so it is a
  deliberate simplification later rather than forgotten scaffolding.

- **Emails already sent stay broken** → Nothing in this repo can fix a URL
  already in someone's mailbox. Operational remedy: after deploy, re-send the
  2026 High Holy Days schedules. Worth stating in the release note so it is not
  discovered by a confused recipient.

- **A capture that runs but is never consumed leaves a stale sessionStorage key**
  → The consumer clears the key before navigating, and an unrecognized value is
  cleared without navigating (D5), so no path leaves it set.

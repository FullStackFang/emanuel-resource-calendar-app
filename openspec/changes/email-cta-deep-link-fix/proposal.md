## Why

The "View My Assignments" button in every schedule email is dead: it points at
`https://emanuelnyc.org/scheduler/my-assignments`, which returns **404**. The
first real send of the 2026 High Holy Days schedules went out with it.

The cause is a wrong assumption about what `FRONTEND_URL` is.
`eventDeepLink.js` documents it as "custom domain mounted at the /scheduler
sub-path". It is not a mount — it is a vanity **301 redirect** that matches
that one exact path and forwards to the Azure app root. Measured 2026-09-03:

| URL | Result |
|---|---|
| `emanuelnyc.org/scheduler` | 301 → `…azurewebsites.net/` |
| `emanuelnyc.org/scheduler?eventId=abc123` | 301 → `…azurewebsites.net/?eventId=abc123` |
| `emanuelnyc.org/scheduler/my-assignments` | **404** |
| `…azurewebsites.net/my-assignments` | 200 |

The redirect preserves the **query string** but drops deeper **paths**. Every
other email link has always appended a query param, which is why this has never
surfaced before; `buildMyAssignmentsUrl()` is the only builder that appends a
path, so it is the only one that breaks.

My Assignments itself is live and healthy — the route, the component, and the
`GET /api/my-assignments` endpoint all work. Only the link is broken.

## What Changes

- `buildMyAssignmentsUrl()` returns `<FRONTEND_URL>?view=my-assignments`
  instead of appending `/my-assignments`, using the query-param mechanism that
  is already proven to survive the redirect.
- `src/main.jsx` captures `?view=` at module scope — before MSAL initializes —
  and the app routes to `/my-assignments` once authentication resolves. This
  mirrors the existing `?eventId=` capture and must run in the same place, for
  the same reason: MSAL's redirect flow returns to `window.location.origin` and
  strips query params.
- A regression guard asserts no URL builder appends a path to `FRONTEND_URL`.
  The next person to add an email CTA should not have to rediscover this.
- The misleading "mounted at the /scheduler sub-path" comment in
  `eventDeepLink.js` is corrected to describe a redirect, with the measured
  behavior recorded so the constraint is not lost again.
- **Not in scope, recorded as follow-up**: a wildcard `/scheduler/*` redirect at
  the emanuelnyc.org host, or a `scheduler.emanuelnyc.org` Azure custom domain,
  would make real sub-paths work and retire the query-param workaround. Both
  live outside this repository (host/WordPress config, DNS, TLS, and an Azure AD
  redirect-URI update), so neither can be implemented or verified here.

## Capabilities

### New Capabilities
- `email-cta-links`: how transactional email links address the app — the
  query-param-only constraint imposed by the vanity redirect, the
  `?view=my-assignments` destination, the pre-MSAL capture that survives the
  auth round trip, and the guard that keeps future builders from appending
  paths.

### Modified Capabilities
<!-- None. scheduling-schedule-email already requires the CTA to target My
     Assignments rather than an ?eventId= deep link; that requirement is
     unchanged. What changes is the URL SHAPE used to express it, which is a
     property of the new email-cta-links capability. -->

## Impact

- `backend/utils/eventDeepLink.js` — `buildMyAssignmentsUrl()` and its comment.
  `buildEventDeepLinkUrl()` is untouched: it already appends only a query param.
- `src/main.jsx` — one more module-scope capture beside the `?eventId=` one.
- Whatever consumes the captured value to perform the redirect (App/Calendar
  mount, decided in design.md).
- `backend/__tests__/` — the URL builder's unit coverage plus the new guard.
- `src/__tests__/` — the capture and the post-auth routing.
- No API surface, schema, query key, or permission change. No change to the
  `/my-assignments` route or `GET /api/my-assignments`, both of which work.
- Behavioral note: recipients land on `…azurewebsites.net` after the 301
  regardless of which fix is chosen, because the vanity URL redirects rather
  than proxies. Only the follow-up options above change that.

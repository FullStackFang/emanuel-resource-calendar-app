## 1. Backend URL builder

- [x] 1.1 Change `buildMyAssignmentsUrl()` in `backend/utils/eventDeepLink.js` to set a `view=my-assignments` search param on `FRONTEND_URL` instead of appending to `url.pathname`, keeping the malformed-base fallback
- [x] 1.2 Correct the file's header comment: `FRONTEND_URL` is a vanity 301 redirect, not a sub-path mount — record the measured behavior (exact path matches, query string preserved, deeper paths 404, measured 2026-09-03) and why every builder must stay query-only
- [x] 1.3 Add the guard test asserting `new URL(buildMyAssignmentsUrl()).pathname === new URL(process.env.FRONTEND_URL).pathname` — it must fail if a path segment is ever appended again (spec: "Reintroducing a path fails the suite")
- [x] 1.4 Add builder unit tests for the sub-path-with-trailing-slash base and the malformed-base fallback (spec scenarios 2 and 3 of the first requirement)
- [x] 1.5 Verify: run the `eventDeepLink` unit tests plus `schedulingSheetEmail.test.js`, and confirm `buildEventDeepLinkUrl()` output is byte-identical to before

## 2. Frontend capture

- [x] 2.1 Add a module-scope IIFE in `src/main.jsx`, directly beside the existing `?eventId=` capture, reading `view` from `window.location.search` into `sessionStorage` under `deepLinkView`
- [x] 2.2 Store only values present in the destination allow-list (`{ 'my-assignments': '/my-assignments' }`); ignore and do not store anything else (design D5)
- [x] 2.3 Add a `?raw` source assertion that `main.jsx` performs the capture at module scope — `main.jsx` boots MSAL, Sentry and the whole app on import, so it cannot be behaviourally exercised in jsdom (same precedent as UPI-0 for `initInstallCapture`)

## 3. Frontend routing

- [x] 3.1 Add the consumer inside `<Router>` in `src/App.jsx`: read `view` from the live URL first, then fall back to `sessionStorage`, mirroring `Calendar.jsx`'s ordering
- [x] 3.2 Gate the navigation on the same `apiToken` readiness the rest of the app uses, so a recipient never sees an empty My Assignments list before auth resolves (design D4)
- [x] 3.3 Clear the URL param (`setSearchParams({}, { replace: true })` or equivalent) and remove the `sessionStorage` key BEFORE navigating, and latch with a `useRef` so StrictMode's double-invoke cannot double-navigate (design D3)
- [x] 3.4 Resolve the value through the allow-list table and navigate to the mapped route; clear storage and render normally for anything unrecognized

## 4. Frontend tests

- [x] 4.1 Signed-in recipient: opening `?view=my-assignments` renders My Assignments without first rendering the calendar
- [x] 4.2 Signed-out recipient: the value survives in `sessionStorage` across an MSAL round trip (query string absent on return) and routes once `apiToken` arrives
- [x] 4.3 Consumed exactly once: after routing, a reload of the app root renders the default screen, and navigating away is not undone
- [x] 4.4 Unknown `view` value renders the default screen and clears storage; a path-like or absolute-URL value is never navigated to (spec: "Only known destinations are honored")

## 5. Verification and rollout

- [x] 5.1 Run the full frontend scheduling suites and the backend email suites; confirm counts match the documented baseline with no new failures
- [x] 5.2 Lint every touched file; confirm `api-server.js` and the backend services stay at their pre-existing error counts (325 / 17)
- [x] 5.3 Mutation-check the guard: temporarily restore the path-appending builder and confirm task 1.3's test fails
- [ ] 5.4 Manual on dev with a live MSAL session: send a schedule email to a test mailbox, click the CTA while signed out, confirm sign-in completes and My Assignments renders; repeat while already signed in
- [x] 5.5 Release note: emails ALREADY SENT carry the broken `/scheduler/my-assignments` URL and cannot be repaired from this repo — the 2026 High Holy Days schedules should be re-sent after deploy
- [x] 5.6 Record the follow-up (host wildcard `/scheduler/*` redirect, or a `scheduler.emanuelnyc.org` custom domain) so the query-param workaround can be retired deliberately rather than forgotten

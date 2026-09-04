// src/components/EmailDestinationRouter.jsx
//
// Routes a visitor who arrived from an email link (?view=my-assignments) to
// their destination. Renders nothing.
//
// Mounted inside <Router> in App.jsx. It lives in its own file rather than
// inside App because App renders the Router and so cannot use its hooks — and
// because App.jsx boots MSAL on import, which makes anything defined there
// untestable in jsdom.
//
// Three things here are load-bearing:
//  - It waits for `apiToken`. The destination route is unguarded, so an
//    unauthenticated visitor would render it and see an empty list — which
//    reads as "you have no assignments" rather than "not signed in yet".
//  - It reads the live URL first, then sessionStorage. The first covers a
//    visitor with a session; the second covers one bounced through MSAL, which
//    returns to the origin without the query string.
//  - The latch is a ref, not state: it must not itself cause a render, and it
//    must survive StrictMode's double-invoke so one link is honored once.

import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  EMAIL_DESTINATION_PARAM,
  readStoredEmailDestination,
  clearStoredEmailDestination,
  resolveEmailDestination
} from '../utils/emailDestination';

export default function EmailDestinationRouter({ apiToken }) {
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current || !apiToken) return;

    const fromUrl = new URLSearchParams(location.search).get(EMAIL_DESTINATION_PARAM);
    const value = fromUrl || readStoredEmailDestination();
    if (!value) return;

    // Consume once, whatever the outcome: an unrecognized value must not sit in
    // storage waiting to be retried on some later render.
    handledRef.current = true;
    clearStoredEmailDestination();

    const route = resolveEmailDestination(value);
    if (!route) return;                       // not allow-listed — render normally
    navigate(route, { replace: true });       // replace: Back should leave the app,
  }, [apiToken, location.search, navigate]);  // not bounce through the email link

  return null;
}

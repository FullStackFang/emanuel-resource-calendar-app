## Why

Day-level navigation is missing from the mobile calendar, and the day shown at
the top can disagree with the day the user is looking at.

The week strip's chevrons jump a **whole week** (`MobileWeekStrip.jsx:36-46`).
The only way to move a single day is to tap its number in the strip — which
fails as soon as the day you want is in the next week. On a phone, stepping
forward one day is the single most common calendar motion, and it currently
takes two gestures.

Separately, the agenda renders a 14-day list. Scrolling through it is the
natural way to browse, but nothing observes that scroll: the week strip keeps
highlighting whatever was last *tapped*. A user who scrolls from Monday down to
Thursday sees a strip that still says Monday, and a month label that never
changes even when scrolling crosses into the next month. The header stops
describing the content beneath it.

## What Changes

- **Horizontal swipe steps one day**, in both the agenda and the 3-day grid.
  Swipe left advances, swipe right goes back. One day per swipe in the 3-day
  grid too — paging all three columns at once was considered and rejected
  because it changes every column simultaneously, so the reader loses their
  visual anchor and cannot follow an event across the boundary.
- **The week strip follows the agenda's scroll position.** The highlighted day,
  the week the strip displays, and the month label are all driven by the day
  currently at the top of the agenda viewport.
- **Selection intent and scroll observation become separate state.**
  `MobileAgenda.jsx:55-66` already scrolls to `selectedDate` whenever it
  changes; if scroll wrote back to that same value it would drive itself. A
  distinct `visibleDate` makes the loop structurally impossible rather than
  suppressed by a flag. See `design.md` Decision 1.
- **Pull-to-refresh gains an axis guard.** `MobileAgenda`'s existing gesture
  fires when a touch starting at `scrollTop === 0` ends 80px lower; a large
  diagonal drag from the top of the list could satisfy both it and a day swipe.
  The swipe's locked axis is authoritative — an `x`-locked gesture never
  refreshes.
- **No slide animation.** The day snaps. A real transition needs duplicated
  off-screen columns; cut as YAGNI, not deferred.
- **No new keyboard affordance.** Swipe is touch-only by nature. The strip's
  day buttons and week chevrons remain the keyboard and screen-reader path,
  unchanged.
- **The week strip itself is not made swipeable.** Its chevrons already do
  weeks.

## Capabilities

### New Capabilities

- `mobile-day-navigation`: which day the mobile calendar is focused on and how
  that focus moves — horizontal swipe stepping, and the agenda's scroll
  position driving the header. Owns the intent/observation state split shared
  by both mobile calendar views.

### Modified Capabilities

- `mobile-agenda`: the week strip's selected day is no longer only what was
  last tapped — it follows the scroll position. Pull-to-refresh is now
  suppressed for horizontally-locked gestures.

## Impact

- **Frontend**: new `src/hooks/useHorizontalSwipe.js`, new
  `src/utils/agendaScrollSpy.js`; modified
  `src/components/mobile/MobileCalendarTab.jsx` (the `visibleDate` state and
  the swipe binding) and `src/components/mobile/MobileAgenda.jsx` (scroll
  listener, `onVisibleDateChange`, pull-to-refresh guard).
- **`MobileThreeDay.jsx` is not modified.** The swipe binds to a wrapper in the
  tab shell that encloses both views.
- **Backend**: none.
- **Data model**: unchanged.
- **Fetch behavior**: unchanged. Stepping a day past the loaded window triggers
  the same append fetch `useMobileEvents.js:135-142` already performs for a
  strip tap.
- **Depends on**: `mobile-three-day-view` (unarchived) for `MobileCalendarTab`
  and `MobileThreeDay`.
- **Unchanged**: desktop UI, the 3-day grid's internals, event data transforms,
  auth.

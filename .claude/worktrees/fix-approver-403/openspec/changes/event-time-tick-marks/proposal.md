## Why

Event blocks in the Scheduling Assistant span the full blocking window (setup through teardown), but there is no visual distinction between buffer time and actual event time. When a 1-hour meeting has 30 minutes of setup and 30 minutes of teardown, the block looks like a 2-hour event. Users cannot glance at the timeline and understand where the real event starts and ends within its buffer zone.

## What Changes

- **Event time tick marks**: Thin horizontal lines rendered inside event blocks at the positions where the actual event starts and ends, visually separating buffer zones from event core time
- **Adaptive labels**: Time labels (e.g., '10:00 AM' on left for start, '4:00 PM' on right for end) shown only when the block is tall enough (>=150px); lines only for smaller blocks; nothing for very-compact blocks (<35px)
- **User event block data**: Add `eventStartDecimal` and `eventEndDecimal` fields to the user event block object so tick positions can be calculated (locked event blocks already carry `originalStartTime`/`originalEndTime`)
- **Visual pattern**: Mirrors the existing `sa-current-time-line` pattern (positioned line + label) but scoped inside individual blocks with subtler styling

## Capabilities

### New Capabilities
- `event-time-ticks`: Horizontal tick marks inside Scheduling Assistant event blocks indicating where the actual event start/end falls within the setup-to-teardown blocking window

### Modified Capabilities
<!-- None — this is additive visual enhancement to existing block rendering -->

## Impact

- **Modified files**:
  - `src/components/SchedulingAssistant.jsx` — add fields to user event block construction (~line 477), add tick mark rendering in `renderEventBlock` (~line 1448)
  - `src/components/SchedulingAssistant.css` — new classes for tick lines and labels
- **No backend changes** — `originalStart`/`originalEnd` already returned by availability API for reservations; calendar events without buffers naturally produce no ticks
- **No new props** — `eventStartTime`, `eventEndTime`, `setupTime`, `teardownTime` already flow into the component
- **No new dependencies**
- **Risk**: Low — purely additive rendering inside existing blocks, no changes to positioning math, drag behavior, or conflict detection
- **Estimated scope**: ~40-50 lines of JSX + ~30 lines of CSS

## Design Decisions

### Tick visibility tiers (by block height)
| Block height | Mode | Tick behavior |
|---|---|---|
| < 35px | very-compact | No ticks |
| 35-149px | compact/normal | Lines only, no labels |
| >= 150px | normal (large) | Lines + time labels |

### When ticks appear
- Only when event time differs from block time (i.e., setup or teardown buffer exists)
- Start tick: when `eventStartDecimal > block.startTime`
- End tick: when `eventEndDecimal < block.endTime`
- If no buffer on one side, only the other tick renders

### Label positioning
- Start tick label: left-aligned (mirrors current-time-line label placement)
- End tick label: right-aligned (distinguishes end from start at a glance)

### Line styling
- Subtle color (semi-transparent, not red like current-time-line) to avoid competing with the timeline-level current time indicator
- 1-2px solid line spanning the block width

### Drag behavior
- Ticks positioned as percentage within block, so they maintain correct relative position during drag without special handling

## Data Availability

| Block type | Block span source | Event time source | Status |
|---|---|---|---|
| User event | `setupTime` / `teardownTime` props | `eventStartTime` / `eventEndTime` props | Need to add to block object |
| Reservation | `effectiveStart` / `effectiveEnd` from API | `originalStartTime` / `originalEndTime` via `buildBlockFromStrings` | Already available |
| Calendar event | `effectiveStart` / `effectiveEnd` | Same (no buffer) → no ticks | Natural fallback |
| Pending edit/res | `effectiveStart` / `effectiveEnd` | `originalStartTime` / `originalEndTime` | Already available |

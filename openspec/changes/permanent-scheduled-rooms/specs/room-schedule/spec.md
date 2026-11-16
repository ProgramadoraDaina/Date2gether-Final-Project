# Specification: room-schedule

## Purpose

Defines the storage of weekly recurring schedule slots for a room, the computation of the next upcoming occurrence from those slots, and the rendering of that occurrence in the viewer's own local timezone without ever exposing the room owner's timezone.

## Requirements

### Requirement: A room may hold multiple schedule slots

The system MUST allow a room to be associated with zero, one, or many schedule slots, each defined by a day of week, a time of day, and a timezone.

#### Scenario: Room with two weekly slots

- GIVEN a permanent room with slots "Tuesday 07:00 America/Argentina/Buenos_Aires" and "Thursday 15:00 America/Argentina/Buenos_Aires"
- WHEN the room's schedule is read
- THEN both slots are returned, each with its own day, time, and timezone

### Requirement: Each slot stores an explicit timezone

The system MUST store, for every schedule slot, the IANA timezone name in effect for the room owner who created the slot. The system MUST NOT store a slot's time as a fixed numeric UTC offset.

#### Scenario: Slot created in a DST-observing timezone

- GIVEN a schedule slot created with timezone `America/Argentina/Buenos_Aires` and time `07:00`
- WHEN the slot is persisted
- THEN the stored timezone is the IANA zone name, not a numeric offset

### Requirement: Next occurrence is computed as a concrete instant

Given a room's schedule slots and the current instant, the system MUST be able to compute the next upcoming occurrence as a concrete point in time (an instant), resolving each slot's wall-clock day/time/timezone against the calendar.

#### Scenario: Computing the next occurrence among multiple slots

- GIVEN a room with slots on Tuesday 07:00 and Thursday 15:00, both in the owner's timezone
- WHEN the next-occurrence computation runs at a point in time before both of those weekly slots
- THEN the computation returns the earliest of the two upcoming occurrences, as an instant

### Requirement: The room owner's timezone never reaches the viewer

When presenting the next-occurrence information to a student/viewer, the system MUST render it converted to the viewer's own local timezone. The system MUST NOT expose the room owner's (creator's) timezone to the viewer.

#### Scenario: Student in a different timezone views the next occurrence

- GIVEN a room owner's slot of "Tuesday 07:00 America/Argentina/Buenos_Aires"
- WHEN a student in `Europe/Madrid` opens the waiting room
- THEN the student sees the next occurrence expressed in `Europe/Madrid` local time
- AND no indication of the owner's timezone is shown to the student

### Requirement: Next-occurrence information is informational only

Displaying the next upcoming occurrence MUST NOT gate or restrict a student's ability to open the waiting room or request admission at any time.

#### Scenario: Student opens the waiting room outside scheduled hours

- GIVEN a permanent room with a slot for Tuesday 07:00
- WHEN a student opens the waiting room on a Wednesday at 14:00
- THEN the student is shown the next scheduled occurrence
- AND the student is not rejected or blocked from requesting admission for being "too early" or outside scheduled hours

## Non-Goals

These are explicitly not resolved by this spec; they are open questions or out-of-scope items carried from the proposal, and MUST NOT be silently decided during implementation:

- Schedule exceptions (holidays, one-off cancellations, reschedules) are not covered. v1 slots are a fixed weekly recurrence with no exception calendar.
- Calendar export (`.ics`) is not covered.
- Timezone/DST edge-case handling beyond what the chosen timezone-aware date library provides by default is not covered.
- Slot duration and "in-progress" occurrence state (e.g. "started 10 minutes ago") are not specified; only a single upcoming start instant is covered.
- Whether slots can be edited or deleted after room creation is not specified here.
- Proactive notifications (email, push) about upcoming occurrences are not covered. The occurrence message is shown only when the viewer opens the waiting room.

# Specification: room-permanence

## Purpose

Defines the `isPermanent` property of a room, the rolling-inactivity expiry of non-permanent rooms, the code-reuse pool, and the rule that every authorization and data-access path MUST resolve rooms by `id`, never by `code`, so that two rooms sharing a `code` at different points in time are fully unrelated entities.

## Requirements

### Requirement: Permanence is declared at creation

The system MUST accept an `isPermanent` flag at room-creation time. When no value is supplied, the system MUST default `isPermanent` to `false`.

#### Scenario: Room created without specifying permanence

- GIVEN a user creating a new room without specifying `isPermanent`
- WHEN the room is created
- THEN the room is persisted with `isPermanent = false`

#### Scenario: Room explicitly created as permanent

- GIVEN a user creating a new room with `isPermanent = true`
- WHEN the room is created
- THEN the room is persisted with `isPermanent = true`

> Non-goal: whether `isPermanent` can be changed after creation is not specified by this requirement. See Non-Goals.

### Requirement: Permanent rooms never lose joinability

For a room with `isPermanent = true`, the system MUST treat the room's `code` as joinable indefinitely, regardless of how much time has elapsed since the last entry.

#### Scenario: Permanent room with no activity for a long period

- GIVEN a permanent room whose last entry was more than 24 hours ago
- WHEN any user attempts to join the room by its code
- THEN the join succeeds as if the room had just been used

### Requirement: Non-permanent rooms expire on rolling inactivity

For a room with `isPermanent = false`, the system MUST stop treating the room's `code` as joinable once more than 24 hours have elapsed since the last entry into the room. The system MUST reset this 24-hour window on every new entry, so the window is rolling, not fixed from creation.

#### Scenario: Room idle for over 24 hours

- GIVEN a non-permanent room whose last entry was more than 24 hours ago
- WHEN a user attempts to join the room by its code
- THEN the join is rejected because the code is no longer joinable

#### Scenario: Room re-entered before expiry extends the window

- GIVEN a non-permanent room entered at hour 0 and re-entered at hour 23
- WHEN a user attempts to join at hour 47 (24 hours after the hour-23 entry)
- THEN the join succeeds, because the window rolled forward on the hour-23 entry

#### Scenario: Room not re-entered after the last entry

- GIVEN the same room as above, last entered at hour 23 and not entered again
- WHEN a user attempts to join at hour 48 (more than 24 hours after the hour-23 entry)
- THEN the join is rejected because the code is no longer joinable

### Requirement: Expiry removes joinability, never the row

When a non-permanent room's code stops being joinable, the system MUST NOT delete or otherwise make unreadable the room's row, its history, its notes, its memberships, or its timeline data.

#### Scenario: Reading history of an expired room

- GIVEN a non-permanent room that has expired (unjoinable by code)
- WHEN a past participant requests the call history or notes they are authorized to see for that room
- THEN the request succeeds, resolved by the room's `id`, unaffected by the room no longer being joinable by code

### Requirement: Code uniqueness is scoped to joinable rooms

The system MUST enforce uniqueness of `code` only among currently-joinable rooms (permanent rooms, and non-permanent rooms within their rolling window). The system MUST allow a `code` that belonged to a now-unjoinable, non-permanent room to be assigned to a brand-new room.

#### Scenario: Reusing a retired code

- GIVEN a non-permanent room R1 whose code has expired (unjoinable)
- WHEN a new room R2 is created and assigned the same `code` as R1
- THEN R2's creation succeeds
- AND R1 and R2 are two distinct rows with distinct `id`s

### Requirement: Permanent codes are never recycled

The system MUST NOT release a permanent room's `code` for reuse by any other room, under any circumstance.

#### Scenario: Attempting to reuse a permanent room's code

- GIVEN a permanent room R1 with code `ABC123`
- WHEN a new room creation would otherwise need a free code
- THEN the system MUST NOT assign `ABC123` to the new room while R1 exists as a permanent room holding that code

### Requirement: Rooms sharing a code over time are unrelated entities

When a `code` has been reused by a new room after the previous room holding that code became unjoinable, the system MUST treat the two rooms as fully unrelated: no shared history, notes, memberships, participant tokens, or timeline data.

#### Scenario: Old room's data is not reachable through the new room's code

- GIVEN room R1 (unjoinable, retired) and room R2 (newly created, holding the same `code` R1 used to hold)
- WHEN any feature resolves "the room with this code" for an operation scoped to R2
- THEN only R2's data is returned or affected
- AND none of R1's history, notes, memberships, or timeline data is included

### Requirement: Authorization and data access resolve rooms by id, not by code

Every path that authorizes a user against a room, or reads/writes room-scoped data (history, notes, memberships, timeline, participant/admission tokens), MUST resolve and key that operation on the room's `id`. The system MUST NOT authorize or scope such an operation using `code` alone as the identifying key, because `code` is not a stable identifier for a room over time.

#### Scenario: Call-notes history authorization uses room id

- GIVEN a user requesting the call-notes history for a session that belongs to room R1 (now retired)
- AND a different room R2 now holds R1's former `code`
- WHEN the system authorizes and resolves this request
- THEN authorization and data retrieval are both scoped to R1's `id`
- AND no data belonging to R2 is returned, even though R2 currently holds the same `code`

#### Scenario: Participant token bound to a retired room is rejected by the new room

- GIVEN a participant/admission token issued for room R1 while R1 held code `ABC123`
- AND room R1 has since become unjoinable and code `ABC123` has been reassigned to a new, unrelated room R2
- WHEN the token is presented to access a room identified by code `ABC123`
- THEN the system MUST reject the token, because the token's bound `roomId` does not match R2's `id`

## Non-Goals

These are explicitly not resolved by this spec; they are open questions or out-of-scope items carried from the proposal, and MUST NOT be silently decided during implementation:

- Whether `isPermanent` can be toggled after room creation, in either direction, is not specified here.
- The precise set of actions that count as "entry" for resetting the rolling-inactivity window (room join only, vs. call join, vs. any room activity such as chat or notes) is not fully specified beyond "entering the room"; the exact triggering event set is left for design.
- The expiry-detection mechanism (lazy check on access vs. a scheduled sweep) is an implementation choice, not mandated by this spec; only the observable joinability outcome is specified.
- Automatic deletion or cleanup of expired rooms' data is not covered; rows persist indefinitely regardless of joinability.

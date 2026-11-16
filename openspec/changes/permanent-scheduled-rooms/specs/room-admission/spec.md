# Specification: room-admission (modified)

## Purpose

Describes how this change modifies the existing admission/waiting-room flow (`request` -> `pending` -> `decide()`, introduced in PR #21) for permanent rooms: the waiting room becomes mandatory and non-togglable, and pending requests no longer expire. Non-permanent rooms keep today's behavior unchanged. This delta does not introduce a new approval mechanism.

## Requirements

### Requirement: Waiting room is mandatory and non-optional for permanent rooms

For a permanent room, the system MUST always treat the waiting room as enabled. The system MUST reject any attempt, through `configure()` or any other path, to disable the waiting room on a permanent room.

#### Scenario: Attempt to disable the waiting room on a permanent room

- GIVEN a permanent room
- WHEN an admin calls `configure()` attempting to set `waitingRoomEnabled` to `false`
- THEN the system rejects the change
- AND the room's waiting room remains enabled

#### Scenario: Permanent room always requires admission

- GIVEN a permanent room
- WHEN a student who is not already a member attempts to join
- THEN the student is placed in the waiting room and must request admission; no automatic entry occurs

### Requirement: No request TTL on permanent rooms

For a permanent room, an admission request that reaches `pending` status MUST remain `pending` indefinitely until an admin decides it (`decide()`) or the requesting student cancels it. The system MUST NOT expire a pending request on a permanent room based on elapsed time.

#### Scenario: Pending request older than 24 hours is still decidable

- GIVEN a pending admission request on a permanent room, created more than 24 hours ago
- WHEN an admin reviews the pending requests
- THEN the request still appears as `pending`
- AND the admin can still admit or deny it via `decide()`

### Requirement: Admission may be requested at any time

For a permanent room, the system MUST allow a student to submit an admission request at any time, regardless of the room's schedule slots or whether any scheduled occurrence is near.

#### Scenario: Request submitted outside scheduled hours

- GIVEN a permanent room with a weekly schedule
- WHEN a student requests admission at a time that does not match any schedule slot
- THEN the request is accepted and becomes `pending`, exactly as it would during a scheduled slot

### Requirement: Existing admission mechanism is reused unchanged

This change MUST reuse the existing `request` -> `pending` -> `decide()` admission flow. The system MUST NOT introduce a second or alternative approval mechanism for permanent rooms.

#### Scenario: Admin decides a permanent room's request the same way as before

- GIVEN a pending admission request on a permanent room
- WHEN an admin calls `decide()` to admit or deny it
- THEN the same `decide()` entry point used for non-permanent rooms handles the decision

### Requirement: Non-permanent rooms keep existing admission behavior unchanged

For a room with `isPermanent = false`, this change MUST NOT alter existing behavior: `waitingRoomEnabled` remains an admin-toggleable setting, and a pending admission request MUST still expire after 24 hours exactly as before this change.

#### Scenario: Non-permanent room's waiting room toggle still works

- GIVEN a non-permanent room
- WHEN an admin calls `configure()` to disable `waitingRoomEnabled`
- THEN the change is accepted, exactly as before this change

#### Scenario: Non-permanent room's pending request still expires

- GIVEN a pending admission request on a non-permanent room, created more than 24 hours ago
- WHEN its status is checked
- THEN it is `expired`, exactly as before this change

## Non-Goals

These are explicitly not resolved by this spec; they are open questions or out-of-scope items carried from the proposal, and MUST NOT be silently decided during implementation:

- Bulk admission (deciding multiple pending requests in one action) is not specified here; the existing one-at-a-time `decide()` behavior is preserved, and whether a bulk path is added is left open for design.
- Any cap, soft-stale marker, or other hygiene mechanism for the unbounded list of pending requests on a popular permanent room is not specified here. A hard TTL MUST NOT be reintroduced for permanent rooms as a substitute for such a mechanism.

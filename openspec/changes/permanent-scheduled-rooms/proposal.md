# Proposal: Permanent scheduled rooms with a mandatory waiting room

A teacher gets one link that never changes. They mark the room **permanent** at creation, attach one or more weekly schedule slots (day + time + their own timezone), and from then on the waiting room is always on: no student ever auto-enters, the teacher admits each one by hand, and a student who arrives early waits for as long as they want while the UI tells them the next scheduled time **in the student's own timezone**.

To make that promise meaningful, the other half of the change is the opposite rule: **non-permanent rooms stop being forever**. A room nobody re-enters for 24h becomes unjoinable, its row is kept as history, and its `code` returns to the pool for brand-new, unrelated rooms.

---

## Quick path (what the user experiences)

1. Teacher creates a room and ticks **permanent**. Default for new rooms stays **not** permanent.
2. Teacher adds schedule slots: `Tuesday 07:00` and `Thursday 15:00`, stored with the teacher's timezone.
3. Teacher shares the room link once. It never expires and is never recycled.
4. Student opens the link at any hour, lands in the waiting room, sees *"This call is scheduled for Tuesday at 7:00 AM (your time)"*, and waits — indefinitely if needed.
5. Teacher opens the room, sees the pending requests, and admits each student explicitly.

---

## Intent

Three facts about today's code make this change necessary:

| Today | Consequence |
|---|---|
| Every room code is already permanent — `generateRoomCode()` + a global `UNIQUE("code")`, no TTL anywhere (`src/common/generate-room-code.ts`, `rooms.service.ts:27-43`) | "Permanent" is the accidental default. The codespace is consumed forever by one-off rooms, and there is no way to declare intent. |
| `waitingRoomEnabled` / `entryLocked` are admin-toggleable per room (`room-admission.service.ts::configure`) | A teacher can turn the waiting room off — by accident or by a stale setting — and strangers auto-enter a class. |
| Admission requests die after 24h (`expiresAt`, `room-admission.service.ts:69`) | A student who requests access on Monday for a Tuesday class is silently expired before the teacher ever sees them. |

This change turns permanence into an explicit, declared property, and makes the waiting room a **non-negotiable consequence** of that property.

---

## Scope

### In scope

- `rooms.isPermanent` flag, decided at creation. New rooms default to `false`.
- **Lifecycle for non-permanent rooms**: rolling 24h inactivity window measured from the *last entry*. On expiry the room stops being joinable; the row survives forever as history.
- **Code reuse**: `UNIQUE("code")` becomes a **partial** unique index scoped to currently-joinable rooms, so a retired code can be handed to a new, unrelated room.
- **Hard separation between rooms that share a code over time**: every history, notes, membership, timeline and token path must resolve rooms by `id`, never by `code`. Two rooms with the same `code` at different times are fully unrelated entities.
- New one-to-many table for **schedule slots**: `(roomId, dayOfWeek, time, timezone)`, many slots per room.
- **Forced waiting room for permanent rooms**: `waitingRoomEnabled` is always on and cannot be toggled off; `configure()` must reject attempts to disable it.
- **No request TTL on permanent rooms**: a `pending` request stays pending until the admin decides or the student cancels. Non-permanent rooms keep today's 24h TTL untouched.
- **Waiting-room messaging**: compute the next upcoming occurrence from the room's slots and render it in the viewer's local timezone. Informational only — it never gates entry.
- Reuse of the existing admission flow (`request` → `pending` → admin `decide()`). No new approval mechanism.

### Out of scope

- Email / push / any proactive notification. The scheduled-time message is shown **only** when the student opens the waiting room.
- Schedule exceptions: holidays, "no class this week", one-off cancellations or reschedules. v1 slots are a fixed weekly recurrence with no exception calendar.
- Calendar export (`.ics`), timezone-aware DST edge handling beyond what the chosen date library gives for free.
- Changing the video-call lifecycle, the admin-presence gate, or the participation timeline shipped by `call-participation-timeline`.
- Recycling codes of *permanent* rooms. A permanent code is never released, even if the room goes unused for years.
- Automatic cleanup/deletion of expired rooms' data. Rows stay; only joinability changes.

---

## Closed product decisions

| Decision | Rationale |
|---|---|
| `isPermanent` is set at creation; new rooms default to `false` | Permanence is a commitment, not a default. Today's accidental permanence is the bug. |
| A permanent room's code is never expired and never recycled | The teacher's promise is "this link always works". |
| Non-permanent rooms expire on a **rolling** 24h window since the last entry, not 24h from creation | A room in active use must not die mid-use. Inactivity, not age, is the signal. |
| Expiry destroys *joinability*, never the row | Call history, timelines and notes must keep resolving for past participants. |
| Uniqueness on `code` becomes partial (joinable rooms only) | Without this, retired codes stay locked forever and the codespace still leaks. |
| Rooms sharing a `code` across time are **unrelated entities** — no shared history, no data linkage | Stated explicitly so no one is tempted to query history by `code` instead of `id`. This is a security boundary, not a style preference. |
| A permanent room has **many** schedule slots | A professor teaches Tuesday 07:00 *and* Thursday 15:00 on the same link. |
| Each slot stores the creator's timezone explicitly | Needed to resolve a wall-clock time to a real instant. |
| The student **never** sees the professor's raw timezone — only their own local time | A student should not have to do timezone math to attend a class. |
| For permanent rooms the waiting room is forced on, not a toggle | A class link is public-ish by nature; auto-entry for strangers is unacceptable. |
| Admission stays explicit and per-request, reusing `decide()` | The existing mechanism already works and is already tested. |
| A student may open the waiting room at **any** time — no "too early" rejection | The schedule informs, it does not gate. Office hours, make-up classes and early arrivals all stay possible. |
| Waiting is **indefinite** for permanent rooms; the 24h request TTL does not apply | Expiring a request the teacher has not read yet is the current bug, not a feature. |
| Non-permanent rooms keep the 24h request TTL exactly as today | No regression surface on the existing flow. |

---

## Capabilities

### New

- `room-permanence`: the `isPermanent` flag, the rolling-inactivity expiry of non-permanent rooms, the partial-unique code pool, and the `id`-not-`code` identity rule.
- `room-schedule`: schedule-slot storage, the "next upcoming occurrence" computation, and local-timezone rendering.

### Modified

- `room-admission` (from PR #21, no spec file in `openspec/specs/` yet): forced waiting room for permanent rooms, and TTL-free pending requests for permanent rooms.

---

## Approach

1. **Schema** (`src/db/schema.ts` + a new `drizzle/00XX_*.sql`)
   - `rooms.isPermanent boolean not null default false`.
   - A joinability marker for the partial index. `rooms.isActive` already exists and `joinRoom()` already rejects `!isActive` (`rooms.service.ts:58`), so design should first evaluate reusing it rather than adding a parallel flag — but note `isActive` currently also means "admin closed the room", so the design phase must decide whether the two meanings can share one column.
   - `rooms.lastEnteredAt timestamp` (or an equivalent derivation) to drive the rolling window.
   - Drop `CONSTRAINT "rooms_code_unique"`, add `CREATE UNIQUE INDEX ... ON rooms (code) WHERE <joinable>`.
   - New table `room_schedule_slots (id, roomId FK cascade, dayOfWeek, timeOfDay, timezone, createdAt)`.

2. **Room creation** — accept `isPermanent` and an optional slot list; persist slots in the same transaction that creates the room and its `administrador` member.

3. **Expiry** — mark non-permanent rooms unjoinable once `now - lastEnteredAt > 24h`. Mechanism (lazy check on lookup vs. scheduled sweep) is an open design question; a lazy check on the code-resolution path is the cheapest and needs no scheduler.

4. **Code resolution hardening** — every `where(eq(rooms.code, ...))` must filter to joinable rooms. There are ~13 such call sites today (`rooms.service.ts` ×2, `room-admission.service.ts` ×2, `calls.service.ts`, `calls-webhook.service.ts`, `call-session-close.service.ts`, `chat.gateway.ts`, plus every `getByCodeOrThrow` consumer). This is the highest-risk mechanical part of the change.

5. **Admission** — in `request()`, skip `expiresAt` for permanent rooms (nullable `expiresAt`, or a sentinel far-future value); in `list()` and `decide()`, stop filtering/rejecting on `expiresAt` for permanent rooms. In `configure()`, reject disabling `waitingRoomEnabled` on a permanent room.

6. **Next-occurrence computation** — a pure, unit-testable function: slots + current instant → next occurrence instant. Exposed to the client already resolved to an instant, so the client only formats it in the viewer's locale/timezone and the professor's timezone never reaches the browser.

7. **Client** — `WaitingRoom.tsx` renders the next-occurrence line; `useAdmissionRequest.ts` (5s poll) must not surface an `expired` state for permanent rooms; room creation UI gains the permanent toggle and the slot editor.

---

## Affected areas

| Area | Impact | Description |
|---|---|---|
| `src/db/schema.ts` + new migration | Modified | `isPermanent`, joinability/`lastEnteredAt`, partial unique index, new `room_schedule_slots` table |
| `src/modules/rooms/rooms.service.ts` | Modified | `createRoom` accepts permanence + slots; `findByCode`/`getByCodeOrThrow` filter to joinable; entry touches `lastEnteredAt` |
| `src/modules/rooms/room-admission.service.ts` | Modified | TTL bypass for permanent rooms in `request`/`status`/`list`/`decide`; `configure()` refuses to disable the waiting room on permanent rooms |
| `src/modules/rooms/` (schedule) | New | Schedule-slot service + next-occurrence computation + controller surface |
| `src/modules/rooms/dto/` | Modified | Create-room DTO gains `isPermanent` + slots; admission settings DTO validation |
| `src/modules/calls/calls.service.ts`, `calls-webhook.service.ts`, `call-session-close.service.ts` | Modified | Every `rooms.code` lookup must become joinable-scoped; `getRoomNotesForHistory` must stop authorizing by `code` |
| `src/modules/chat/chat.gateway.ts` | Modified | `findByCode` is now joinable-scoped |
| `src/modules/auth/room-access.service.ts` | Modified | Participant/admission tokens are `roomCode`-scoped with a 24h life — must be bound to `roomId` so a recycled code cannot be unlocked by an old token |
| `client/src/features/rooms/WaitingRoom.tsx` | Modified | Next-occurrence message in the viewer's local timezone |
| `client/src/features/rooms/useAdmissionRequest.ts` | Modified | No `expired` transition for permanent rooms |
| Room creation UI (`client/src/app/...`) | Modified | Permanent toggle + weekly slot editor |

---

## Risks

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| **Code recycling leaks data across unrelated rooms.** `CallsService.getRoomNotesForHistory` authorizes on `eq(rooms.code, roomCode)` and then calls `getRoomNotes(roomCode)` (`calls.service.ts:344-353`). After recycling, a user whose history is in the *old* room passes the check and reads the *new* room's notes. | High | **CRITICAL** | Rewrite this path to resolve and authorize by `roomId`. Spec must state the `id`-not-`code` rule as a MUST, and tests must cover a recycled-code scenario explicitly. |
| **Stale room tokens unlock a recycled code.** `RoomParticipant` JWTs and admission tickets carry `roomCode` and live `24h` (`room-access.service.ts:59,70`) — the same length as the inactivity window, so overlap is not hypothetical. | Medium | **CRITICAL** | Embed `roomId` in the token and verify it against the resolved room. Reject tokens whose `roomId` does not match. |
| **History keyed by code becomes ambiguous.** `call_events.roomCode` and `call_sessions.roomCode` are plain varchars with no FK (deliberate, per the timeline design, `schema.ts:317,346`). | Medium | High | Treat `roomCode` on those tables as a display label only; every join/filter goes through `roomId`. Document it in the spec so the timeline feature is not quietly broken. |
| **~13 unfiltered `rooms.code` lookups.** Missing even one leaves a path that can resolve a retired room — or the wrong one of two rooms sharing a code, since several queries use `.limit(1)` with no ordering. | High | High | Centralize code resolution in a single `RoomsService` method and route every caller through it; grep for `eq(rooms.code` as a verification gate. |
| **Dropping a unique constraint is hard to reverse.** Once two rooms share a code, re-adding the global `rooms_code_unique` fails. | Medium | High | See the rollback plan below — rollback requires a data check, not just a `down` migration. |
| **A room expires while someone is mid-use** because `lastEnteredAt` is only touched on *entry*, not on activity. | Medium | Medium | Design must define "entry" precisely (room join? call join? chat message?) and decide whether an in-progress call refreshes the window. |
| **DST and weekly recurrence.** A `Tuesday 07:00 America/Argentina/Buenos_Aires` slot is not a fixed UTC offset across the year. | Medium | Medium | Store the IANA zone name (never a numeric offset) and resolve wall-clock → instant at read time with a zone-aware library. Needs unit tests across a DST boundary. |
| **Unbounded pending requests on permanent rooms.** With no TTL, a popular class accumulates stale `pending` rows forever and the teacher's list becomes unusable. | Medium | Medium | Open question: cap the list, let students auto-cancel on tab close, or add a soft "stale" marker. Do **not** reintroduce a hard TTL. |
| **Forcing the waiting room breaks existing rooms** if `isPermanent` were ever backfilled to `true`. | Low | Medium | Backfill is `false` for all existing rooms — the change is additive for everything already in the DB. |
| **Teacher never shows up and the student waits forever** with no feedback loop. | Medium | Low | The next-occurrence message is the mitigation for v1; notifications are explicitly out of scope. |

---

## Rollback plan

The change is **not** purely additive — it swaps a global unique constraint for a partial one — so rollback has an ordering requirement and a data precondition.

**Forward migration order**
1. `ALTER TABLE rooms ADD COLUMN is_permanent boolean NOT NULL DEFAULT false;` (+ `last_entered_at`, + joinability column if the design does not reuse `isActive`).
2. `CREATE TABLE room_schedule_slots (...)` with `room_id` FK `ON DELETE CASCADE`.
3. `ALTER TABLE rooms DROP CONSTRAINT "rooms_code_unique";`
4. `CREATE UNIQUE INDEX rooms_code_joinable_unique ON rooms (code) WHERE <joinable>;`

**Down migration order (exact reverse, with a gate)**
1. `DROP INDEX rooms_code_joinable_unique;`
2. **Gate — check for duplicates before restoring the global constraint:**
   ```sql
   SELECT code, count(*) FROM rooms GROUP BY code HAVING count(*) > 1;
   ```
   - **Empty result** → safe. `ALTER TABLE rooms ADD CONSTRAINT "rooms_code_unique" UNIQUE("code");` and continue.
   - **Non-empty** → the global constraint **cannot** be restored without touching data. Do not force it. Options, in order of preference: (a) leave the partial index in place and roll back only the application code, which is fully compatible with the old behavior because the old code never wrote duplicate codes; (b) rename the duplicated codes on the *retired* rows (they are unjoinable and unreachable by code anyway) and then restore the constraint. Never delete rows — they are history.
3. `DROP TABLE room_schedule_slots;`
4. `ALTER TABLE rooms DROP COLUMN is_permanent;` (+ the other added columns).

**Why no existing room breaks on rollback:** every pre-existing room gets `is_permanent = false` and stays joinable until it goes 24h idle, and no pre-existing room relies on *code reuse* — the old code path only ever assumed codes are globally unique for *reading*, which the partial index still satisfies for joinable rooms. The only irreversible step is the first code reuse in production. Practical consequence: **the application-code rollback is always safe and should be the first response to an incident; the schema rollback is only clean until the first duplicate code exists.**

**Application-only rollback** (no migration, reversible at any time): revert the forced waiting room, the TTL bypass, and the schedule UI. The added columns and table are inert if unread. This is the recommended emergency lever.

**Testing posture:** `strict_tdd: true` is this repo's convention (`openspec/config.yaml`), with colocated `*.spec.ts` / `*.spec.tsx`. Apply and verify will enforce it. Beyond the usual coverage, the migration itself needs a verification step: run the duplicate-code query above against a seeded DB with at least one recycled code before trusting the down path.

---

## Delivery and rollout

| Item | Decision |
|---|---|
| `delivery_strategy` | **`single-pr`** — everything ships together. |
| If the diff turns out large | Record a **`size:exception`** in `sdd-tasks` / `sdd-apply`. Do **not** silently split into chained PRs. |
| Review order for the reviewer | (1) the migration + partial index, (2) the code-resolution hardening across the ~13 call sites, (3) admission TTL/forced-waiting-room changes, (4) schedule computation, (5) client rendering. |
| TDD | Enforced downstream by apply/verify; not designed in this proposal. |

---

## Dependencies

- PR #21 (room admission / waiting room) is merged — this change builds directly on `room-admission.service.ts` and `WaitingRoom.tsx`.
- A timezone-aware date library for weekly-slot → instant resolution on the server, and `Intl.DateTimeFormat` on the client (no new dependency needed client-side).
- No LiveKit webhook is involved in this change, so the `openspec/config.yaml` proposal rule about webhook events and signature verification does not apply.
- No new infrastructure, no scheduler service — unless the design phase chooses a sweep job over a lazy expiry check.

---

## Open questions for design

These are deliberately unresolved. Each needs a decision before `sdd-tasks`.

1. **Can schedule slots be edited or deleted after room creation?** Leaning yes (a teacher's timetable changes), but it affects the API surface and the UI. Not assumed either way here.
2. **Can `isPermanent` ever be toggled after creation?** Flipping `true → false` makes a "forever" link expirable and its code recyclable — a user-visible promise being broken. Flipping `false → true` is safer. Leaning "immutable in v1".
3. **Bulk admission.** Today `decide()` handles one request at a time. A teacher with 20 students waiting will hate that. Leaning **keep one-by-one for v1** unless design finds a cheap transactional bulk path over the existing `decide()`.
4. **Reuse `isActive` as the joinability flag, or add a separate column?** `isActive` already gates `joinRoom()` but currently means "admin closed the room". Overloading it is cheap; separating it is clearer.
5. **Expiry mechanism:** lazy check on code resolution vs. a scheduled sweep. Lazy needs no scheduler but means expiry is only observed on access.
6. **Definition of "entry"** for the rolling window: room join, call join, or any activity (chat message, note edit)?
7. **Pending-request hygiene on permanent rooms** with no TTL — cap, soft-stale marker, or nothing (see risks).
8. **Granularity of schedule slots:** is `timeOfDay` enough, or does a slot need a duration so "next occurrence" can say "started 10 minutes ago" instead of only "next Tuesday"?

---

## Success criteria

- [ ] A room created as permanent keeps the same joinable `code` indefinitely, with no expiry and no recycling.
- [ ] A newly created room is **not** permanent unless explicitly flagged.
- [ ] A non-permanent room with no entry for 24h stops being joinable by its code, while its row and all its history remain readable.
- [ ] The rolling window is genuinely rolling: a room re-entered at hour 23 survives to hour 47.
- [ ] A retired code can be assigned to a brand-new room, and that new room shares **no** history, notes, members, or timeline with the old one.
- [ ] A participant token issued for a retired room **cannot** access the new room that reuses its code.
- [ ] `getRoomNotesForHistory` cannot be used to read a different room's notes via a recycled code.
- [ ] A permanent room can hold multiple schedule slots on different days and times.
- [ ] A student in a permanent room's waiting room sees the next scheduled occurrence in **their own** local timezone, and never sees the professor's timezone.
- [ ] A student can open a permanent room's waiting room at any hour — before, after, or between scheduled times — and is never rejected as "too early".
- [ ] A pending request on a permanent room is still `pending` after more than 24h and is still admittable by the teacher.
- [ ] A pending request on a non-permanent room still expires after 24h, exactly as today.
- [ ] `waitingRoomEnabled` cannot be turned off on a permanent room through `configure()` or any other path.
- [ ] Admission still goes through the existing `request` → `pending` → `decide()` flow; no second approval mechanism exists.
- [ ] All existing room, chat, call, timeline and admission tests still pass unchanged for non-permanent rooms.

---

## Next step

`sdd-spec` — turn the closed decisions above into Given/When/Then requirements with RFC 2119 keywords, with explicit coverage of the code-recycling isolation rule and the permanent-room TTL bypass.

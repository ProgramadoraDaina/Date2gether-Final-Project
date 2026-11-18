# Tasks: Permanent scheduled rooms with a mandatory waiting room

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1200–2000 (1 new table + migration + rollback, 1 new leaf module, 13 call-site migrations across 8 files, token-shape change, 1 new service + controller for schedule, 2 new pure-function files with DST tests, ~8 modified client files + 2 new) |
| 400-line budget risk | High |
| Chained PRs recommended | No — `delivery_strategy` is `single-pr` by explicit user decision; do not propose chaining |
| Decision needed before apply | Yes |

```text
Decision needed before apply: Yes
Chained PRs recommended: No (single-pr explicitly chosen)
400-line budget risk: High
```

**Why this is over budget, and why it still ships as one PR:** design.md's own risk table already counted ~15 new files and ~25 modified files (File-level impact, design.md lines 659–710) and called this "comfortably over 400 changed lines." That estimate is not something this task breakdown can shrink — the surface is real: a security-fix call-site migration (13 sites, 5 categories) cannot be safely split from the `RoomResolver` it depends on without leaving a window where some paths check `roomId` and others still trust `code`, and the migration's two schema changes (`retired_at`/`is_permanent`/`room_schedule_slots` and the TTL-nullable column) are a single transaction by design (D3). The user has already decided against chaining for this change (`single-pr`). **Action for the orchestrator:** record an explicit `size:exception` before launching `sdd-apply` — this is not a recommendation to split, it is the required paper trail for an accepted overrun.

---

## Phase 1 — Database: schema and migration

*Depends on nothing. Everything downstream depends on this. Must land first regardless of PR shape.*

- [x] 1.1 Modify `src/db/schema.ts` (design.md lines 212–242, 410–435):
  - `rooms`: add `isPermanent boolean not null default false`, `lastEnteredAt timestamp not null defaultNow()`, `retiredAt timestamp` (nullable); remove `.unique()` from `code`.
  - `rooms` table-extras: `uniqueIndex('rooms_code_code_pool_unique').on(table.code).where(sql`${table.retiredAt} is null`)`; `index('rooms_retirement_sweep_idx').on(table.lastEnteredAt).where(sql`${table.retiredAt} is null and ${table.isPermanent} = false`)`.
  - `roomAdmissionRequests.expiresAt`: drop `.notNull()` (becomes nullable — "no TTL" is `NULL`, never a far-future sentinel, per D7 rationale).
  - Add new `roomScheduleSlots` pgTable: `id` (uuid pk), `roomId` (uuid, FK `rooms.id` `onDelete: cascade`), `dayOfWeek` (smallint, 0=Sunday), `timeOfDay` (varchar(5)), `timezone` (varchar(64)), `createdAt`; table-extras: index on `roomId`, `unique(roomId, dayOfWeek, timeOfDay, timezone)`, `check` on `dayOfWeek between 0 and 6`, `check` on `timeOfDay ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`.
- [x] 1.2 Hand-write `drizzle/0016_permanent_scheduled_rooms.sql` in the style of `0015_room_admission.sql` (`--> statement-breakpoint`, named constraints), exact order from design.md lines 121–151: add the three `rooms` columns → create `room_schedule_slots` + its FK/unique/index → drop `NOT NULL` on `room_admission_requests.expires_at` → drop `rooms_code_unique` → create `rooms_code_code_pool_unique` and `rooms_retirement_sweep_idx`. Regenerate `drizzle/meta/_journal.json` and the matching snapshot entry.
- [x] 1.3 Hand-write `drizzle/rollback/0016_permanent_scheduled_rooms.down.sql` (design.md lines 162–208), manually executed only, inside one transaction, with both self-gating `DO` blocks running before any destructive statement:
  - **Gate 1** (lines 169–183): aborts with `RAISE EXCEPTION` if any `code` is duplicated among current rows — restoring the global `UNIQUE(code)` would otherwise fail; the exception message states the documented recovery path (rename the duplicate on retired rows, or roll back application code only).
  - **Gate 2** (lines 186–196): aborts with `RAISE EXCEPTION` if any `room_admission_requests.expires_at IS NULL` row exists — restoring `NOT NULL` would otherwise fail; the message asks the operator to decide backfill vs. staying nullable.
  - Destructive statements after both gates: restore `rooms_code_unique`, restore `expires_at SET NOT NULL`, `DROP TABLE room_schedule_slots`, drop the three new `rooms` columns.
- [x] 1.4 Write `drizzle/rollback/README.md` stating these rollback files are **never** run by `drizzle-kit migrate` — manual execution only, documented as deliberate (no down-runner exists in this project's drizzle-kit setup).
- [x] 1.5 Apply the forward migration against the dev/test database; run `pnpm test` to confirm the additive change breaks nothing existing (pre-existing rooms get `last_entered_at = now()` from the column default, so no existing room retires on deploy — the "gentle backfill" design.md line 155 requires).

## Phase 2 — Identity hardening: `RoomResolver` and the 13 call-site migration

*Depends on Phase 1 (the resolver's `joinable()` predicate reads `retiredAt`/`isPermanent`/`lastEnteredAt`). This is the security-critical phase — design.md calls it "the highest-risk part of the change."*

### 2a. The resolver itself

- [x] 2.1 [RED] `src/modules/rooms/room-resolver.service.spec.ts`: joinability predicate (permanent room always joinable regardless of `lastEnteredAt`; non-permanent joinable only within rolling 24h window; retired and never-existed both produce the same not-found outcome; `isActive=false` produces a distinct forbidden outcome); `assertBound` throws on `participant.roomId !== room.id`; `retireExpired` only retires rows matching all of `retired_at IS NULL AND NOT is_permanent AND is_active AND last_entered_at < now()-24h AND NOT EXISTS(open call_session)`.
- [x] 2.2 [GREEN] Implement `src/modules/rooms/room-resolver.service.ts` (design.md lines 253–267): `resolveJoinable(code)` → 404 unknown/retired/expired (indistinguishable, per D1), 403 if `!isActive`; `lockJoinable(tx, code, {requireActive?})` → same, `FOR UPDATE`; `assertBound(participant, room)`; `getById(roomId)`; `touchEntry(roomId, tx?)`; `retireExpired(tx)` (the D2 allocation-time sweep SQL, design.md lines 94–107).
- [x] 2.3 Create `src/modules/rooms/room-resolver.module.ts` — a leaf module importing nothing (`DrizzleModule` is `@Global()`, so no explicit import is needed and no cycle is introduced); exports `RoomResolverService`.
- [x] 2.4 Import `RoomResolverModule` into `RoomsModule`, `JwtAuthModule` (`src/modules/auth/jwt-auth.module.ts`), `CallsModule`, `ChatModule`.

### 2b. Call-site migration, by category (design.md lines 272–347)

- [x] 2.5 **Category A** (fixed for free once the delegation lands) — in `rooms.service.ts`, make `findByCode` / `getByCodeOrThrow` one-line delegations to `resolver.resolveJoinable`. This is the single change that propagates to: `joinRoom`, `listMembers`, `getMemberRole`, `setMemberRole`, `getRoomNotes`, `saveRoomNotes` (6 sites in `rooms.service.ts`), `rooms.controller.ts:46` `findOne`, `room-emojis.service.ts:136,155,202,264,299` (5 sites), `calls.service.ts:54` `join`.
- [x] 2.6 [RED] Regression tests for Category A: each listed site still succeeds for an active/permanent/non-expired room, and now returns 404 for a retired or time-expired room (previously these sites had no expiry concept at all). Include a regression assertion that `room-roles.guard.ts` (unchanged code, but transitively depends on `getMemberRole`) still authorizes correctly.
- [x] 2.7 **Category B** — `room-admission.service.ts:26` `lockRoom` → `resolver.lockJoinable(tx, code, { requireActive })`, keeping `FOR UPDATE`; `room-admission.service.ts:128` `list` → `resolver.resolveJoinable(code)`.
- [x] 2.8 [RED] **Category C — the vulnerability.** Write the failing test first: a user with a history row in retired room R1 can currently reach R2's notes through `getRoomNotesForHistory(userId, roomCode)` because the authorization query and the data query re-resolve the code independently (design.md lines 286–297, spec scenario "Call-notes history authorization uses room id"). Confirm this test fails against the pre-fix code before proceeding.
- [x] 2.9 [GREEN] Rewrite `calls.service.ts:344-353` `getRoomNotesForHistory(userId, roomId)` to the single-identifier shape (design.md lines 302–311): one query on `callHistory.roomId`, no `rooms` join, no code anywhere in the method. Add `RoomsService.getRoomNotesById(roomId)` / `saveRoomNotesById(roomId, …)` id-keyed twins; existing code-keyed methods become two-line resolve-then-delegate wrappers.
- [x] 2.10 Route change forced by 2.9: `calls/call-history.controller.ts:23` `:roomCode` → `:roomId` with `ParseUUIDPipe`; `CallHistoryEntry` gains `roomId` (`listHistory` already selects it internally at `calls.service.ts:289` — just return it); `roomCode` stays in the DTO as a display label only.
- [x] 2.11 **Category D** — delete the `eq(rooms.code, roomCode)` lookups in `calls-webhook.service.ts:235` and `call-session-close.service.ts:180`; resolve `roomId` instead from `call_participant_identities` via the `identityKeys` the webhook handler already computes (design.md lines 334–343): `onRoomFinished` already has `identityKeys` at line 257; `ensureSessionRow` derives the same set from its existing `call_events` query.
- [x] 2.12 **Category E** — `chat.gateway.ts:135`: `findByCode` → `resolver.resolveJoinable(dto.code)`, emitting the existing `error` Socket.io event instead of throwing; add `resolver.assertBound(participant, room)` inside `handleJoinRoom` (the only handler with a resolvable code — the other 10 `@SubscribeMessage` handlers already operate on `connectedUsers`, which carries `roomId`).

### 2c. Token binding and legacy-token rejection

- [x] 2.13 `RoomParticipant` (`src/modules/auth/room-access.service.ts`) gains a **required** `roomId` field alongside the existing `roomCode` (design.md lines 353–361). `create(roomId, roomCode, name, auth)` / `issueParticipant` carry it. `verify()` rejects (throws `UnauthorizedException`) any payload missing `roomId` — no dual-path fallback for the old token shape (D4's explicit "reject, don't accept-for-one-release" decision).
- [x] 2.14 [RED] Test: a token signed before this change (no `roomId` claim) presented to `verify()` after this change is rejected. This is the deliberate legacy-token-rejection behavior, not a bug — assert it explicitly so a future dual-path "fix" is caught by this test.
- [x] 2.15 `createAdmissionTicket(roomId, requestId, { permanent })` / `verifyAdmissionTicket(token, roomId, requestId)` switch their binding key from `roomCode` to `roomId`. Move the `verifyAdmissionTicket` call inside the transaction in `status()` and `cancel()`, after `lockJoinable` (the controller no longer has the id up front; the service resolves the room first).
- [x] 2.16 `RoomAccessGuard` (`src/modules/auth/guards/room-access.guard.ts`): resolve `request.params.roomCode` via `resolveJoinable`, call `assertBound(participant, room)`, attach `request.room`. One place, so no handler can forget the binding check.
- [x] 2.17 `WsJwtAuthGuard` (`src/modules/auth/guards/ws-jwt-auth.guard.ts`): no behavior change — add a code comment documenting that its cheap string compare (`participant.roomCode !== data.code`) is intentionally not the authoritative check; the authoritative `roomId` check lives in `handleJoinRoom` via `assertBound` (2.12).
- [x] 2.18 [RED] Flow-2 attack-scenario tests reproducing design.md's sequence diagram (lines 602–655): (a) an R1 participant token presented against R2's recycled code → `403 "El acceso pertenece a otra sala"`; (b) `getRoomNotesForHistory` called with R1's `roomId` after the code was recycled to R2 → returns only R1's notes, R2 untouched.

### 2d. `touchEntry` wiring (D5) and accepted costs

- [x] 2.19 Wire `resolver.touchEntry(roomId)` into the three "entry" sites D5 identifies, and only these three: `RoomsService.joinRoom()`, `RoomAdmissionService.grant()`, `CallsService.join()`. Explicitly do **not** wire it into chat messages, note edits, emoji uploads, or admission status polling (D5 rationale: polling must never keep a room alive).
- [x] 2.20 [RED] Room-permanence spec regression tests: room entered at hour 0, re-entered at hour 23 → still joinable at hour 47 (window rolled); same room, no re-entry after hour 23 → unjoinable at hour 48 (spec scenarios, room-permanence spec.md lines 47–57).
- [x] 2.21 Document the accepted cost on `GifsController` (`src/modules/gifs/gifs.controller.ts`): it is `RoomAccessGuard`-protected and previously touched no database; it now pays one indexed `SELECT` per search as a side effect of 2.16. No code change needed in the controller itself — add a regression test confirming it still proxies Tenor correctly for a valid, bound room.

### 2e. Verification gate

- [x] 2.22 Run `rg "eq\(rooms\.code"` over `src/` excluding `*.spec.ts` and confirm **exactly one** hit, inside `room-resolver.service.ts`. Treat any other hit as a blocker for this phase — this is the mechanical, reviewable proof that the single-boundary design (D4) actually holds.

## Phase 3 — Admission service: permanence branching (D7)

*Depends on Phase 1 (nullable `expiresAt`) and Phase 2 (resolver, `touchEntry`). All line numbers below are pre-change, in `src/modules/rooms/room-admission.service.ts` unless noted.*

- [x] 3.1 [RED] Confirm `isPermanent` is immutable: no update/configure DTO or endpoint accepts it. Add a negative test attempting to pass `isPermanent` through `configure()` or any update path and asserting it has no effect (D5: "Immutable in v1. Absent from every update DTO; no endpoint accepts it.").
- [x] 3.2 [RED] One failing test per D7 site (design.md lines 503–514), written against the current (pre-permanence) behavior as the regression baseline plus the new permanent-room branch:
  - `:25-30` `lockRoom` now goes through `resolver.lockJoinable`.
  - `:69` `request` — `expiresAt` is `null` when `room.isPermanent`, else the existing 24h `Date`.
  - `:76` `request` — `createAdmissionTicket(room.id, id, { permanent: room.isPermanent })`.
  - `:96` `status` — expiry check becomes `if (request.expiresAt && request.expiresAt <= new Date())`.
  - `:128` `list` — `resolver.resolveJoinable(code)`.
  - `:142` `list` — filter becomes `or(isNull(expiresAt), gt(expiresAt, new Date()))`.
  - `:146-150` `list` — each returned request gains `stale: createdAt < now - 24h`.
  - `:156-159` `configure` — attempting `waitingRoomEnabled: false` on a permanent room throws `ForbiddenException('La sala de espera no se puede desactivar en una sala permanente')`; otherwise `waitingRoomEnabled` is forced `true` for permanent rooms.
  - `:163-173` `configure` — the auto-admit-on-toggle-off branch is unreachable for permanent rooms (since `waitingRoomEnabled` is forced `true`); its filter still gets the `or(isNull(…), gt(…))` treatment for the non-permanent path.
  - `:182` `decide` — conflict check becomes `if (request.expiresAt && request.expiresAt <= new Date())`.
- [x] 3.3 [GREEN] Implement all ten sites from 3.2.
- [x] 3.4 `rooms.service.ts` `createRoom` — a permanent room is inserted with `waitingRoomEnabled: true` explicitly (the column default is `false`; without this the spec's "permanent room always requires admission" scenario fails from the first second).
- [x] 3.5 [RED] Ticket-lifetime branch: `createAdmissionTicket` signs `expiresIn: permanent ? '365d' : '24h'` (`room-access.service.ts:70`) — test both branches independently of the DB TTL.
- [x] 3.6 [GREEN] Implement 3.5.
- [x] 3.7 [RED+GREEN] Explicit non-permanent regression suite (room-admission spec, "Non-permanent rooms keep existing admission behavior unchanged"): `configure()` can still disable `waitingRoomEnabled`; a pending request on a non-permanent room still reports `expired` after 24h exactly as before this change. Run this against the *modified* service to catch any permanence-branch logic leaking into the non-permanent path.

## Phase 4 — Schedule: slots, next-occurrence, two asymmetric endpoints (D6)

*Depends on Phase 1 (`room_schedule_slots` table). Independent of Phases 2–3 otherwise and could be developed in parallel, but ships in the same PR per `single-pr`.*

- [x] 4.1 [RED] `src/modules/rooms/schedule/next-occurrence.spec.ts`: multi-slot ordering (earliest instant across slots wins); a real Southern-Hemisphere DST transition; a real Northern-Hemisphere DST transition; spring-forward (wall time doesn't exist → fires at the next existing wall minute); fall-back (wall time ambiguous → pre-transition instant wins); empty slot list → `null`; day-of-week correctly re-derived from the resulting instant after offset correction (design.md lines 453–476).
- [x] 4.2 [GREEN] Implement the pure function `src/modules/rooms/schedule/next-occurrence.ts`: `nextOccurrence(slots, now)`, two-pass offset correction per slot (design.md lines 456–462), zero new dependencies (Node's built-in `Intl`).
- [x] 4.3 `src/modules/rooms/validators/is-iana-timezone.validator.ts` — custom `class-validator` constraint checking against `Intl.supportedValuesOf('timeZone')`; a typo'd zone must fail at `POST`, not silently produce a `null` next-occurrence forever.
- [x] 4.4 `src/modules/rooms/dto/create-schedule-slot.dto.ts` — validates `dayOfWeek` (0–6), `timeOfDay` (`HH:MM`), `timezone` (the 4.3 validator).
- [x] 4.5 [RED] `src/modules/rooms/schedule/room-schedule.service.spec.ts`: create a slot (happy path); create a duplicate `(roomId, dayOfWeek, timeOfDay, timezone)` → rejected by the DB unique constraint; delete a slot by id (cascade has no side effects since nothing derives state from slots, per D5); `getNextOccurrence(roomId)` orchestrates slot fetch + `nextOccurrence()`.
- [x] 4.6 [GREEN] Implement `src/modules/rooms/schedule/room-schedule.service.ts`: slot create/list/delete + next-occurrence orchestration.
- [x] 4.7 [RED] `room-schedule.controller.ts` tests for all four operations and the deliberate asymmetry: `GET /rooms/:code/schedule/next` is unauthenticated and its response **has no field that could carry a timezone**; `GET /rooms/:code/schedule/slots` requires `JwtAuthGuard` + `RoomRolesGuard('administrador')` and includes `timezone`; `POST /rooms/:code/schedule/slots` and `DELETE /rooms/:code/schedule/slots/:slotId` are admin-only (D5: slots are editable/deletable after creation).
- [x] 4.8 [GREEN] Implement `src/modules/rooms/schedule/room-schedule.controller.ts` with the four routes from 4.7.
- [x] 4.9 Wire `RoomScheduleController`/`RoomScheduleService` into `rooms.module.ts`.
- [x] 4.10 `create-room.dto.ts`: add `isPermanent?: boolean`, `slots?: CreateScheduleSlotDto[]`; `rooms.controller.ts` `create` accepts them; `rooms.service.ts` `createRoom(name, creatorId, { isPermanent, slots })` performs the retirement sweep, room insert, member insert, and slot inserts in one transaction (design.md "New" row for `rooms.service.ts`).
- [x] 4.11 [RED] Integration test: `createRoom` with slots persists all slots atomically (a failure on one slot insert rolls back the whole room creation); `createRoom`'s sweep (D2) retires eligible rooms before the code-collision probe runs, in the same transaction.
- [x] 4.12 [GREEN] Confirm 4.11 against 4.10's implementation.

## Phase 5 — Frontend

*Depends on Phase 2 (token shape, history route), Phase 3 (admission response shape), Phase 4 (schedule endpoints).*

- [x] 5.1 `client/src/lib/api.ts`: `Room` gains `isPermanent`; `RoomAccess.participant` gains `roomId`; `CallHistoryEntry` gains `roomId`; notes-history client call moves to the `:roomId` path; `AdmissionManagement.requests[]` gains `stale`; add client functions for the four schedule endpoints (4.7/4.8).
- [x] 5.2 Room creation UI: add the permanent-room toggle and wire `client/src/features/rooms/ScheduleSlotEditor.tsx` (new — admin weekly slot editor: add/remove slot rows, day/time/timezone inputs) into the room-creation flow.
- [x] 5.3 [RED] Spec for `ScheduleSlotEditor.tsx`: add a slot, remove a slot, reject an invalid time format client-side before submit.
- [x] 5.4 `client/src/features/rooms/NextOccurrence.tsx` (new) — renders the server's ISO instant via `Intl.DateTimeFormat(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })`, which uses the viewer's own zone by definition; no new client dependency.
- [x] 5.5 [RED] Spec for `NextOccurrence.tsx`: given a fixed instant and a mocked `Intl` locale/zone, renders the expected local-time string; renders a "no upcoming occurrence" state when `nextOccurrenceAt` is `null`.
- [x] 5.6 `client/src/features/rooms/WaitingRoom.tsx`: render `<NextOccurrence>`; confirm the component never receives or displays a timezone field (matches the room-schedule spec's "owner's timezone never reaches the viewer").
- [x] 5.7 `client/src/features/rooms/useAdmissionRequest.ts`: no `expired` transition when the room is permanent (the ticket's 401 "expired" mapping from `client/src/lib/api.ts:385` must not fire before the ticket's actual 365d lifetime).
- [x] 5.8 `client/src/features/rooms/AdmissionControl.tsx`: show the `stale` flag per pending request; hide the waiting-room toggle entirely for permanent rooms (not just disable it — the spec forbids the admin from even attempting to turn it off).
- [x] 5.9 History-notes route rename, forced by the Category C fix (2.9/2.10): rename `client/src/app/history/notes/[roomCode]/page.tsx` → `client/src/app/history/notes/[roomId]/page.tsx`; update `client/src/app/history/page.tsx:100` to link by `entry.roomId` instead of `entry.roomCode`. `roomCode` stays displayed as a label; it stops being the routing key.
- [x] 5.10 [RED+GREEN] Update `client/src/app/history/page.spec.tsx` for the roomId-based link; add specs for 5.2's room-creation-UI permanent toggle.
- [x] 5.11 `pnpm --filter client typecheck` and `pnpm --filter client lint` clean after all of Phase 5.

## Phase 6 — The three non-ordinary test tasks

*These do not fit inside any phase above as ordinary colocated unit specs — design.md's own "Testing notes for sdd-tasks" (lines 728–734) calls them out by name. Each gets its own task, not a generic "testing" folder.*

- [x] 6.1 **Real-Postgres recycled-code integration test.** Using the existing `docker-compose.test.yml` + `test:e2e:db:migrate` harness (already provides a migrated Postgres): create room R1, backdate `last_entered_at` past the 24h window, create room R2 and force the same `code` (via the real `createRoom` sweep + a collision retry, not a mock), then assert: R1's notes/members/history are unreachable through R2's code; R1's participant token is rejected when presented against R2 (`403`, matches Flow 2's attack scenarios, design.md lines 602–655). This exercises the partial unique index itself — mocked Drizzle cannot, since the index is half the correctness mechanism (D3).
- [x] 6.2 **Down-migration gate assertion.** Seed a test database with two rooms sharing a duplicated `code` (bypassing the app-level constraint directly via SQL, simulating pre-existing corrupt data), run `drizzle/rollback/0016_permanent_scheduled_rooms.down.sql`, and assert the transaction raises the Gate 1 exception and leaves the schema untouched (the three `rooms` columns and `room_schedule_slots` still exist). Repeat for Gate 2: seed a `room_admission_requests` row with `expires_at IS NULL`, run the rollback, assert it aborts before reaching the destructive statements. This turns the proposal's "run the duplicate query before trusting the down path" checklist item into an executable assertion (design.md line 733).
- [x] 6.3 **Ticket-verifiability regression at hour 25.** For a permanent room's pending admission request, advance to hour 25 (fake timers) and assert **both** that the DB row is still `status: 'pending'` **and** that `verifyAdmissionTicket` still accepts the originally issued ticket. Asserting only the DB row would have passed under the old 24h-JWT assumption while the real user saw a `401` → "La solicitud venció" (design.md lines 522–523, 734) — this test exists specifically to catch that gap reappearing.

## Phase 7 — Deploy sequencing note (runbook, not code)

*Covers the "legacy tokens rejected at deploy" accepted risk (D4, design.md lines 371–378) and the final cross-phase verification. No application code changes here.*

- [x] 7.1 Add a short deploy note (extend `drizzle/rollback/README.md` or add a `## Deploy sequencing` section near it) stating: this deploy rejects any participant/admission token issued before it (no `roomId` claim) — every active session is logged out, recoverable via the client's existing `401` → re-request-access path (`client/src/lib/api.ts:385`, `useAdmissionRequest`'s reset). Recommend deploying at low traffic. State explicitly that this is a deliberate one-time cost, not a bug to "fix" with a dual-path `verify()`.
- [x] 7.2 Final pre-merge run of the verification gate (2.22) against the *complete* diff, not just Phase 2's files — Phases 3 and 4 touch `room-admission.service.ts` and add new schedule files that must not reintroduce a code-keyed query. `rg "eq\(rooms\.code"` over `src/` excluding `*.spec.ts` must still return exactly one hit.
- [x] 7.3 Full-suite run before PR: `pnpm test`, `pnpm test:cov`, `pnpm lint`, `pnpm build` (root) and `pnpm test:client`, `pnpm --filter client lint`, `pnpm --filter client typecheck` (client), per `openspec/config.yaml`'s `apply`/`verify` commands.

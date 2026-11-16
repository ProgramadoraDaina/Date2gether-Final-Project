# Verify Report: permanent-scheduled-rooms

## Status: PASS

## Summary

Independent verification of the `sdd-apply` report. All 63 tasks in `tasks.md` are genuinely checked off and the implementation matches `design.md` and all three spec files. The single most important mechanical gate — `rg "eq\(rooms\.code"` over `src/` excluding `*.spec.ts` — returns exactly one hit, inside `room-resolver.service.ts`, confirming the code-recycling security fix (D4) is fully and correctly applied with no missed call site.

All test suites were re-run from scratch in this session (not trusted from the apply report):

| Command | Result |
|---|---|
| `pnpm test` (backend) | 322 passed, 46 suites passed |
| `pnpm lint` (backend) | 0 errors, 1 pre-existing warning (unrelated file, confirmed pre-existing via `git diff --stat`) |
| `pnpm build` (backend) | clean |
| `pnpm test:client` | 274 passed, 47 suites passed |
| `pnpm --filter client lint` | exit 0, only pre-existing warnings, none introduced by new files beyond one `exhaustive-deps` warning on the renamed notes page matching the pre-existing pattern on sibling history pages |
| `pnpm --filter client typecheck` | clean |
| `pnpm --filter client build` | clean after clearing a stale `.next` cache (see Note below) |

**Note on client build:** the first `pnpm --filter client build` run failed with `Cannot find module for page: /login/page` / `PageNotFoundError`. This was a stale `.next` build-cache artifact from a prior build, not a real break — deleting `client/.next` and rebuilding produced a fully clean build including the new `/history/notes/[roomId]` route. Not a project defect; noted here only so a future verifier doesn't get spooked by the same transient.

The dockerized test Postgres (`date2gether-postgres-test`) was already running and healthy; no action needed.

## Verification gate (most critical check)

```
rg "eq\(rooms\.code" src/ --glob '!*.spec.ts'
→ src/modules/rooms/room-resolver.service.ts:13:const byCode = (code: string) => eq(rooms.code, code);
```

Exactly one hit, as design.md requires. `byCode` is a private helper reused by both `joinableByCode` (live-traffic joinability) and `findPoolOccupant` (code-pool occupancy probe used only by `createRoom`'s collision check) — both are internal to the resolver, so the single-boundary invariant holds even though the resolver itself has two internal consumers of `byCode`.

## Spot-checks performed (code read directly, not inferred from docs)

1. **`RoomResolverService`** (`src/modules/rooms/room-resolver.service.ts`): `resolveJoinable`, `lockJoinable`, `assertBound`, `getById`, `touchEntry`, `retireExpired`, `findPoolOccupant` all present and match design.md's signatures and SQL predicates exactly, including the `NOT EXISTS(open call_session)` guard in the sweep.
2. **`RoomAccessService`** (`src/modules/auth/room-access.service.ts`): `RoomParticipant.roomId` is required; `verify()` rejects any payload missing `roomId`/`roomCode`/`name` with no dual-path fallback (D4's "reject, don't accept-for-one-release"); `createAdmissionTicket`/`verifyAdmissionTicket` bind on `roomId`; ticket lifetime is `permanent ? '365d' : '24h'`.
3. **`RoomAccessGuard`** (`src/modules/auth/guards/room-access.guard.ts`): resolves by code via `resolveJoinable`, then `assertBound(participant, room)`, attaches `request.room` — single enforcement point, matches design.md exactly.
4. **Category C fix** — `calls.service.ts:367-375` `getRoomNotesForHistory(userId, roomId)`: single query on `callHistory.roomId`, no `rooms` join, no code anywhere in the method; delegates to `RoomsService.getRoomNotesById(roomId)`. Route confirmed changed: `call-history.controller.ts:24` is `@Get('history/:roomId/notes')` with `ParseUUIDPipe`. This is the exact fix for the proposal's CRITICAL finding.
5. **Category D fixes** — both `calls-webhook.service.ts` and `call-session-close.service.ts` no longer query `rooms` by code; both derive `roomId` from `call_participant_identities` via `identityKeys`, exactly as design.md specifies, with `roomId` nullable when no identity is known.
6. **Migration SQL** (`drizzle/0016_permanent_scheduled_rooms.sql`): byte-for-byte match to design.md's forward migration, correct statement order (columns → new table → nullable `expires_at` → drop old constraint → create partial unique index → create sweep index).
7. **Down-migration** (`drizzle/rollback/0016_permanent_scheduled_rooms.down.sql`): both self-gating `DO` blocks (duplicate-code Gate 1, TTL-free-request Gate 2) present, both before any destructive statement, inside one transaction — matches design.md exactly.
8. **`next-occurrence.ts`**: two-pass offset correction, day-of-week re-derivation from the resulting instant, `Math.max(pass1, pass2)` resolution strategy. Verified against its own DST test suite (both hemispheres, spring-forward and fall-back) — fall-back test expects the pre-transition instant (`2024-11-03T05:30:00Z`), matching D6's documented "pass 1's offset wins" rule.
9. **Two asymmetric schedule endpoints** (`room-schedule.controller.ts`): `GET .../schedule/next` is unauthenticated and its controller spec asserts `Object.keys(result)).toEqual(['nextOccurrenceAt'])` — the "owner's timezone never reaches the viewer" requirement is enforced by the response shape itself, matching D6's stated design intent. `GET .../schedule/slots` requires `JwtAuthGuard` + `RoomRolesGuard('administrador')` and includes `timezone`.
10. **Phase 3 (D7) ten sites** — read `room-admission.service.ts` in full: `lockRoom`, `request` (nullable `expiresAt`, permanent-aware ticket), `status`/`decide` (`request.expiresAt &&` guard), `list` (`or(isNull(...), gt(...))` filter, `stale` flag, `isPermanent` passthrough), `configure` (reject disabling waiting room on permanent, force `true`, unreachable auto-admit branch). All ten match design.md's table precisely.

## Spec-to-test traceability (2+ scenarios per spec file, traced to real assertions)

- **room-permanence**: "Room re-entered before expiry extends the window" / "Room not re-entered after the last entry" → `room-resolver.rolling-window.spec.ts`, a real-Postgres integration test using `±1 minute` margins around the 24h boundary specifically because the predicate runs in SQL (`gt(lastEnteredAt, now() - interval '24 hours')`) and a mocked Drizzle cannot exercise it. "Call-notes history authorization uses room id" → `calls.service.spec.ts` + the real-Postgres `room-code-recycling.integration.spec.ts`.
- **room-admission**: "Attempt to disable the waiting room on a permanent room" → `room-admission.service.spec.ts` asserts `ForbiddenException`. "Pending request older than 24 hours is still decidable" → covered at the DB layer by the `expiresAt &&` guard tests, and — critically — at the actual user-facing layer by `room-admission.ticket-verifiability.spec.ts` (Phase 6.3, see below).
- **room-schedule**: "Computing the next occurrence among multiple slots" → `next-occurrence.spec.ts`'s multi-slot ordering test. "The room owner's timezone never reaches the viewer" → `room-schedule.controller.spec.ts`'s `Object.keys` assertion on the `/next` endpoint.

## Phase 6 non-ordinary tests — confirmed real, not stubs

1. `room-code-recycling.integration.spec.ts` — real Postgres, real `createRoom` sweep + collision retry (not mocked), asserts R1's notes/history are unreachable through R2's recycled code and that `assertBound` throws for R1's token against R2.
2. `migration-0016-rollback.integration.spec.ts` — runs the actual `.down.sql` file via a raw `postgres()` connection against seeded corrupt data for both Gate 1 (duplicated code) and Gate 2 (TTL-free request), asserting the transaction aborts and the schema (three `rooms` columns + `room_schedule_slots`) remains untouched.
3. `room-admission.ticket-verifiability.spec.ts` — real `JwtService` (not mocked), advances `Date.now()` to hour 25, asserts both that the ticket still verifies (365d lifetime) AND the DB row is still `pending`; includes a deliberate "regression guard" test proving the clock-spy actually moves the clock (non-permanent room's 24h ticket does reject at hour 25).

## Deviations reviewed — both reasonable, neither violates a spec

(a) **`isPermanent` added to `RoomAdmissionService.list()`'s response**, not in design.md's file-impact table. Confirmed at `room-admission.service.ts:168`, with an inline comment explaining it exists so the client can hide (not merely disable) the waiting-room toggle for permanent rooms per task 5.8. This is additive, read-only, and doesn't touch any spec requirement — **not a concern**.

(b) **History notes page reads `roomCode` from a `?code=` query param** for the device-local personal-notes localStorage key, while the route itself is `roomId`-keyed. Confirmed in `client/src/app/history/notes/[roomId]/page.tsx`: `getRoomNotesFromHistory(roomId)` is the only backend call and it is `roomId`-only — the query param never reaches the server, never participates in authorization, and only derives a client-side storage key using the same key format `RoomPage` already uses. This does not reopen the Category C vulnerability since the backend call path is untouched. **Not a concern**, though see Suggestion below.

## Pre-existing migration-journal bug — confirmed pre-existing, confirmed unaffected

`drizzle/0012_room_notes.sql` and `drizzle/0013_room_notes_reconcile.sql` exist as files but have no corresponding entries in `drizzle/meta/_journal.json` (which instead lists `0012_call_participation_timeline` and `0013_fix_call_events_id_type` at those index slots). Verified via `git log --follow`: these two orphaned files were committed in `e015028` ("feat(rooms): add personal and shared room notes"), well before this change's work started — confirmed pre-existing, not introduced here. `git status` on `drizzle/` shows this change only modifies `_journal.json` (appending the `0016` entry) and adds new `0016`-prefixed files; it does not touch the `0012`/`0013` orphans, so production/dev migration sequencing for this change's own migration is unaffected by the pre-existing bug.

## Findings

No CRITICAL findings. No WARNING findings that block merge.

### SUGGESTION (non-blocking)

1. `client/src/app/history/page.tsx` builds the notes-page link as `/history/notes/${entry.roomId}?code=${encodeURIComponent(entry.roomCode)}`. For a room whose code has since been recycled by a different room, this URL exposes a now-reassigned code as a query parameter in a bookmarkable/shareable link. It carries no security risk (the backend never reads it, and the code is already shown as a plain label on the `/history` page itself), but a cleaner long-term shape would derive the personal-notes storage key from `roomId` instead of `roomCode`, removing the query param entirely. Not required for this change; flagging for a future cleanup.
2. The pre-existing `drizzle/0012_room_notes.sql` / `0013_room_notes_reconcile.sql` journal gap (not introduced by this change, see above) should get its own fix at some point — it's a latent trap for the next person who runs `drizzle-kit` tooling expecting the journal to be authoritative.

## Recommendation

`next_recommended: archive`

## Risks

- None CRITICAL.
- None WARNING.
- Two SUGGESTIONs noted above, both pre-existing or cosmetic, neither blocking.

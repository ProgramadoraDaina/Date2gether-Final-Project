# Apply Progress: breakout-rooms-ux-fix

**Mode**: Strict TDD (`pnpm test` backend via vitest, `pnpm test` frontend via jest)
**Delivery**: single-pr, size:exception (confirmed by user, High budget-risk forecast)

## Status: 33/35 tasks complete and verified passing. Phases 1-5 done; Phase 6 close-out done except the two live-environment E2E tasks (6.1/6.2), explicitly deferred to manual execution against a real LiveKit/EC2 deploy (established project pattern, no live infra available in this sandbox).

## Completed Phases

### Phase 1 — R1 characterization + mitigation (DONE, 7/7 tasks)

- [x] 1.1-1.6 RED: R1-C1..C6 characterization tests written first
  - R1-C1/C2 in `src/modules/calls/call-session-close.service.spec.ts` (multi-room group, both rooms empty → timer scheduled; T+15s reconnect found → no close)
  - R1-C3/C4 in same file (new `hasAdminAssignmentInFlight` behavior: fresh admin assignment suppresses close, stale/non-admin does not)
  - R1-C5 in `src/modules/calls/calls-webhook.service.spec.ts` (room_finished of principal never calls closeGroupBreakouts — structural + behavioral)
  - R1-C6 in `src/modules/calls/calls.service.spec.ts` (assertHostConnected never queries call_breakout_occupants — exactly 1 call from assertBreakoutReturnAllowed only)
- [x] 1.7 GREEN: `hasAdminAssignmentInFlight(roomId)` implemented in `call-session-close.service.ts`, `ASSIGNMENT_IN_FLIGHT_MS = 30_000`, invoked only when `groupRoomNames.length > 1` and presence check would return `false`.

All 28 tests in call-session-close.service.spec.ts pass (23 pre-existing + 5 new). All R1-C1..C6 green.

### Phase 2 — Removal-reason signal (DONE, 9/9 tasks)

- [x] 2.1 `call-group.ts`: `BREAKOUT_REMOVAL_REASONS` closed array + `BreakoutRemovalReason` type + `isBreakoutRemovalReason()` guard + test.
- [x] 2.2 `breakout-rooms.service.ts`: `findOpenOccupantByLivekitIdentity` now projects `sourceIdentity` + test.
- [x] 2.3 `room-events.service.ts`: `BreakoutRemovalEvent` + `emitBreakoutRemoval`/`onBreakoutRemoval` + test.
- [x] 2.4 `chat.gateway.ts`: forwards `breakout:removal` via `emitToParticipant` keyed by `event.targetIdentity` + test.
- [x] 2.5 `breakout-rooms.service.ts`: `moveIn` emits `BREAKOUT_MOVE_IN` before `removeParticipant`; `selfReturn` admin branch emits `BREAKOUT_FORCED_RETURN` addressed to `occupant.sourceIdentity` (not the mini-room identity) before `removeParticipant` + tests.
- [x] 2.6 `calls-webhook.service.ts`: locked expulsion (`onParticipantJoined`) emits `BREAKOUT_RETURN_LOCKED` before `removeParticipant`. Added `RoomEventsService` as new constructor dependency (already exported by `RoomsModule`, already imported by `CallsModule` — no module wiring change needed) + tests.
- [x] 2.7 `client/src/features/chat/useRoomSocket.ts`: `consumeRemovalNotice()` — ref-backed (`removalNoticeRef`), destructive read, 10s freshness window (`REMOVAL_NOTICE_FRESHNESS_MS`) + 5 new tests.
- [x] 2.8 `client/src/features/calls/useCallSession.ts`: `endedForBreakout()` (new producer for the already-declared `'breakout-closed'` literal), `removedByPolicy(code)` (new producer, new `'breakout-locked'` literal). Neither passes through `status: 'error'`. `removedByPolicy` stores the raw code in `error` for now — see Deviation below. + 4 new tests.
- [x] 2.9 `client/src/features/calls/MeetingRoom.tsx` `onDisconnected`: new `PARTICIPANT_REMOVED` branch inserted after the `switching` check, before the final `else`. Branches on `consumeRemovalNotice()`: `BREAKOUT_MOVE_IN` → no-op return; `BREAKOUT_FORCED_RETURN` → `call.endedForBreakout()`; `BREAKOUT_RETURN_LOCKED` → `call.removedByPolicy(notice.reason)`; none/expired → `call.failed(...)` (unchanged). + 4 new tests.

All 457 client jest tests pass. All backend unit tests pass (509, pre-existing Postgres integration tests still fail locally — no DB available, unrelated to this change, confirmed identical failure set before/after via git stash).

## Deviations from Design

1. ~~**`removedByPolicy(code)` stores the raw code in `error`, not a translated message.**~~ **RESOLVED in Phase 5 (task 5.5)**: `client/src/lib/breakouts.ts` gained `resolveBreakoutEndCopy(endReason)`, and `page.tsx`'s `callEndedPanel` now branches on `callSession.endReason` to render it for `breakout-closed`/`breakout-locked` instead of always showing the host-left text. `removedByPolicy(code)` itself still stores the raw code in `error` (unused by the render path now — `endReason` alone drives the copy selection), which is fine: no caller reads `error` for this path. Covered by 2 new tests in `page.spec.tsx`.

2. **`useRoomSocket(roomSocket)` is called once, in the outer `MeetingRoom` component, not twice.** Initially implemented by calling the hook a second time inside `MeetingContent` too (since `breakoutAssignment` was already consumed there) — this is technically safe against a real Socket.io socket (multiple `.on()` listeners for the same event all fire), but broke `MeetingRoom.spec.tsx`'s existing `createFakeSocket()` test helper, which stores only the **last-registered** callback per event name (not a true multi-listener emitter), unlike `chat.gateway.spec.ts`'s `mockRoom.on` which does chain callbacks. Fixed by lifting the single `useRoomSocket` call to the outer `MeetingRoom` function and passing `breakoutAssignment` down to `MeetingContent` as a new prop instead of calling the hook again. This is a cleaner structural outcome than two independent hook instances and was verified against the full 28-test `MeetingRoom.spec.tsx` suite (passes) — noting it here because it is a structural change beyond the design's literal file-change description for `MeetingRoom.tsx` (which only mentioned "un solo montaje de mini salas" for Phase 5, not this prop-lifting). Low risk: `MeetingContent`'s only consumer of `breakoutAssignment` is unchanged in behavior, just unchanged in source (prop vs hook).

3. **`moveIn`'s reordering (fetch breakout row before resolving role, per design.md's explicit "las líneas 226-234 se reordenan") required fixing one pre-existing test's setup.** `[5.4.3] solicitante no-administrador: 403, ninguna identity nueva` previously relied on the role check short-circuiting *before* any `callBreakoutRooms` query ran, so it never mocked `db.breakoutRoomsSelectWhere`. With the row fetched first (required because `joinPolicy` lives on it and the authorization decision needs both role and policy), the default empty-rows mock would make `getOpenRowOrThrow` throw `NotFoundException` instead of the expected `ForbiddenException`. Fixed by adding the now-required `db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]))` to that test's setup — the test's actual intent (non-admin can't move a third party) is unchanged and still asserts `ForbiddenException`. This is a direct, required consequence of implementing the design's explicit reordering instruction, not an incidental side effect.

4. **Resolved ambiguity in task 4.1's "incl. principal" wording** — see Phase 4 section above. Implemented per design.md's literal TypeScript interfaces (no backend-side principal entry; `sourceIdentity` is the enabler for a client-side computation in Phase 5).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.6 | `call-session-close.service.spec.ts` | Unit | ✅ 23/23 | ✅ Written | ✅ Passed | ✅ multiple cases | ➖ None needed |
| 1.5 | `calls-webhook.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ➖ Single | ➖ None needed |
| 1.6 | `calls.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ➖ Single | ➖ None needed |
| 1.7 | `call-session-close.service.ts` (impl) | Unit | N/A (impl task) | — | ✅ all R1-C* pass | ✅ 2 branches (fresh/stale) | ✅ Clean |
| 2.1 | `call-group.spec.ts` | Unit (pure) | N/A (new) | ✅ Written | ✅ Passed | ✅ 3 reasons + 1 rejection | ➖ None needed |
| 2.2 | `breakout-rooms.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ➖ Single | ➖ None needed |
| 2.3 | `room-events.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ➖ Single | ➖ None needed |
| 2.4 | `chat.gateway.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ✅ 2 cases (connected/not) | ➖ None needed |
| 2.5 | `breakout-rooms.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ✅ moveIn + selfReturn | ➖ None needed |
| 2.6 | `calls-webhook.service.spec.ts` | Unit | ✅ pre-existing suite green | ✅ Written | ✅ Passed | ✅ 2 cases (locked/free) | ➖ None needed |
| 2.7 | `useRoomSocket.spec.ts` | Unit | ✅ pre-existing 6/6 | ✅ Written | ✅ Passed | ✅ 5 cases (empty/fresh/destructive/expired/unsub) | ➖ None needed |
| 2.8 | `useCallSession.spec.ts` | Unit | ✅ pre-existing 12/12 | ✅ Written | ✅ Passed | ✅ 4 cases | ➖ None needed |
| 2.9 | `MeetingRoom.spec.tsx` | Unit (RTL) | ✅ pre-existing 25/28 (3 new RED, 1 safety-net already green) | ✅ Written | ✅ Passed | ✅ 4 branches | ✅ Refactor: lifted `useRoomSocket` call (see Deviation 2) |
| 5.1 | `breakoutViewState.spec.ts` | Unit (pure) | N/A (new) | ✅ Written (prior session) | ✅ Passed | ✅ 4 states + exhaustiveness | ➖ None needed |
| 5.2/5.7 | `BreakoutHostConsole.spec.tsx` | Unit (RTL) | ✅ pre-existing suite green | ✅ Written (prior session) | ✅ Passed | ✅ principal pane / 2 toggles / transfer filter / self-transfer | ➖ None needed |
| 5.3 | `BreakoutSelfStatus.spec.tsx` | Unit (RTL) | ✅ pre-existing 4/4 (pure rename) | ➖ N/A (rename, no new behavior) | ✅ Passed | ➖ N/A | ➖ None needed |
| 5.4 | `BreakoutView.spec.tsx` | Unit (RTL) | N/A (new) | ✅ Written (prior session) | ✅ Passed | ✅ 4 states + Volver delegation | ➖ None needed |
| 5.5 (gap-closure) | `page.spec.tsx` | Unit (RTL) | ✅ pre-existing 55/55 | ✅ Written (this batch, confirmed RED) | ✅ Passed | ✅ breakout-closed + breakout-locked | ➖ None needed |
| 5.6 | `page.spec.tsx` | Unit (RTL) | ✅ pre-existing suite green | ✅ Written (prior session) | ✅ Passed | ➖ Single | ➖ None needed |

### Test Summary
- **Total tests written this session**: ~45 new test cases across 9 files
- **Total tests passing**: 509 backend unit (vitest) + 457 frontend (jest) = 966, all green
- **Layers used**: Unit (all) — no Integration/E2E tooling exercised this session (Postgres unavailable locally for the pre-existing integration specs; those were already failing before this change for the same reason, confirmed via `git stash`)
- **Approval tests** (refactoring of existing code): R1-C1/C2/C6 in Phase 1 are approval/characterization tests of existing `hasConnectedAdmin`/`assertHostConnected` behavior, written and passing against current code before 1.7's mitigation
- **Pure functions created**: `isBreakoutRemovalReason` (call-group.ts), `hasAdminAssignmentInFlight` is impure (DB), `consumeRemovalNotice` is impure (ref/Date.now) by necessity; `resolveBreakoutViewState` (breakoutViewState.ts, Phase 5) and `resolveBreakoutEndCopy`/`isAdminBreakoutView` (breakouts.ts, Phase 5) are pure

### Final totals (after Phase 5-6, this continuation batch)
- **Backend (vitest)**: 535/549 passing (14 pre-existing Postgres-integration `ECONNREFUSED` failures, identical file/count to the Phase-4 checkpoint — confirmed unrelated)
- **Frontend (jest)**: 478/478 passing (476 at the Phase-4/pre-crash checkpoint + 2 new `[5.5]` tests in `page.spec.tsx` this batch)
- **`tsc --noEmit`**: zero new errors in either package. One fixture (`MeetingRoom.spec.tsx:832`) needed a `joinPolicy` field added to satisfy `BreakoutRoomAdminView`'s stricter shape — not a task, a correctness fix surfaced by running the type-checker for the first time since Phase 3/4 tightened that type.

### Phase 3 — joinPolicy schema, migration, authorization (DONE, 6/6 tasks)

- [x] 3.1 `schema.ts`: `joinPolicy` column added to `callBreakoutRooms`. `drizzle/0024_breakout_join_policy.sql` generated successfully via `DATABASE_URL="postgres://user:pass@localhost:5432/dummy" pnpm drizzle-kit generate --name breakout_join_policy` — `drizzle-kit generate` (unlike `migrate`/`push`) only diffs against the local schema snapshot in `drizzle/meta/`, so it does NOT need a live Postgres connection. Generated SQL matches design exactly: `ALTER TABLE "call_breakout_rooms" ADD COLUMN "join_policy" varchar(16) DEFAULT 'admin_only' NOT NULL;`.
- [x] 3.2 `JoinPolicy` type + `DEFAULT_JOIN_POLICY`; `create`/`updatePolicy`/`toView` all updated; cross-isolation verified by test (`updatePolicy` patch object only ever contains the key that was explicitly passed in the dto — changing one policy never touches the other's key in the SQL `SET` clause).
- [x] 3.3 Both DTOs get `joinPolicy?: JoinPolicy` with `@IsIn(['admin_only', 'open'])`, same pattern as `leavePolicy`. Added `src/modules/calls/dto/breakout-rooms.dto.spec.ts` (new file — no DTO spec file existed before) with `class-validator`'s real `validate()` to prove the decorator actually rejects out-of-union values, not just structurally present.
- [x] 3.4 `moveIn` fully rewritten: `getOpenRowOrThrow(breakoutId, roomId)` now runs **before** role resolution (joinPolicy lives on that row, needed for the decision) — see Deviation 3 below for the one pre-existing test this reordering required fixing. Authorization: `role === 'administrador' || (breakout.joinPolicy === 'open' && target.livekitIdentity === actorGroupIdentity)`, where `actorGroupIdentity` is lazily computed (only queried when non-admin AND policy is `'open'` — zero extra queries on the admin path, matching D2/D9 cost invariants elsewhere in this codebase).
- [x] 3.5 Added `findOpenOccupantByLivekitIdentityAnyRoom` (unscoped by breakout room — needed because origin and destination are different mini rooms on a jump). `sourceIdentity` is inherited from the existing assignment when present; the previous assignment is closed (`markOccupantReturned`) **before** the new row is inserted (verified via explicit call-order test).
- [x] 3.6 Capacity check now calls `listRooms([breakout.livekitRoomName])` first; if the room doesn't exist in LiveKit (reaped by `emptyTimeout`), capacity is treated as 0 and `listParticipants` is never called (verified: `expect(listParticipants).not.toHaveBeenCalled()`), avoiding the unguarded-throw → 500 path.

All 62 tests in `breakout-rooms.service.spec.ts` pass.

### Phase 4 — list role projection (DONE, 2/2 tasks)

- [x] 4.1 Added `BreakoutRoomAdminView`/`BreakoutRoomAdminOccupantView`/`BreakoutRoomPublicView`. `list()` now calls `resolveRole` first, then branches: admin gets the full roster per room **with `sourceIdentity`** (the design's stated purpose: enabling the frontend to compute "who's left in the principal" via presence-minus-occupants subtraction); non-admin gets `{ id, label, leavePolicy, joinPolicy, autoCloseAt, occupantCount, selfAssigned }` — no `livekitRoomName`, no occupant identities at all. `fetchOccupantsByBreakoutIds` (shared helper also used by `create`/`updatePolicy`) now additionally projects `sourceIdentity`; this is additive and does not change `create`/`updatePolicy`'s existing `BreakoutRoomView`/`toView()` contract (left untouched — out of this phase's scope per tasks.md, which only calls out `list()`).
- [x] 4.2 Controller `list()` now has an explicit `Promise<BreakoutRoomAdminView[] | BreakoutRoomPublicView[]>` return type (the only controller method in this file with an explicit return type — intentional, to make the role-discriminated contract visible at the HTTP boundary, matching Decision 4's framing of the projection as "the security boundary").

**Resolved ambiguity (not a deviation, flagging for visibility):** tasks.md's task 4.1 says "role-discriminated `list()` **incl. principal**", but design.md's literal `BreakoutRoomAdminView`/`BreakoutRoomPublicView` TypeScript interfaces have no principal-room field, and design.md's own prose explains the principal roster is computed **client-side** (`breakoutParticipants` presence minus `⋃ occupants.sourceIdentity`, see Decision 4's explanation of why `sourceIdentity` was added). I implemented exactly what design.md's interfaces specify (mini-room-only discriminated array; `sourceIdentity` is the enabler, not a backend-computed principal entry). This will matter for Phase 5, which does the actual client-side subtraction in `BreakoutHostConsole`.

All 62 tests in `breakout-rooms.service.spec.ts` + full backend suite (535/549 unit tests, 14 pre-existing Postgres-integration failures unrelated) pass. `tsc --noEmit` shows zero new errors (same 4 pre-existing error files as the Phase-1 baseline).

### Phase 5 — Frontend state machine + component split (DONE, 7/7 tasks)

**Context for this section**: this phase was started by a previous session that was cut off mid-task by an API session-limit error (not a code failure), after the last time this file was written but before it recorded Phase 5 progress. That session had already landed, untracked by this doc: `breakoutViewState.ts`/`.spec.ts` (5.1), `BreakoutView.tsx`/`.spec.tsx`/`.module.css` (5.4), the `BreakoutPanel.tsx`→`BreakoutHostConsole.tsx` and `BreakoutBanner.tsx`→`BreakoutSelfStatus.tsx` renames with their full behavior changes (5.2/5.3/5.7), `client/src/lib/breakouts.ts`'s `joinPolicy`/admin-public views/copy map (most of 5.5), `page.tsx`'s `currentParticipantId` wiring (5.6), and `MeetingRoom.tsx`'s single-mount wiring. This continuation batch verified all of that against the actual file contents and tasks.md's literal 5.1-5.7 definitions (not by trusting the stale version of this doc), confirmed it was complete and tested, and closed the one remaining gap.

- [x] 5.1 `breakoutViewState.ts`: `resolveBreakoutViewState({isAdmin, assignment})` → `'guest-idle' | 'guest-occupant' | 'host' | 'host-occupant'`, pure, no React. 5 tests (4 states + exhaustiveness-of-4-distinct-results) in `breakoutViewState.spec.ts`. Verified against design.md's literal state table.
- [x] 5.2 `BreakoutPanel.tsx` → `BreakoutHostConsole.tsx` (git-tracked rename, `R` status in `git diff --stat`): gained `currentParticipantId` prop, a principal-pane (`data-testid="breakout-principal-pane"`) computed as `participants` minus `⋃ occupants.sourceIdentity` per Decision 4, a second policy toggle (`handleToggleJoinPolicy`, verified by test to never send `leavePolicy` in the same PATCH and vice versa), and consumes `BreakoutRoomAdminView[]` (filtered defensively via `isAdminBreakoutView`) instead of the old flat `BreakoutRoom[]`.
- [x] 5.3 `BreakoutBanner.tsx` → `BreakoutSelfStatus.tsx` (git-tracked rename): pure rename + prop/type renames, no behavior change — correct per design, since it's now a subview mounted by `BreakoutView`, not a standalone mount point. 4 pre-existing tests renamed/passing.
- [x] 5.4 `BreakoutView.tsx`: single mount point, delegates to `resolveBreakoutViewState` and renders `BreakoutSelfStatus`/`BreakoutHostConsole` per the 4-state table (never two at once — verified explicitly for `host-occupant`, where both render **inside** the same popover, never as siblings at the `MeetingRoom` level). 5 tests in `BreakoutView.spec.tsx` cover all 4 states + the "Volver" action delegation.
- [x] 5.5 `client/src/lib/breakouts.ts`: `JoinPolicy` type, `BreakoutRoomAdminView`/`BreakoutRoomPublicView`/`BreakoutRoomAdminOccupant` (mirroring the backend's Decision-4 types), `isAdminBreakoutView` type guard, and `resolveBreakoutEndCopy(endReason)` mapping `'breakout-closed'`/`'breakout-locked'` to visible copy. **This batch additionally closed Deviation 1** (flagged in a prior checkpoint of this doc as a known gap): `resolveBreakoutEndCopy` existed and was tested in isolation, but `page.tsx`'s `callEndedPanel` still unconditionally rendered the host-left text for any `endReason`. Added `callEndedMessage` in `page.tsx` that branches on `callSession.endReason` (`breakout-closed`/`breakout-locked` → `resolveBreakoutEndCopy`; anything else, including `host-left`/`null`, → the existing hardcoded text), plus 2 new RED→GREEN tests in `page.spec.tsx` (`[5.5] ...breakout-closed...` / `[5.5] ...breakout-locked...`) using a new mutable `mockEndReason` in that file's `useCallSession` mock (same pattern as the pre-existing `mockStatus`/`mockError`).
- [x] 5.6 `client/src/app/room/[code]/page.tsx`: `currentParticipantId={access.participant.sub}` passed to `MeetingRoom`. 1 test (`[5.6] ...guest-1...`) asserting it reaches `MeetingRoom`'s props.
- [x] 5.7 `BreakoutHostConsole`'s transfer `<select>` now iterates `transferCandidates` (= `participants` filtered to exclude `currentParticipantId`) instead of the raw `participants` list, and a separate "Trasladarme acá" button calls `handleMoveIn(room.id, currentParticipantId)` directly — never through the dropdown. Covered by the `[5.7]` describe block in `BreakoutHostConsole.spec.tsx` (selector excludes self; separate button calls `moveToBreakoutRoom` with `currentParticipantId`).

**TDD note for this phase**: tasks 5.1-5.4 and 5.6-5.7's tests were already written and green from the prior (crashed) session — this batch's own RED→GREEN cycle was for the 5.5 gap-closure only (2 new tests, confirmed RED against the unmodified `page.tsx` before the `callEndedMessage` branch was added, then GREEN after).

**One fixture fix required for `tsc --noEmit` cleanliness** (not a task, a correctness check): `MeetingRoom.spec.tsx:832` mocked `listBreakoutRooms` with an object missing the now-required `joinPolicy` field (added by Decision 3/Phase 3, surfaced only now because this is the first time `tsc --noEmit` was run after Phase 5's `BreakoutRoomAdminView` typing tightened that mock's shape). Added `joinPolicy: 'admin_only'` to that one fixture. Zero other new type errors introduced; the `exact` option error at `page.spec.tsx` (unrelated line, pre-existing `ByRoleOptions` typing gap) and the 4 backend baseline error files are unchanged from before this batch.

### Phase 6 — E2E + close-out (2/4 — 6.1/6.2 explicitly deferred to manual)

- [ ] 6.1 E2E: admin alone creates mini room, transfers, zero visible error, call stays alive past 20s — **deferred, manual.** Needs a real LiveKit room (local or EC2); this sandbox has no LiveKit infra running. Consistent with this project's established pattern of running E2E/load tests against real EC2 deploys rather than simulating LiveKit locally (see prior session notes on load testing and the EC2-demo-deploy memory).
- [ ] 6.2 E2E: locked occupant reconnecting sees policy message — **deferred, manual**, same reason as 6.1.
- [x] 6.3 Ran full `pnpm test` in both packages. Backend: 535/549 (14 failures, all pre-existing `ECONNREFUSED` Postgres-integration failures — same count/files as the Phase-4 checkpoint, confirmed unrelated). Frontend: 478/478 (476 at the Phase-4/pre-crash checkpoint + 2 new 5.5 tests). All R1-C1..C6 and every new Phase 1-5 suite green.
- [x] 6.4 Appended **entry #22** to `docs/decisiones-tecnicas.md`: covers R1's race-condition mitigation rationale (`hasAdminAssignmentInFlight`, why the alternatives — widening the grace window, in-memory suppression — were rejected), the `joinPolicy`/`leavePolicy` separation rationale, the removal-reason-signal decision, and verification counts for this change.

## Remaining Work

None blocking. Only 6.1/6.2 (live-environment E2E) remain, by design deferred to manual execution — same pattern as this project's prior EC2-based load/E2E verification for this same feature branch (see `project_breakout_rooms_branch_status` memory: deployed live to production demo, load-tested manually on EC2, not via a local E2E harness).

## Next Steps for Continuation Batch

None required for `breakout-rooms-ux-fix` itself — all code/test/doc tasks are done. If picked up again, the only remaining action is running 6.1/6.2 manually against a live deploy (or explicitly waiving them) before merge, per this project's `single-pr`/`size:exception` delivery strategy. No commit/push/PR was made by this batch per the orchestrator's explicit instruction to stop at implementation.

# Tasks: breakout-rooms-ux-fix

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Production files touched | 20 (per design's "Cambios de archivos" table) |
| Test files touched/created | ~12 (characterization R1-C1..C6 + signal + joinPolicy + list + frontend specs) |
| Estimated changed lines | 800-1200+ (migration/DTO small; moveIn reordering, list projection, BreakoutView/breakoutViewState new files, Panel/Banner→HostConsole/SelfStatus rewrite, 6 characterization tests are the bulk) |
| 400-line budget risk | High |
| Hot-path match (`**/auth/**`, `**/security/**`, `**/payments/**`) | None — all touched paths are under `calls/`, `chat/`, `rooms/`, `db/`, no auth/security/payments directory match |
| Chained PRs recommended | No (overridden by `delivery_strategy=single-pr`) |
| Suggested split | Single PR, ordered commits per phase below (R1 → signal → joinPolicy → list → frontend → E2E) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All phases below | PR 1 (single) | `single-pr` strategy; requires `size:exception` approval before apply given High budget risk; keep backend-signal commit and frontend-panel commit separate internally per proposal rollback plan |

## Phase 1: R1 characterization + mitigation (blocking — condicions all else)

- [x] 1.1 RED `call-session-close.service.spec.ts`: R1-C1 — both rooms empty, `onAdminLeft` schedules close timer (current behavior)
- [x] 1.2 RED same file: R1-C2 — at T+15s with new identity present in mini room, `recheckAndClose` does not call `deleteRoom`
- [x] 1.3 RED same file: R1-C3 — `hasAdminAssignmentInFlight`: 5s-old admin assignment suppresses close, 60s-old does not
- [x] 1.4 RED same file: R1-C4 — fresh non-admin assignment does not suppress close
- [x] 1.5 RED `calls-webhook.service.spec.ts`: R1-C5 — `room_finished`(principal) never calls `closeGroupBreakouts`
- [x] 1.6 RED `calls.service.spec.ts`: R1-C6 — `assertHostConnected` never queries `call_breakout_occupants`
- [x] 1.7 GREEN `call-session-close.service.ts`: implement `hasAdminAssignmentInFlight(roomId)`, invoked only when `groupRoomNames.length > 1` and presence check would return `false`; all R1-C1..C6 pass — [spec: call-host-gate "Administradora única del grupo..."]

## Phase 2: Removal-reason signal (decision 2)

- [x] 2.1 `call-group.ts`: add closed union `BreakoutRemovalReason` + test
- [x] 2.2 `breakout-rooms.service.ts`: `findOpenOccupantByLivekitIdentity` projects `sourceIdentity` + test
- [x] 2.3 `room-events.service.ts`: `emitBreakoutRemoval({roomCode, targetIdentity, reason})` + `onBreakoutRemoval` + test
- [x] 2.4 `chat.gateway.ts`: forward `breakout:removal` via `emitToParticipant` keyed by `sourceIdentity` + test
- [x] 2.5 `breakout-rooms.service.ts` §5.4: `moveIn` (:283) emits `BREAKOUT_MOVE_IN` before `removeParticipant`; admin `selfReturn` (:365) emits `BREAKOUT_FORCED_RETURN` addressed to `occupant.sourceIdentity` — [spec: call-breakout-rooms "Señal explícita de motivo"]
- [x] 2.6 `calls-webhook.service.ts` (:214): locked expulsion emits `BREAKOUT_RETURN_LOCKED` before `removeParticipant` — [spec: call-webhook-ingestion "Señal explícita en la expulsión...locked"]
- [x] 2.7 `useRoomSocket.ts`: `consumeRemovalNotice()` ref-backed, destructive read, 10s freshness window + test
- [x] 2.8 `useCallSession.ts`: `endedForBreakout()`, `removedByPolicy(code)`, `'breakout-locked'` EndReason literal + test
- [x] 2.9 `MeetingRoom.tsx` `onDisconnected`: branch per reason table (MOVE_IN no-op / FORCED_RETURN ended / RETURN_LOCKED policy message / none-or-expired→`failed`), inserted after the `switching` check (:643) — [spec: call-breakout-rooms + call-webhook-ingestion distinguishability scenarios]

## Phase 3: joinPolicy schema, migration, authorization (decision 3)

- [x] 3.1 `src/db/schema.ts` + `drizzle/0024_breakout_join_policy.sql`: add `joinPolicy` varchar(16) default `admin_only`, generated via `drizzle-kit generate` with inline `DATABASE_URL`
- [x] 3.2 `breakout-rooms.service.ts`: `JoinPolicy` type, `create`/`updatePolicy` accept it, `toView` projects it; cross-isolation from `leavePolicy` + test — [spec: "Política de ingreso por mini sala" all scenarios]
- [x] 3.3 `dto/create-breakout-room.dto.ts`, `dto/update-breakout-room.dto.ts`: add `joinPolicy?` validator matching `leavePolicy` pattern
- [x] 3.4 `moveIn` authorization matrix + test: admin any target incl. self OK; non-admin `admin_only` self→403; non-admin `open` self→OK; non-admin `open` third-party→403; full room→409 — [spec: "Traslado de un participante hacia una mini sala" all scenarios]
- [x] 3.5 `moveIn` + test: mini-room-to-mini-room jump inherits `sourceIdentity` from existing open assignment, closes previous (`returned_at = now()`) before inserting new
- [x] 3.6 `moveIn` + test: guard capacity check with `listRooms([name])` first; LiveKit-absent room treated as empty, no 500

## Phase 4: list role projection (decision 4)

- [x] 4.1 `breakout-rooms.service.ts`: `BreakoutRoomAdminView`/`BreakoutRoomPublicView`, role-discriminated `list()` incl. principal + test — [spec: "Proyección de roster por rol al listar mini salas"]
- [x] 4.2 `breakout-rooms.controller.ts`: update `list()` return type to the discriminated union

## Phase 5: Frontend state machine + component split (decision 5)

- [x] 5.1 `breakoutViewState.ts`: `resolveBreakoutViewState`, 4 states exhaustive, pure, no render + test
- [x] 5.2 `BreakoutPanel.tsx` → `BreakoutHostConsole.tsx`: principal+occupants pane, per-room roster, two labeled policy toggles, self-transfer action + test
- [x] 5.3 `BreakoutBanner.tsx` → `BreakoutSelfStatus.tsx`: own-status subview, no longer mounts standalone + test
- [x] 5.4 `BreakoutView.tsx`: single mount replacing dock trigger (`MeetingRoom.tsx:562-584`), removes banner mount site (`:478-484`); never renders two breakout views at once + test
- [x] 5.5 `client/src/lib/breakouts.ts`: `joinPolicy` field, admin/public view types, removal-code→copy map — **plus** wired `resolveBreakoutEndCopy` into `page.tsx`'s `callEndedPanel` (branches on `endReason`), closing the gap flagged as Deviation 1 in a previous apply-progress checkpoint + 2 new tests
- [x] 5.6 `client/src/app/room/[code]/page.tsx`: pass `currentParticipantId={access.participant.sub}` to `MeetingRoom` → `BreakoutView`
- [x] 5.7 Host console transfer selector + test: filter own identity via `currentParticipantId`; admin self-transfer offered as separate explicit action, never a duplicated/ambiguous row

## Phase 6: E2E + close-out

- [ ] 6.1 E2E: admin alone creates mini room, transfers, zero visible error, call stays alive past 20s — **deferred, manual**: needs a live LiveKit/EC2 environment, same established pattern as the rest of this project's E2E/load tests (no local LiveKit infra available in this sandbox)
- [ ] 6.2 E2E: locked occupant reconnecting sees policy message — **deferred, manual**, same reason as 6.1
- [x] 6.3 Run full `pnpm test`; confirm R1-C1..C6 and all new suites green — backend 535/549 (14 pre-existing Postgres-integration failures, unrelated), frontend 478/478, both green
- [x] 6.4 Append decision entry to `docs/decisiones-tecnicas.md` (joinPolicy/leavePolicy separation, R1 mitigation rationale) — entry #22 added

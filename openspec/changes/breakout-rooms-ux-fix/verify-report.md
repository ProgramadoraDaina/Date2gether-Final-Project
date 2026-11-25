# Verification Report: breakout-rooms-ux-fix

**Mode**: Full spec-driven verification (proposal/specs/design/tasks/apply-progress all present)
**Strict TDD**: Active, verified against real test execution, not apply-progress narrative alone.
**Verdict**: PASS WITH WARNINGS

## Completeness

| Dimension | Result |
|---|---|
| Tasks checked vs code state | 33/35 checked, matches code. 6.1/6.2 unchecked and genuinely deferred (no live LiveKit infra in sandbox), explicitly documented, not silently skipped |
| Unchecked tasks | 6.1/6.2 are E2E tasks requiring real infra; treated as WARNING (blocks sign-off before merge, not a code defect) since nothing in code depends on them and the deferral is explicit and consistent with project precedent |

## Test Execution (reproduced, not trusted from apply-progress)

| Suite | Claimed | Actual (reproduced) | Match |
|---|---|---|---|
| Backend vitest, pnpm test at root | 535/549 passing, 14 pre-existing Postgres ECONNREFUSED failures | 535/549 passing, 14 failed, same ECONNREFUSED Postgres-integration failures | Match |
| Frontend jest, client/ | 478/478 passing | 478/478 passing, 68 suites | Match |
| tsc --noEmit root | zero new errors, 4 pre-existing error files unchanged | 4 files produce errors: migration-0016-rollback.integration.spec.ts, calls-webhook.service.spec.ts, room-code-recycling.integration.spec.ts, rooms.service.create-room.integration.spec.ts. File count matches but one new error occurrence found inside the new R1-C5 test, see WARNING below | Partial, see finding |
| tsc --noEmit client | pre-existing ByRoleOptions typing gap, unrelated line | 1 error at page.spec.tsx line 433, confirmed via diff-hunk line mapping to correspond to pre-existing code shifted by insertions, not new | Match |

## Spec Compliance Matrix

### call-host-gate: administradora unica del grupo (R1)

| Scenario | Evidence | Status |
|---|---|---|
| Admin alone transfers to breakout, reconnects within grace window, group not force-closed | hasAdminAssignmentInFlight(roomId) in call-session-close.service.ts lines 199-221, wired into hasConnectedAdmin only when groupRoomNames.length greater than 1 AND the presence check already returned identities.length === 0, exactly as scoped in design.md | PASS |
| R1-C1 through R1-C6 characterization tests | All 6 exist and were read individually: call-session-close.service.spec.ts (R1-C1, R1-C2, R1-C3 x2, R1-C4), calls-webhook.service.spec.ts (R1-C5), calls.service.spec.ts (R1-C6). Each asserts the exact behavior design.md's table specifies, not superficially-similar substitutes | PASS, real coverage |

### call-breakout-rooms: removal-reason signal, joinPolicy, list projection

| Requirement | Evidence | Status |
|---|---|---|
| BreakoutRemovalReason closed union | call-group.ts lines 71-81, BREAKOUT_REMOVAL_REASONS const array plus derived type plus type guard | PASS |
| All 3 callers emit correct reason before removeParticipant | moveIn to BREAKOUT_MOVE_IN (breakout-rooms.service.ts:415-420); admin selfReturn to BREAKOUT_FORCED_RETURN addressed to occupant.sourceIdentity (:511-516); webhook locked-eviction to BREAKOUT_RETURN_LOCKED (calls-webhook.service.ts:222-228), all confirmed before removeParticipant | PASS |
| Client branches on all 3 reasons plus none/expired fallback | MeetingRoom.tsx lines 605-628: BREAKOUT_MOVE_IN no-op return; BREAKOUT_FORCED_RETURN to call.endedForBreakout(); BREAKOUT_RETURN_LOCKED to call.removedByPolicy(...); none/expired to call.failed(...) unchanged. useRoomSocket.ts consumeRemovalNotice() is ref-backed, destructive, 10s freshness window | PASS |
| joinPolicy migration matches schema | drizzle/0024_breakout_join_policy.sql matches schema.ts line 549 exactly | PASS |
| moveIn authorization matrix | breakout-rooms.service.ts lines 321-334: authorized = role === administrador OR (joinPolicy === open AND target === actorGroupIdentity) | PASS |
| Changing joinPolicy never touches leavePolicy | updatePolicy's patch object only adds the field present in the dto; explicit isolation tests in both directions exist | PASS |
| list() role projection genuinely excludes occupant identities and livekitRoomName for non-admins | breakout-rooms.service.ts lines 221-262: BreakoutRoomPublicView branch has no occupants array, no livekitRoomName; admin branch retains both | PASS, verified by reading response-shaping code |

### call-webhook-ingestion: locked-eviction signal survives generic no-error handling

| Requirement | Evidence | Status |
|---|---|---|
| Locked eviction gets its own signal, distinct from generic move/return signal | calls-webhook.service.ts lines 222-226 emits BREAKOUT_RETURN_LOCKED, handled as distinct branch client-side with separate endReason breakout-locked vs breakout-closed | PASS |

### Frontend 4-state machine

| Check | Evidence | Status |
|---|---|---|
| resolveBreakoutViewState pure, exactly 4 states | breakoutViewState.ts, no React import, 4-state union, exhaustiveness tested via Set of 4 distinct results | PASS |
| BreakoutView.tsx single mount point | MeetingRoom.tsx lines 516-525, only one BreakoutView mount; old BreakoutPanel/BreakoutBanner files no longer exist on disk, renamed not left dead alongside | PASS |
| callEndedPanel renders breakout copy | page.tsx lines 561-567, callEndedMessage branches on callSession.endReason, confirmed real rendered code | PASS, gap genuinely closed |

## Non-Goals Respected

| Non-goal | Status |
|---|---|
| leavePolicy semantics untouched | No scope creep |
| 3-room cap untouched (MAX_BREAKOUT_ROOMS default 3) | No scope creep |
| Multi-room host monitoring untouched | No scope creep |

## Deviations from Design, Reasonableness Review

All 4 documented deviations in apply-progress.md were checked against actual code and found reasonable:
1. Deviation 1 (removedByPolicy raw-code-in-error, resolved via page.tsx copy branch in 5.5): confirmed resolved and real.
2. Deviation 2 (useRoomSocket called once, lifted to outer MeetingRoom): confirmed, only one call site exists.
3. Deviation 3 (pre-existing test fixture needed a mock added after moveIn reordering): confirmed necessary consequence of design's explicit reordering instruction.
4. Deviation 4 (list's incl. principal ambiguity resolved per design's literal TS interfaces): confirmed matches design.md's literal interfaces exactly.

## Issues

### CRITICAL
None found. No spec requirement is unmet in code despite being checked off.

### WARNING

1. tsc --noEmit claim of zero new errors is not literally accurate for the backend package. Diff-hunk line mapping shows the new R1-C5 test (calls-webhook.service.spec.ts lines 367-387) introduces a new occurrence (line 369) of a pre-existing, systemic mock-typing error in db.transaction.mockImplementation, which already appears about 9 other times in the same file (confirmed pre-existing by mapping each error line back through the diff's insertion offsets). Same category of error, copy-pasted from existing test patterns, does not affect runtime results (535/549 still passes identically). The 4-pre-existing-error-files framing is accurate at file level but not at occurrence-count level.

2. Tasks 6.1/6.2 (live E2E against real LiveKit/EC2) remain unchecked and unexecuted. Explicitly and honestly documented, consistent with project precedent. These are the only evidence source for real end-to-end behavior under actual LiveKit timing; all other evidence is unit-level with mocked LiveKit clients. Recommend running 6.1/6.2 against the existing EC2 demo before merging to develop.

### SUGGESTION

1. Consider fixing the systemic db.transaction mock-typing issue in calls-webhook.service.spec.ts in a follow-up; it predates this change but now has 10 occurrences and will keep being copy-pasted into new tests.

## Final Verdict: PASS WITH WARNINGS

Every spec requirement and scenario checked against real source code (not narrative) is genuinely implemented and covered by passing tests that assert the behaviors described in design.md. No CRITICAL findings. The two WARNING items are a minor overstatement in the apply-progress type-check claim with zero functional impact, and the already-disclosed deferral of live-infra E2E tasks, which should be resolved before merge per project convention.

# Rollback scripts

Files in this directory are **never** run by `drizzle-kit migrate`. This project's
`drizzle-kit` setup has no down-runner — forward migrations under `drizzle/` are the
only thing `pnpm db:migrate` applies. Each `*.down.sql` file here is a manually
executed, hand-written reversal of the matching forward migration, kept next to the
forward file it undoes for discoverability, not because drizzle-kit knows about it.

Before running one:

1. Read the file. Each one documents, inline, what it checks and why.
2. Run it with a direct `psql` connection (or an equivalent single-transaction client).
   Every rollback here wraps its statements in one `BEGIN`/`COMMIT`, with any
   self-gating safety checks running before the first destructive statement, so a
   failed gate leaves the schema untouched.
3. Re-run the forward migration only after confirming the rollback actually applied.

## 0016_permanent_scheduled_rooms.down.sql

Reverses `drizzle/0016_permanent_scheduled_rooms.sql`. Two gates run before any
destructive statement, inside the same transaction as the destructive work:

- **Gate 1** aborts if any `rooms.code` is duplicated — restoring the global
  `UNIQUE(code)` constraint would otherwise fail outright.
- **Gate 2** aborts if any `room_admission_requests.expires_at IS NULL` row exists —
  restoring `NOT NULL` on that column would otherwise fail.

Both gates raise an exception with the recommended recovery path in the message
rather than printing a warning a human could miss.

## Deploy sequencing

This deploy rejects any participant or admission token issued before it (none of
them carry the new `roomId` claim) — every active session is logged out. This is
recoverable: the client already treats a `401` as "request access again"
(`client/src/lib/api.ts:385`, `useAdmissionRequest`'s reset path), so an affected
user is two clicks from being back in the room. Recommend deploying at low traffic.

This is a deliberate one-time cost of closing the room-code-recycling vulnerability
(see `openspec/changes/permanent-scheduled-rooms/design.md`, decision D4) — it is
not a bug to "fix" later with a dual-path `RoomParticipant` verification that accepts
both old and new token shapes. A dual path is exactly the kind of security check that
outlives its intended deadline.

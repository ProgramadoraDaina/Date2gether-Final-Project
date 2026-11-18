BEGIN;

DROP INDEX IF EXISTS "rooms_retirement_sweep_idx";
DROP INDEX IF EXISTS "rooms_code_code_pool_unique";

-- Gate 1: the global UNIQUE("code") cannot be restored if any code is duplicated.
DO $$
DECLARE duplicated int;
BEGIN
  SELECT count(*) INTO duplicated
    FROM (SELECT code FROM rooms GROUP BY code HAVING count(*) > 1) d;
  IF duplicated > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: % room code(s) are duplicated. Restoring the global unique constraint '
      'would fail. Preferred response: roll back APPLICATION CODE ONLY and leave this schema in '
      'place (the old code never wrote duplicate codes, so it is compatible). If the schema '
      'rollback is truly required, first rename the duplicated code on the RETIRED rows '
      '(retired_at IS NOT NULL) — never delete rows, they are history — then re-run this file.',
      duplicated;
  END IF;
END $$;

-- Gate 2: expires_at cannot become NOT NULL again while TTL-free requests exist.
DO $$
DECLARE ttl_free int;
BEGIN
  SELECT count(*) INTO ttl_free FROM room_admission_requests WHERE expires_at IS NULL;
  IF ttl_free > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: % admission request(s) have no TTL (expires_at IS NULL). Decide '
      'explicitly whether to backfill them (expires_at = created_at + interval ''24 hours'') '
      'or to leave this column nullable, then re-run.', ttl_free;
  END IF;
END $$;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_code_unique" UNIQUE("code");
ALTER TABLE "room_admission_requests" ALTER COLUMN "expires_at" SET NOT NULL;

DROP TABLE "room_schedule_slots";

ALTER TABLE "rooms" DROP COLUMN "retired_at";
ALTER TABLE "rooms" DROP COLUMN "last_entered_at";
ALTER TABLE "rooms" DROP COLUMN "is_permanent";

COMMIT;

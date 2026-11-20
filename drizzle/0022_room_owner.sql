ALTER TABLE "room_members" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Al crear una sala, ambas filas se insertaban en la misma transacción.
-- PostgreSQL usa el mismo now() para created_at y joined_at en esa transacción.
WITH creation_members AS (
	SELECT member."room_id", member."user_id",
		count(*) OVER (PARTITION BY member."room_id") AS matches
	FROM "room_members" AS member
	INNER JOIN "rooms" AS room ON room."id" = member."room_id"
	WHERE member."joined_at" = room."created_at"
)
UPDATE "room_members" AS member
SET "is_owner" = true, "role" = 'administrador'
FROM creation_members
WHERE creation_members.matches = 1
	AND member."room_id" = creation_members."room_id"
	AND member."user_id" = creation_members."user_id";--> statement-breakpoint
CREATE UNIQUE INDEX "room_members_one_owner_per_room" ON "room_members" USING btree ("room_id") WHERE "room_members"."is_owner";--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_owner_is_admin" CHECK (not "room_members"."is_owner" or "room_members"."role" = 'administrador');

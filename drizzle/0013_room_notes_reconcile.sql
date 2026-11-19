CREATE TABLE IF NOT EXISTS "room_notes" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'room_notes_room_id_rooms_id_fk'
		  AND conrelid = 'room_notes'::regclass
	) THEN
		ALTER TABLE "room_notes"
		ADD CONSTRAINT "room_notes_room_id_rooms_id_fk"
		FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id")
		ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;

CREATE TABLE "room_notes" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_notes" ADD CONSTRAINT "room_notes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
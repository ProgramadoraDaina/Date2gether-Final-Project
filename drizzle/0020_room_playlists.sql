CREATE TABLE "room_playlists" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"tracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_playlists_current_index_valid" CHECK ("room_playlists"."current_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "room_playlists" ADD CONSTRAINT "room_playlists_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
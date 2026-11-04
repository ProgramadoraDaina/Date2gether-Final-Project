CREATE TABLE "room_notes" (
	"room_id" uuid PRIMARY KEY NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

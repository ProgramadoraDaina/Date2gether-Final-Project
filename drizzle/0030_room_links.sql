CREATE TABLE "room_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"url" varchar(2048) NOT NULL,
	"title" varchar(120),
	"added_by_name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_links_room_url_unique" UNIQUE("room_id","url")
);
--> statement-breakpoint
ALTER TABLE "room_links" ADD CONSTRAINT "room_links_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
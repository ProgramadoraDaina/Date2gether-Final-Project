CREATE TABLE "room_emojis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"image" "bytea" NOT NULL,
	"image_mime" varchar(32) NOT NULL,
	"sound" "bytea",
	"sound_mime" varchar(32),
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_emojis_room_id_name_unique" UNIQUE("room_id","name")
);
--> statement-breakpoint
ALTER TABLE "room_emojis" ADD CONSTRAINT "room_emojis_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD CONSTRAINT "room_emojis_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
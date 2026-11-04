CREATE TYPE "public"."name_color" AS ENUM('purple', 'red', 'teal', 'amber', 'navy', 'orange', 'green', 'pink');--> statement-breakpoint
CREATE TABLE "call_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_color" "name_color";--> statement-breakpoint
ALTER TABLE "call_history" ADD CONSTRAINT "call_history_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_history" ADD CONSTRAINT "call_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
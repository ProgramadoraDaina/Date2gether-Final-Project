CREATE TYPE "public"."admission_status" AS ENUM('pending', 'admitted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "room_admission_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(60) NOT NULL,
	"status" "admission_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "waiting_room_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "entry_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_admission_requests" ADD CONSTRAINT "room_admission_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_admission_requests" ADD CONSTRAINT "room_admission_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_admission_room_status_idx" ON "room_admission_requests" USING btree ("room_id","status");
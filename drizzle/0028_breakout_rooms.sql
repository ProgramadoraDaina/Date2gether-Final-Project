CREATE TABLE "call_breakout_occupants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"breakout_room_id" uuid NOT NULL,
	"source_identity" varchar(64) NOT NULL,
	"livekit_identity" varchar(64) NOT NULL,
	"user_id" uuid,
	"display_name" varchar(60) NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"returned_at" timestamp,
	CONSTRAINT "call_breakout_occupants_livekit_identity_unique" UNIQUE("livekit_identity")
);
--> statement-breakpoint
CREATE TABLE "call_breakout_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"livekit_room_name" varchar(40) NOT NULL,
	"parent_livekit_room_sid" varchar(64),
	"label" varchar(60) NOT NULL,
	"leave_policy" varchar(16) DEFAULT 'locked' NOT NULL,
	"auto_close_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "call_breakout_rooms_livekit_room_name_unique" UNIQUE("livekit_room_name")
);
--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "call_group_id" varchar(64);--> statement-breakpoint
ALTER TABLE "call_breakout_occupants" ADD CONSTRAINT "call_breakout_occupants_breakout_room_id_call_breakout_rooms_id_fk" FOREIGN KEY ("breakout_room_id") REFERENCES "public"."call_breakout_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_breakout_occupants" ADD CONSTRAINT "call_breakout_occupants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_breakout_rooms" ADD CONSTRAINT "call_breakout_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_breakout_occupants_breakout_room_id_open_idx" ON "call_breakout_occupants" USING btree ("breakout_room_id") WHERE "call_breakout_occupants"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "call_breakout_occupants_source_identity_open_idx" ON "call_breakout_occupants" USING btree ("source_identity") WHERE "call_breakout_occupants"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "call_breakout_rooms_room_id_closed_at_idx" ON "call_breakout_rooms" USING btree ("room_id","closed_at");
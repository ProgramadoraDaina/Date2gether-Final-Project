CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"livekit_room_sid" varchar(64) NOT NULL,
	"room_code" varchar(20) NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"livekit_identity" varchar(64),
	"track_source" varchar(24),
	"occurred_at" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_participant_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livekit_identity" varchar(64) NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" varchar(60) NOT NULL,
	"role_at_issue" "room_role",
	"issued_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "call_participant_identities_livekit_identity_unique" UNIQUE("livekit_identity")
);
--> statement-breakpoint
CREATE TABLE "call_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_key" varchar(80) NOT NULL,
	"user_id" uuid,
	"display_name" varchar(60) NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"first_joined_at" timestamp NOT NULL,
	"last_left_at" timestamp,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"spoke" boolean DEFAULT false NOT NULL,
	"screen_shared" boolean DEFAULT false NOT NULL,
	"rejoin_count" smallint DEFAULT 0 NOT NULL,
	"name_color" "name_color",
	CONSTRAINT "call_session_participants_session_id_participant_key_unique" UNIQUE("session_id","participant_key")
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livekit_room_sid" varchar(64) NOT NULL,
	"room_id" uuid,
	"room_code" varchar(20) NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"close_reason" varchar(32),
	"forced_close_at" timestamp,
	"materialized_at" timestamp,
	CONSTRAINT "call_sessions_livekit_room_sid_unique" UNIQUE("livekit_room_sid")
);
--> statement-breakpoint
ALTER TABLE "call_participant_identities" ADD CONSTRAINT "call_participant_identities_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participant_identities" ADD CONSTRAINT "call_participant_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_session_participants" ADD CONSTRAINT "call_session_participants_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_session_participants" ADD CONSTRAINT "call_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_events_room_sid_occurred_at_idx" ON "call_events" USING btree ("livekit_room_sid","occurred_at");--> statement-breakpoint
CREATE INDEX "call_events_livekit_identity_idx" ON "call_events" USING btree ("livekit_identity");--> statement-breakpoint
CREATE INDEX "call_participant_identities_room_id_user_id_idx" ON "call_participant_identities" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "call_session_participants_session_id_idx" ON "call_session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "call_sessions_room_id_started_at_idx" ON "call_sessions" USING btree ("room_id","started_at" DESC NULLS LAST);
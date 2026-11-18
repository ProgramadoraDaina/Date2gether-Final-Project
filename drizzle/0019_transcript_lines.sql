CREATE TABLE "transcript_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"call_sid" varchar(64) NOT NULL,
	"speaker_name" varchar(60) NOT NULL,
	"content" text NOT NULL,
	"spoken_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_lines" ADD CONSTRAINT "transcript_lines_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_lines_room_call_idx" ON "transcript_lines" USING btree ("room_id","call_sid");
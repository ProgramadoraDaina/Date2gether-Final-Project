ALTER TABLE "rooms" ADD COLUMN "is_permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "last_entered_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint

CREATE TABLE "room_schedule_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_schedule_slots_day_of_week_valid" CHECK ("day_of_week" between 0 and 6),
	CONSTRAINT "room_schedule_slots_time_of_day_valid" CHECK ("time_of_day" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "room_schedule_slots" ADD CONSTRAINT "room_schedule_slots_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_schedule_slots" ADD CONSTRAINT "room_schedule_slots_room_day_time_tz_unique" UNIQUE("room_id","day_of_week","time_of_day","timezone");--> statement-breakpoint
CREATE INDEX "room_schedule_slots_room_id_idx" ON "room_schedule_slots" USING btree ("room_id");--> statement-breakpoint

ALTER TABLE "room_admission_requests" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "rooms" DROP CONSTRAINT "rooms_code_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_code_code_pool_unique" ON "rooms" USING btree ("code") WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "rooms_retirement_sweep_idx" ON "rooms" USING btree ("last_entered_at")
  WHERE "retired_at" IS NULL AND "is_permanent" = false;

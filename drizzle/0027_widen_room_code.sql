ALTER TABLE "call_events" ALTER COLUMN "room_code" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "call_sessions" ALTER COLUMN "room_code" SET DATA TYPE varchar(40);
ALTER TABLE "room_emojis" ALTER COLUMN "image" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ALTER COLUMN "image_mime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "emoji" varchar(32);--> statement-breakpoint
ALTER TABLE "room_emojis" ADD CONSTRAINT "room_emojis_image_xor_emoji" CHECK (("room_emojis"."image" is not null) <> ("room_emojis"."emoji" is not null));
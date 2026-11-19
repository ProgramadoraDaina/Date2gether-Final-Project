CREATE TYPE "public"."call_mode" AS ENUM('reaction', 'sticker');--> statement-breakpoint
CREATE TYPE "public"."sticker_animation" AS ENUM('static', 'float', 'spin', 'pulse', 'shake');--> statement-breakpoint
CREATE TYPE "public"."sticker_position" AS ENUM('top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right');--> statement-breakpoint
CREATE TYPE "public"."sticker_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "call_mode" "call_mode" DEFAULT 'reaction' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "sticker_duration" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "sticker_position" "sticker_position" DEFAULT 'top-right' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "sticker_size" "sticker_size" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD COLUMN "sticker_animation" "sticker_animation" DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_emojis" ADD CONSTRAINT "room_emojis_sticker_duration_valid" CHECK ("room_emojis"."sticker_duration" in (5, 10, 30));
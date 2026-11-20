ALTER TABLE "users" ADD COLUMN "call_history_deleted_before" timestamp;--> statement-breakpoint
CREATE INDEX "call_history_user_started_id_idx" ON "call_history" USING btree ("user_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_history_user_room_started_id_idx" ON "call_history" USING btree ("user_id","room_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_session_participants_user_joined_idx" ON "call_session_participants" USING btree ("user_id","first_joined_at" DESC NULLS LAST,"session_id");
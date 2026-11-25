ALTER TABLE "call_sessions" ADD COLUMN "history_purged_at" timestamp;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "history_deleted_before" timestamp;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "history_cleanup_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "call_sessions_room_ended_history_idx" ON "call_sessions" USING btree ("room_id","ended_at","id") WHERE "call_sessions"."ended_at" is not null and "call_sessions"."history_purged_at" is null;--> statement-breakpoint
CREATE INDEX "messages_room_created_id_idx" ON "messages" USING btree ("room_id","created_at","id");--> statement-breakpoint
CREATE INDEX "rooms_history_cleanup_pending_idx" ON "rooms" USING btree ("id") WHERE "rooms"."history_cleanup_pending";--> statement-breakpoint

-- Serialize late writes with the cleanup of a finished call. The session header
-- remains after its payload is removed so an old webhook cannot recreate it.
CREATE FUNCTION prevent_deleted_call_history_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  call_sid varchar;
  deleted boolean;
BEGIN
  IF TG_TABLE_NAME = 'call_events' THEN
    call_sid := NEW.livekit_room_sid;
  ELSE
    call_sid := NEW.call_sid;
  END IF;

  SELECT s.history_purged_at IS NOT NULL OR s.ended_at < r.history_deleted_before INTO deleted
    FROM call_sessions s LEFT JOIN rooms r ON s.room_id = r.id
    WHERE s.livekit_room_sid = call_sid
    FOR SHARE OF s;

  IF deleted THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER prevent_deleted_call_events BEFORE INSERT ON call_events
  FOR EACH ROW EXECUTE FUNCTION prevent_deleted_call_history_write();--> statement-breakpoint
CREATE TRIGGER prevent_deleted_transcript_lines BEFORE INSERT ON transcript_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_deleted_call_history_write();--> statement-breakpoint

-- A delayed finish can put a session behind a cutoff that was already cleaned.
CREATE FUNCTION queue_late_ended_call_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE rooms SET history_cleanup_pending = true
    WHERE id = NEW.room_id AND history_deleted_before > NEW.ended_at;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER queue_late_ended_call_cleanup AFTER UPDATE OF ended_at ON call_sessions
  FOR EACH ROW WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND NEW.room_id IS NOT NULL)
  EXECUTE FUNCTION queue_late_ended_call_cleanup();

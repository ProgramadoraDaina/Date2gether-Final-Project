import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callEvents,
  callSessionParticipants,
  callSessions,
  messages,
  roomMembers,
  rooms,
  transcriptLines,
} from '../../db/schema';
import { callHistoryCutoff } from '../calls/call-history-retention';

const BATCH_SIZE = 500;

@Injectable()
export class RoomArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomArchiveService.name);
  private timer?: NodeJS.Timeout;
  private working = false;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanBatch(), 2000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async clear(roomId: string, userId: string) {
    const cutoff = callHistoryCutoff();
    const admin = this.db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, rooms.id),
          eq(roomMembers.userId, userId),
          eq(roomMembers.role, 'administrador'),
        ),
      );
    const [room] = await this.db
      .update(rooms)
      .set({
        historyDeletedBefore: sql`greatest(${rooms.historyDeletedBefore}, ${cutoff.toISOString()}::timestamp)`,
        historyCleanupPending: true,
      })
      .where(and(eq(rooms.id, roomId), eq(rooms.isPermanent, true), sql`exists (${admin})`))
      .returning({ id: rooms.id });
    if (!room)
      throw new ForbiddenException('Solo un administrador puede borrar el archivo de esta sala');
  }

  private async cleanBatch() {
    if (this.working) return;
    this.working = true;
    try {
      await this.db.transaction(async (tx) => {
        const [room] = await tx
          .select({ id: rooms.id, cutoff: rooms.historyDeletedBefore })
          .from(rooms)
          .where(and(eq(rooms.historyCleanupPending, true), isNotNull(rooms.historyDeletedBefore)))
          .orderBy(asc(rooms.id))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!room?.cutoff) return;

        const chat = await tx
          .delete(messages)
          .where(
            inArray(
              messages.id,
              tx
                .select({ id: messages.id })
                .from(messages)
                .where(and(eq(messages.roomId, room.id), lt(messages.createdAt, room.cutoff)))
                .orderBy(asc(messages.createdAt), asc(messages.id))
                .limit(BATCH_SIZE),
            ),
          )
          .returning({ id: messages.id });
        const [session] = await tx
          .select({ id: callSessions.id, sid: callSessions.livekitRoomSid })
          .from(callSessions)
          .where(
            and(
              eq(callSessions.roomId, room.id),
              lt(callSessions.endedAt, room.cutoff),
              isNull(callSessions.historyPurgedAt),
            ),
          )
          .orderBy(asc(callSessions.endedAt), asc(callSessions.id))
          .limit(1)
          .for('update');

        if (session) {
          // Keep the session header as a tombstone so late webhooks cannot recreate its payload.
          const transcripts = await tx
            .delete(transcriptLines)
            .where(
              inArray(
                transcriptLines.id,
                tx
                  .select({ id: transcriptLines.id })
                  .from(transcriptLines)
                  .where(
                    and(
                      eq(transcriptLines.roomId, room.id),
                      eq(transcriptLines.callSid, session.sid),
                    ),
                  )
                  .limit(BATCH_SIZE),
              ),
            )
            .returning({ id: transcriptLines.id });
          const participants = await tx
            .delete(callSessionParticipants)
            .where(
              inArray(
                callSessionParticipants.id,
                tx
                  .select({ id: callSessionParticipants.id })
                  .from(callSessionParticipants)
                  .where(eq(callSessionParticipants.sessionId, session.id))
                  .limit(BATCH_SIZE),
              ),
            )
            .returning({ id: callSessionParticipants.id });
          const events = await tx
            .delete(callEvents)
            .where(
              inArray(
                callEvents.id,
                tx
                  .select({ id: callEvents.id })
                  .from(callEvents)
                  .where(eq(callEvents.livekitRoomSid, session.sid))
                  .limit(BATCH_SIZE),
              ),
            )
            .returning({ id: callEvents.id });
          if ([transcripts, participants, events].every((rows) => rows.length < BATCH_SIZE)) {
            await tx
              .update(callSessions)
              .set({ historyPurgedAt: new Date() })
              .where(eq(callSessions.id, session.id));
          }
          return;
        }
        if (chat.length < BATCH_SIZE) {
          await tx.update(rooms).set({ historyCleanupPending: false }).where(eq(rooms.id, room.id));
        }
      });
    } catch (error) {
      this.logger.error('No se pudo completar un lote del borrado de historial de sala', error);
    } finally {
      this.working = false;
    }
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callSessionParticipants, callSessions, users } from '../../db/schema';
import { isSessionVisibleToParticipant } from '../calls/call-history-retention';
import { TranscriptsService, type TranscriptEntry } from './transcripts.service';

@Injectable()
export class TranscriptHistoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly transcripts: TranscriptsService,
  ) {}

  async getForSession(sessionId: string, userId: string): Promise<TranscriptEntry[]> {
    const session = await this.findParticipated(eq(callSessions.id, sessionId), userId);
    // Borrar la sala borra sus frases en cascada; la sesión del historial queda con roomId null.
    if (!session.roomId) return [];
    return this.transcripts.getCall(session.roomId, session.livekitRoomSid);
  }

  async resolveBySid(livekitRoomSid: string, userId: string): Promise<{ id: string }> {
    const session = await this.findParticipated(
      eq(callSessions.livekitRoomSid, livekitRoomSid),
      userId,
    );
    return { id: session.id };
  }

  // Misma regla que la línea de tiempo: 404 tanto si no existe como si no participó.
  private async findParticipated(match: SQL, userId: string) {
    const [session] = await this.db
      .select({
        id: callSessions.id,
        roomId: callSessions.roomId,
        livekitRoomSid: callSessions.livekitRoomSid,
      })
      .from(callSessions)
      .innerJoin(callSessionParticipants, eq(callSessionParticipants.sessionId, callSessions.id))
      .innerJoin(users, eq(callSessionParticipants.userId, users.id))
      .where(and(match, eq(callSessionParticipants.userId, userId), isSessionVisibleToParticipant))
      .limit(1);
    if (!session) throw new NotFoundException('Sesión no encontrada');
    return session;
  }
}

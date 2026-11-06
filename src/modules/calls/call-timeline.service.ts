import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callSessionParticipants,
  callSessions,
  rooms,
  type CallSessionParticipant,
} from '../../db/schema';

export interface CallSessionSummary {
  id: string;
  roomCode: string;
  roomName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  participantCount: number;
}

export type CallSessionParticipantSummary = Omit<CallSessionParticipant, 'id' | 'sessionId'>;

export interface CallSessionTimeline {
  id: string;
  roomCode: string;
  roomName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  participants: CallSessionParticipantSummary[];
}

const PARTICIPANT_SUMMARY_COLUMNS = {
  participantKey: callSessionParticipants.participantKey,
  userId: callSessionParticipants.userId,
  displayName: callSessionParticipants.displayName,
  isGuest: callSessionParticipants.isGuest,
  firstJoinedAt: callSessionParticipants.firstJoinedAt,
  lastLeftAt: callSessionParticipants.lastLeftAt,
  totalSeconds: callSessionParticipants.totalSeconds,
  spoke: callSessionParticipants.spoke,
  screenShared: callSessionParticipants.screenShared,
  rejoinCount: callSessionParticipants.rejoinCount,
  nameColor: callSessionParticipants.nameColor,
};

const SESSION_HEADER_COLUMNS = {
  id: callSessions.id,
  roomCode: callSessions.roomCode,
  roomName: rooms.name,
  startedAt: callSessions.startedAt,
  endedAt: callSessions.endedAt,
};

/**
 * Lectura de lo ya materializado por `CallsWebhookService.onRoomFinished()`
 * (PR4): dos endpoints de solo lectura, sin tocar `callHistory` ni la
 * escritura de `call_sessions` / `call_session_participants` (ver
 * design.md "Lectura y autorización").
 *
 * No re-exporta `aggregateSession()`: ese import directo desde
 * `aggregate-session.ts` en `calls-webhook.service.ts` no cambia en este PR.
 */
@Injectable()
export class CallTimelineService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listSessions(userId: string): Promise<CallSessionSummary[]> {
    const participated = await this.db
      .select({ sessionId: callSessionParticipants.sessionId })
      .from(callSessionParticipants)
      .where(eq(callSessionParticipants.userId, userId));

    const sessionIds = [...new Set(participated.map((row) => row.sessionId))];
    if (sessionIds.length === 0) return [];

    const sessions = await this.db
      .select(SESSION_HEADER_COLUMNS)
      .from(callSessions)
      // leftJoin (no innerJoin): si la sala fue borrada, roomId queda null
      // (ON DELETE SET NULL) pero la sesión materializada debe seguir
      // listándose, solo con roomName en null.
      .leftJoin(rooms, eq(callSessions.roomId, rooms.id))
      .where(inArray(callSessions.id, sessionIds))
      .orderBy(desc(callSessions.startedAt));

    // Conteo en memoria en vez de GROUP BY: evita acoplar este PR a un
    // helper de agregación SQL nuevo para un cálculo que ya es trivial sobre
    // un puñado de filas (una sesión de llamada tiene, como mucho, unas
    // pocas decenas de participantes).
    const allParticipants = await this.db
      .select({ sessionId: callSessionParticipants.sessionId })
      .from(callSessionParticipants)
      .where(inArray(callSessionParticipants.sessionId, sessionIds));

    const countBySession = new Map<string, number>();
    for (const row of allParticipants) {
      countBySession.set(row.sessionId, (countBySession.get(row.sessionId) ?? 0) + 1);
    }

    return sessions.map((session) => ({
      ...session,
      participantCount: countBySession.get(session.id) ?? 0,
    }));
  }

  async getSessionTimeline(sessionId: string, userId: string): Promise<CallSessionTimeline> {
    const participants = await this.db
      .select(PARTICIPANT_SUMMARY_COLUMNS)
      .from(callSessionParticipants)
      .where(eq(callSessionParticipants.sessionId, sessionId));

    // La misma rama de 404 cubre "la sesión no existe" y "el solicitante no
    // participó": no hay forma de distinguirlas desde afuera, a propósito
    // (design.md: "404 y no 403, para no filtrar si la sesión existe").
    const participated = participants.some((participant) => participant.userId === userId);
    if (!participated) {
      throw new NotFoundException('Sesión no encontrada');
    }

    const [session] = await this.db
      .select(SESSION_HEADER_COLUMNS)
      .from(callSessions)
      .leftJoin(rooms, eq(callSessions.roomId, rooms.id))
      .where(eq(callSessions.id, sessionId))
      .limit(1);

    return { ...session, participants };
  }
}

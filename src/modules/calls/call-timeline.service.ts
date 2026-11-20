import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callSessionParticipants,
  callSessions,
  rooms,
  users,
  type CallSessionParticipant,
} from '../../db/schema';
import {
  CALL_HISTORY_PAGE_SIZE,
  callHistoryCutoff,
  isSessionVisibleToParticipant,
} from './call-history-retention';
import { isRoomSessionVisible } from '../rooms/room-history-policy';
import type { CallHistoryPage } from './calls.service';

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
  trackIntervals: callSessionParticipants.trackIntervals,
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
    return (
      this.db
        .select({
          ...SESSION_HEADER_COLUMNS,
          participantCount: this.db.$count(
            callSessionParticipants,
            eq(callSessionParticipants.sessionId, callSessions.id),
          ),
        })
        .from(callSessionParticipants)
        .innerJoin(callSessions, eq(callSessionParticipants.sessionId, callSessions.id))
        .innerJoin(users, eq(callSessionParticipants.userId, users.id))
        // leftJoin (no innerJoin): si la sala fue borrada, roomId queda null
        // (ON DELETE SET NULL) pero la sesión materializada debe seguir
        // listándose, solo con roomName en null.
        .leftJoin(rooms, eq(callSessions.roomId, rooms.id))
        .where(
          and(
            eq(callSessionParticipants.userId, userId),
            gte(callSessionParticipants.firstJoinedAt, callHistoryCutoff()),
            isSessionVisibleToParticipant,
            isRoomSessionVisible,
          ),
        )
        .orderBy(
          sql`${callSessionParticipants.firstJoinedAt} desc nulls last`,
          asc(callSessionParticipants.sessionId),
        )
        .limit(CALL_HISTORY_PAGE_SIZE)
    );
  }

  async getSessionTimeline(sessionId: string, userId: string): Promise<CallSessionTimeline> {
    const [session] = await this.db
      .select(SESSION_HEADER_COLUMNS)
      .from(callSessions)
      .leftJoin(rooms, eq(callSessions.roomId, rooms.id))
      .innerJoin(callSessionParticipants, eq(callSessionParticipants.sessionId, callSessions.id))
      .innerJoin(users, eq(callSessionParticipants.userId, users.id))
      .where(
        and(
          eq(callSessions.id, sessionId),
          eq(callSessionParticipants.userId, userId),
          isSessionVisibleToParticipant,
          isRoomSessionVisible,
        ),
      )
      .limit(1);
    // Same response for a missing session and one the account cannot see.
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const participants = await this.db
      .select(PARTICIPANT_SUMMARY_COLUMNS)
      .from(callSessionParticipants)
      .where(eq(callSessionParticipants.sessionId, session.id));

    return { ...session, participants };
  }

  async listRoomArchive(roomId: string, userId: string, before?: string): Promise<CallHistoryPage> {
    const inRoom = eq(callSessions.roomId, roomId);
    const boundary = before
      ? this.db
          .select({ endedAt: callSessions.endedAt, id: callSessions.id })
          .from(callSessions)
          .innerJoin(
            callSessionParticipants,
            eq(callSessionParticipants.sessionId, callSessions.id),
          )
          .where(
            and(inRoom, eq(callSessions.id, before), eq(callSessionParticipants.userId, userId)),
          )
          .limit(1)
      : undefined;
    const rows = await this.db
      .select({
        id: callSessions.id,
        roomId: rooms.id,
        roomCode: callSessions.roomCode,
        roomName: rooms.name,
        startedAt: callSessions.startedAt,
        sessionId: callSessions.id,
      })
      .from(callSessions)
      .innerJoin(rooms, eq(callSessions.roomId, rooms.id))
      .innerJoin(callSessionParticipants, eq(callSessionParticipants.sessionId, callSessions.id))
      .innerJoin(users, eq(callSessionParticipants.userId, users.id))
      .where(
        and(
          inRoom,
          eq(rooms.isPermanent, true),
          eq(callSessionParticipants.userId, userId),
          lt(callSessions.endedAt, callHistoryCutoff()),
          isSessionVisibleToParticipant,
          isRoomSessionVisible,
          boundary && sql`(${callSessions.endedAt}, ${callSessions.id}) < (${boundary})`,
        ),
      )
      .orderBy(sql`${callSessions.endedAt} desc`, sql`${callSessions.id} desc`)
      .limit(CALL_HISTORY_PAGE_SIZE + 1);
    return {
      entries: rows.slice(0, CALL_HISTORY_PAGE_SIZE),
      nextCursor: rows.length > CALL_HISTORY_PAGE_SIZE ? rows[CALL_HISTORY_PAGE_SIZE - 1].id : null,
      hasArchived: false,
    };
  }
}

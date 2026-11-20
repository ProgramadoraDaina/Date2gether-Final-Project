import { and, gte, isNull, or } from 'drizzle-orm';
import { callSessions, rooms } from '../../db/schema';

export const isRoomSessionVisible = and(
  isNull(callSessions.historyPurgedAt),
  or(
    isNull(callSessions.endedAt),
    isNull(rooms.historyDeletedBefore),
    gte(callSessions.endedAt, rooms.historyDeletedBefore),
  ),
);

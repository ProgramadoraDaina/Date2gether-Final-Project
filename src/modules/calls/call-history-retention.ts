import { gte, isNull, or } from 'drizzle-orm';
import { callSessionParticipants, users } from '../../db/schema';

export const CALL_HISTORY_PAGE_SIZE = 50;
const RETENTION_DAYS = 90;

export function callHistoryCutoff(now = Date.now()): Date {
  return new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// Materialized sessions and transcripts are shared. Hide them only for the account
// that cleared its archive, including when it opens a previously saved link.
export const isSessionVisibleToParticipant = or(
  isNull(users.callHistoryDeletedBefore),
  gte(callSessionParticipants.firstJoinedAt, users.callHistoryDeletedBefore),
);

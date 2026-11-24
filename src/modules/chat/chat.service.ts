import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { messages, rooms, type Message } from '../../db/schema';
import { callHistoryCutoff } from '../calls/call-history-retention';
import type { ListChatMessagesDto } from './dto/list-chat-messages.dto';

const PAGE_SIZE = 50;

function getDayRange(from?: string, to?: string): [Date, Date] | undefined {
  if (!from && !to) return;
  const start = new Date(from ?? '');
  const end = new Date(to ?? '');
  const length = end.getTime() - start.getTime();
  // Accept short or long days across timezone changes, with an exclusive end.
  if (!(length > 0 && length <= 30 * 60 * 60 * 1000)) {
    throw new BadRequestException('El intervalo de búsqueda debe corresponder a un día');
  }
  return [start, end];
}

@Injectable()
export class ChatService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getHistory(
    roomId: string,
    permanent: boolean,
    query: ListChatMessagesDto = {},
  ): Promise<{ entries: Message[]; nextCursor: string | null }> {
    if (query.view === 'archive' && !permanent) return { entries: [], nextCursor: null };
    const day = getDayRange(query.from, query.to);
    const cutoff = callHistoryCutoff();
    const inRoom = eq(messages.roomId, roomId);
    const cursor = query.before
      ? this.db
          .select({ createdAt: messages.createdAt, id: messages.id })
          .from(messages)
          .where(and(inRoom, eq(messages.id, query.before)))
      : undefined;
    const rows = await this.db
      .select(getTableColumns(messages))
      .from(messages)
      .innerJoin(rooms, eq(messages.roomId, rooms.id))
      .where(
        and(
          inRoom,
          permanent
            ? query.view === 'archive'
              ? lt(messages.createdAt, cutoff)
              : gte(messages.createdAt, cutoff)
            : undefined,
          or(
            isNull(rooms.historyDeletedBefore),
            gte(messages.createdAt, rooms.historyDeletedBefore),
          ),
          day && gte(messages.createdAt, day[0]),
          day && lt(messages.createdAt, day[1]),
          cursor && sql`(${messages.createdAt}, ${messages.id}) < (${cursor})`,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(PAGE_SIZE + 1);
    return {
      entries: rows.slice(0, PAGE_SIZE).reverse(),
      nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null,
    };
  }

  async createMessage(
    roomId: string,
    authorName: string,
    content: string,
    kind: Message['kind'] = 'text',
  ): Promise<Message> {
    const [message] = await this.db
      .insert(messages)
      .values({ roomId, authorName, content, kind })
      .returning();
    return message;
  }
}

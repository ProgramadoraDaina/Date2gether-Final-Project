import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { messages, type Message } from '../../db/schema';

@Injectable()
export class ChatService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getHistory(roomId: string): Promise<Message[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(asc(messages.createdAt));
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

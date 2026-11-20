import { GoneException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, not, notExists } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callSessions, rooms, transcriptLines, type TranscriptLine } from '../../db/schema';
import { isRoomSessionVisible } from '../rooms/room-history-policy';

export const TRANSCRIPT_LIMIT = 2000;

export type TranscriptEntry = Pick<TranscriptLine, 'id' | 'speakerName' | 'content' | 'spokenAt'>;

@Injectable()
export class TranscriptsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async save(
    roomId: string,
    callSid: string,
    speakerName: string,
    content: string,
  ): Promise<TranscriptEntry> {
    const [line] = await this.db
      .insert(transcriptLines)
      .values({ roomId, callSid, speakerName, content })
      .returning();
    if (!line) throw new GoneException('La transcripción de esta llamada fue borrada');
    return toEntry(line);
  }

  async getCall(roomId: string, callSid: string): Promise<TranscriptEntry[]> {
    const deletedCall = this.db
      .select({ id: callSessions.id })
      .from(callSessions)
      .innerJoin(rooms, eq(rooms.id, callSessions.roomId))
      .where(
        and(
          eq(callSessions.roomId, roomId),
          eq(callSessions.livekitRoomSid, callSid),
          not(isRoomSessionVisible!),
        ),
      );
    const lines = await this.db
      .select()
      .from(transcriptLines)
      .where(
        and(
          eq(transcriptLines.roomId, roomId),
          eq(transcriptLines.callSid, callSid),
          notExists(deletedCall),
        ),
      )
      .orderBy(asc(transcriptLines.spokenAt))
      .limit(TRANSCRIPT_LIMIT);
    return lines.map(toEntry);
  }
}

function toEntry({ id, speakerName, content, spokenAt }: TranscriptLine): TranscriptEntry {
  return { id, speakerName, content, spokenAt };
}

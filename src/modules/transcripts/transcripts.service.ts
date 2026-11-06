import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { transcriptLines, type TranscriptLine } from '../../db/schema';
import { RoomsService } from '../rooms/rooms.service';

export const TRANSCRIPT_LIMIT = 2000;

export type TranscriptEntry = Pick<TranscriptLine, 'id' | 'speakerName' | 'content' | 'spokenAt'>;

@Injectable()
export class TranscriptsService {
  constructor(
    private readonly roomsService: RoomsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async save(
    roomCode: string,
    callSid: string,
    speakerName: string,
    content: string,
  ): Promise<TranscriptEntry> {
    const room = await this.roomsService.getByCodeOrThrow(roomCode);
    const [line] = await this.db
      .insert(transcriptLines)
      .values({ roomId: room.id, callSid, speakerName, content })
      .returning();
    return toEntry(line);
  }

  async getCall(roomCode: string, callSid: string): Promise<TranscriptEntry[]> {
    const room = await this.roomsService.getByCodeOrThrow(roomCode);
    const lines = await this.db
      .select()
      .from(transcriptLines)
      .where(and(eq(transcriptLines.roomId, room.id), eq(transcriptLines.callSid, callSid)))
      .orderBy(asc(transcriptLines.spokenAt))
      .limit(TRANSCRIPT_LIMIT);
    return lines.map(toEntry);
  }
}

function toEntry({ id, speakerName, content, spokenAt }: TranscriptLine): TranscriptEntry {
  return { id, speakerName, content, spokenAt };
}

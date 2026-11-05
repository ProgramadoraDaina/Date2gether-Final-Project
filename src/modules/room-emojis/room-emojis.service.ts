import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { roomEmojis } from '../../db/schema';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomsService } from '../rooms/rooms.service';
import { processEmojiImage, validateEmojiSound, type ProcessedMedia } from './emoji-media';
import { FreesoundService } from './freesound.service';

export const MAX_EMOJIS_PER_ROOM = 50;

const UNIQUE_VIOLATION = '23505';

// Drizzle envuelve el error de Postgres: el código queda en `cause`.
export function isUniqueViolation(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === UNIQUE_VIOLATION || cause?.code === UNIQUE_VIOLATION;
}

export interface RoomEmojiSummary {
  id: string;
  name: string;
  emoji: string | null;
  hasSound: boolean;
  soundAttribution: string | null;
}

// Exactamente uno entre `image` (archivo subido) y `emoji` (Unicode elegido del picker).
interface NewEmojiContent {
  image?: Buffer;
  emoji?: string;
  // Como mucho uno entre un archivo de sonido propio y un sonido de Freesound.
  sound?: Buffer;
  freesoundId?: number;
}

@Injectable()
export class RoomEmojisService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomsService: RoomsService,
    private readonly roomEvents: RoomEventsService,
    private readonly freesound: FreesoundService,
  ) {}

  async list(code: string): Promise<RoomEmojiSummary[]> {
    const room = await this.roomsService.getByCodeOrThrow(code);
    // Select explícito: el listado nunca devuelve los archivos.
    return this.db
      .select({
        id: roomEmojis.id,
        name: roomEmojis.name,
        emoji: roomEmojis.emoji,
        hasSound: sql<boolean>`${roomEmojis.sound} is not null`,
        soundAttribution: roomEmojis.soundAttribution,
      })
      .from(roomEmojis)
      .where(eq(roomEmojis.roomId, room.id))
      .orderBy(asc(roomEmojis.createdAt));
  }

  async create(
    code: string,
    userId: string,
    name: string,
    content: NewEmojiContent,
  ): Promise<RoomEmojiSummary> {
    if (Boolean(content.image) === Boolean(content.emoji)) {
      throw new BadRequestException('Subí una imagen o elegí un emoji (solo uno de los dos)');
    }
    if (content.sound && content.freesoundId) {
      throw new BadRequestException(
        'Subí un sonido o elegí uno de Freesound (solo uno de los dos)',
      );
    }
    const room = await this.roomsService.getByCodeOrThrow(code);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(roomEmojis)
      .where(eq(roomEmojis.roomId, room.id));
    if (total >= MAX_EMOJIS_PER_ROOM) {
      throw new BadRequestException(`La sala ya tiene ${MAX_EMOJIS_PER_ROOM} emojis`);
    }

    const image = content.image ? await processEmojiImage(content.image) : undefined;
    const freesound = content.freesoundId
      ? await this.freesound.downloadForEmoji(content.freesoundId)
      : undefined;
    const soundBytes = content.sound ?? freesound?.data;
    const sound: ProcessedMedia | undefined = soundBytes
      ? await validateEmojiSound(soundBytes)
      : undefined;

    try {
      const [created] = await this.db
        .insert(roomEmojis)
        .values({
          roomId: room.id,
          name,
          image: image?.data ?? null,
          imageMime: image?.mime ?? null,
          emoji: content.emoji ?? null,
          sound: sound?.data ?? null,
          soundMime: sound?.mime ?? null,
          soundAttribution: freesound?.attribution ?? null,
          createdBy: userId,
        })
        .returning({ id: roomEmojis.id, name: roomEmojis.name, emoji: roomEmojis.emoji });
      this.roomEvents.emitRoomEmojisChanged({ roomCode: code });
      return {
        ...created,
        hasSound: Boolean(sound),
        soundAttribution: freesound?.attribution ?? null,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un emoji con ese nombre en la sala');
      }
      throw error;
    }
  }

  async getImage(code: string, id: string): Promise<ProcessedMedia> {
    return this.findFile(code, id, 'image');
  }

  async getSound(code: string, id: string): Promise<ProcessedMedia> {
    return this.findFile(code, id, 'sound');
  }

  async remove(code: string, id: string): Promise<void> {
    const room = await this.roomsService.getByCodeOrThrow(code);
    const deleted = await this.db
      .delete(roomEmojis)
      .where(and(eq(roomEmojis.id, id), eq(roomEmojis.roomId, room.id)))
      .returning({ id: roomEmojis.id });
    if (deleted.length === 0) throw new NotFoundException('El emoji no existe');
    this.roomEvents.emitRoomEmojisChanged({ roomCode: code });
  }

  private async findFile(code: string, id: string, kind: 'image' | 'sound') {
    const room = await this.roomsService.getByCodeOrThrow(code);
    const [row] = await this.db
      .select(
        kind === 'image'
          ? { data: roomEmojis.image, mime: roomEmojis.imageMime }
          : { data: roomEmojis.sound, mime: roomEmojis.soundMime },
      )
      .from(roomEmojis)
      .where(and(eq(roomEmojis.id, id), eq(roomEmojis.roomId, room.id)))
      .limit(1);
    if (!row?.data || !row.mime) throw new NotFoundException('El emoji no existe');
    return { data: row.data, mime: row.mime };
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  CALL_MODES,
  roomEmojis,
  STICKER_ANIMATIONS,
  STICKER_DURATIONS,
  STICKER_POSITIONS,
  STICKER_SIZES,
} from '../../db/schema';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomsService } from '../rooms/rooms.service';
import { processEmojiImage, validateEmojiSound, type ProcessedMedia } from './emoji-media';
import { FreesoundService } from './freesound.service';

export const MAX_EMOJIS_PER_ROOM = 50;

const UNIQUE_VIOLATION = '23505';

// Drizzle envuelve el error de Postgres: el código queda en `cause`.
interface SummaryRow extends Omit<RoomEmojiSummary, 'sticker'> {
  stickerDuration: number;
  stickerPosition: StickerOptions['position'];
  stickerSize: StickerOptions['size'];
  stickerAnimation: StickerOptions['animation'];
}

function toSummary(row: SummaryRow): RoomEmojiSummary {
  const { stickerDuration, stickerPosition, stickerSize, stickerAnimation, ...rest } = row;
  return {
    ...rest,
    sticker: {
      duration: stickerDuration as StickerOptions['duration'],
      position: stickerPosition,
      size: stickerSize,
      animation: stickerAnimation,
    },
  };
}

export function kindOf(content: NewEmojiContent): RoomEmojiKind {
  if (content.image && content.emoji) {
    throw new BadRequestException('Subí una imagen o elegí un emoji (solo uno de los dos)');
  }
  if (content.sound && content.freesoundId) {
    throw new BadRequestException('Subí un sonido o elegí uno de Freesound (solo uno de los dos)');
  }
  if (content.image || content.emoji) return 'emoji';
  if (content.sound || content.freesoundId) return 'sound';
  throw new BadRequestException('Agregá una imagen, un emoji o un sonido');
}

export function isUniqueViolation(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === UNIQUE_VIOLATION || cause?.code === UNIQUE_VIOLATION;
}

// 'sound' = sonido de sala: sin imagen ni emoji, solo se usa desde la botonera.
export type RoomEmojiKind = 'emoji' | 'sound';

export interface StickerOptions {
  duration: (typeof STICKER_DURATIONS)[number];
  position: (typeof STICKER_POSITIONS)[number];
  size: (typeof STICKER_SIZES)[number];
  animation: (typeof STICKER_ANIMATIONS)[number];
}

export interface RoomEmojiSummary {
  id: string;
  name: string;
  kind: RoomEmojiKind;
  emoji: string | null;
  hasSound: boolean;
  soundAttribution: string | null;
  callMode: (typeof CALL_MODES)[number];
  sticker: StickerOptions;
}

export interface EmojiCallOptions {
  callMode?: (typeof CALL_MODES)[number];
  sticker?: Partial<StickerOptions>;
}

// Emoji: `image` o `emoji` (nunca los dos). Sonido de sala: ninguno de los dos y un sonido.
export interface NewEmojiContent {
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
    const rows = await this.db
      .select({
        id: roomEmojis.id,
        name: roomEmojis.name,
        kind: sql<RoomEmojiKind>`case when ${roomEmojis.image} is null and ${roomEmojis.emoji} is null then 'sound' else 'emoji' end`,
        emoji: roomEmojis.emoji,
        hasSound: sql<boolean>`${roomEmojis.sound} is not null`,
        soundAttribution: roomEmojis.soundAttribution,
        callMode: roomEmojis.callMode,
        stickerDuration: roomEmojis.stickerDuration,
        stickerPosition: roomEmojis.stickerPosition,
        stickerSize: roomEmojis.stickerSize,
        stickerAnimation: roomEmojis.stickerAnimation,
      })
      .from(roomEmojis)
      .where(eq(roomEmojis.roomId, room.id))
      .orderBy(asc(roomEmojis.createdAt));
    return rows.map(toSummary);
  }

  async create(
    code: string,
    userId: string,
    name: string,
    content: NewEmojiContent,
    options: EmojiCallOptions = {},
  ): Promise<RoomEmojiSummary> {
    const kind = kindOf(content);
    // Un sonido de sala no aparece en la llamada como reacción ni como sticker.
    const callMode = kind === 'sound' ? 'reaction' : (options.callMode ?? 'reaction');
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
          callMode,
          stickerDuration: options.sticker?.duration,
          stickerPosition: options.sticker?.position,
          stickerSize: options.sticker?.size,
          stickerAnimation: options.sticker?.animation,
          createdBy: userId,
        })
        .returning({
          id: roomEmojis.id,
          name: roomEmojis.name,
          emoji: roomEmojis.emoji,
          soundAttribution: roomEmojis.soundAttribution,
          callMode: roomEmojis.callMode,
          stickerDuration: roomEmojis.stickerDuration,
          stickerPosition: roomEmojis.stickerPosition,
          stickerSize: roomEmojis.stickerSize,
          stickerAnimation: roomEmojis.stickerAnimation,
        });
      this.roomEvents.emitRoomEmojisChanged({ roomCode: code });
      return toSummary({ ...created, kind, hasSound: Boolean(sound) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un emoji o sonido con ese nombre en la sala');
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

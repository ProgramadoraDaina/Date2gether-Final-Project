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
  // Cambia con cada edición: el cliente la agrega a las URLs de imagen y sonido.
  version: number;
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

export interface EmojiChanges extends NewEmojiContent, EmojiCallOptions {
  name?: string;
  removeSound?: boolean;
}

// Columnas del resumen: el listado nunca devuelve los archivos.
const summaryColumns = {
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
  updatedAt: roomEmojis.updatedAt,
};

interface SummaryRow extends Omit<RoomEmojiSummary, 'sticker' | 'version'> {
  stickerDuration: number;
  stickerPosition: StickerOptions['position'];
  stickerSize: StickerOptions['size'];
  stickerAnimation: StickerOptions['animation'];
  updatedAt: Date;
}

function toSummary(row: SummaryRow): RoomEmojiSummary {
  const { stickerDuration, stickerPosition, stickerSize, stickerAnimation, updatedAt, ...rest } =
    row;
  return {
    ...rest,
    sticker: {
      duration: stickerDuration as StickerOptions['duration'],
      position: stickerPosition,
      size: stickerSize,
      animation: stickerAnimation,
    },
    version: updatedAt.getTime(),
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

// Drizzle envuelve el error de Postgres: el código queda en `cause`.
export function isUniqueViolation(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === UNIQUE_VIOLATION || cause?.code === UNIQUE_VIOLATION;
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
    const rows = await this.db
      .select(summaryColumns)
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
    const { sound, attribution } = await this.prepareSound(content);

    return this.writeSummary(code, () =>
      this.db
        .insert(roomEmojis)
        .values({
          roomId: room.id,
          name,
          image: image?.data ?? null,
          imageMime: image?.mime ?? null,
          emoji: content.emoji ?? null,
          sound: sound?.data ?? null,
          soundMime: sound?.mime ?? null,
          soundAttribution: attribution,
          callMode,
          stickerDuration: options.sticker?.duration,
          stickerPosition: options.sticker?.position,
          stickerSize: options.sticker?.size,
          stickerAnimation: options.sticker?.animation,
          createdBy: userId,
        })
        .returning(summaryColumns),
    );
  }

  async update(code: string, id: string, changes: EmojiChanges): Promise<RoomEmojiSummary> {
    if (changes.image && changes.emoji) {
      throw new BadRequestException('Subí una imagen o elegí un emoji (solo uno de los dos)');
    }
    if (changes.sound && changes.freesoundId) {
      throw new BadRequestException(
        'Subí un sonido o elegí uno de Freesound (solo uno de los dos)',
      );
    }
    if ((changes.sound || changes.freesoundId) && changes.removeSound) {
      throw new BadRequestException('Elegí un sonido nuevo o quitalo, no las dos cosas');
    }
    const room = await this.roomsService.getByCodeOrThrow(code);
    const [current] = await this.db
      .select({
        hasImage: sql<boolean>`${roomEmojis.image} is not null`,
        emoji: roomEmojis.emoji,
        hasSound: sql<boolean>`${roomEmojis.sound} is not null`,
      })
      .from(roomEmojis)
      .where(and(eq(roomEmojis.id, id), eq(roomEmojis.roomId, room.id)))
      .limit(1);
    if (!current) throw new NotFoundException('El emoji no existe');

    const image = changes.image ? await processEmojiImage(changes.image) : undefined;
    const { sound, attribution } = await this.prepareSound(changes);

    const hasImage = image ? true : changes.emoji ? false : current.hasImage;
    const emoji = changes.emoji ?? (image ? null : current.emoji);
    const hasSound = sound ? true : changes.removeSound ? false : current.hasSound;
    if (!hasImage && !emoji && !hasSound) {
      throw new BadRequestException('Un sonido de sala no puede quedarse sin sonido');
    }
    const isSound = !hasImage && !emoji;

    const set: Partial<typeof roomEmojis.$inferInsert> = { updatedAt: new Date() };
    if (changes.name) set.name = changes.name;
    if (image) Object.assign(set, { image: image.data, imageMime: image.mime, emoji: null });
    if (changes.emoji) Object.assign(set, { emoji: changes.emoji, image: null, imageMime: null });
    if (sound) {
      Object.assign(set, {
        sound: sound.data,
        soundMime: sound.mime,
        soundAttribution: attribution,
      });
    }
    if (changes.removeSound) {
      Object.assign(set, { sound: null, soundMime: null, soundAttribution: null });
    }
    if (isSound) set.callMode = 'reaction';
    else if (changes.callMode) set.callMode = changes.callMode;
    if (changes.sticker?.duration) set.stickerDuration = changes.sticker.duration;
    if (changes.sticker?.position) set.stickerPosition = changes.sticker.position;
    if (changes.sticker?.size) set.stickerSize = changes.sticker.size;
    if (changes.sticker?.animation) set.stickerAnimation = changes.sticker.animation;

    return this.writeSummary(code, () =>
      this.db
        .update(roomEmojis)
        .set(set)
        .where(and(eq(roomEmojis.id, id), eq(roomEmojis.roomId, room.id)))
        .returning(summaryColumns),
    );
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

  private async prepareSound(content: NewEmojiContent) {
    const freesound = content.freesoundId
      ? await this.freesound.downloadForEmoji(content.freesoundId)
      : undefined;
    const bytes = content.sound ?? freesound?.data;
    const sound: ProcessedMedia | undefined = bytes ? await validateEmojiSound(bytes) : undefined;
    return { sound, attribution: freesound?.attribution ?? null };
  }

  private async writeSummary(
    code: string,
    write: () => Promise<SummaryRow[]>,
  ): Promise<RoomEmojiSummary> {
    try {
      const [row] = await write();
      this.roomEvents.emitRoomEmojisChanged({ roomCode: code });
      return toSummary(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un emoji o sonido con ese nombre en la sala');
      }
      throw error;
    }
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

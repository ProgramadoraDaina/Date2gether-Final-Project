import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import {
  CALL_MODES,
  STICKER_ANIMATIONS,
  STICKER_DURATIONS,
  STICKER_POSITIONS,
  STICKER_SIZES,
} from '../../../db/schema';

// Un solo emoji, incluidos tonos de piel, secuencias con ZWJ (👨‍👩‍👧) y banderas (🇦🇷).
const SINGLE_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}️?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*)$/u;

export class CreateRoomEmojiDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/, {
    message: 'El nombre debe tener de 2 a 32 caracteres: letras, números o guion bajo',
  })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(SINGLE_EMOJI, { message: 'Elegí un solo emoji' })
  emoji?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  freesoundId?: number;

  @IsOptional()
  @IsIn(CALL_MODES)
  callMode?: (typeof CALL_MODES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsIn(STICKER_DURATIONS)
  stickerDuration?: (typeof STICKER_DURATIONS)[number];

  @IsOptional()
  @IsIn(STICKER_POSITIONS)
  stickerPosition?: (typeof STICKER_POSITIONS)[number];

  @IsOptional()
  @IsIn(STICKER_SIZES)
  stickerSize?: (typeof STICKER_SIZES)[number];

  @IsOptional()
  @IsIn(STICKER_ANIMATIONS)
  stickerAnimation?: (typeof STICKER_ANIMATIONS)[number];
}

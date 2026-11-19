import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AVATAR_BODY_IDS, AVATAR_FACE_IDS, AVATAR_HEAD_IDS, AVATAR_NECK_IDS } from '../avatar';
import { IsAvatarColorsMap } from '../validators/is-avatar-colors-map.validator';

export class UpdateAvatarDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AVATAR_BODY_IDS, { each: true })
  body?: Array<(typeof AVATAR_BODY_IDS)[number]>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AVATAR_HEAD_IDS, { each: true })
  head?: Array<(typeof AVATAR_HEAD_IDS)[number]>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AVATAR_FACE_IDS, { each: true })
  face?: Array<(typeof AVATAR_FACE_IDS)[number]>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AVATAR_NECK_IDS, { each: true })
  neck?: Array<(typeof AVATAR_NECK_IDS)[number]>;

  // Mapa "<slot>:<id>" -> color hex: una entrada por pieza seleccionada,
  // no una por slot (ver avatarColorKey en ../avatar.ts).
  @IsOptional()
  @IsAvatarColorsMap()
  colors?: Record<string, string>;

  @IsBoolean()
  sticker: boolean;
}

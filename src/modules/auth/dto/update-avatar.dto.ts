import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, Matches, ValidateNested } from 'class-validator';
import { AVATAR_COLOR_PATTERN, AVATAR_FACE_IDS, AVATAR_HEAD_IDS, AVATAR_NECK_IDS } from '../avatar';

class AvatarColorsDto {
  @IsOptional()
  @Matches(AVATAR_COLOR_PATTERN)
  head?: string;

  @IsOptional()
  @Matches(AVATAR_COLOR_PATTERN)
  face?: string;

  @IsOptional()
  @Matches(AVATAR_COLOR_PATTERN)
  neck?: string;
}

export class UpdateAvatarDto {
  @IsOptional()
  @IsIn(AVATAR_HEAD_IDS)
  head?: (typeof AVATAR_HEAD_IDS)[number];

  @IsOptional()
  @IsIn(AVATAR_FACE_IDS)
  face?: (typeof AVATAR_FACE_IDS)[number];

  @IsOptional()
  @IsIn(AVATAR_NECK_IDS)
  neck?: (typeof AVATAR_NECK_IDS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => AvatarColorsDto)
  colors?: AvatarColorsDto;

  @IsBoolean()
  sticker: boolean;
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import {
  NAME_MESSAGE,
  NAME_PATTERN,
  normalizeName,
  RoomEmojiFieldsDto,
} from './create-room-emoji.dto';

// Todo opcional: solo se cambia lo que llega en el formulario.
export class UpdateRoomEmojiDto extends RoomEmojiFieldsDto {
  @IsOptional()
  @Transform(normalizeName)
  @IsString()
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  name?: string;

  // Llega como texto en el multipart: 'true' quita el sonido actual.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  removeSound?: boolean;
}

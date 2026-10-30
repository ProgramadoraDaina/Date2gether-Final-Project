import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class CreateRoomEmojiDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/, {
    message: 'El nombre debe tener de 2 a 32 caracteres: letras, números o guion bajo',
  })
  name: string;
}

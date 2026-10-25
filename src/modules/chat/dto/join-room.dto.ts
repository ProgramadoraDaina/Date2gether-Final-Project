import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Matches } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/, {
    message: 'code debe tener el formato "abc-defg-hij"',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  userName: string;

  // Solo viene si quien se une tiene sesión iniciada. Permite cruzar la
  // presencia del socket con los roles de room_members sin ambigüedad
  // cuando dos personas comparten el mismo userName.
  @IsOptional()
  @IsUUID()
  userId?: string;
}

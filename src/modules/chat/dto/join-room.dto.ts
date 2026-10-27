import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/, {
    message: 'code debe tener el formato "abc-defg-hij"',
  })
  code: string;
}

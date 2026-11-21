import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateRoomNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

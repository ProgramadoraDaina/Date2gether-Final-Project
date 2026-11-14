import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class SaveRoomNotesDto {
  @IsString()
  @MaxLength(20000)
  content: string;

  @IsInt()
  @Min(0)
  @Max(2147483646)
  revision: number;
}

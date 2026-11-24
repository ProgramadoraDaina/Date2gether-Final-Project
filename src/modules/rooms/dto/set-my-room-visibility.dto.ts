import { IsBoolean } from 'class-validator';

export class SetMyRoomVisibilityDto {
  @IsBoolean()
  hidden!: boolean;
}

import { IsBoolean, IsIn } from 'class-validator';

export class SetMediaLockDto {
  @IsIn(['audio', 'video'])
  target: 'audio' | 'video';

  @IsBoolean()
  locked: boolean;
}

import { IsBoolean, IsIn } from 'class-validator';
import type { SetMediaLockPayload } from '@date2gether/shared';

export class SetMediaLockDto implements SetMediaLockPayload {
  @IsIn(['audio', 'video'])
  target: 'audio' | 'video';

  @IsBoolean()
  locked: boolean;
}

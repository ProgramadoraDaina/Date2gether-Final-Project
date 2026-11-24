import { IsBoolean } from 'class-validator';
import type { NameFocusState } from '@date2gether/shared';

export class SetNameFocusDto implements NameFocusState {
  @IsBoolean()
  enabled: boolean;
}

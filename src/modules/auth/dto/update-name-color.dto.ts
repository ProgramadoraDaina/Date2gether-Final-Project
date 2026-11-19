import { IsIn } from 'class-validator';
import { NAME_COLOR_IDS } from '../../../db/schema';

export class UpdateNameColorDto {
  @IsIn(NAME_COLOR_IDS)
  nameColor: (typeof NAME_COLOR_IDS)[number];
}

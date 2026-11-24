import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListCallHistoryDto {
  @IsOptional()
  @IsIn(['recent', 'archive'])
  view?: 'recent' | 'archive';

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsUUID()
  before?: string;
}

import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class ListChatMessagesDto {
  @IsOptional()
  @IsIn(['recent', 'archive'])
  view?: 'recent' | 'archive';

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  before?: string;
}

import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MESSAGE_KINDS } from '../../../db/schema';

export class SendMessageDto {
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: (typeof MESSAGE_KINDS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

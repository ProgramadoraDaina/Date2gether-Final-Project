import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateRoomLinkDto {
  // Only http(s): the client renders it as an <a href>, so javascript: must never get in.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

import { IsString, MaxLength, MinLength } from 'class-validator';

export class KickParticipantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  participantId: string;
}

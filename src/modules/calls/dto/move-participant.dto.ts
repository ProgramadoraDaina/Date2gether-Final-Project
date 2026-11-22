import { IsNotEmpty, IsString } from 'class-validator';

export class MoveParticipantDto {
  @IsString()
  @IsNotEmpty()
  livekitIdentity: string;
}

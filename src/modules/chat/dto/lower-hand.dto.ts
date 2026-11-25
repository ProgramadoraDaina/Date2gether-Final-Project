import { IsString, MaxLength, MinLength } from 'class-validator';

export class LowerHandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  participantId: string;
}

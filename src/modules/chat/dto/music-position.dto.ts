import { IsNumber, Min } from 'class-validator';

export class MusicPositionDto {
  @IsNumber()
  @Min(0)
  positionSeconds: number;
}

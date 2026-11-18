import { IsNumber, Min } from 'class-validator';

export class MusicTrackEndedDto {
  // updatedAt of the state that was playing; stale reports from other listeners are ignored.
  @IsNumber()
  @Min(0)
  updatedAt: number;
}

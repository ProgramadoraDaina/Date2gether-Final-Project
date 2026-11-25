import { IsInt, Max, Min } from 'class-validator';

export class MusicVolumeDto {
  @IsInt()
  @Min(0)
  @Max(100)
  volume: number;
}

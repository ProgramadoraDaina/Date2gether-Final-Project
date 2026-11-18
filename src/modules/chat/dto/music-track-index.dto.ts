import { IsInt, Min } from 'class-validator';

// Compartido por musicRemoveTrack y musicJumpToTrack: ambos solo necesitan
// un índice de la lista de canciones de la sala.
export class MusicTrackIndexDto {
  @IsInt()
  @Min(0)
  index: number;
}

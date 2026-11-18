import { IsBoolean, IsIn } from 'class-validator';
import { PLAYBACK_MODES, type PlaybackMode } from '../music-playback';

export class MusicModeDto {
  @IsIn(PLAYBACK_MODES)
  mode: PlaybackMode;

  @IsBoolean()
  shuffle: boolean;
}

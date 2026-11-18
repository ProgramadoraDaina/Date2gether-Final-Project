import { IsBoolean, IsIn } from 'class-validator';

// LiveKit no manda webhook de mute/unmute (solo publish/unpublish real, ver
// design.md): esto es lo que el propio cliente reporta cuando el usuario
// prende o apaga su cámara/mic después de la primera publicación.
export class ReportTrackStateDto {
  @IsIn(['camera', 'microphone'])
  source: 'camera' | 'microphone';

  @IsBoolean()
  enabled: boolean;
}

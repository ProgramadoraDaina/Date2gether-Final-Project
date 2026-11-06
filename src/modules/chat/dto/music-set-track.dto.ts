import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Se acepta tanto el id de 11 caracteres como un link completo de YouTube;
// el gateway extrae y valida el id real (ver extractYouTubeId en chat.gateway.ts).
// El largo máximo solo evita payloads arbitrarios, no valida el formato.
export class MusicSetTrackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  videoId: string;
}

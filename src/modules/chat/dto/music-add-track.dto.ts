import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Se acepta tanto el id de 11 caracteres como un link completo de YouTube;
// el gateway extrae y valida el id real (ver extractYouTubeId en chat.gateway.ts).
// El título lo resuelve el cliente (oEmbed de YouTube) antes de emitir este
// evento: el servidor solo lo guarda y retransmite, no vuelve a resolverlo.
export class MusicAddTrackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  videoId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}

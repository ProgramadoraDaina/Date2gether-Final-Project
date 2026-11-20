import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

// El array de valores (en vez de un literal suelto) es lo que permitió sumar
// 'poll' sin tocar el decorador @IsIn de abajo.
export const ROOM_EVENT_TYPES = ['roulette', 'poll'] as const;
export type RoomEventType = (typeof ROOM_EVENT_TYPES)[number];

// Solo se mandan ids: el gateway resuelve el nombre real de cada participante
// contra su propio mapa de conectados (ver ChatGateway.getUsersInRoom), así
// un cliente no puede inventar el nombre de otra persona en la ruleta ni en
// la encuesta.
export class StartRoomEventDto {
  @IsIn(ROOM_EVENT_TYPES)
  type: RoomEventType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  participantIds: string[];

  // Campos exclusivos de 'poll': @ValidateIf los deja fuera de la validación
  // (y por ende no requeridos) cuando type es 'roulette', sin necesitar dos
  // DTOs separados para un solo evento de WebSocket. Opcionales también a
  // nivel de tipo, para que los payloads de ruleta (sin ninguno de estos
  // campos) sigan tipando sin casts.
  @ValidateIf((o: StartRoomEventDto) => o.type === 'poll')
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  question?: string;

  @ValidateIf((o: StartRoomEventDto) => o.type === 'poll')
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options?: string[];

  @ValidateIf((o: StartRoomEventDto) => o.type === 'poll')
  @IsBoolean()
  multipleChoice?: boolean;

  @ValidateIf((o: StartRoomEventDto) => o.type === 'poll')
  @IsBoolean()
  anonymous?: boolean;
}

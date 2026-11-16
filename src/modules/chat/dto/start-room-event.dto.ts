import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';

// Único tipo soportado hoy; el array de valores (en vez de un literal suelto)
// es lo que permite sumar 'votacion' el día de mañana sin tocar el decorador.
export const ROOM_EVENT_TYPES = ['roulette'] as const;
export type RoomEventType = (typeof ROOM_EVENT_TYPES)[number];

// Solo se mandan ids: el gateway resuelve el nombre real de cada participante
// contra su propio mapa de conectados (ver ChatGateway.getUsersInRoom), así
// un cliente no puede inventar el nombre de otra persona en la ruleta.
export class StartRoomEventDto {
  @IsIn(ROOM_EVENT_TYPES)
  type: RoomEventType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  participantIds: string[];
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient } from 'livekit-server-sdk';
import { RoomEventsService } from '../rooms/room-events.service';

/**
 * Corta la llamada de LiveKit en curso cuando se borra una sala. Se suscribe a
 * RoomEventsService (el puente que ya usa ChatGateway) en vez de que RoomsService
 * llame a LiveKit: así RoomsModule no depende de CallsModule (que ya importa
 * RoomsModule) y se evita la dependencia circular.
 *
 * El nombre de la sala de LiveKit es el código de la sala (ver CallsService.join:
 * createRoom({ name: roomCode }) y el grant `room: roomCode`).
 */
@Injectable()
export class CallRoomTeardownService {
  private readonly logger = new Logger(CallRoomTeardownService.name);
  private readonly client: RoomServiceClient;

  constructor(config: ConfigService, roomEvents: RoomEventsService) {
    const wsUrl = config.get<string>('LIVEKIT_URL') ?? '';
    const apiUrl = config.get<string>('LIVEKIT_API_URL') || wsUrl.replace(/^ws/, 'http');
    this.client = new RoomServiceClient(
      apiUrl,
      config.get<string>('LIVEKIT_API_KEY', ''),
      config.get<string>('LIVEKIT_API_SECRET', ''),
    );
    roomEvents.onRoomDeleted(({ roomCode }) => {
      void this.endCall(roomCode);
    });
  }

  // Best-effort: sin llamada activa LiveKit responde "not found" y con LiveKit caído
  // falla la red; en ambos casos el borrado de la sala ya se confirmó y no se revierte.
  async endCall(roomCode: string): Promise<void> {
    try {
      await this.client.deleteRoom(roomCode);
    } catch {
      // No registrar la respuesta externa: puede incluir URLs internas o credenciales.
      this.logger.log('No se pudo cerrar la sala de medios (sin llamada activa o sin conexión)');
    }
  }
}

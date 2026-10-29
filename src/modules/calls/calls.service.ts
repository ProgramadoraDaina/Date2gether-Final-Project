import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq } from 'drizzle-orm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { RoomParticipant } from '../auth/room-access.service';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callHistory, rooms } from '../../db/schema';
import { RoomsService } from '../rooms/rooms.service';

const HISTORY_LIMIT = 50;

export interface CallHistoryEntry {
  roomCode: string;
  roomName: string;
  startedAt: Date;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly roomsService: RoomsService,
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async join(roomCode: string, participant: RoomParticipant) {
    if (participant.roomCode !== roomCode)
      throw new ForbiddenException('El acceso pertenece a otra sala');
    const room = await this.roomsService.getByCodeOrThrow(roomCode);
    if (!room.isActive) throw new ForbiddenException('La sala está cerrada');

    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Las llamadas todavía no están configuradas');
    }
    const maxParticipants = Number(this.config.get('MAX_ROOM_PARTICIPANTS', '6'));
    if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 20) {
      throw new ServiceUnavailableException(
        'La capacidad de la sala no está configurada correctamente',
      );
    }
    // El navegador recibe la URL pública; el API puede usar la red interna de Docker.
    const apiUrl = this.config.get<string>('LIVEKIT_API_URL') || url.replace(/^ws/, 'http');
    const client = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    try {
      // createRoom es idempotente. El servidor aplica el cupo al conectar, no al emitir pases.
      await client.createRoom({
        name: roomCode,
        maxParticipants,
        emptyTimeout: 300,
        departureTimeout: 30,
      });
    } catch {
      // No registrar respuestas externas: pueden incluir credenciales o URLs internas.
      this.logger.warn('No se pudo preparar la sala de medios en LiveKit');
      throw new ServiceUnavailableException(
        'El servidor de llamadas no está disponible. Intentá nuevamente.',
      );
    }
    const access = new AccessToken(apiKey, apiSecret, {
      identity: participant.sub,
      name: participant.name,
      ttl: '15m',
    });
    access.addGrant({
      room: roomCode,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      roomAdmin: false,
      roomRecord: false,
    });

    if (participant.userId) {
      // Solo las cuentas registradas generan historial; los invitados se omiten
      // en silencio. Un fallo al registrar no debe impedir que la llamada continúe.
      await this.db
        .insert(callHistory)
        .values({ roomId: room.id, userId: participant.userId })
        .catch(() => {
          this.logger.warn('No se pudo registrar el historial de la llamada');
        });
    }

    return {
      url,
      token: await access.toJwt(),
      roomName: roomCode,
      participantLimit: maxParticipants,
    };
  }

  async listHistory(userId: string): Promise<CallHistoryEntry[]> {
    return this.db
      .select({
        roomCode: rooms.code,
        roomName: rooms.name,
        startedAt: callHistory.startedAt,
      })
      .from(callHistory)
      .innerJoin(rooms, eq(callHistory.roomId, rooms.id))
      .where(eq(callHistory.userId, userId))
      .orderBy(desc(callHistory.startedAt))
      .limit(HISTORY_LIMIT);
  }
}

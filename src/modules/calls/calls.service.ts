import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { RoomParticipant } from '../auth/room-access.service';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callHistory,
  callParticipantIdentities,
  roomMembers,
  rooms,
  type RoomRole,
} from '../../db/schema';
import { RoomsService } from '../rooms/rooms.service';

// Código estable para el rechazo del gate de anfitrión (D5, design.md): el
// cliente se acopla a este código, no al texto del mensaje.
const NO_HOST_CONNECTED_CODE = 'NO_HOST_CONNECTED';
const NO_HOST_CONNECTED_MESSAGE = 'Esperá a que se conecte un anfitrión para unirte a la llamada.';

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

    // Gate de anfitrión (D1/D2, design.md): el rol se resuelve LOCAL y
    // PRIMERO, antes de contactar a LiveKit. Es lo que permite que un
    // administrador cortocircuite el chequeo de presencia por completo (ver
    // más abajo) y pueda iniciar la llamada incluso si LiveKit está
    // inestable — la excepción que la propuesta exige.
    const role = await this.resolveLocalRole(room.id, participant.userId);

    // El navegador recibe la URL pública; el API puede usar la red interna de Docker.
    const apiUrl = this.config.get<string>('LIVEKIT_API_URL') || url.replace(/^ws/, 'http');
    const client = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    try {
      // createRoom es idempotente. El servidor aplica el cupo al conectar, no al emitir pases.
      // Va ANTES de listParticipants (gate de abajo) para que una sala
      // creada con certeza y una lista vacía de participantes signifiquen
      // sin ambigüedad "nadie conectado", no "la sala no existe".
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

    // El admin nunca pasa por esta consulta (D2): solo los no-admin dependen
    // de que haya al menos un administrador ya conectado a la videollamada.
    if (role !== 'administrador') {
      await this.assertHostConnected(client, roomCode, room.id);
    }

    // Correlación identity↔usuario/invitado para esta sala, escrita antes de
    // emitir el token (es el único lugar que tiene juntos participant.sub,
    // participant.userId, participant.name y room.id). El JWT de acceso a la
    // sala vive 24h con un participant.sub FIJO, así que este POST puede
    // reenviarse con el MISMO identity (reintento, re-montaje del cliente):
    // por eso es un upsert por livekitIdentity y no un insert simple.
    // roleAtIssue guarda el snapshot de rol resuelto arriba: es lo que el
    // gate de futuros solicitantes y el cierre forzado del PR7 usan para
    // reconocer admins conectados sin volver a consultar roomMembers.
    await this.db
      .insert(callParticipantIdentities)
      .values({
        livekitIdentity: participant.sub,
        roomId: room.id,
        userId: participant.userId ?? null,
        displayName: participant.name,
        roleAtIssue: role ?? null,
      })
      .onConflictDoUpdate({
        target: callParticipantIdentities.livekitIdentity,
        set: { issuedAt: new Date(), roleAtIssue: role ?? null },
      });

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
      // Las reacciones viajan por el data channel; el cliente valida cada mensaje recibido.
      canPublishData: true,
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

  // Rol del solicitante, resuelto local contra roomMembers (snapshot al
  // momento de unirse). Los invitados (sin userId) nunca son admin: no
  // tienen fila en roomMembers y no se consulta nada por ellos (spec
  // host-gate/invitados-no-admin).
  private async resolveLocalRole(
    roomId: string,
    userId: string | undefined,
  ): Promise<RoomRole | undefined> {
    if (!userId) return undefined;
    const [member] = await this.db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    return member?.role;
  }

  // Gate de anfitrión para un solicitante no-admin (D1/D2, design.md):
  // consulta el estado EN VIVO de LiveKit (no el log de eventos, que es una
  // proyección rezagada) y lo cruza contra el snapshot de rol guardado en
  // call_participant_identities. Si LiveKit no responde, se rechaza con 503
  // (fail-closed honesto), nunca con 403 (eso le mentiría al solicitante).
  private async assertHostConnected(
    client: RoomServiceClient,
    roomCode: string,
    roomId: string,
  ): Promise<void> {
    let connectedIdentities: string[];
    try {
      const participants = await client.listParticipants(roomCode);
      connectedIdentities = participants
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
    } catch {
      this.logger.warn('No se pudo verificar la presencia de un anfitrión en la videollamada');
      throw new ServiceUnavailableException(
        'No se pudo verificar si hay un anfitrión conectado. Intentá nuevamente.',
      );
    }

    // Lista vacía: nadie conectado, se rechaza sin consultar la base.
    let hostConnected = false;
    if (connectedIdentities.length > 0) {
      const [admin] = await this.db
        .select({ id: callParticipantIdentities.id })
        .from(callParticipantIdentities)
        .where(
          and(
            eq(callParticipantIdentities.roomId, roomId),
            inArray(callParticipantIdentities.livekitIdentity, connectedIdentities),
            eq(callParticipantIdentities.roleAtIssue, 'administrador'),
          ),
        )
        .limit(1);
      hostConnected = !!admin;
    }

    if (!hostConnected) {
      throw new ForbiddenException({
        message: NO_HOST_CONNECTED_MESSAGE,
        code: NO_HOST_CONNECTED_CODE,
      });
    }
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

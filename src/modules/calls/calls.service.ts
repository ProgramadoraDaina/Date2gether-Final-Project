import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Attendee,
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  GetMeetingCommand,
  type Meeting,
  NotFoundException,
} from '@aws-sdk/client-chime-sdk-meetings';
import { createHash } from 'node:crypto';
import { RoomsService } from '../rooms/rooms.service';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private readonly pendingMeetings = new Map<string, Promise<Meeting>>();

  constructor(
    private readonly chimeClient: ChimeSDKMeetingsClient,
    private readonly roomsService: RoomsService,
    private readonly configService: ConfigService,
  ) {}

  async createMeetingForRoom(roomCode: string): Promise<Meeting> {
    this.ensureEnabled();
    const pending = this.pendingMeetings.get(roomCode);
    if (pending) return pending;

    const meeting = this.resolveMeetingForRoom(roomCode);
    this.pendingMeetings.set(roomCode, meeting);
    try {
      return await meeting;
    } finally {
      this.pendingMeetings.delete(roomCode);
    }
  }

  private async resolveMeetingForRoom(roomCode: string): Promise<Meeting> {
    const room = await this.roomsService.getByCodeOrThrow(roomCode);
    if (!room.isActive) throw new ForbiddenException('La sala está cerrada');

    if (room.chimeMeetingId) {
      const existingMeeting = await this.findActiveMeeting(room.chimeMeetingId);
      if (existingMeeting) return existingMeeting;
    }

    const command = new CreateMeetingCommand({
      // El mismo intento obtiene la misma reunión incluso entre procesos.
      ClientRequestToken: createHash('sha256')
        .update(`${room.id}:${room.chimeMeetingId ?? 'initial'}`)
        .digest('hex'),
      ExternalMeetingId: roomCode,
      MediaRegion: this.configService.get<string>(
        'AWS_CHIME_MEDIA_REGION',
        this.configService.get<string>('AWS_REGION', 'us-east-2'),
      ),
    });

    const response = await this.requestChime(() => this.chimeClient.send(command));
    const meeting = response.Meeting;
    if (!meeting?.MeetingId) {
      throw new ServiceUnavailableException('El servicio de audio no devolvió una reunión válida');
    }
    await this.roomsService.setChimeMeetingId(room.id, meeting.MeetingId);
    return meeting;
  }

  // Devuelve la reunión si Chime todavía la tiene activa, o `undefined` si ya
  // terminó (Chime la da de baja sola tras un tiempo sin asistentes) — en ese
  // caso createMeetingForRoom crea una nueva y la persiste.
  private async findActiveMeeting(meetingId: string): Promise<Meeting | undefined> {
    try {
      const response = await this.requestChime(() =>
        this.chimeClient.send(new GetMeetingCommand({ MeetingId: meetingId })),
      );
      return response.Meeting;
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  async createAttendee(meetingId: string, userId: string): Promise<Attendee> {
    this.ensureEnabled();
    const command = new CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: userId,
    });

    const response = await this.requestChime(() => this.chimeClient.send(command));
    if (!response.Attendee?.AttendeeId) {
      throw new ServiceUnavailableException(
        'El servicio de audio no devolvió un participante válido',
      );
    }
    return response.Attendee;
  }

  private ensureEnabled(): void {
    if (this.configService.get<string>('AWS_CHIME_ENABLED', 'false') !== 'true') {
      throw new ServiceUnavailableException('Las llamadas de audio todavía no están habilitadas');
    }
  }

  private async requestChime<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      const name = error instanceof Error ? error.name : 'UnknownError';
      // No registrar mensajes de AWS: pueden contener ARNs o identificadores.
      this.logger.warn(`Chime SDK: ${name}`);
      if (
        ['CredentialsProviderError', 'TokenProviderError', 'ExpiredTokenException'].includes(name)
      ) {
        throw new ServiceUnavailableException('El servicio de audio necesita renovar su conexión');
      }
      throw new ServiceUnavailableException(
        'El servicio de audio no está disponible en este momento',
      );
    }
  }
}

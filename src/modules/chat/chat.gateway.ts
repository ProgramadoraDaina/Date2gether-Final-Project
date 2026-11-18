import { Inject, UseGuards, UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { isURL } from 'class-validator';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { users } from '../../db/schema';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import type { RoomParticipant } from '../auth/room-access.service';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomResolverService } from '../rooms/room-resolver.service';
import { RoomsService } from '../rooms/rooms.service';
import { ChatService } from './chat.service';
import { RoomPlaylistsService } from './room-playlists.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { MusicAddTrackDto } from './dto/music-add-track.dto';
import { MusicPositionDto } from './dto/music-position.dto';
import { MusicTrackIndexDto } from './dto/music-track-index.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartRoomEventDto, type RoomEventType } from './dto/start-room-event.dto';

// "Hasta la próxima ruleta o evento" (lo que llegue primero: el próximo
// startRoomEvent pisa este estado igual) además de un techo fijo en el
// tiempo, para que el cartel de resultado no quede pegado para siempre en
// una sala inactiva.
const ROOM_EVENT_TTL_MS = 15 * 60 * 1000;

// Solo GIFs servidos por GIPHY: evita que se inyecten imágenes de cualquier dominio.
function isGiphyUrl(url: string): boolean {
  return isURL(url, {
    protocols: ['https'],
    require_protocol: true,
    host_whitelist: [/^media\d?\.giphy\.com$/],
  });
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// El cliente puede mandar el id "pelado" o un link completo; no se confía en
// que lo haya parseado bien del lado del cliente, así que el id real
// siempre se extrae y valida acá.
function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (YOUTUBE_VIDEO_ID.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return YOUTUBE_VIDEO_ID.test(id) ? id : null;
    }
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id && YOUTUBE_VIDEO_ID.test(id) ? id : null;
      }
      const embedMatch = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
      if (embedMatch) return embedMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

interface ConnectedUser {
  participantId: string;
  roomCode: string;
  roomId: string;
  userName: string;
  userId?: string;
  nameColor?: string | null;
}

// Shape pública de la presencia: mismos campos que ConnectedUser salvo los
// internos (roomId), para no declarar un segundo tipo con los mismos campos.
type RoomUser = Pick<ConnectedUser, 'participantId' | 'userName' | 'userId' | 'nameColor'>;

interface MusicTrack {
  videoId: string;
  title: string;
}

interface MusicState {
  tracks: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: number;
}

interface RoomEventState {
  type: RoomEventType;
  participants: RoomUser[];
  winner: RoomUser;
  startedAt: number;
  expiresAt: number;
}

@WebSocketGateway({
  namespace: '/rooms',
  cors: { origin: process.env.CORS_ORIGIN ?? '*' },
})
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly connectedUsers = new Map<string, ConnectedUser>();
  private readonly musicStateByRoom = new Map<string, MusicState>();
  private readonly eventStateByRoom = new Map<string, RoomEventState>();
  private readonly permanentRoomIds = new Set<string>();
  private readonly playlistSaves = new Map<string, Promise<void>>();
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomsService: RoomsService,
    private readonly chatService: ChatService,
    private readonly roomEvents: RoomEventsService,
    private readonly resolver: RoomResolverService,
    private readonly playlists: RoomPlaylistsService,
  ) {
    this.roomEvents.onMemberRoleChanged(({ roomCode }) => {
      this.server.to(roomCode).emit('memberRoleChanged');
    });
    this.roomEvents.onRoomEmojisChanged(({ roomCode }) => {
      this.server.to(roomCode).emit('roomEmojisChanged');
    });
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() dto: JoinRoomDto) {
    // Categoría E (D4): único handler con un código resolvable -- los otros
    // 10 @SubscribeMessage ya operan sobre connectedUsers, que lleva roomId.
    // Es un handler de Socket.io: se emite el evento 'error' existente en
    // vez de dejar que la excepción (404/403) se propague como throw.
    let room: Awaited<ReturnType<RoomResolverService['resolveJoinable']>>;
    try {
      room = await this.resolver.resolveJoinable(dto.code);
    } catch (error) {
      client.emit('error', { message: error instanceof Error ? error.message : 'Error' });
      return;
    }

    const { participant } = client.data as { participant: RoomParticipant };
    try {
      this.resolver.assertBound(participant, room);
    } catch (error) {
      client.emit('error', { message: error instanceof Error ? error.message : 'Error' });
      return;
    }
    if (this.connectedUsers.has(client.id)) this.removeClient(client);
    await client.join(dto.code);
    const nameColor = await this.getNameColor(participant.userId);
    const presence: RoomUser = {
      participantId: participant.sub,
      userName: participant.name,
      userId: participant.userId,
      nameColor,
    };
    this.connectedUsers.set(client.id, {
      roomCode: dto.code,
      roomId: room.id,
      ...presence,
    });

    const history = await this.chatService.getHistory(room.id);
    client.emit('roomHistory', history);
    client.emit('roomUsers', this.getUsersInRoom(dto.code));

    // Sincroniza al que recién entra con lo que ya se está escuchando; si
    // nadie eligió nada todavía no tiene sentido mandar un estado vacío.
    if (room.isPermanent) await this.restorePlaylist(dto.code, room.id);
    const musicState = this.musicStateByRoom.get(dto.code);
    if (musicState) client.emit('musicState', musicState);

    // Mismo criterio que musicState: solo se sincroniza si todavía está
    // vigente (ver ROOM_EVENT_TTL_MS). A diferencia de 'eventStarted' (que
    // se emite en vivo a toda la sala cuando alguien gira la ruleta), este
    // 'eventState' nunca dispara la animación de la ruleta en el cliente que
    // recién se une: solo le muestra el cartel de resultado si ya corresponde.
    const eventState = this.eventStateByRoom.get(dto.code);
    if (eventState && eventState.expiresAt > Date.now()) client.emit('eventState', eventState);

    client.to(dto.code).emit('userJoined', presence);
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    this.removeClient(client);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('sendMessage')
  async handleSendMessage(@ConnectedSocket() client: Socket, @MessageBody() dto: SendMessageDto) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', { message: 'Tenés que unirte a una sala antes de enviar mensajes' });
      return;
    }

    const kind = dto.kind ?? 'text';
    if (kind === 'gif' && !isGiphyUrl(dto.content)) {
      client.emit('error', { message: 'El GIF no es válido' });
      return;
    }

    const message = await this.chatService.createMessage(
      user.roomId,
      user.userName,
      dto.content,
      kind,
    );
    this.server.to(user.roomCode).emit('newMessage', message);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicAddTrack')
  async handleMusicAddTrack(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MusicAddTrackDto,
  ) {
    const user = await this.requireMusicAdmin(client);
    if (!user) return;

    const videoId = extractYouTubeId(dto.videoId);
    if (!videoId) {
      client.emit('error', { message: 'El link o ID de YouTube no es válido' });
      return;
    }
    const title = dto.title.trim();
    if (!title) {
      client.emit('error', { message: 'El título de la canción no puede estar vacío' });
      return;
    }

    const current = this.musicStateByRoom.get(user.roomCode);
    // Agregar una canción a una lista que ya está sonando no debe interrumpir
    // la reproducción en curso: solo la primera canción de la sala arranca
    // en currentIndex 0, pausada, en el segundo 0.
    const state: MusicState = {
      tracks: [...(current?.tracks ?? []), { videoId, title }],
      currentIndex: current?.currentIndex ?? 0,
      isPlaying: current?.isPlaying ?? false,
      positionSeconds: current?.positionSeconds ?? 0,
      updatedAt: Date.now(),
    };
    this.setMusicState(user, state);
    this.server.to(user.roomCode).emit('musicState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicRemoveTrack')
  async handleMusicRemoveTrack(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MusicTrackIndexDto,
  ) {
    const user = await this.requireMusicAdmin(client);
    if (!user) return;

    const current = this.musicStateByRoom.get(user.roomCode);
    if (!current || dto.index >= current.tracks.length) {
      client.emit('error', { message: 'Esa canción ya no está en la lista' });
      return;
    }

    const removingCurrent = dto.index === current.currentIndex;
    const tracks = current.tracks.filter((_, index) => index !== dto.index);
    // Si se saca una canción antes de la actual, el resto se corre un lugar
    // y el índice tiene que acompañar ese corrimiento para seguir apuntando
    // a la misma canción que ya estaba sonando.
    const currentIndex = Math.min(
      current.currentIndex > dto.index ? current.currentIndex - 1 : current.currentIndex,
      Math.max(tracks.length - 1, 0),
    );
    const state: MusicState = {
      tracks,
      currentIndex,
      isPlaying: removingCurrent ? false : current.isPlaying,
      positionSeconds: removingCurrent ? 0 : current.positionSeconds,
      updatedAt: Date.now(),
    };
    this.setMusicState(user, state);
    this.server.to(user.roomCode).emit('musicState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicJumpToTrack')
  async handleMusicJumpToTrack(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MusicTrackIndexDto,
  ) {
    const user = await this.requireMusicAdmin(client);
    if (!user) return;

    const current = this.musicStateByRoom.get(user.roomCode);
    if (!current || dto.index >= current.tracks.length) {
      client.emit('error', { message: 'Esa canción ya no está en la lista' });
      return;
    }

    const state: MusicState = {
      ...current,
      currentIndex: dto.index,
      positionSeconds: 0,
      updatedAt: Date.now(),
    };
    this.setMusicState(user, state);
    this.server.to(user.roomCode).emit('musicState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicNext')
  async handleMusicNext(@ConnectedSocket() client: Socket) {
    await this.updateMusicState(client, (state) => {
      if (state.currentIndex >= state.tracks.length - 1) return state;
      return { ...state, currentIndex: state.currentIndex + 1, positionSeconds: 0 };
    });
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicPrevious')
  async handleMusicPrevious(@ConnectedSocket() client: Socket) {
    await this.updateMusicState(client, (state) => {
      if (state.currentIndex <= 0) return state;
      return { ...state, currentIndex: state.currentIndex - 1, positionSeconds: 0 };
    });
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicPlay')
  async handleMusicPlay(@ConnectedSocket() client: Socket, @MessageBody() dto: MusicPositionDto) {
    await this.updateMusicState(client, (state) => ({
      ...state,
      isPlaying: true,
      positionSeconds: dto.positionSeconds,
    }));
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicPause')
  async handleMusicPause(@ConnectedSocket() client: Socket, @MessageBody() dto: MusicPositionDto) {
    await this.updateMusicState(client, (state) => ({
      ...state,
      isPlaying: false,
      positionSeconds: dto.positionSeconds,
    }));
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicSeek')
  async handleMusicSeek(@ConnectedSocket() client: Socket, @MessageBody() dto: MusicPositionDto) {
    await this.updateMusicState(client, (state) => ({
      ...state,
      positionSeconds: dto.positionSeconds,
    }));
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('startRoomEvent')
  async handleStartRoomEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: StartRoomEventDto,
  ) {
    const user = await this.requireEventModerator(client);
    if (!user) return;

    // No se confía en la lista que manda el cliente más que para filtrar:
    // el nombre y la propia pertenencia a la sala salen de connectedUsers,
    // autoritativo del lado del servidor (ver comentario en el DTO). Si
    // alguien se fue entre que se armó la selección y se giró, queda afuera.
    const roster = this.getUsersInRoom(user.roomCode);
    const participants = roster.filter((candidate) =>
      dto.participantIds.includes(candidate.participantId),
    );
    if (participants.length === 0) {
      client.emit('error', {
        message: 'Nadie de la lista elegida sigue en la sala',
      });
      return;
    }

    const winner = participants[Math.floor(Math.random() * participants.length)];
    const now = Date.now();
    const state: RoomEventState = {
      type: dto.type,
      participants,
      winner,
      startedAt: now,
      expiresAt: now + ROOM_EVENT_TTL_MS,
    };
    this.eventStateByRoom.set(user.roomCode, state);
    this.server.to(user.roomCode).emit('eventStarted', state);
  }

  handleDisconnect(client: Socket) {
    this.removeClient(client);
  }

  private removeClient(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;

    void client.leave(user.roomCode);
    this.connectedUsers.delete(client.id);
    client.to(user.roomCode).emit('userLeft', {
      participantId: user.participantId,
      userName: user.userName,
      userId: user.userId,
    });

    // Los códigos de sala son efímeros: sin esto los mapas de música/eventos
    // crecerían sin límite a medida que se van creando y vaciando salas nuevas.
    if (this.getUsersInRoom(user.roomCode).length === 0) {
      this.musicStateByRoom.delete(user.roomCode);
      this.eventStateByRoom.delete(user.roomCode);
      this.permanentRoomIds.delete(user.roomId);
    }
  }

  // Igual que requireMusicAdmin, pero admite también a 'colaborador': a
  // diferencia de la música (un solo admin la controla), armar un evento es
  // una acción de moderación más liviana, la misma vara que ya se usa para
  // gestionar los emojis de la sala (ver RoomEmojisDialog del lado del
  // cliente, canManage = administrador || colaborador).
  private async requireEventModerator(client: Socket): Promise<ConnectedUser | undefined> {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', { message: 'Tenés que unirte a una sala antes de armar un evento' });
      return undefined;
    }
    if (!user.userId) {
      client.emit('error', { message: 'Necesitás una cuenta para armar un evento en la sala' });
      return undefined;
    }
    const role = await this.roomsService.getMemberRole(user.roomCode, user.userId);
    if (role !== 'administrador' && role !== 'colaborador') {
      client.emit('error', {
        message: 'Solo un administrador o colaborador de la sala puede armar un evento',
      });
      return undefined;
    }
    return user;
  }

  // Devuelve al usuario conectado si es administrador de la sala; si no,
  // emite el error correspondiente y devuelve undefined.
  private async requireMusicAdmin(client: Socket): Promise<ConnectedUser | undefined> {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', { message: 'Tenés que unirte a una sala antes de controlar la música' });
      return undefined;
    }
    if (!user.userId) {
      client.emit('error', { message: 'Necesitás una cuenta para controlar la música de la sala' });
      return undefined;
    }
    const role = await this.roomsService.getMemberRole(user.roomCode, user.userId);
    if (role !== 'administrador') {
      client.emit('error', {
        message: 'Solo el administrador de la sala puede controlar la música',
      });
      return undefined;
    }
    return user;
  }

  private async updateMusicState(
    client: Socket,
    apply: (state: MusicState) => Omit<MusicState, 'updatedAt'>,
  ) {
    const user = await this.requireMusicAdmin(client);
    if (!user) return;

    const current = this.musicStateByRoom.get(user.roomCode);
    if (!current || current.tracks.length === 0) {
      client.emit('error', { message: 'Todavía no se eligió una canción para la sala' });
      return;
    }

    const next: MusicState = { ...apply(current), updatedAt: Date.now() };
    this.setMusicState(user, next);
    this.server.to(user.roomCode).emit('musicState', next);
  }

  private setMusicState(user: ConnectedUser, state: MusicState) {
    const previous = this.musicStateByRoom.get(user.roomCode);
    this.musicStateByRoom.set(user.roomCode, state);
    if (!this.permanentRoomIds.has(user.roomId)) return;
    if (previous?.tracks === state.tracks && previous.currentIndex === state.currentIndex) return;
    // Chained per room so two quick changes cannot commit out of order.
    const pending = this.playlistSaves.get(user.roomId) ?? Promise.resolve();
    const next = pending
      .then(() => this.playlists.save(user.roomId, state.tracks, state.currentIndex))
      .catch(() => {
        this.logger.warn(`No se pudo guardar la playlist de la sala ${user.roomId}`);
      });
    this.playlistSaves.set(user.roomId, next);
    void next.finally(() => {
      if (this.playlistSaves.get(user.roomId) === next) this.playlistSaves.delete(user.roomId);
    });
  }

  private async restorePlaylist(roomCode: string, roomId: string) {
    this.permanentRoomIds.add(roomId);
    if (this.musicStateByRoom.has(roomCode)) return;
    let stored: Awaited<ReturnType<RoomPlaylistsService['load']>>;
    try {
      stored = await this.playlists.load(roomId);
    } catch {
      this.logger.warn(`No se pudo recuperar la playlist de la sala ${roomId}`);
      return;
    }
    if (!stored || stored.tracks.length === 0 || this.musicStateByRoom.has(roomCode)) return;
    this.musicStateByRoom.set(roomCode, {
      tracks: stored.tracks,
      currentIndex: Math.min(stored.currentIndex, stored.tracks.length - 1),
      isPlaying: false,
      positionSeconds: 0,
      updatedAt: Date.now(),
    });
  }

  private getUsersInRoom(roomCode: string): RoomUser[] {
    return Array.from(this.connectedUsers.values())
      .filter((user) => user.roomCode === roomCode)
      .map(({ participantId, userName, userId, nameColor }) => ({
        participantId,
        userName,
        userId,
        nameColor,
      }));
  }

  // Los invitados no tienen cuenta ni color guardado: devuelve undefined para
  // que el payload de presencia no incluya el campo en ese caso.
  private async getNameColor(userId?: string): Promise<string | null | undefined> {
    if (!userId) return undefined;
    const [account] = await this.db
      .select({ nameColor: users.nameColor })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return account?.nameColor;
  }
}

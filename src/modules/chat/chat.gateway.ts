import { Inject, UseGuards, UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { isURL } from 'class-validator';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { users } from '../../db/schema';
import { sanitizeAvatar, type UserAvatar } from '../auth/avatar';
import { UpdateAvatarDto } from '../auth/dto/update-avatar.dto';
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
import { afterTrackEnded, skipToNext, type PlaybackState } from './music-playback';
import { MusicModeDto } from './dto/music-mode.dto';
import { MusicVolumeDto } from './dto/music-volume.dto';
import { MusicTrackEndedDto } from './dto/music-track-ended.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { MusicAddTrackDto } from './dto/music-add-track.dto';
import { MusicPositionDto } from './dto/music-position.dto';
import { MusicTrackIndexDto } from './dto/music-track-index.dto';
import { CastPollVoteDto } from './dto/cast-poll-vote.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartRoomEventDto } from './dto/start-room-event.dto';
import { SetMediaLockDto } from './dto/set-media-lock.dto';
import { SetNameFocusDto } from './dto/set-name-focus.dto';
import { MEDIA_LOCK_EVENTS, NAME_FOCUS_EVENTS, type MediaLockState } from '@date2gether/shared';

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
  avatar?: UserAvatar | null;
}

// Shape pública de la presencia: mismos campos que ConnectedUser salvo los
// internos (roomId), para no declarar un segundo tipo con los mismos campos.
type RoomUser = Pick<
  ConnectedUser,
  'participantId' | 'userName' | 'userId' | 'nameColor' | 'avatar'
>;

interface MusicState extends PlaybackState {
  updatedAt: number;
  // Volumen que fija el admin para toda la sala (0-100); cada persona ajusta el suyo encima.
  roomVolume?: number;
}

interface RouletteEventState {
  type: 'roulette';
  participants: RoomUser[];
  winner: RoomUser;
  startedAt: number;
  expiresAt: number;
}

interface PollEventState {
  type: 'poll';
  question: string;
  options: string[];
  multipleChoice: boolean;
  anonymous: boolean;
  participants: RoomUser[];
  // participantId -> índices de opción elegidos; ausente = todavía no votó.
  votes: Record<string, number[]>;
  closed: boolean;
  startedAt: number;
  expiresAt: number;
}

type RoomEventState = RouletteEventState | PollEventState;

// Clients extrapolate from updatedAt, so refreshing it requires advancing the position too.
function livePosition(state: MusicState, now: number): number {
  if (!state.isPlaying) return state.positionSeconds;
  return state.positionSeconds + Math.max(0, now - state.updatedAt) / 1000;
}

// CORS origin is applied at runtime by CorsIoAdapter (see app-setup.ts).
@WebSocketGateway({ namespace: '/rooms' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly connectedUsers = new Map<string, ConnectedUser>();
  private readonly musicStateByRoom = new Map<string, MusicState>();
  private readonly eventStateByRoom = new Map<string, RoomEventState>();
  private readonly mediaLockByRoom = new Map<string, MediaLockState>();
  private readonly nameFocusByRoom = new Map<string, boolean>();
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
    // Mini salas (D12, design.md): señal únicamente, nunca el token de
    // LiveKit (ese se pide por HTTP autenticado, issueBreakoutToken). El
    // traslado es personal -- solo el participante trasladado tiene que
    // enterarse -- a diferencia del cierre, que es un broadcast a toda la
    // sala (cualquier occupant de esa mini sala puede estar escuchando).
    this.roomEvents.onBreakoutAssigned((event) => {
      this.emitToParticipant(event.roomCode, event.targetIdentity, 'breakout:assigned', {
        breakoutId: event.breakoutId,
        label: event.label,
        leavePolicy: event.leavePolicy,
        closesAt: event.closesAt,
      });
    });
    this.roomEvents.onBreakoutBroadcast((event) => {
      this.server.to(event.roomCode).emit(event.event, event.payload);
    });
    this.roomEvents.onBreakoutClosed((event) => {
      this.server.to(event.roomCode).emit('breakout:closed', { breakoutId: event.breakoutId });
    });
    // Decisión 2 (design.md "Señal de motivo de remoción"): mismo criterio
    // que breakout:assigned -- personal, nunca broadcast. targetIdentity ya
    // llega resuelto por el llamador (BreakoutRoomsService/
    // CallsWebhookService) como la sourceIdentity estable que corresponde
    // al socket real.
    this.roomEvents.onBreakoutRemoval((event) => {
      this.emitToParticipant(event.roomCode, event.targetIdentity, 'breakout:removal', {
        reason: event.reason,
      });
    });
    // La sala se borró: se avisa y se corta el chat. handleDisconnect limpia el estado en memoria.
    this.roomEvents.onRoomDeleted(({ roomCode }) => {
      this.server.to(roomCode).emit('roomDeleted');
      this.server.in(roomCode).disconnectSockets(true);
    });
    this.roomEvents.onRoomLinksChanged(({ roomCode }) => {
      this.server.to(roomCode).emit('roomLinksChanged');
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
    const account = await this.getAccountLook(participant.userId);
    const presence: RoomUser = {
      participantId: participant.sub,
      userName: participant.name,
      userId: participant.userId,
      nameColor: account?.nameColor,
      avatar: account?.avatar ?? undefined,
    };
    this.connectedUsers.set(client.id, {
      roomCode: dto.code,
      roomId: room.id,
      ...presence,
    });

    const history = await this.chatService.getHistory(room.id, room.isPermanent);
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

    const mediaLockState = this.mediaLockByRoom.get(dto.code);
    if (mediaLockState) client.emit(MEDIA_LOCK_EVENTS.state, mediaLockState);

    // A diferencia de mediaLockState (dos flags, ausente = "sin lock
    // todavía"), acá false YA es el default válido: siempre se emite.
    client.emit(NAME_FOCUS_EVENTS.state, { enabled: this.nameFocusByRoom.get(dto.code) ?? false });

    client.to(dto.code).emit('userJoined', presence);
  }

  // Solo en vivo: las cuentas además lo guardan con PATCH /auth/me/avatar.
  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('setAvatar')
  handleSetAvatar(@ConnectedSocket() client: Socket, @MessageBody() dto: UpdateAvatarDto) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;
    user.avatar = sanitizeAvatar(dto);
    this.server
      .to(user.roomCode)
      .emit('avatarChanged', { participantId: user.participantId, avatar: user.avatar });
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
    const now = Date.now();
    const state: MusicState = {
      tracks: [...(current?.tracks ?? []), { videoId, title }],
      currentIndex: current?.currentIndex ?? 0,
      isPlaying: current?.isPlaying ?? false,
      positionSeconds: current ? livePosition(current, now) : 0,
      mode: current?.mode ?? 'sequence',
      shuffle: current?.shuffle ?? false,
      played: current?.played ?? [0],
      updatedAt: now,
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
      positionSeconds: removingCurrent ? 0 : livePosition(current, Date.now()),
      mode: current.mode,
      shuffle: current.shuffle,
      played: [currentIndex],
      updatedAt: Date.now(),
    };
    this.setMusicState(user, state);
    this.server.to(user.roomCode).emit('musicState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage(MEDIA_LOCK_EVENTS.set)
  async handleSetMediaLock(@ConnectedSocket() client: Socket, @MessageBody() dto: SetMediaLockDto) {
    const user = await this.requireMediaLockAdmin(client);
    if (!user) return;

    const current = this.mediaLockByRoom.get(user.roomCode) ?? {
      audioLocked: false,
      videoLocked: false,
    };
    const state: MediaLockState = {
      audioLocked: dto.target === 'audio' ? dto.locked : current.audioLocked,
      videoLocked: dto.target === 'video' ? dto.locked : current.videoLocked,
    };
    this.mediaLockByRoom.set(user.roomCode, state);
    this.server.to(user.roomCode).emit(MEDIA_LOCK_EVENTS.state, state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage(NAME_FOCUS_EVENTS.set)
  async handleSetNameFocus(@ConnectedSocket() client: Socket, @MessageBody() dto: SetNameFocusDto) {
    const user = await this.requireNameFocusAdmin(client);
    if (!user) return;

    this.nameFocusByRoom.set(user.roomCode, dto.enabled);
    this.server.to(user.roomCode).emit(NAME_FOCUS_EVENTS.state, { enabled: dto.enabled });
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
      played: current.played.includes(dto.index) ? current.played : [...current.played, dto.index],
      updatedAt: Date.now(),
    };
    this.setMusicState(user, state);
    this.server.to(user.roomCode).emit('musicState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicNext')
  async handleMusicNext(@ConnectedSocket() client: Socket) {
    await this.updateMusicState(client, (state) => skipToNext(state) ?? state);
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
  @SubscribeMessage('musicSetMode')
  async handleMusicSetMode(@ConnectedSocket() client: Socket, @MessageBody() dto: MusicModeDto) {
    await this.updateMusicState(client, (state) => ({
      ...state,
      mode: dto.mode,
      shuffle: dto.shuffle,
      played: [state.currentIndex],
    }));
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicSetVolume')
  async handleMusicSetVolume(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MusicVolumeDto,
  ) {
    await this.updateMusicState(client, (state) => ({ ...state, roomVolume: dto.volume }));
  }

  // Any listener may report the end: the admin is not necessarily listening.
  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('musicTrackEnded')
  handleMusicTrackEnded(@ConnectedSocket() client: Socket, @MessageBody() dto: MusicTrackEndedDto) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;
    const current = this.musicStateByRoom.get(user.roomCode);
    if (!current?.isPlaying || current.updatedAt !== dto.updatedAt) return;
    const next: MusicState = { ...afterTrackEnded(current), updatedAt: Date.now() };
    this.setMusicState(user, next);
    this.server.to(user.roomCode).emit('musicState', next);
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

    const now = Date.now();
    const state: RoomEventState =
      dto.type === 'poll'
        ? {
            // Los ! son seguros: el ValidationPipe global ya corrió @ValidateIf
            // + @IsString/@IsArray/@IsBoolean sobre estos campos para type 'poll'
            // (ver start-room-event.dto.ts) antes de que el handler se ejecute.
            type: 'poll',
            question: dto.question!,
            options: dto.options!,
            multipleChoice: dto.multipleChoice!,
            anonymous: dto.anonymous!,
            participants,
            votes: {},
            closed: false,
            startedAt: now,
            expiresAt: now + ROOM_EVENT_TTL_MS,
          }
        : {
            type: 'roulette',
            participants,
            winner: participants[Math.floor(Math.random() * participants.length)],
            startedAt: now,
            expiresAt: now + ROOM_EVENT_TTL_MS,
          };
    this.eventStateByRoom.set(user.roomCode, state);
    this.server.to(user.roomCode).emit('eventStarted', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('castPollVote')
  handleCastPollVote(@ConnectedSocket() client: Socket, @MessageBody() dto: CastPollVoteDto) {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', { message: 'Tenés que unirte a una sala antes de votar' });
      return;
    }

    const state = this.eventStateByRoom.get(user.roomCode);
    if (!state || state.type !== 'poll' || state.closed) {
      client.emit('error', { message: 'No hay ninguna encuesta abierta en esta sala' });
      return;
    }
    if (!state.participants.some((p) => p.participantId === user.participantId)) {
      client.emit('error', { message: 'No estás participando en esta encuesta' });
      return;
    }
    const inRange = dto.optionIndexes.every((index) => index < state.options.length);
    if (!inRange) {
      client.emit('error', { message: 'Esa opción no existe en la encuesta' });
      return;
    }
    if (!state.multipleChoice && dto.optionIndexes.length > 1) {
      client.emit('error', { message: 'Esta encuesta solo permite elegir una opción' });
      return;
    }

    if (dto.optionIndexes.length === 0) {
      delete state.votes[user.participantId];
    } else {
      state.votes[user.participantId] = [...new Set(dto.optionIndexes)];
    }
    this.server.to(user.roomCode).emit('eventState', state);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('closePollEvent')
  async handleClosePollEvent(@ConnectedSocket() client: Socket) {
    const user = await this.requireEventModerator(client);
    if (!user) return;

    const state = this.eventStateByRoom.get(user.roomCode);
    if (!state || state.type !== 'poll' || state.closed) return;

    state.closed = true;
    this.server.to(user.roomCode).emit('eventState', state);
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
      this.mediaLockByRoom.delete(user.roomCode);
      this.nameFocusByRoom.delete(user.roomCode);
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

  // Misma regla que requireMusicAdmin (administrador exclusivo), pero con
  // mensajes propios: reusar requireMusicAdmin tal cual le mostraba al
  // participante errores de "música" al tocar un switch de mic/cámara.
  private async requireMediaLockAdmin(client: Socket): Promise<ConnectedUser | undefined> {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', {
        message: 'Tenés que unirte a una sala antes de silenciar a los demás',
      });
      return undefined;
    }
    if (!user.userId) {
      client.emit('error', {
        message: 'Necesitás una cuenta para silenciar a los demás en la sala',
      });
      return undefined;
    }
    const role = await this.roomsService.getMemberRole(user.roomCode, user.userId);
    if (role !== 'administrador') {
      client.emit('error', {
        message: 'Solo el administrador de la sala puede silenciar a los demás',
      });
      return undefined;
    }
    return user;
  }

  // Misma regla que requireMediaLockAdmin (administrador exclusivo), pero con
  // mensajes propios para el enfoque automático al nombrar.
  private async requireNameFocusAdmin(client: Socket): Promise<ConnectedUser | undefined> {
    const user = this.connectedUsers.get(client.id);
    if (!user) {
      client.emit('error', {
        message: 'Tenés que unirte a una sala antes de activar el enfoque automático',
      });
      return undefined;
    }
    if (!user.userId) {
      client.emit('error', {
        message: 'Necesitás una cuenta para activar el enfoque automático en la sala',
      });
      return undefined;
    }
    const role = await this.roomsService.getMemberRole(user.roomCode, user.userId);
    if (role !== 'administrador') {
      client.emit('error', {
        message: 'Solo el administrador de la sala puede activar el enfoque automático',
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

    const now = Date.now();
    const live = { ...current, positionSeconds: livePosition(current, now) };
    const next: MusicState = { ...apply(live), updatedAt: now };
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
      mode: 'sequence',
      shuffle: false,
      played: [Math.min(stored.currentIndex, stored.tracks.length - 1)],
      updatedAt: Date.now(),
    });
  }

  // Mini salas (D12): a diferencia de memberRoleChanged/roomEmojisChanged
  // (broadcast a toda la sala), breakout:assigned es personal. Todo socket
  // de Socket.io se autosuscribe a una room con su propio id, así que
  // emitir a ese id llega solo al cliente buscado sin tener que guardar un
  // mapa nuevo de participantId -> clientId.
  private emitToParticipant(
    roomCode: string,
    participantId: string,
    event: string,
    payload: unknown,
  ): void {
    for (const [clientId, user] of this.connectedUsers) {
      if (user.roomCode === roomCode && user.participantId === participantId) {
        this.server.to(clientId).emit(event, payload);
      }
    }
  }

  private getUsersInRoom(roomCode: string): RoomUser[] {
    return Array.from(this.connectedUsers.values())
      .filter((user) => user.roomCode === roomCode)
      .map(({ participantId, userName, userId, nameColor, avatar }) => ({
        participantId,
        userName,
        userId,
        nameColor,
        avatar,
      }));
  }

  // Los invitados no tienen cuenta: devuelve undefined para que el payload de
  // presencia no incluya esos campos (su avatar llega después por setAvatar).
  private async getAccountLook(
    userId?: string,
  ): Promise<{ nameColor: string | null; avatar: UserAvatar | null } | undefined> {
    if (!userId) return undefined;
    const [account] = await this.db
      .select({ nameColor: users.nameColor, avatar: users.avatar })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return account;
  }
}

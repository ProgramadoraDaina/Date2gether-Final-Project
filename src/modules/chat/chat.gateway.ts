import { Inject, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { RoomsService } from '../rooms/rooms.service';
import { ChatService } from './chat.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { MusicAddTrackDto } from './dto/music-add-track.dto';
import { MusicPositionDto } from './dto/music-position.dto';
import { MusicTrackIndexDto } from './dto/music-track-index.dto';
import { SendMessageDto } from './dto/send-message.dto';

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

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomsService: RoomsService,
    private readonly chatService: ChatService,
    private readonly roomEvents: RoomEventsService,
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
    const room = await this.roomsService.findByCode(dto.code);
    if (!room) {
      client.emit('error', { message: `No existe una sala con el código "${dto.code}"` });
      return;
    }

    const { participant } = client.data as { participant: RoomParticipant };
    if (!room.isActive) {
      client.emit('error', { message: 'La sala está cerrada' });
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
    const musicState = this.musicStateByRoom.get(dto.code);
    if (musicState) client.emit('musicState', musicState);

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
    this.musicStateByRoom.set(user.roomCode, state);
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
    this.musicStateByRoom.set(user.roomCode, state);
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
    this.musicStateByRoom.set(user.roomCode, state);
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

    // Los códigos de sala son efímeros: sin esto el mapa de música crecería
    // sin límite a medida que se van creando y vaciando salas nuevas.
    if (this.getUsersInRoom(user.roomCode).length === 0) {
      this.musicStateByRoom.delete(user.roomCode);
    }
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
    this.musicStateByRoom.set(user.roomCode, next);
    this.server.to(user.roomCode).emit('musicState', next);
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

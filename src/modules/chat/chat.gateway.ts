import { Inject, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { SendMessageDto } from './dto/send-message.dto';

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

@WebSocketGateway({
  namespace: '/rooms',
  cors: { origin: process.env.CORS_ORIGIN ?? '*' },
})
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly connectedUsers = new Map<string, ConnectedUser>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomsService: RoomsService,
    private readonly chatService: ChatService,
    private readonly roomEvents: RoomEventsService,
  ) {
    this.roomEvents.onMemberRoleChanged(({ roomCode }) => {
      this.server.to(roomCode).emit('memberRoleChanged');
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

    const message = await this.chatService.createMessage(user.roomId, user.userName, dto.content);
    this.server.to(user.roomCode).emit('newMessage', message);
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

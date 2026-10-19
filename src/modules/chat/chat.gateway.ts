import { UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { ChatService } from './chat.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { SendMessageDto } from './dto/send-message.dto';

interface ConnectedUser {
  roomCode: string;
  roomId: string;
  userName: string;
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

  constructor(
    private readonly roomsService: RoomsService,
    private readonly chatService: ChatService,
  ) {}

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() dto: JoinRoomDto) {
    const room = await this.roomsService.findByCode(dto.code);
    if (!room) {
      client.emit('error', { message: `No existe una sala con el código "${dto.code}"` });
      return;
    }

    await client.join(dto.code);
    this.connectedUsers.set(client.id, {
      roomCode: dto.code,
      roomId: room.id,
      userName: dto.userName,
    });

    const history = await this.chatService.getHistory(room.id);
    client.emit('roomHistory', history);
    client.emit('roomUsers', this.getUsersInRoom(dto.code));

    client.to(dto.code).emit('userJoined', { userName: dto.userName });
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    this.removeClient(client);
  }

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
    client.to(user.roomCode).emit('userLeft', { userName: user.userName });
  }

  private getUsersInRoom(roomCode: string): string[] {
    return Array.from(this.connectedUsers.values())
      .filter((user) => user.roomCode === roomCode)
      .map((user) => user.userName);
  }
}

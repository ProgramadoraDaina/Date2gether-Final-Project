import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { ChatService } from './chat.service';
import { ListChatMessagesDto } from './dto/list-chat-messages.dto';

@Controller('rooms/:roomCode/messages')
@UseGuards(RoomAccessGuard)
export class ChatHistoryController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: ParticipantRequest, @Query() query: ListChatMessagesDto) {
    return this.chat.getHistory(request.room.id, request.room.isPermanent, query);
  }
}

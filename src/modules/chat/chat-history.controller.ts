import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { ChatService } from './chat.service';
import { ListChatMessagesDto } from './dto/list-chat-messages.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROOM_PASS_AUTH } from '../../swagger';

@ApiTags('Chat')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('rooms/:roomCode/messages')
@UseGuards(RoomAccessGuard)
export class ChatHistoryController {
  constructor(private readonly chat: ChatService) {}

  @ApiOperation({
    summary: 'Get the chat history of a room',
    description: 'Requires a room pass for this room. History is only kept for permanent rooms.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: ParticipantRequest, @Query() query: ListChatMessagesDto) {
    return this.chat.getHistory(request.room.id, request.room.isPermanent, query);
  }
}

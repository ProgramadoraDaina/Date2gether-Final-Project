import { Controller, Header, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(RoomAccessGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post(':roomCode')
  @Header('Cache-Control', 'no-store')
  join(@Param('roomCode') roomCode: string, @Req() request: ParticipantRequest) {
    return this.callsService.join(roomCode, request.participant);
  }
}

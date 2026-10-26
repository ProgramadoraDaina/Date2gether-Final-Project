import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(RoomAccessGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post(':roomCode')
  async join(@Param('roomCode') roomCode: string, @Req() request: ParticipantRequest) {
    const meeting = await this.callsService.createMeetingForRoom(roomCode);
    const attendee = await this.callsService.createAttendee(
      meeting.MeetingId!,
      request.participant.sub,
    );
    return { meeting, attendee };
  }
}

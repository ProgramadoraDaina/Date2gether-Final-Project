import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post(':roomCode')
  createMeeting(@Param('roomCode') roomCode: string) {
    return this.callsService.createMeetingForRoom(roomCode);
  }

  @Post('meetings/:meetingId/attendees')
  createAttendee(@Param('meetingId') meetingId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.callsService.createAttendee(meetingId, user.sub);
  }
}

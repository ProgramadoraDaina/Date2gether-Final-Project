import { Body, Controller, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsService } from './calls.service';
import { ReportTrackStateDto } from './dto/report-track-state.dto';
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

@ApiTags('Calls')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('calls')
@UseGuards(RoomAccessGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @ApiOperation({
    summary: 'Join the call and get a LiveKit token',
    description: 'Requires a room pass for this room.',
  })
  @Post(':roomCode')
  @Header('Cache-Control', 'no-store')
  join(@Param('roomCode') roomCode: string, @Req() request: ParticipantRequest) {
    return this.callsService.join(roomCode, request.participant);
  }

  @ApiOperation({ summary: 'Report the mic/camera/screen state of the caller' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Post(':roomCode/track-state')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async reportTrackState(
    @Param('roomCode') roomCode: string,
    @Body() dto: ReportTrackStateDto,
    @Req() request: ParticipantRequest,
  ): Promise<void> {
    await this.callsService.reportTrackState(roomCode, request.participant, dto);
  }
}

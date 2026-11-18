import { Body, Controller, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsService } from './calls.service';
import { ReportTrackStateDto } from './dto/report-track-state.dto';

@Controller('calls')
@UseGuards(RoomAccessGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post(':roomCode')
  @Header('Cache-Control', 'no-store')
  join(@Param('roomCode') roomCode: string, @Req() request: ParticipantRequest) {
    return this.callsService.join(roomCode, request.participant);
  }

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

import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { GetTranscriptDto, SaveTranscriptLineDto } from './dto/save-transcript-line.dto';
import { TranscriptsService } from './transcripts.service';

@Controller('transcripts')
@UseGuards(RoomAccessGuard)
export class TranscriptsController {
  constructor(private readonly transcripts: TranscriptsService) {}

  @Post(':roomCode')
  save(
    @Param('roomCode') roomCode: string,
    @Body() dto: SaveTranscriptLineDto,
    @Req() request: ParticipantRequest,
  ) {
    // El nombre sale del pase verificado, no del body: nadie puede hablar en nombre de otro.
    return this.transcripts.save(roomCode, dto.callSid, request.participant.name, dto.content);
  }

  @Get(':roomCode')
  @Header('Cache-Control', 'no-store')
  getCall(@Param('roomCode') roomCode: string, @Query() dto: GetTranscriptDto) {
    return this.transcripts.getCall(roomCode, dto.callSid);
  }
}

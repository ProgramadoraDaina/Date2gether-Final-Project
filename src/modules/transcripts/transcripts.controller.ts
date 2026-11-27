import { Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { GetTranscriptDto, SaveTranscriptLineDto } from './dto/save-transcript-line.dto';
import { TranscriptsService } from './transcripts.service';
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

@ApiTags('Transcripts')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('transcripts')
@UseGuards(RoomAccessGuard)
export class TranscriptsController {
  constructor(private readonly transcripts: TranscriptsService) {}

  @ApiOperation({
    summary: 'Save a transcript line',
    description: 'The speaker name comes from the verified room pass, not from the body.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Post(':roomCode')
  save(@Body() dto: SaveTranscriptLineDto, @Req() request: ParticipantRequest) {
    // El nombre sale del pase verificado, no del body: nadie puede hablar en nombre de otro.
    return this.transcripts.save(
      request.room.id,
      dto.callSid,
      request.participant.name,
      dto.content,
    );
  }

  @ApiOperation({ summary: 'Get the transcript of a call in a room' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Get(':roomCode')
  @Header('Cache-Control', 'no-store')
  getCall(@Query() dto: GetTranscriptDto, @Req() request: ParticipantRequest) {
    return this.transcripts.getCall(request.room.id, dto.callSid);
  }
}

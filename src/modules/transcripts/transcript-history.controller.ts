import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TranscriptHistoryService } from './transcript-history.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../swagger';

// Clase aparte: el guard de TranscriptsController (pase de sala) se heredaría a nivel clase.
@ApiTags('Transcripts')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@ApiForbiddenResponse({ description: 'The account did not participate in that session' })
@ApiNotFoundResponse({ description: 'Session not found' })
@Controller('calls/sessions')
@UseGuards(JwtAuthGuard)
export class TranscriptHistoryController {
  constructor(private readonly history: TranscriptHistoryService) {}

  @ApiOperation({ summary: 'Resolve a LiveKit room sid to a call session of the account' })
  @Get('by-sid/:livekitRoomSid')
  resolveBySid(
    @Param('livekitRoomSid') livekitRoomSid: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.history.resolveBySid(livekitRoomSid, user.sub);
  }

  @ApiOperation({ summary: 'Get the transcript of a call session' })
  @ApiBadRequestResponse({ description: 'Invalid sessionId' })
  @Get(':sessionId/transcript')
  @Header('Cache-Control', 'no-store')
  getForSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.history.getForSession(sessionId, user.sub);
  }
}

import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallTimelineService } from './call-timeline.service';
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

// Controlador separado (mismo razonamiento que CallHistoryController): los
// guards de Nest se acumulan a nivel clase, así que compartir clase con
// CallsController heredaría su RoomAccessGuard. Estas rutas son de lectura
// exclusivas de cuentas registradas, por eso usan JwtAuthGuard.
@ApiTags('Call history')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@ApiForbiddenResponse({ description: 'The account did not participate in that session or room' })
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallTimelineController {
  constructor(private readonly callTimelineService: CallTimelineService) {}

  @ApiOperation({ summary: 'List call sessions the authenticated account took part in' })
  @Get('sessions')
  listSessions(@CurrentUser() user: AccessTokenPayload) {
    return this.callTimelineService.listSessions(user.sub);
  }

  @ApiOperation({ summary: 'List archived call sessions of a room (paginated by session id)' })
  @ApiBadRequestResponse({ description: 'Invalid UUID in roomId or before' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @Get('rooms/:roomId/archive')
  @Header('Cache-Control', 'no-store')
  listRoomArchive(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('before', new ParseUUIDPipe({ optional: true })) before: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.callTimelineService.listRoomArchive(roomId, user.sub, before);
  }

  @ApiOperation({ summary: 'Get the participation timeline of a call session' })
  @ApiBadRequestResponse({ description: 'Invalid sessionId' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @Get('sessions/:sessionId/timeline')
  getSessionTimeline(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.callTimelineService.getSessionTimeline(sessionId, user.sub);
  }
}

import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallTimelineService } from './call-timeline.service';

// Controlador separado (mismo razonamiento que CallHistoryController): los
// guards de Nest se acumulan a nivel clase, así que compartir clase con
// CallsController heredaría su RoomAccessGuard. Estas rutas son de lectura
// exclusivas de cuentas registradas, por eso usan JwtAuthGuard.
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallTimelineController {
  constructor(private readonly callTimelineService: CallTimelineService) {}

  @Get('sessions')
  listSessions(@CurrentUser() user: AccessTokenPayload) {
    return this.callTimelineService.listSessions(user.sub);
  }

  @Get('rooms/:roomId/archive')
  @Header('Cache-Control', 'no-store')
  listRoomArchive(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('before', new ParseUUIDPipe({ optional: true })) before: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.callTimelineService.listRoomArchive(roomId, user.sub, before);
  }

  @Get('sessions/:sessionId/timeline')
  getSessionTimeline(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.callTimelineService.getSessionTimeline(sessionId, user.sub);
  }
}

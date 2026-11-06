import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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

  @Get('sessions/:sessionId/timeline')
  getSessionTimeline(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.callTimelineService.getSessionTimeline(sessionId, user.sub);
  }
}

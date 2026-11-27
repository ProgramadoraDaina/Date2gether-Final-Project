import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TranscriptHistoryService } from './transcript-history.service';

// Clase aparte: el guard de TranscriptsController (pase de sala) se heredaría a nivel clase.
@Controller('calls/sessions')
@UseGuards(JwtAuthGuard)
export class TranscriptHistoryController {
  constructor(private readonly history: TranscriptHistoryService) {}

  @Get('by-sid/:livekitRoomSid')
  resolveBySid(
    @Param('livekitRoomSid') livekitRoomSid: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.history.resolveBySid(livekitRoomSid, user.sub);
  }

  @Get(':sessionId/transcript')
  @Header('Cache-Control', 'no-store')
  getForSession(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.history.getForSession(sessionId, user.sub);
  }
}

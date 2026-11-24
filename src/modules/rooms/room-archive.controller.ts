import { Controller, Delete, HttpCode, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomArchiveService } from './room-archive.service';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomArchiveController {
  constructor(private readonly archive: RoomArchiveService) {}

  @Delete(':roomId/archive')
  @HttpCode(204)
  clear(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.archive.clear(roomId, user.sub);
  }
}

import { Controller, Delete, HttpCode, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomArchiveService } from './room-archive.service';
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

@ApiTags('Rooms')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomArchiveController {
  constructor(private readonly archive: RoomArchiveService) {}

  @ApiOperation({ summary: 'Clear the archived history of a room for the authenticated account' })
  @ApiBadRequestResponse({ description: 'Invalid roomId' })
  @ApiForbiddenResponse({ description: 'Account is not allowed to clear this room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @Delete(':roomId/archive')
  @HttpCode(204)
  clear(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.archive.clear(roomId, user.sub);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { RoomRoles } from '../rooms/decorators/room-roles.decorator';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { CreateRoomLinkDto } from './dto/create-room-link.dto';
import { RoomLinksService } from './room-links.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH, ROOM_PASS_AUTH } from '../../swagger';

// Reading uses the room token (guests too); writing needs an account with a room role.
@ApiTags('Room links')
@Controller('rooms')
export class RoomLinksController {
  constructor(private readonly roomLinks: RoomLinksService) {}

  @ApiOperation({
    summary: 'List the link library of a room',
    description: 'Requires a room pass for this room (guests included).',
  })
  @ApiBearerAuth(ROOM_PASS_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
  @ApiForbiddenResponse({ description: 'Room pass was issued for a different room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(RoomAccessGuard)
  @Get(':roomCode/links')
  list(@Req() request: ParticipantRequest) {
    return this.roomLinks.list(request.room.id);
  }

  @ApiOperation({
    summary: 'Add a link to the room library',
    description:
      'Requires room role: administrador or colaborador. Only permanent rooms have a library.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'The link is already in the library' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Room is not permanent, not a member, or room role not allowed',
  })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @Post(':code/links')
  add(
    @Param('code') code: string,
    @Body() dto: CreateRoomLinkDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roomLinks.add(code, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Remove a link from the room library',
    description: 'Requires room role: administrador or colaborador.',
  })
  @ApiBadRequestResponse({ description: 'Invalid link id' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description:
      'Not a member of the room, or room role not allowed (requires: administrador, colaborador)',
  })
  @ApiNotFoundResponse({ description: 'Room or link not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @Delete(':code/links/:id')
  @HttpCode(204)
  async remove(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.roomLinks.remove(code, id);
  }
}

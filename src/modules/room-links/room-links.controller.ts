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

// Reading uses the room token (guests too); writing needs an account with a room role.
@Controller('rooms')
export class RoomLinksController {
  constructor(private readonly roomLinks: RoomLinksService) {}

  @UseGuards(RoomAccessGuard)
  @Get(':roomCode/links')
  list(@Req() request: ParticipantRequest) {
    return this.roomLinks.list(request.room.id);
  }

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

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @Delete(':code/links/:id')
  @HttpCode(204)
  async remove(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.roomLinks.remove(code, id);
  }
}

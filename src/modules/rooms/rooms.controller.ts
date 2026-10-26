import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomRoles } from './decorators/room-roles.decorator';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateRoomDto, @CurrentUser() user: AccessTokenPayload) {
    return this.roomsService.createRoom(dto.name, user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.roomsService.getByCodeOrThrow(code);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':code/join')
  async join(@Param('code') code: string, @CurrentUser() user: AccessTokenPayload) {
    await this.roomsService.joinRoom(code, user.sub);
    return { message: 'Te uniste a la sala' };
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @Get(':code/members')
  listMembers(@Param('code') code: string) {
    return this.roomsService.listMembers(code);
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch(':code/members/:userId')
  async updateMemberRole(
    @Param('code') code: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    await this.roomsService.setMemberRole(code, userId, dto.role);
    return { message: 'Rol actualizado' };
  }
}

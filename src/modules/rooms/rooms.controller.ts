import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
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
import { SetMyRoomVisibilityDto } from './dto/set-my-room-visibility.dto';
import { UpdateRoomNameDto } from './dto/update-room-name.dto';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomsService } from './rooms.service';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { SaveRoomNotesDto } from './dto/save-room-notes.dto';
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

@ApiTags('Rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @ApiOperation({
    summary: 'Get the shared notes of a room',
    description: 'Requires a room pass for this room.',
  })
  @ApiBearerAuth(ROOM_PASS_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
  @ApiForbiddenResponse({ description: 'Room pass was issued for a different room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(RoomAccessGuard)
  @Get(':roomCode/notes')
  getRoomNotes(@Param('roomCode') roomCode: string) {
    return this.roomsService.getRoomNotes(roomCode);
  }

  @ApiOperation({
    summary: 'Save the shared notes of a room',
    description: 'Requires a room pass for this room. Uses an optimistic revision number.',
  })
  @ApiBearerAuth(ROOM_PASS_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
  @ApiForbiddenResponse({ description: 'Room pass was issued for a different room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Someone else updated the notes (stale revision)' })
  @UseGuards(RoomAccessGuard)
  @Patch(':roomCode/notes')
  saveRoomNotes(@Param('roomCode') roomCode: string, @Body() dto: SaveRoomNotesDto) {
    return this.roomsService.saveRoomNotes(roomCode, dto.content, dto.revision);
  }

  @ApiOperation({ summary: 'Create a room', description: 'The creator becomes its administrador.' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateRoomDto, @CurrentUser() user: AccessTokenPayload) {
    return this.roomsService.createRoom(dto.name, user.sub, {
      isPermanent: dto.isPermanent,
      slots: dto.slots,
    });
  }

  // Must stay above @Get(':code') or "mine" is matched as a room code.
  @ApiOperation({ summary: 'List the rooms owned by the authenticated account' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  @Header('Cache-Control', 'no-store')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.roomsService.listOwnedRooms(user.sub);
  }

  @ApiOperation({ summary: 'Hide or show an owned room in the account list' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Room not found in the account list' })
  @UseGuards(JwtAuthGuard)
  @Patch('mine/:roomId/visibility')
  @HttpCode(204)
  setMyRoomVisibility(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: SetMyRoomVisibilityDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roomsService.setMyRoomVisibility(roomId, user.sub, dto.hidden);
  }

  @ApiOperation({
    summary: 'Get a room by code',
    description: 'Public: no authentication required.',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @Get(':code')
  async findOne(@Param('code') code: string) {
    const {
      historyDeletedBefore: _deleted,
      historyCleanupPending: _pending,
      ...room
    } = await this.roomsService.getByCodeOrThrow(code);
    return room;
  }

  @ApiOperation({
    summary: 'Join a room as a member',
    description: 'Requires an account. Rooms that need approval reject non-admitted accounts.',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({ description: 'Admission required to join this room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard)
  @Post(':code/join')
  async join(@Param('code') code: string, @CurrentUser() user: AccessTokenPayload) {
    await this.roomsService.joinRoom(code, user.sub);
    return { message: 'Te uniste a la sala' };
  }

  @ApiOperation({
    summary: 'List the members of a room',
    description: 'Requires room membership (any room role).',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @Get(':code/members')
  listMembers(@Param('code') code: string) {
    return this.roomsService.listMembers(code);
  }

  @ApiOperation({
    summary: 'Change the room role of a member',
    description:
      'Requires room role: administrador. The room must keep at least one administrador and the owner keeps their permissions.',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not an administrador of the room, or the change is not allowed',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Room or member not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch(':code/members/:userId')
  async updateMemberRole(
    @Param('code') code: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.roomsService.setMemberRole(code, userId, dto.role, user.sub);
    return { message: 'Rol actualizado' };
  }

  @ApiOperation({ summary: 'Rename a room', description: 'Requires room role: administrador.' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({ description: 'Not an administrador of the room' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch(':code/name')
  async renameRoom(@Param('code') code: string, @Body() dto: UpdateRoomNameDto) {
    await this.roomsService.renameRoom(code, dto.name);
    return { message: 'Nombre actualizado' };
  }

  // Temporal -> permanente, irreversible e idempotente (200 con la sala si ya lo era).
  // El rol "administrador" se valida en el service (en la misma transacción que bloquea la
  // fila), no con RoomRolesGuard: 404 sala inexistente/vencida, 403 si no es administrador.
  @ApiOperation({
    summary: 'Promote a temporary room to permanent',
    description:
      'Irreversible and idempotent. Requires room role: administrador (checked in the service).',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({ description: 'Not an administrador of the room' })
  @ApiNotFoundResponse({ description: 'Room not found or expired' })
  @UseGuards(JwtAuthGuard)
  @Patch(':code/permanent')
  async promoteToPermanent(@Param('code') code: string, @CurrentUser() user: AccessTokenPayload) {
    const {
      historyDeletedBefore: _deleted,
      historyCleanupPending: _pending,
      ...room
    } = await this.roomsService.promoteToPermanent(code, user.sub);
    return room;
  }

  // El rol "administrador" de la sala se valida en el service (ver deleteRoomAsAdmin).
  @ApiOperation({
    summary: 'Delete a room',
    description: 'Requires room role: administrador (checked in the service).',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({ description: 'Not an administrador of the room' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard)
  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRoom(
    @Param('code') code: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    await this.roomsService.deleteRoomAsAdmin(code, user.sub);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import {
  BreakoutRoomsService,
  type BreakoutRoomAdminView,
  type BreakoutRoomPublicView,
} from './breakout-rooms.service';
import { CreateBreakoutRoomDto } from './dto/create-breakout-room.dto';
import { MoveParticipantDto } from './dto/move-participant.dto';
import { RecallBreakoutRoomsDto } from './dto/recall-breakout-rooms.dto';
import { ReturnOccupantDto } from './dto/return-occupant.dto';
import { UpdateBreakoutRoomDto } from './dto/update-breakout-room.dto';
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
import { ROOM_PASS_AUTH } from '../../swagger';

@ApiTags('Breakout rooms')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('calls')
@UseGuards(RoomAccessGuard)
export class BreakoutRoomsController {
  constructor(private readonly breakoutRooms: BreakoutRoomsService) {}

  @ApiOperation({
    summary: 'Create a breakout room',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Maximum number of simultaneous breakout rooms reached' })
  @Post(':roomCode/breakouts')
  create(@Req() request: ParticipantRequest, @Body() dto: CreateBreakoutRoomDto) {
    return this.breakoutRooms.create(request.room.id, request.room.code, request.participant, dto);
  }

  // Decisión 4 (design.md "Proyección de list por rol", tasks.md 4.2): el
  // tipo de retorno documenta explícitamente la unión discriminada por rol
  // -- la proyección real vive en BreakoutRoomsService.list().
  @ApiOperation({
    summary: 'List open breakout rooms',
    description: 'Administrators get the admin view; other participants get the public view.',
  })
  @Get(':roomCode/breakouts')
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: ParticipantRequest,
  ): Promise<BreakoutRoomAdminView[] | BreakoutRoomPublicView[]> {
    return this.breakoutRooms.list(request.room.id, request.participant);
  }

  @ApiOperation({
    summary: 'Update the policy of a breakout room',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Breakout room not found or already closed' })
  @Patch(':roomCode/breakouts/:breakoutId')
  updatePolicy(
    @Req() request: ParticipantRequest,
    @Param('breakoutId', ParseUUIDPipe) breakoutId: string,
    @Body() dto: UpdateBreakoutRoomDto,
  ) {
    return this.breakoutRooms.updatePolicy(breakoutId, request.room.id, request.participant, dto);
  }

  @ApiOperation({
    summary: 'Move a participant into a breakout room',
    description:
      'Administrators can move anyone; others only where the breakout policy allows joining.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Breakout room or participant not found' })
  @ApiConflictResponse({ description: 'Breakout room is at capacity' })
  @Post(':roomCode/breakouts/:breakoutId/participants')
  moveIn(
    @Req() request: ParticipantRequest,
    @Param('breakoutId', ParseUUIDPipe) breakoutId: string,
    @Body() dto: MoveParticipantDto,
  ) {
    return this.breakoutRooms.moveIn(breakoutId, request.room.id, request.participant, dto);
  }

  @ApiOperation({
    summary: 'Get a LiveKit token for an assigned breakout room',
    description: 'Requires an assignment in that breakout room (or room role: administrador).',
  })
  @ApiNotFoundResponse({ description: 'Breakout room not found or already closed' })
  @Post(':roomCode/breakouts/:breakoutId/token')
  @Header('Cache-Control', 'no-store')
  issueToken(
    @Req() request: ParticipantRequest,
    @Param('breakoutId', ParseUUIDPipe) breakoutId: string,
  ) {
    return this.breakoutRooms.issueBreakoutToken(breakoutId, request.room.id, request.participant);
  }

  @ApiOperation({
    summary: 'Return from a breakout room to the main room',
    description:
      'Participants return themselves; returning someone else requires room role: administrador. Locked breakouts only let administrators leave.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Breakout room or occupant not found' })
  @Post(':roomCode/breakouts/:breakoutId/return')
  @HttpCode(204)
  async selfReturn(
    @Req() request: ParticipantRequest,
    @Param('breakoutId', ParseUUIDPipe) breakoutId: string,
    @Body() dto: ReturnOccupantDto,
  ): Promise<void> {
    await this.breakoutRooms.selfReturn(
      breakoutId,
      request.room.id,
      request.participant,
      dto.livekitIdentity,
    );
  }

  @ApiOperation({
    summary: 'Close a breakout room',
    description: 'Requires room role: administrador.',
  })
  @ApiNotFoundResponse({ description: 'Breakout room not found' })
  @ApiConflictResponse({ description: 'Breakout room was already closed' })
  @Delete(':roomCode/breakouts/:breakoutId')
  @HttpCode(204)
  async close(
    @Req() request: ParticipantRequest,
    @Param('breakoutId', ParseUUIDPipe) breakoutId: string,
  ): Promise<void> {
    await this.breakoutRooms.close(breakoutId, request.room.id, request.participant, 'manual');
  }

  @ApiOperation({
    summary: 'Call everyone back from the breakout rooms',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'No open breakout rooms' })
  @Post(':roomCode/breakouts/recall')
  recall(@Req() request: ParticipantRequest, @Body() dto: RecallBreakoutRoomsDto) {
    return this.breakoutRooms.recall(request.room.id, request.participant, dto);
  }

  @ApiOperation({
    summary: 'Close all breakout rooms',
    description: 'Requires room role: administrador.',
  })
  @Delete(':roomCode/breakouts')
  @HttpCode(204)
  async closeAll(@Req() request: ParticipantRequest): Promise<void> {
    await this.breakoutRooms.closeAll(request.room.id, request.participant);
  }
}

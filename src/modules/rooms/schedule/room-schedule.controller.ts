import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RoomRoles } from '../decorators/room-roles.decorator';
import { CreateScheduleSlotDto } from '../dto/create-schedule-slot.dto';
import { RoomRolesGuard } from '../guards/room-roles.guard';
import { RoomResolverService } from '../room-resolver.service';
import { RoomScheduleService } from './room-schedule.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../../swagger';

// Two deliberately asymmetric endpoints (design.md D6): `next` is public and
// its response shape has no field that could ever carry the owner's
// timezone; `slots` is admin-only and returns it. The asymmetry is enforced
// by the response shape itself, not by remembering to strip a field.
@ApiTags('Room schedule')
@Controller('rooms/:code/schedule')
export class RoomScheduleController {
  constructor(
    private readonly schedule: RoomScheduleService,
    private readonly resolver: RoomResolverService,
  ) {}

  @ApiOperation({
    summary: 'Get the next scheduled occurrence of a room',
    description: 'Public. Never exposes the owner timezone.',
  })
  @ApiNotFoundResponse({ description: 'Room not found or expired' })
  @Get('next')
  async next(@Param('code') code: string) {
    const room = await this.resolver.resolveJoinable(code);
    const nextOccurrenceAt = await this.schedule.getNextOccurrence(room.id);
    return { nextOccurrenceAt: nextOccurrenceAt ? nextOccurrenceAt.toISOString() : null };
  }

  @ApiOperation({
    summary: 'List the schedule slots of a room',
    description: 'Requires room role: administrador.',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Get('slots')
  async listSlots(@Param('code') code: string) {
    const room = await this.resolver.resolveJoinable(code);
    return this.schedule.listSlots(room.id);
  }

  @ApiOperation({
    summary: 'Create a schedule slot',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Post('slots')
  async createSlot(@Param('code') code: string, @Body() dto: CreateScheduleSlotDto) {
    const room = await this.resolver.resolveJoinable(code);
    return this.schedule.createSlot(room.id, dto);
  }

  @ApiOperation({
    summary: 'Delete a schedule slot',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Invalid slotId' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Delete('slots/:slotId')
  async deleteSlot(@Param('code') code: string, @Param('slotId', ParseUUIDPipe) slotId: string) {
    const room = await this.resolver.resolveJoinable(code);
    await this.schedule.deleteSlot(room.id, slotId);
  }
}

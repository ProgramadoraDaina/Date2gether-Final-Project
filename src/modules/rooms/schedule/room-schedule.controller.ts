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

// Two deliberately asymmetric endpoints (design.md D6): `next` is public and
// its response shape has no field that could ever carry the owner's
// timezone; `slots` is admin-only and returns it. The asymmetry is enforced
// by the response shape itself, not by remembering to strip a field.
@Controller('rooms/:code/schedule')
export class RoomScheduleController {
  constructor(
    private readonly schedule: RoomScheduleService,
    private readonly resolver: RoomResolverService,
  ) {}

  @Get('next')
  async next(@Param('code') code: string) {
    const room = await this.resolver.resolveJoinable(code);
    const nextOccurrenceAt = await this.schedule.getNextOccurrence(room.id);
    return { nextOccurrenceAt: nextOccurrenceAt ? nextOccurrenceAt.toISOString() : null };
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Get('slots')
  async listSlots(@Param('code') code: string) {
    const room = await this.resolver.resolveJoinable(code);
    return this.schedule.listSlots(room.id);
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Post('slots')
  async createSlot(@Param('code') code: string, @Body() dto: CreateScheduleSlotDto) {
    const room = await this.resolver.resolveJoinable(code);
    return this.schedule.createSlot(room.id, dto);
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Delete('slots/:slotId')
  async deleteSlot(@Param('code') code: string, @Param('slotId', ParseUUIDPipe) slotId: string) {
    const room = await this.resolver.resolveJoinable(code);
    await this.schedule.deleteSlot(room.id, slotId);
  }
}

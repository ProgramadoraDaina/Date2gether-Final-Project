import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RoomAccessGuard, type ParticipantRequest } from '../auth/guards/room-access.guard';
import { BreakoutRoomsService } from './breakout-rooms.service';
import { CreateBreakoutRoomDto } from './dto/create-breakout-room.dto';
import { MoveParticipantDto } from './dto/move-participant.dto';
import { ReturnOccupantDto } from './dto/return-occupant.dto';
import { UpdateBreakoutRoomDto } from './dto/update-breakout-room.dto';

@Controller('calls')
@UseGuards(RoomAccessGuard)
export class BreakoutRoomsController {
  constructor(private readonly breakoutRooms: BreakoutRoomsService) {}

  @Post(':roomCode/breakouts')
  create(@Req() request: ParticipantRequest, @Body() dto: CreateBreakoutRoomDto) {
    return this.breakoutRooms.create(request.room.id, request.room.code, request.participant, dto);
  }

  @Get(':roomCode/breakouts')
  @Header('Cache-Control', 'no-store')
  list(@Req() request: ParticipantRequest) {
    return this.breakoutRooms.list(request.room.id, request.participant);
  }

  @Patch(':roomCode/breakouts/:breakoutId')
  updatePolicy(
    @Req() request: ParticipantRequest,
    @Param('breakoutId') breakoutId: string,
    @Body() dto: UpdateBreakoutRoomDto,
  ) {
    return this.breakoutRooms.updatePolicy(breakoutId, request.room.id, request.participant, dto);
  }

  @Post(':roomCode/breakouts/:breakoutId/participants')
  moveIn(
    @Req() request: ParticipantRequest,
    @Param('breakoutId') breakoutId: string,
    @Body() dto: MoveParticipantDto,
  ) {
    return this.breakoutRooms.moveIn(breakoutId, request.room.id, request.participant, dto);
  }

  @Post(':roomCode/breakouts/:breakoutId/token')
  @Header('Cache-Control', 'no-store')
  issueToken(@Req() request: ParticipantRequest, @Param('breakoutId') breakoutId: string) {
    return this.breakoutRooms.issueBreakoutToken(breakoutId, request.room.id, request.participant);
  }

  @Post(':roomCode/breakouts/:breakoutId/return')
  @HttpCode(204)
  async selfReturn(
    @Req() request: ParticipantRequest,
    @Param('breakoutId') breakoutId: string,
    @Body() dto: ReturnOccupantDto,
  ): Promise<void> {
    await this.breakoutRooms.selfReturn(
      breakoutId,
      request.room.id,
      request.participant,
      dto.livekitIdentity,
    );
  }

  @Delete(':roomCode/breakouts/:breakoutId')
  @HttpCode(204)
  async close(
    @Req() request: ParticipantRequest,
    @Param('breakoutId') breakoutId: string,
  ): Promise<void> {
    await this.breakoutRooms.close(breakoutId, request.room.id, request.participant, 'manual');
  }

  @Delete(':roomCode/breakouts')
  @HttpCode(204)
  async closeAll(@Req() request: ParticipantRequest): Promise<void> {
    await this.breakoutRooms.closeAll(request.room.id, request.participant);
  }
}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomEventsService } from './room-events.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomRolesGuard, RoomEventsService],
  exports: [RoomsService, RoomEventsService],
})
export class RoomsModule {}

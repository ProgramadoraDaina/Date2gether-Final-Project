import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomEventsService } from './room-events.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomRolesGuard, RoomEventsService],
  exports: [RoomsService, RoomEventsService],
})
export class RoomsModule {}

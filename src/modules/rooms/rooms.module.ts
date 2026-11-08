import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomEventsService } from './room-events.service';
import { RoomAdmissionController } from './room-admission.controller';
import { RoomAdmissionService } from './room-admission.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [RoomsController, RoomAdmissionController],
  providers: [RoomAdmissionService, RoomsService, RoomRolesGuard, RoomEventsService],
  exports: [RoomsService, RoomEventsService],
})
export class RoomsModule {}

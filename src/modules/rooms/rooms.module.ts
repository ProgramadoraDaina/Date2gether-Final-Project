import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomEventsService } from './room-events.service';
import { RoomAdmissionController } from './room-admission.controller';
import { RoomAdmissionService } from './room-admission.service';
import { RoomResolverModule } from './room-resolver.module';
import { RoomScheduleController } from './schedule/room-schedule.controller';
import { RoomScheduleService } from './schedule/room-schedule.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomArchiveController } from './room-archive.controller';
import { RoomArchiveService } from './room-archive.service';

@Module({
  imports: [JwtAuthModule, RoomResolverModule],
  controllers: [
    RoomsController,
    RoomAdmissionController,
    RoomScheduleController,
    RoomArchiveController,
  ],
  providers: [
    RoomAdmissionService,
    RoomsService,
    RoomRolesGuard,
    RoomEventsService,
    RoomScheduleService,
    RoomArchiveService,
  ],
  exports: [RoomsService, RoomEventsService],
})
export class RoomsModule {}

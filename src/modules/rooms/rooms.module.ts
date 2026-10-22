import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoomAdminGuard } from './guards/room-admin.guard';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomAdminGuard],
  exports: [RoomsService],
})
export class RoomsModule {}

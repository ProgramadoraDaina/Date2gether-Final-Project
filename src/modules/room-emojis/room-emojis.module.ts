import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { RoomsModule } from '../rooms/rooms.module';
import { RoomEmojisController } from './room-emojis.controller';
import { RoomEmojisService } from './room-emojis.service';

@Module({
  imports: [JwtAuthModule, RoomsModule],
  controllers: [RoomEmojisController],
  providers: [RoomEmojisService, RoomRolesGuard],
})
export class RoomEmojisModule {}

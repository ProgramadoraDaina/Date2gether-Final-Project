import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoomLinksController } from './room-links.controller';
import { RoomLinksService } from './room-links.service';

@Module({
  imports: [JwtAuthModule, RoomsModule, RoomResolverModule],
  controllers: [RoomLinksController],
  providers: [RoomLinksService, RoomRolesGuard],
})
export class RoomLinksModule {}

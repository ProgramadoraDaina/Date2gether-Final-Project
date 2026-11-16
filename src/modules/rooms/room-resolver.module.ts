import { Module } from '@nestjs/common';
import { RoomResolverService } from './room-resolver.service';

// Leaf module: imports nothing. DrizzleModule is @Global(), so this breaks
// what would otherwise be a RoomsModule <-> JwtAuthModule import cycle.
@Module({
  providers: [RoomResolverService],
  exports: [RoomResolverService],
})
export class RoomResolverModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { GifsController } from './gifs.controller';
import { GifsService } from './gifs.service';

@Module({
  // RoomResolverModule explícito: GifsController es RoomAccessGuard-protected
  // (accepted cost documentado en design.md D4/tasks.md 2.21 -- antes no
  // tocaba la base, ahora paga un SELECT indexado por búsqueda).
  imports: [ConfigModule, JwtAuthModule, RoomResolverModule],
  controllers: [GifsController],
  providers: [GifsService],
})
export class GifsModule {}
